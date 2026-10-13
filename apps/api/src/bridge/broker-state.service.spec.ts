import { loadAppConfig } from "../config/app.config";
import { BrokerStateService } from "./broker-state.service";

function service(rows: Array<{ receivedAt: Date; details: unknown }>) {
  const prisma = {
    bridgeHeartbeat: {
      create: jest.fn(async () => ({})),
      findFirst: jest.fn(async () => rows[0] ?? null),
    },
  };
  return { svc: new BrokerStateService(prisma as never, loadAppConfig({})), prisma };
}

const DETAILS = {
  positions: [{ positionId: "p1", symbol: "XAUUSD.a" }],
  symbols: { "XAUUSD.a": { symbol: "XAUUSD.a", spread: 20 } },
  balance: 10000,
};

describe("BrokerStateService", () => {
  it("records heartbeats", async () => {
    const { svc, prisma } = service([]);
    await expect(
      svc.recordHeartbeat({ accountId: "acc1", status: "ok", positions: [], symbols: {} }),
    ).resolves.toEqual({ ok: true });
    expect(prisma.bridgeHeartbeat.create).toHaveBeenCalled();
  });

  it("reads fresh state", async () => {
    const { svc } = service([{ receivedAt: new Date(), details: DETAILS }]);
    await expect(svc.positions("acc1")).resolves.toHaveLength(1);
    await expect(svc.symbolInfo("acc1", "XAUUSD.a")).resolves.toBeTruthy();
    await expect(svc.isAlive("acc1")).resolves.toBe(true);
  });

  it("treats stale heartbeats as dead (fail-safe)", async () => {
    const { svc } = service([
      { receivedAt: new Date(Date.now() - 10 * 60_1000), details: DETAILS },
    ]);
    await expect(svc.positions("acc1")).resolves.toEqual([]);
    await expect(svc.isAlive("acc1")).resolves.toBe(false);
    await expect(svc.account("acc1")).resolves.toEqual({});
  });
});
