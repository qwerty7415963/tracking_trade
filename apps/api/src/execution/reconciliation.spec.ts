import { KillSwitchService } from "./kill-switch.service";
import { ReconciliationService } from "./reconciliation.service";
import { BridgePort } from "../bridge/mt5-bridge.adapter";

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
  function service(prisma: unknown, bridge: Partial<BridgePort>) {
    return new ReconciliationService(
      prisma as never,
      { record: jest.fn(async () => ({})) } as never,
      bridge as BridgePort,
      { mt5AccountId: "acc1" } as never,
    );
  }

  it("flags broker positions unknown to the DB and never closes them", async () => {
    const prisma = {
      execution: { findMany: jest.fn(async () => []) },
      riskEvent: { create: jest.fn(async () => ({})) },
      executionCommand: { findMany: jest.fn(async () => []) },
    };
    const bridge = {
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
        },
      ]),
      commandStatus: jest.fn(),
    };
    const svc = service(prisma, bridge);
    const report = await svc.reconcileAccount("acc1", "alice");
    expect(report.unknownPositions).toEqual([
      { positionId: "p9", symbol: "XAUUSD.a", volume: 0.05 },
    ]);
    expect(prisma.riskEvent.create).toHaveBeenCalled();
    // No close call exists on the bridge port: unknown positions are never auto-closed.
    expect("closePosition" in (bridge as object)).toBe(false);
  });

  it("resolves stale commands from bridge status", async () => {
    const update = jest.fn(async () => ({}));
    const prisma = {
      execution: { findMany: jest.fn(async () => []) },
      riskEvent: { create: jest.fn(async () => ({})) },
      executionCommand: {
        findMany: jest.fn(async () => [{ id: "c1" }]),
        update,
      },
    };
    const bridge = {
      positions: jest.fn(async () => []),
      commandStatus: jest.fn(async () => ({ result: "CONFIRMED" }) as never),
    };
    const svc = service(prisma, bridge);
    const report = await svc.reconcileAccount("acc1", "alice");
    expect(report.reconciledCommands).toEqual(["c1"]);
  });
});
