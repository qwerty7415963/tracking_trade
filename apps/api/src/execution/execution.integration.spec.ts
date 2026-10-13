import { Test } from "@nestjs/testing";
import { APP_CONFIG, loadAppConfig } from "../config/app.config";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { BrokerStateService } from "../bridge/broker-state.service";

const FAKE_STATE = {
  symbolInfo: jest.fn(async () => SPEC),
  account: jest.fn(async () => ({ marginFree: 10000, marginRequired: 100, equity: 10000 })),
  isAlive: jest.fn(async () => true),
  positions: jest.fn(async () => []),
};
import { ExecutionService } from "./execution.service";
import { KillSwitchService } from "./kill-switch.service";
import { SignalsService } from "../signals/signals.service";

// Live-DB test with fake broker state (no MT5 terminal needed).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

const SPEC = {
  symbol: "XAUUSD.a",
  spread: 20,
  minVolume: 0.01,
  maxVolume: 10,
  volumeStep: 0.01,
  stopDistance: 5,
  tickValue: 1,
  tickSize: 0.01,
  contractSize: 100,
};

const EA_CONFIRM = {
  result: "CONFIRMED" as const,
  brokerRetcode: 10009,
  brokerOrderId: "o1",
  brokerDealId: "d1",
  brokerPositionId: "pLive",
  requestedVolume: 0.02,
  filledVolume: 0.02,
  fillPrice: 2345,
  actualSl: 2340,
  actualTp: 2360,
  timestamps: {},
  accountSnapshot: null,
  error: null,
};

describeIntegration("Execution flow (live DB, poll topology)", () => {
  it("journals SENT; EA confirm opens; retry idempotent; kill switch blocks", async () => {
    // Dedicated account isolates risk counts from other suites running in parallel.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue({ ...loadAppConfig({}), mt5AccountId: "acc-exec-it" })
      .overrideProvider(BrokerStateService)
      .useValue(FAKE_STATE)
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();

    const signals = app.get(SignalsService);
    const executions = app.get(ExecutionService);
    const kill = app.get(KillSwitchService);
    const prisma = app.get(PrismaService);

    const channel = `phase4-chan-${Date.now()}`;
    await prisma.source.deleteMany({ where: { platform: "TELEGRAM", externalSourceId: channel } });
    const source = await prisma.source.create({
      data: {
        platform: "TELEGRAM",
        externalSourceId: channel,
        displayName: "P4",
        sourceKind: "SIGNAL",
      },
    });
    const msg = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "p4m1",
        contentRaw: "BUY XAUUSD limit\nEntry: 2345\nSL: 2340\nTP: 2360",
        contentHash: "h4",
      },
    });
    const outcome = await signals.ingestSourceMessage(msg.id, "tester");
    const full = await signals.get(outcome.signalId as string);
    await signals.approve(outcome.signalId as string, { signalVersionId: full.versions[0].id }, "alice");

    // Journal SENT for EA pickup (no broker call from the backend).
    const opened = await executions.openFromApproval(outcome.signalId as string, "alice");
    expect(opened.status).toBe("SENT");
    expect(opened.executions[0].executionStatus).toBe("PENDING");

    // EA reports fill -> OPEN with broker ids.
    const confirmed = await executions.applyExternalResponse(opened.id, EA_CONFIRM, "bridge");
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.executions[0].executionStatus).toBe("OPEN");
    expect(confirmed.executions[0].brokerPositionId).toBe("pLive");

    // Same approval again: idempotent, no second command.
    const again = await executions.openFromApproval(outcome.signalId as string, "alice");
    expect(again.id).toBe(opened.id);

    await kill.setMode("STOP_NEW_TRADES", "alice");
    const msg2 = await prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: "p4m2",
        contentRaw: "BUY XAUUSD limit\nEntry: 2345\nSL: 2340\nTP: 2360",
        contentHash: "h4b",
      },
    });
    const outcome2 = await signals.ingestSourceMessage(msg2.id, "tester");
    const full2 = await signals.get(outcome2.signalId as string);
    await signals.approve(outcome2.signalId as string, { signalVersionId: full2.versions[0].id }, "alice");
    await expect(executions.openFromApproval(outcome2.signalId as string, "alice")).rejects.toThrow(
      /risk rejected|kill/i,
    );
    await kill.setMode("OFF", "alice");

    // Cleanup.
    const signalIds = [outcome.signalId as string, outcome2.signalId as string];
    await prisma.execution.deleteMany({ where: { command: { signalId: { in: signalIds } } } });
    await prisma.executionCommand.deleteMany({ where: { signalId: { in: signalIds } } });
    await prisma.approval.deleteMany({ where: { signalId: { in: signalIds } } });
    await prisma.signalVersion.deleteMany({ where: { signalId: { in: signalIds } } });
    await prisma.signal.deleteMany({ where: { id: { in: signalIds } } });
    await prisma.sourceMessage.deleteMany({ where: { sourceId: source.id } });
    await prisma.source.delete({ where: { id: source.id } });
    await app.close();
  }, 60000);
});
