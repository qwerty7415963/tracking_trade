import { ConflictException, ForbiddenException } from "@nestjs/common";
import { BridgePort } from "../bridge/mt5-bridge.adapter";
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

function fakeBridge(overrides: Partial<BridgePort> = {}): BridgePort {
  return {
    sendCommand: jest.fn(async () => ({ result: "CONFIRMED" })),
    commandStatus: jest.fn(),
    positions: jest.fn(async () => []),
    orders: jest.fn(async () => []),
    deals: jest.fn(async () => []),
    symbolInfo: jest.fn(async () => SPEC),
    account: jest.fn(async () => ({ marginFree: 10000, marginRequired: 100, equity: 10000 })),
    heartbeat: jest.fn(async () => ({ status: "ok" })),
    ...overrides,
  } as unknown as BridgePort;
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
    expiresAt: new Date(),
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

function service(prisma: unknown, bridge: BridgePort, killMode: "OFF" | "STOP_NEW_TRADES" = "OFF") {
  const kill = new KillSwitchService({ record: jest.fn() } as never);
  (kill as unknown as { mode: string }).mode = killMode;
  return new ExecutionService(prisma as never, { record: jest.fn() } as never, bridge, CONFIG as never, kill);
}

const CONFIRMED = {
  result: "CONFIRMED" as const,
  brokerRetcode: 10009,
  brokerOrderId: "o1",
  brokerDealId: "d1",
  brokerPositionId: "p1",
  requestedVolume: 0.02,
  filledVolume: 0.02,
  fillPrice: 2345,
  actualSl: 2340,
  actualTp: 2360,
  timestamps: {},
  accountSnapshot: null,
  error: null,
};

describe("ExecutionService", () => {
  it("refuses a second OPEN while one is unresolved", async () => {
    const prisma = mockPrisma({ findFirstCommand: { id: "c0" } });
    const svc = service(prisma, fakeBridge());
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(ConflictException);
  });

  it("returns the existing command for the same idempotency key without resending", async () => {
    const existing = { id: "c1", status: "CONFIRMED" };
    const prisma = mockPrisma({ findUniqueCommand: existing });
    const bridge = fakeBridge();
    const svc = service(prisma, bridge);
    await expect(svc.openFromApproval("s1", "alice")).resolves.toEqual(existing);
    expect(bridge.sendCommand).not.toHaveBeenCalled();
  });

  it("marks TIMEOUT_UNKNOWN on send failure and never resends", async () => {
    const bridge = fakeBridge({
      sendCommand: jest.fn(async () => {
        throw new Error("timeout");
      }),
      commandStatus: jest.fn(async () => {
        throw new Error("bridge down");
      }),
    });
    const prisma = mockPrisma();
    const svc = service(prisma, bridge);
    const result = (await svc.openFromApproval("s1", "alice")) as { status: string };
    expect(bridge.sendCommand).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("TIMEOUT_UNKNOWN");
  });

  it("blocks new orders when kill switch is on", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, fakeBridge({ sendCommand: jest.fn(async () => CONFIRMED) }), "STOP_NEW_TRADES");
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(ForbiddenException);
  });

  it("confirms a clean open and records the fill", async () => {
    const prisma = mockPrisma();
    const bridge = fakeBridge({ sendCommand: jest.fn(async () => CONFIRMED) });
    const svc = service(prisma, bridge);
    const result = (await svc.openFromApproval("s1", "alice")) as { status: string };
    expect(bridge.sendCommand).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("CONFIRMED");
    expect(prisma.execution.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ executionStatus: "OPEN" }) }),
    );
  });

  it("rejects when bridge has no symbol map", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, fakeBridge({ symbolInfo: jest.fn(async () => null) }));
    await expect(svc.openFromApproval("s1", "alice")).rejects.toThrow(/no symbol map/);
  });
});
