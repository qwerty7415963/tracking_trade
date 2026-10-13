import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ExecutionService } from "./execution.service";
import { KillSwitchService } from "./kill-switch.service";

const VERSION = {
  id: "v1",
  instrument: "XAUUSD.a",
  direction: "LONG",
  entry: 2345,
  stopLoss: 2340,
  takeProfits: [2360],
};
const SIGNAL = {
  id: "s1",
  status: "APPROVED",
  createdAt: new Date(),
  versions: [VERSION],
  approvals: [{ decision: "APPROVED", signalVersionId: "v1" }],
};
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
const CONFIG = {
  operatorUsernames: [],
  tradingEnabled: false,
  databaseUrl: "",
  redisUrl: "",
  mt5BridgeUrl: "",
  mt5BridgeApiKey: "",
  mt5AccountId: "acc1",
  signalMaxAgeHours: 24,
  bridgeTimeoutMs: 50,
};

function fakeBrokerState(overrides: Record<string, unknown> = {}) {
  return {
    symbolInfo: jest.fn(async () => SPEC),
    account: jest.fn(async () => ({ marginFree: 10000, marginRequired: 100, equity: 10000 })),
    isAlive: jest.fn(async () => true),
    positions: jest.fn(async () => []),
    ...overrides,
  };
}

function mockPrisma(
  overrides: {
    findUniqueCommand?: unknown;
    findFirstCommand?: unknown;
  } = {},
) {
  let status = "RISK_CHECKED";
  const row = () => ({
    id: "c1",
    idempotencyKey: "open:s1:v1",
    accountId: "acc1",
    signalId: "s1",
    signalVersionId: "v1",
    commandType: "OPEN",
    payloadJson: { volume: 0.02 },
    correlationId: null,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60000),
    status,
    executions: [{ id: "e1" }],
  });
  return {
    signal: { findUnique: jest.fn(async () => SIGNAL) },
    executionCommand: {
      findUnique: jest.fn(async () => overrides.findUniqueCommand ?? null),
      findFirst: jest.fn(async () => overrides.findFirstCommand ?? null),
      findUniqueOrThrow: jest.fn(async () => row()),
      create: jest.fn(async () => row()),
      update: jest.fn(async (args: { data: { status?: string } }) => {
        if (args.data.status) status = args.data.status;
        return row();
      }),
      findMany: jest.fn(async () => []),
    },
    execution: {
      count: jest.fn(async () => 0),
      create: jest.fn(async () => ({ id: "e1" })),
      update: jest.fn(async () => ({})),
      findUniqueOrThrow: jest.fn(async () => ({})),
      findMany: jest.fn(async () => []),
    },
    riskEvent: { create: jest.fn(async () => ({})) },
  };
}

function service(prisma: unknown, brokerState: unknown, killMode: "OFF" | "STOP_NEW_TRADES" = "OFF") {
  const kill = new KillSwitchService({ record: jest.fn() } as never);
  (kill as unknown as { mode: string }).mode = killMode;
  return new ExecutionService(
    prisma as never,
    { record: jest.fn() } as never,
    brokerState as never,
    CONFIG as never,
    kill,
  );
}

describe("ExecutionService (poll topology)", () => {
  it("refuses a second OPEN while one is unresolved", async () => {
    const prisma = mockPrisma({ findFirstCommand: { id: "c0" } });
    const svc = service(prisma, fakeBrokerState());
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(ConflictException);
  });

  it("returns the existing command for the same idempotency key", async () => {
    const existing = { id: "c1", status: "CONFIRMED" };
    const prisma = mockPrisma({ findUniqueCommand: existing });
    const svc = service(prisma, fakeBrokerState());
    await expect(svc.openFromApproval("s1", "alice")).resolves.toEqual(existing);
  });

  it("journals SENT for EA pickup without calling the broker", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, fakeBrokerState());
    const result = await svc.openFromApproval("s1", "alice");
    expect(result.status).toBe("SENT");
    expect(result.executions).toHaveLength(1);
  });

  it("blocks new orders when kill switch is on", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, fakeBrokerState(), "STOP_NEW_TRADES");
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(ForbiddenException);
  });

  it("rejects when bridge has no symbol map", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, fakeBrokerState({ symbolInfo: jest.fn(async () => null) }));
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(/no symbol map/);
  });

  it("marks expired unconfirmed commands TIMEOUT_UNKNOWN on reconcile", async () => {
    const prisma = mockPrisma();
    (prisma.executionCommand.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
      id: "c1",
      accountId: "acc1",
      status: "SENT",
      expiresAt: new Date(Date.now() - 1000),
      executions: [],
    });
    const svc = service(prisma, fakeBrokerState());
    const result = await svc.reconcileCommand("c1", "alice");
    expect(result.status).toBe("TIMEOUT_UNKNOWN");
  });

  it("flags OPEN executions whose broker position vanished", async () => {
    const prisma = mockPrisma();
    (prisma.executionCommand.findUniqueOrThrow as jest.Mock).mockResolvedValueOnce({
      id: "c1",
      accountId: "acc1",
      status: "SENT",
      expiresAt: new Date(Date.now() + 60000),
      executions: [{ id: "e1", executionStatus: "OPEN", brokerPositionId: "pX" }],
    });
    const svc = service(prisma, fakeBrokerState());
    const result = await svc.reconcileCommand("c1", "alice");
    expect(result.status).toBe("RECONCILING");
    expect(prisma.riskEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ checkName: "RECONCILE_POSITION_MISSING" }),
      }),
    );
  });
});
