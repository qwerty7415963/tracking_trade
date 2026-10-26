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

  it("stores a DCA ladder with per-level notionals frozen at open", async () => {
    const prisma = mockPrisma({
      signal: {
        findUnique: jest.fn(async () => ({
          ...SIGNAL,
          versions: [
            {
              ...VERSION,
              normalizedPayloadJson: { sourceMessageId: "m1", entries: [3000, 2950, 2900] },
            },
          ],
        })),
      },
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await svc.openApproved("s1", "acc1", "alice");
    // entry[0] keeps the full target notional; every later level 1/N of it.
    expect(prisma.virtualPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryPrice: 3000,
          size: 33.333,
          entries: [
            { price: 3000, notional: 100000 },
            { price: 2950, notional: 100000 / 3 },
            { price: 2900, notional: 100000 / 3 },
          ],
          pendingEntries: [
            { price: 2950, notional: 100000 / 3 },
            { price: 2900, notional: 100000 / 3 },
          ],
        }),
      }),
    );
  });

  it("degrades a ladder pointing the wrong way to its first level", async () => {
    const prisma = mockPrisma({
      signal: {
        findUnique: jest.fn(async () => ({
          ...SIGNAL,
          versions: [
            {
              ...VERSION,
              normalizedPayloadJson: { sourceMessageId: "m1", entries: [3000, 3100] },
            },
          ],
        })),
      },
    });
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await svc.openApproved("s1", "acc1", "alice");
    expect(prisma.virtualPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entries: [{ price: 3000, notional: 100000 }],
          pendingEntries: [],
        }),
      }),
    );
  });

  it("opens a single-level position when the payload carries no ladder", async () => {
    const prisma = mockPrisma();
    const svc = service(prisma, mockMarketData(), mockAccounts());
    await svc.openApproved("s1", "acc1", "alice");
    expect(prisma.virtualPosition.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entries: [{ price: 3000, notional: 100000 }],
          pendingEntries: [],
        }),
      }),
    );
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

