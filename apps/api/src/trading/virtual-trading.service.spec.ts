import { ConflictException, ForbiddenException } from "@nestjs/common";
import { VirtualTradingService } from "./virtual-trading.service";

const SPEC = {
  coin: "ETH",
  szDecimals: 4,
  minSize: 0.01,
  sizeIncrement: 0.001,
  maintenanceMarginRate: 0.01,
};

const VERSION = {
  id: "v1",
  instrument: "ETH",
  direction: "LONG",
  entry: 3000,
  stopLoss: 2900,
  takeProfits: [3100, 3200],
};

const SIGNAL = {
  id: "s1",
  status: "APPROVED",
  createdAt: new Date(),
  versions: [VERSION],
  approvals: [{ decision: "APPROVED", signalVersionId: "v1", createdAt: new Date() }],
};

const CONFIG = {
  signalMaxAgeHours: 24,
} as never;

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    signal: { findUnique: jest.fn(async () => SIGNAL) },
    virtualPosition: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => []),
      findUnique: jest.fn(),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pos1", ...args.data })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pos1", ...args.data })),
    },
    riskEvent: { create: jest.fn(async () => ({})) },
    ...(overrides as Record<string, { [k: string]: jest.Mock }>),
  };
}

function mockMarketData(overrides: Record<string, unknown> = {}) {
  return {
    resolveCoin: jest.fn(async () => "ETH"),
    getMid: jest.fn(async () => 3000),
    getAllMids: jest.fn(async () => ({ ETH: 3000 })),
    assetSpec: jest.fn(async () => SPEC),
    ...overrides,
  };
}

function mockAccounts(overrides: Record<string, unknown> = {}) {
  return {
    get: jest.fn(async () => ({ id: "acc1", balance: 10000, leverage: 10, mode: "APPROVE" })),
    applyRealizedPnl: jest.fn(async () => undefined),
    ...overrides,
  };
}

function mockCoins(overrides: Record<string, unknown> = {}) {
  return {
    notionalFor: jest.fn(async () => 100000),
    ...overrides,
  };
}

function service(
  prisma: unknown,
  marketData: unknown,
  accounts: unknown,
  killMode: "OFF" | "STOP_NEW_TRADES" | "STOP_ALL_MUTATIONS" = "OFF",
  coins: unknown = mockCoins(),
) {
  const kill = { getMode: () => killMode, setMode: jest.fn() };
  return new VirtualTradingService(
    prisma as never,
    { record: jest.fn() } as never,
    marketData as never,
    accounts as never,
    coins as never,
    kill as never,
    CONFIG,
  );
}

describe("VirtualTradingService.openApproved", () => {
  it("opens a sized paper position from an approval", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, mockMarketData(), mockAccounts());
    const { position } = (await svc.openApproved("s1", "acc1", "alice")) as {
      position: { status: string; coin: string };
    };
    expect(position.status).toBe("OPEN");
    expect(position.coin).toBe("ETH");
    // 100k notional / 3000 entry = 33.333 units, rounded down to 0.001
    expect(prisma.virtualPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ size: 33.333 }) }),
    );
  });

  it("opens at the signal entry when it differs from the mid", async () => {
    const prisma = mockPrisma({
      signal: {
        findUnique: jest.fn(async () => ({
          ...SIGNAL,
          versions: [{ ...VERSION, entry: 2427.63, stopLoss: 2400 }],
        })),
      },
    });
    const marketData = mockMarketData({ getMid: jest.fn(async () => 2412.75) });
    const svc = service(prisma, marketData, mockAccounts());
    const { position } = (await svc.openApproved("s1", "acc1", "alice")) as unknown as {
      position: { entryPrice: number; size: number };
    };
    expect(position.entryPrice).toBe(2427.63);
    // 100k notional / 2427.63 entry = 41.192..., rounded down to 0.001
    expect(position.size).toBeCloseTo(41.192, 6);
    expect(prisma.virtualPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ entryPrice: 2427.63 }),
      }),
    );
  });

  it("falls back to the mid when the signal has no entry", async () => {
    const prisma = mockPrisma({
      signal: {
        findUnique: jest.fn(async () => ({
          ...SIGNAL,
          versions: [{ ...VERSION, entry: null }],
        })),
      },
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    const { position } = (await svc.openApproved("s1", "acc1", "alice")) as unknown as {
      position: { entryPrice: number };
    };
    expect(position.entryPrice).toBe(3000);
  });

  it("rejects a non-positive signal entry instead of guessing", async () => {
    const prisma = mockPrisma({
      signal: {
        findUnique: jest.fn(async () => ({
          ...SIGNAL,
          versions: [{ ...VERSION, entry: 0 }],
        })),
      },
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(/INVALID_ENTRY/);
  });

  it("returns the existing position instead of duplicating (idempotent)", async () => {
    const existing = { id: "pos9", status: "OPEN" };
    const prisma = mockPrisma();
    (prisma.virtualPosition.findFirst as jest.Mock).mockResolvedValueOnce(existing);
    const create = prisma.virtualPosition.create as jest.Mock;
    const svc = service(prisma, mockMarketData(), mockAccounts());
    const out = (await svc.openApproved("s1", "acc1", "alice")) as { position: unknown };
    expect(out.position).toEqual(existing);
    expect(create).not.toHaveBeenCalled();
  });

  it("rejects expired approval", async () => {
    const prisma = mockPrisma();
    const old = new Date(Date.now() - 25 * 3600_1000);
    (prisma.signal.findUnique as jest.Mock).mockResolvedValueOnce({
      ...SIGNAL,
      approvals: [{ decision: "APPROVED", signalVersionId: "v1", createdAt: old }],
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(/expired/);
  });

  it("rejects stale approval", async () => {
    const prisma = mockPrisma();
    (prisma.signal.findUnique as jest.Mock).mockResolvedValueOnce({
      ...SIGNAL,
      approvals: [{ decision: "APPROVED", signalVersionId: "old" }],
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(ConflictException);
  });

  it("rejects unmapped coins without guessing", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, mockMarketData({ resolveCoin: jest.fn(async () => null) }), mockAccounts());
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(/NO_SYMBOL_MAP/);
  });

  it("rejects missing quotes without guessing entry", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, mockMarketData({ getMid: jest.fn(async () => null) }), mockAccounts());
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(/NO_QUOTE/);
  });

  it("is blocked by kill switch", async () => {
    const svc = service(mockPrisma(), mockMarketData(), mockAccounts(), "STOP_NEW_TRADES");
    await expect(svc.openApproved("s1", "acc1", "alice")).rejects.toThrow(ForbiddenException);
  });
});

describe("VirtualTradingService TP/SL application", () => {
  const OPEN_POS = {
    id: "pos1",
    accountId: "acc1",
    coin: "ETH",
    direction: "LONG",
    size: 1,
    entryPrice: 3000,
    stopLoss: 2900,
    takeProfits: [3100, 3200],
    leverage: 10,
    remainingSize: 1,
    filledTps: [],
    status: "OPEN",
    realizedPnl: 0,
  };

  function withOpen() {
    const base = mockPrisma();
    (base.virtualPosition.findUnique as jest.Mock).mockResolvedValue(OPEN_POS);
    (base.virtualPosition.update as jest.Mock).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...OPEN_POS, ...args.data }),
    );
    const txAware = {
      ...base,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          virtualPosition: base.virtualPosition,
          virtualAccount: { findUniqueOrThrow: jest.fn(async () => ({ id: "acc1", balance: 10000 })) },
        }),
      ),
    };
    return { prisma: txAware, svc: service(txAware, mockMarketData(), mockAccounts()) };
  }

  it("TP1 closes 50%, stays open as TP_HIT", async () => {
    const { svc } = withOpen();
    const r = await svc.applyTpHit("pos1", 3100, "worker");
    expect(r.closedSize).toBe(0.5);
    expect(r.realized).toBe(50);
    expect(r.fullyClosed).toBe(false);
    expect(r.position.status).toBe("TP_HIT");
  });

  it("final TP closes the remainder", async () => {
    const { prisma, svc } = withOpen();
    (prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue({
      ...OPEN_POS,
      remainingSize: 0.5,
      filledTps: [3100],
      status: "TP_HIT",
    });
    const r = await svc.applyTpHit("pos1", 3200, "worker");
    expect(r.closedSize).toBe(0.5);
    expect(r.fullyClosed).toBe(true);
    expect(r.position.status).toBe("CLOSED");
  });

  it("SL closes everything remaining", async () => {
    const { svc } = withOpen();
    const r = await svc.applySlHit("pos1", 2900, "worker");
    expect(r.closedSize).toBe(1);
    expect(r.realized).toBe(-100);
  });

  it("rejects TP application when nothing is hit", async () => {
    const { svc } = withOpen();
    await expect(svc.applyTpHit("pos1", 3000, "worker")).rejects.toThrow(ConflictException);
  });
});

