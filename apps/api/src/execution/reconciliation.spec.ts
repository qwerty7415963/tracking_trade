import { KillSwitchService } from "./kill-switch.service";
import { ReconciliationService } from "./reconciliation.service";

describe("KillSwitchService", () => {
  it("defaults OFF and audits transitions", async () => {
    const audit = { record: jest.fn(async () => ({})) };
    const kill = new KillSwitchService(audit as never);
    expect(kill.getMode()).toBe("OFF");
    await expect(kill.setMode("STOP_NEW_TRADES", "alice")).resolves.toBe("STOP_NEW_TRADES");
    expect(audit.record).toHaveBeenCalledWith("alice", "kill-switch.set", {
      mode: "STOP_NEW_TRADES",
    });
  });
});

describe("ReconciliationService", () => {
  function service(prisma: unknown, brokerState: unknown) {
    return new ReconciliationService(
      prisma as never,
      { record: jest.fn(async () => ({})) } as never,
      brokerState as never,
      { mt5AccountId: "acc1" } as never,
    );
  }

  it("flags broker positions unknown to the DB and never closes them", async () => {
    const prisma = {
      execution: { findMany: jest.fn(async () => []) },
      riskEvent: { create: jest.fn(async () => ({})) },
      executionCommand: { findMany: jest.fn(async () => []), update: jest.fn() },
    };
    const brokerState = {
      positions: jest.fn(async () => [
        {
          positionId: "p9",
          orderId: null,
          symbol: "XAUUSD.a",
          direction: "LONG" as const,
          volume: 0.05,
          openPrice: 2345,
          stopLoss: null,
          takeProfit: null,
          profit: 1,
          currentPrice: 2346,
        },
      ]),
    };
    const svc = service(prisma, brokerState);
    const report = await svc.reconcileAccount("acc1", "alice");
    expect(report.unknownPositions).toEqual([
      { positionId: "p9", symbol: "XAUUSD.a", volume: 0.05 },
    ]);
    expect(prisma.riskEvent.create).toHaveBeenCalled();
  });

  it("marks expired stale commands TIMEOUT_UNKNOWN", async () => {
    const update = jest.fn(async () => ({}));
    const prisma = {
      execution: { findMany: jest.fn(async () => []) },
      riskEvent: { create: jest.fn(async () => ({})) },
      executionCommand: {
        findMany: jest.fn(async () => [
          { id: "c1", expiresAt: new Date(Date.now() - 1000), status: "SENT" },
        ]),
        update,
      },
    };
    const svc = service(prisma, { positions: jest.fn(async () => []) });
    const report = await svc.reconcileAccount("acc1", "alice");
    expect(report.reconciledCommands).toEqual(["c1"]);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "TIMEOUT_UNKNOWN" } }),
    );
  });
});
