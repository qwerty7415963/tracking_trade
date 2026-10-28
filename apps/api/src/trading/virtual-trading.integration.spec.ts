import { Test } from "@nestjs/testing";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";
import { SignalsService } from "../signals/signals.service";
import { VirtualAccountsService } from "./virtual-accounts.service";
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

async function cleanupSignal(
  prisma: PrismaService,
  signalId: string,
  accountId: string,
): Promise<void> {
  const signal = await prisma.signal.findUnique({ where: { id: signalId } });
  await prisma.virtualTransaction.deleteMany({ where: { accountId } });
  await prisma.virtualPosition.deleteMany({ where: { accountId } });
  await prisma.approval.deleteMany({ where: { signalId } });
  await prisma.signalVersion.deleteMany({ where: { signalId } });
  await prisma.signal.deleteMany({ where: { id: signalId } });
  if (signal) {
    await prisma.sourceMessage.deleteMany({ where: { sourceId: signal.sourceId } });
    await prisma.source.deleteMany({ where: { id: signal.sourceId } });
  }
  await prisma.virtualAccount.delete({ where: { id: accountId } });
}

describeIntegration("Virtual trading flow (live DB, mocked market)", () => {
  it("market open, TP1 closes 50%, TP2 closes rest", async () => {
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

    const eth = await prisma.tradableCoin.findUniqueOrThrow({ where: { symbol: "ETH" } });
    expect(Number(eth.notionalUsd)).toBe(100000);

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
        contentRaw: "BUY ETH entry market SL: 2900 TP1: 3100 TP2: 3200",
        contentHash: "h-it",
      },
    });
    // Ingest via service to get a real parsed signal.
    const signals = app.get(SignalsService);
    const outcome = await signals.ingestSourceMessage(message.id, "tester");
    expect(outcome.kind).toBe("SIGNAL");
    const signalId = outcome.signalId as string;

    const full = await signals.get(signalId);
    await signals.approve(signalId, { signalVersionId: full.versions[0].id }, "alice");
    const out = await trading.openApproved(signalId, account.id, "alice");
    expect(out.awaitingEntry).toBe(false);
    const positionId = (out.position as { id: string }).id;

    let position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    // 100k notional / 3000 entry = 33.333 units, rounded down to 0.001
    expect(Number(position.size)).toBe(33.333);
    expect(position.status).toBe("OPEN");
    expect(position.filledAt).not.toBeNull();

    // TP1 hit at 3100 -> closes 50%.
    const tp1 = await trading.applyTpHit(positionId, 3100, "worker");
    expect(tp1.closedSize).toBe(16.6665);
    expect(tp1.fullyClosed).toBe(false);
    expect(tp1.position.status).toBe("TP_HIT");

    // TP2 hit at 3200 -> closes the rest.
    const tp2 = await trading.applyTpHit(positionId, 3200, "worker");
    expect(tp2.closedSize).toBeCloseTo(16.6665, 9);
    expect(tp2.fullyClosed).toBe(true);

    position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(position.status).toBe("CLOSED");
    expect(Number(position.realizedPnl)).toBeCloseTo(16.6665 * 100 + 16.6665 * 200, 6);

    const txs = await prisma.virtualTransaction.findMany({ where: { accountId: account.id } });
    expect(txs.filter((t) => t.type === "REALIZED_PNL")).toHaveLength(2);
    const acc = await prisma.virtualAccount.findUniqueOrThrow({ where: { id: account.id } });
    expect(Number(acc.balance)).toBeCloseTo(10000 + 1666.65 + 3333.3, 6);

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

  it("keeps limit entries pending, opens on first fill and averages DCA", async () => {
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

    const signals = app.get(SignalsService);
    const trading = app.get(VirtualTradingService);
    const prisma = app.get(PrismaService);

    const account = await prisma.virtualAccount.create({
      data: { name: "it-pending", balance: 100000, leverage: 10, mode: "APPROVE" },
    });
    const created = await signals.createOperatorSignal(
      "LONG ETH entry 3000 2900 SL 2800 TP 3200",
      "tester",
      { sourceName: `it-pending-${Date.now()}` },
    );
    await signals.approve(
      created.signalId,
      { signalVersionId: created.versionId },
      "tester",
    );
    const opened = await trading.openApproved(created.signalId, account.id, "tester");
    expect(opened.awaitingEntry).toBe(true);
    const positionId = (opened.position as { id: string }).id;

    let position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(position.status).toBe("PENDING_ENTRY");
    expect(position.filledAt).toBeNull();
    expect(Number(position.size)).toBe(0);
    expect(position.styleChosen).toBe(false);
    expect(position.pendingEntries).toEqual([
      { price: 3000, notional: 100000 },
      { price: 2900, notional: 50000 },
    ]);

    const first = await trading.applyEntryFill(positionId, 3000, 3000, "worker");
    expect(first).toMatchObject({ applied: true, firstFill: true, filled: 1, total: 2 });
    const duplicate = await trading.applyEntryFill(positionId, 3000, 3000, "worker");
    expect(duplicate).toEqual({ applied: false, reason: "already_filled" });

    const second = await trading.applyEntryFill(positionId, 2900, 2900, "worker");
    expect(second).toMatchObject({ applied: true, firstFill: false, filled: 2, total: 2 });
    position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(position.status).toBe("OPEN");
    expect(position.filledAt).not.toBeNull();
    expect(Number(position.size)).toBe(50.574);
    expect(Number(position.entryPrice)).toBeCloseTo(2965.91, 2);
    expect(position.pendingEntries).toEqual([]);

    await cleanupSignal(prisma, created.signalId, account.id);
    await app.close();
  }, 60000);

  it("reset cancels a pending entry without touching the ledger", async () => {
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

    const signals = app.get(SignalsService);
    const trading = app.get(VirtualTradingService);
    const accounts = app.get(VirtualAccountsService);
    const prisma = app.get(PrismaService);

    const account = await prisma.virtualAccount.create({
      data: { name: "it-reset", balance: 100000, leverage: 10, mode: "APPROVE" },
    });
    const created = await signals.createOperatorSignal(
      "LONG ETH entry 3000 SL 2800 TP 3200",
      "tester",
      { sourceName: `it-reset-${Date.now()}` },
    );
    await signals.approve(
      created.signalId,
      { signalVersionId: created.versionId },
      "tester",
    );
    const opened = await trading.openApproved(created.signalId, account.id, "tester");
    const positionId = (opened.position as { id: string }).id;

    await accounts.reset(account.id, 100000, "tester", (id) =>
      trading.closePosition(id, "tester").then(() => undefined),
    );
    const position = await prisma.virtualPosition.findUniqueOrThrow({ where: { id: positionId } });
    expect(position.status).toBe("CANCELLED");
    expect(position.closePrice).toBeNull();
    expect(
      await prisma.virtualTransaction.count({ where: { accountId: account.id } }),
    ).toBe(0);

    await cleanupSignal(prisma, created.signalId, account.id);
    await app.close();
  }, 60000);
});
