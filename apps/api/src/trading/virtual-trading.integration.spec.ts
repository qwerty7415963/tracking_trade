import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";
import { ApprovalFlowService } from "./approval-flow.service";
import { SignalsService } from "../signals/signals.service";
import { VirtualTradingService } from "./virtual-trading.service";

// Live-DB, mocked market data (no network).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

const SPEC = {
  coin: "ETH",
  szDecimals: 4,
  minSize: 0.001,
  sizeIncrement: 0.001,
  maintenanceMarginRate: 0.01,
};

describeIntegration("Virtual trading flow (live DB, mocked market)", () => {
  it("approve opens, TP1 closes 50%, TP2 closes rest", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MarketDataService)
      .useValue({
        resolveCoin: jest.fn(async () => "ETH"),
        getMid: jest.fn(async () => 3000),
        getAllMids: jest.fn(async () => ({ ETH: 3000 })),
        assetSpec: jest.fn(async () => SPEC),
      })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const flow = app.get(ApprovalFlowService);
    const trading = app.get(VirtualTradingService);
    const prisma = app.get(PrismaService);

    const account = await prisma.virtualAccount.create({
      data: { name: "it-flow", balance: 10000, leverage: 10, mode: "APPROVE" },
    });
    const source = await prisma.source.create({
      data: {
        platform: "TELEGRAM",
        externalSourceId: `it-flow-${Date.now()}`,
        displayName: "IT",
        sourceKind: "SIGNAL",
      },
    });
    const message = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "m1",
        contentRaw: "BUY ETH limit Entry: 3000 SL: 2900 TP1: 3100 TP2: 3200",
        contentHash: "h-it",
      },
    });
    // Ingest via service to get a real parsed signal.
    const signals = app.get(SignalsService);
    const outcome = await signals.ingestSourceMessage(message.id, "tester");
    expect(outcome.kind).toBe("SIGNAL");
    const signalId = outcome.signalId as string;

    const full = await signals.get(signalId);
    const out = await flow.approveSignal(
      signalId,
      { signalVersionId: full.versions[0].id },
      "alice",
      account.id,
    );
    expect(out.openError).toBeNull();
    const positionId = (out.position as { id: string }).id;

    let position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    // risk $50 over $100 stop = 0.5 units
    expect(Number(position.size)).toBe(0.5);
    expect(position.status).toBe("OPEN");

    // TP1 hit at 3100 -> closes 50%.
    const tp1 = await trading.applyTpHit(positionId, 3100, "worker");
    expect(tp1.closedSize).toBe(0.25);
    expect(tp1.fullyClosed).toBe(false);
    expect(tp1.position.status).toBe("TP_HIT");

    // TP2 hit at 3200 -> closes the rest.
    const tp2 = await trading.applyTpHit(positionId, 3200, "worker");
    expect(tp2.closedSize).toBeCloseTo(0.25, 9);
    expect(tp2.fullyClosed).toBe(true);

    position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(position.status).toBe("CLOSED");
    expect(Number(position.realizedPnl)).toBeCloseTo(0.25 * 100 + 0.25 * 200, 6);

    const txs = await prisma.virtualTransaction.findMany({ where: { accountId: account.id } });
    expect(txs.filter((t) => t.type === "REALIZED_PNL")).toHaveLength(2);
    const acc = await prisma.virtualAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(acc.balance)).toBeCloseTo(10000 + 25 + 50, 6);

    // Cleanup.
    await prisma.virtualTransaction.deleteMany({ where: { accountId: account.id } });
    await prisma.virtualPosition.deleteMany({ where: { accountId: account.id } });
    await prisma.approval.deleteMany({ where: { signalId } });
    await prisma.signalVersion.deleteMany({ where: { signalId } });
    await prisma.signal.delete({ where: { id: signalId } });
    await prisma.sourceMessage.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await prisma.virtualAccount.delete({ where: { id: account.id } });
    await app.close();
  }, 60000);

  it("SL hit closes everything remaining", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(MarketDataService)
      .useValue({
        resolveCoin: jest.fn(async () => "ETH"),
        getMid: jest.fn(async () => 3000),
        getAllMids: jest.fn(async () => ({ ETH: 3000 })),
        assetSpec: jest.fn(async () => SPEC),
      })
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const trading = app.get(VirtualTradingService);
    const prisma = app.get(PrismaService);

    const account = await prisma.virtualAccount.create({
      data: { name: "it-sl", balance: 5000, leverage: 10, mode: "APPROVE" },
    });
    const position = await prisma.virtualPosition.create({
      data: {
        accountId: account.id,
        coin: "ETH",
        direction: "SHORT",
        size: 1,
        entryPrice: 3000,
        stopLoss: 3100,
        takeProfits: [2900],
        leverage: 10,
        remainingSize: 1,
        filledTps: [],
        status: "OPEN",
      },
    });

    const r = await trading.applySlHit(position.id, 3100, "worker");
    expect(r.closedSize).toBe(1);
    expect(r.realized).toBe(-100);
    const closed = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: position.id } });
    expect(closed.status).toBe("SL_HIT");

    await prisma.virtualTransaction.deleteMany({ where: { accountId: account.id } });
    await prisma.virtualPosition.delete({ where: { id: position.id } });
    await prisma.virtualAccount.delete({ where: { id: account.id } });
    await app.close();
  }, 60000);
});