describe("VirtualTradingService.applyEntryFill", () => {
  const ladderPosition = {
    id: "pos1",
    accountId: "acc1",
    coin: "ETH",
    direction: "LONG",
    size: 33.333,
    entryPrice: 3000,
    remainingSize: 33.333,
    leverage: 10,
    status: "OPEN",
    stopLoss: 2900,
    takeProfits: [3100],
    filledTps: [],
    entries: [
      { price: 3000, notional: 100000 },
      { price: 2950, notional: 100000 / 3 },
      { price: 2900, notional: 100000 / 3 },
    ],
    pendingEntries: [
      { price: 2950, notional: 100000 / 3 },
      { price: 2900, notional: 100000 / 3 },
    ],
    account: { balance: 10000 },
  };

  function fillSetup(position: Record<string, unknown> = ladderPosition) {
    const prisma = mockPrisma();
    (prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue(position);
    (prisma.virtualPosition.update as jest.Mock).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...position, ...args.data }),
    );
    const audit = { record: jest.fn(async () => ({})) };
    const kill = { getMode: () => "OFF", setMode: jest.fn() };
    const svc = new VirtualTradingService(
      prisma as never,
      audit as never,
      mockMarketData() as never,
      mockAccounts() as never,
      mockCoins() as never,
      kill as never,
      CONFIG,
    );
    return { svc, prisma, audit };
  }

  it("grows size and moves the average to the levels that filled", async () => {
    const { svc, prisma, audit } = fillSetup();
    const result = await svc.applyEntryFill("pos1", 2950, 2950, "worker");
    // 100k/3 notional at 2950 â†’ 11.299 units (0.001 step, rounded down).
    const slice = 11.299;
    const expectedAvg = (33.333 * 3000 + slice * 2950) / (33.333 + slice);
    expect(result.applied).toBe(true);
    expect(result.size).toBeCloseTo(44.632, 6);
    expect(result.entryPrice).toBeCloseTo(expectedAvg, 1);
    expect(result.filled).toBe(2);
    expect(result.total).toBe(3);

    const data = (prisma.virtualPosition.update as jest.Mock).mock.calls[0][0].data;
    expect(data.size).toBeCloseTo(44.632, 6);
    expect(data.remainingSize).toBeCloseTo(44.632, 6);
    expect(data.entryPrice).toBeCloseTo(expectedAvg, 1);
    expect(data.pendingEntries).toEqual([{ price: 2900, notional: 100000 / 3 }]);
    expect(data).not.toHaveProperty("status");
    expect(audit.record).toHaveBeenCalledWith(
      "worker",
      "position.entry_fill",
      expect.objectContaining({ positionId: "pos1", entryPrice: 2950, filled: 2, total: 3 }),
    );
  });

  it("is a no-op when the level already filled", async () => {
    const { svc, prisma } = fillSetup({
      ...ladderPosition,
      pendingEntries: [{ price: 2900, notional: 100000 / 3 }],
    });
    await expect(svc.applyEntryFill("pos1", 2950, 2950, "worker")).resolves.toEqual({
      applied: false,
      reason: "already_filled",
    });
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
  });

  it("skips a position that is no longer open", async () => {
    const { svc } = fillSetup({ ...ladderPosition, status: "CLOSED" });
    await expect(svc.applyEntryFill("pos1", 2950, 2950, "worker")).resolves.toEqual({
      applied: false,
      reason: "not_open",
    });
  });

  it("drops a level below min size without growing the position", async () => {
    const { svc, prisma, audit } = fillSetup({
      ...ladderPosition,
      entries: [
        { price: 3000, notional: 100000 },
        { price: 2950, notional: 5 },
      ],
      pendingEntries: [{ price: 2950, notional: 5 }],
    });
    const result = await svc.applyEntryFill("pos1", 2950, 2950, "worker");
    expect(result.applied).toBe(false);
    const data = (prisma.virtualPosition.update as jest.Mock).mock.calls[0][0].data;
    expect(data.pendingEntries).toEqual([]);
    expect(data).not.toHaveProperty("size");
    expect(audit.record).toHaveBeenCalledWith(
      "worker",
      "position.entry_fill_skipped",
      expect.objectContaining({ positionId: "pos1", entryPrice: 2950 }),
    );
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
    // p-sl: mark 3100 vs SL 2950 LONG â†’ not hit; p-tp hits TP1 (single TP â†’ full close)
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

  function dcaPosition(overrides: Record<string, unknown> = {}) {
    return {
      id: "p-dca",
      accountId: "acc1",
      coin: "ETH",
      direction: "LONG",
      size: 33.333,
      entryPrice: 3000,
      stopLoss: 2800,
      takeProfits: [3050],
      leverage: 10,
      remainingSize: 33.333,
      filledTps: [],
      status: "OPEN",
      realizedPnl: 0,
      entries: [
        { price: 3000, notional: 100000 },
        { price: 2950, notional: 100000 / 3 },
      ],
      pendingEntries: [{ price: 2950, notional: 100000 / 3 }],
      account: { balance: 10000 },
      ...overrides,
    };
  }

  function dcaService(position: Record<string, unknown>, mid: number) {
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
    (prisma.virtualPosition.findMany as jest.Mock).mockResolvedValue([position]);
    (prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue(position);
    (prisma.virtualPosition.update as jest.Mock).mockImplementation(
      async (args: { data: Record<string, unknown> }) => ({ ...position, ...args.data }),
    );
    const svc = service(
      prisma,
      mockMarketData({ getAllMids: jest.fn(async () => ({ ETH: mid })) }),
      mockAccounts(),
    );
    return { svc, prisma };
  }

  it("fills a reached DCA level before the TP/SL check", async () => {
    // mark 2950 = the pending level â†’ LONG fill; TP 3050 and SL 2800 untouched.
    const { svc, prisma } = dcaService(dcaPosition(), 2950);
    const events = await svc.pollMarketOnce();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      positionId: "p-dca",
      kind: "ENTRY",
      markPrice: 2950,
      entryPrice: 2950,
    });
    expect(prisma.virtualPosition.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p-dca" },
        data: expect.objectContaining({ pendingEntries: [] }),
      }),
    );
    // TP/SL half of the cycle stays read-only (settle closes afterwards).
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reports the fill first, then the TP hit, in one cycle", async () => {
    // mark 2950 fills the level AND satisfies TP 2950 â†’ entry event first.
    const { svc, prisma } = dcaService(dcaPosition({ takeProfits: [2950] }), 2950);
    const events = await svc.pollMarketOnce();
    expect(events.map((e) => e.kind)).toEqual(["ENTRY", "TP"]);
    expect(events[1]).toMatchObject({ positionId: "p-dca", kind: "TP", tpIndex: 0 });
    expect(prisma.virtualPosition.update).toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
describe("VirtualTradingService manual exits", () => {
  const position = {
    id: "pos1",
    accountId: "acc1",
    coin: "ETH",
    direction: "LONG",
    size: 42,
    entryPrice: 3000,
    remainingSize: 42,
    stopLoss: 2900,
    takeProfits: [3100, 3200],
    filledTps: [],
    status: "OPEN",
    realizedPnl: 0,
    leverage: 10,
  };

  function manualSetup(
    overrides: { position?: Record<string, unknown>; mid?: number | null } = {},
  ) {
    const pos = overrides.position ?? position;
    const base = mockPrisma();
    const prisma: any = {
      ...base,
      virtualPosition: {
        ...base.virtualPosition,
        findUnique: jest.fn(async () => pos),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({
          virtualPosition: prisma.virtualPosition,
          virtualAccount: { findUniqueOrThrow: jest.fn(async () => ({ id: "acc1", balance: 10000 })) },
        }),
      ),
    };
    const audit = { record: jest.fn(async () => ({})) };
    const accounts = mockAccounts();
    const marketData = mockMarketData({
      getMid: jest.fn(async () => (overrides.mid === undefined ? 3050 : overrides.mid)),
    });
    const kill = { getMode: () => "OFF", setMode: jest.fn() };
    const svc = new VirtualTradingService(
      prisma as never,
      audit as never,
      marketData as never,
      accounts as never,
      mockCoins() as never,
      kill as never,
      CONFIG,
    );
    return { svc, prisma, audit, accounts };
  }

  it("takes a manual TP by percent and keeps the position open", async () => {
    const { svc, prisma, audit, accounts } = manualSetup();
    const result = await svc.takeProfitManual("pos1", { percent: 25 }, "alice");

    expect(result.markPrice).toBe(3050);
    expect(result.closedSize).toBeCloseTo(10.5, 6);
    expect(result.realized).toBeCloseTo(525, 6);
    expect(result.remainingSize).toBeCloseTo(31.5, 6);
    expect(result.fullyClosed).toBe(false);

    const args = (prisma.virtualPosition.updateMany as jest.Mock).mock.calls[0][0];
    expect(args.data.remainingSize).toBeCloseTo(31.5, 6);
    expect(args.data.realizedPnl).toBeCloseTo(525, 6);
    expect(args.data).not.toHaveProperty("status");
    expect(accounts.applyRealizedPnl).toHaveBeenCalledWith(
      expect.anything(),
      "acc1",
      525,
      "TP_MANUAL:pos1",
    );
    expect(audit.record).toHaveBeenCalledWith(
      "alice",
      "position.tp_manual",
      expect.objectContaining({ closedSize: 10.5, fullyClosed: false }),
    );
  });

  it("closes the whole remainder when size reaches or exceeds remaining", async () => {
    const { svc, prisma } = manualSetup();
    const result = await svc.takeProfitManual("pos1", { size: 100 }, "alice");
    expect(result.fullyClosed).toBe(true);
    expect(result.remainingSize).toBe(0);
    const args = (prisma.virtualPosition.updateMany as jest.Mock).mock.calls[0][0];
    expect(args.data).toMatchObject({ remainingSize: 0, status: "CLOSED" });
  });

  it("takes all by default and rejects invalid/zero sizes", async () => {
    const { svc } = manualSetup();
    const all = await svc.takeProfitManual("pos1", {}, "alice");
    expect(all.closedSize).toBeCloseTo(42, 6);
    expect(all.fullyClosed).toBe(true);

    await expect(svc.takeProfitManual("pos1", { percent: 0 }, "alice")).rejects.toThrow(
      /INVALID_PERCENT/,
    );
    await expect(svc.takeProfitManual("pos1", { size: 0 }, "alice")).rejects.toThrow(
      /INVALID_SIZE/,
    );
    await expect(
      svc.takeProfitManual("pos1", { size: 1, percent: 50 }, "alice"),
    ).rejects.toThrow(/SIZE_OR_PERCENT_ONLY/);
  });

  it("refuses when the quote is missing or the position is closed", async () => {
    const { svc } = manualSetup({ mid: null });
    await expect(svc.takeProfitManual("pos1", {}, "alice")).rejects.toThrow(/NO_QUOTE/);

    const closed = manualSetup({ position: { ...position, status: "CLOSED" } });
    await expect(closed.svc.takeProfitManual("pos1", {}, "alice")).rejects.toThrow(ConflictException);
  });

  it("keeps TP_HIT status when taking profit manually in parts", async () => {
    const { svc, prisma } = manualSetup({
      position: { ...position, status: "TP_HIT", filledTps: [3100], remainingSize: 21 },
    });
    const result = await svc.takeProfitManual("pos1", { percent: 50 }, "alice");
    expect(result.remainingSize).toBeCloseTo(10.5, 6);
    const data = (prisma.virtualPosition.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty("status");
    expect(data).not.toHaveProperty("filledTps");
  });

  it("leaves pending DCA entry levels untouched on a manual TP", async () => {
    const { svc, prisma } = manualSetup({
      position: {
        ...position,
        entries: [
          { price: 3000, notional: 100000 },
          { price: 2950, notional: 50000 },
        ],
        pendingEntries: [{ price: 2950, notional: 50000 }],
      },
    });
    await svc.takeProfitManual("pos1", { percent: 25 }, "alice");
    const data = (prisma.virtualPosition.updateMany as jest.Mock).mock.calls[0][0].data;
    expect(data).not.toHaveProperty("pendingEntries");
    expect(data).not.toHaveProperty("filledTps");
  });

  it("rejects a manual TP when the row changed underneath (CAS)", async () => {
    const { svc, prisma } = manualSetup();
    (prisma.virtualPosition.updateMany as jest.Mock).mockResolvedValue({ count: 0 });
    await expect(svc.takeProfitManual("pos1", { percent: 25 }, "alice")).rejects.toThrow(
      /POSITION_CHANGED/,
    );
  });

  it("moves the stop loss for an open position", async () => {
    const { svc, prisma, audit } = manualSetup();
    const result = await svc.updateStopLoss("pos1", 3000, "alice");
    expect(result).toEqual({ old: 2900, new: 3000 });
    expect(prisma.virtualPosition.updateMany).toHaveBeenCalledWith({
      where: { id: "pos1", status: { in: ["OPEN", "TP_HIT"] } },
      data: { stopLoss: 3000 },
    });
    expect(audit.record).toHaveBeenCalledWith(
      "alice",
      "position.sl_update",
      expect.objectContaining({ old: 2900, new: 3000, markPrice: 3050 }),
    );
  });

  it("rejects a stop loss that is already through the mark", async () => {
    const { svc } = manualSetup();
    await expect(svc.updateStopLoss("pos1", 3050, "alice")).rejects.toThrow(
      /SL_ALREADY_TRIGGERED/,
    );

    const short = manualSetup({
      position: { ...position, direction: "SHORT", entryPrice: 3000, stopLoss: 3100 },
    });
    await expect(short.svc.updateStopLoss("pos1", 3050, "alice")).rejects.toThrow(
      /SL_ALREADY_TRIGGERED/,
    );
  });

  it("rejects an invalid stop loss and a closed position", async () => {
    const { svc } = manualSetup();
    await expect(svc.updateStopLoss("pos1", 0, "alice")).rejects.toThrow(/INVALID_STOP_LOSS/);

    const closed = manualSetup({ position: { ...position, status: "CLOSED" } });
    await expect(closed.svc.updateStopLoss("pos1", 3000, "alice")).rejects.toThrow(
      ConflictException,
    );
  });
});