describe("VirtualTradingService.pollMarketOnce", () => {
  it("detects TP and SL across positions, skips missing quotes", async () => {
    const tpPos = {
      id: "p-tp",
      accountId: "acc1",
      coin: "ETH",
      direction: "LONG",
      size: 1,
      entryPrice: 3000,
      stopLoss: 2900,
      takeProfits: [3100],
      leverage: 10,
      remainingSize: 1,
      filledTps: [],
      status: "OPEN",
      realizedPnl: 0,
    };
    const slPos = {
      ...tpPos,
      id: "p-sl",
      entryPrice: 3000,
      stopLoss: 2950,
      takeProfits: [3200],
    };
    const base = mockPrisma();
    const prisma = {
      ...base,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          virtualPosition: base.virtualPosition,
          virtualAccount: { findUniqueOrThrow: jest.fn(async () => ({ id: "acc1", balance: 10000 })) },
        }),
      ),
    };
    (prisma.virtualPosition.findMany as jest.Mock).mockResolvedValue([tpPos, slPos]);
    (prisma.virtualPosition.findUnique as jest.Mock).mockImplementation(async (args: { where: { id: string } }) =>
      args.where.id === "p-tp" ? tpPos : slPos,
    );
    (prisma.virtualPosition.update as jest.Mock).mockImplementation(
      async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        ...(args.where.id === "p-tp" ? tpPos : slPos),
        ...args.data,
      }),
    );
    (prisma as unknown as Record<string, unknown>).$transaction = jest.fn(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          virtualPosition: prisma.virtualPosition,
          virtualAccount: { findUniqueOrThrow: jest.fn(async () => ({ id: "acc1", balance: 10000 })) },
        }),
    );
    const svc = service(
      prisma,
      mockMarketData({ getAllMids: jest.fn(async () => ({ ETH: 3100 })) }),
      mockAccounts(),
    );
    // p-sl: mark 3100 vs SL 2950 LONG → not hit; p-tp hits TP1 (single TP → full close)
    const events = await svc.pollMarketOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ positionId: "p-tp", kind: "TP", markPrice: 3100, tpIndex: 0 });
    // Detect only: the settle job renders the card first, closes afterwards.
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns [] when kill switch stops all mutations", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, mockMarketData(), mockAccounts(), "STOP_ALL_MUTATIONS");
    // STOP_ALL_MUTATIONS is not a valid openMode but pollMarketOnce only checks it
    const events = await svc.pollMarketOnce();
    expect(events).toEqual([]);
    expect(prisma.virtualPosition.findMany).not.toHaveBeenCalled();
  });
});
