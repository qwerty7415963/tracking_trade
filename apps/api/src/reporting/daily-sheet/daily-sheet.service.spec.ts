import { DailySheetService } from "./daily-sheet.service";

const CONFIG = {
  dailySheetSpreadsheetId: "sheet-1",
  googleServiceAccountJson: "C:/secrets/sa.json",
  dailySheetAccountId: "acc-1",
  dailySheetTemplateTab: "TEMPLATE",
  dailySheetTimezone: "Asia/Ho_Chi_Minh",
  dailySheetSyncMs: 300_000,
  dailySheetMorningAt: "08:00",
  dailySheetStartDate: "",
};

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    accountId: "acc-1",
    coin: "ETH",
    direction: "LONG",
    status: "CLOSED",
    entryPrice: 100,
    size: 10,
    leverage: 10,
    realizedPnl: 10,
    openedAt: new Date("2026-10-27T01:00:00Z"),
    filledAt: new Date("2026-10-27T01:00:00Z"),
    entries: [{ price: 100, notional: 1000 }],
    pendingEntries: [],
    signal: { source: { displayName: "Channel A" } },
    ...overrides,
  };
}

function setup(records: unknown[], mids: Record<string, number> = {}) {
  const setting = {
    id: "singleton",
    startDate: new Date("2026-10-27T00:00:00Z"),
    lastSyncAt: null,
    lastError: null,
  };
  const prisma = {
    dailySheetSetting: {
      findUnique: jest.fn(async () => setting),
      create: jest.fn(async (args: { data: unknown }) => ({ ...setting, ...(args.data as object) })),
      update: jest.fn(async () => setting),
      upsert: jest.fn(async () => setting),
    },
    virtualPosition: { findMany: jest.fn(async () => records) },
  };
  const audit = { record: jest.fn(async () => ({})) };
  const client = {
    ensureTemplate: jest.fn(async () => undefined),
    ensureTab: jest.fn(async () => undefined),
    writeTab: jest.fn(async () => undefined),
  };
  const marketData = { getAllMids: jest.fn(async () => mids) };
  const svc = new DailySheetService(
    prisma as never,
    audit as never,
    CONFIG as never,
    client as never,
    marketData as never,
  );
  return { svc, prisma, audit, client, marketData };
}

describe("DailySheetService", () => {
  it("writes filled positions and pending limits for a local day", async () => {
    const { svc, prisma, client, audit } = setup([
      record(),
      record({
        id: "p2",
        status: "PENDING_ENTRY",
        realizedPnl: null,
        filledAt: null,
        entries: [
          { price: 100, notional: 1000 },
          { price: 90, notional: 500 },
        ],
        signal: { source: { displayName: "Channel B" } },
      }),
    ]);

    const out = await svc.syncDate("27/10/26", "tester");
    expect(out).toMatchObject({ dateKey: "2026-10-27", tab: "27/10/26", rows: 1, limits: 1 });
    expect(prisma.virtualPosition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          accountId: "acc-1",
          OR: expect.any(Array),
        }),
        include: { signal: { include: { source: true } } },
      }),
    );
    expect(client.writeTab).toHaveBeenCalledWith(
      "27/10/26",
      "NHẬT KÝ TRADING TOPCOIN - 27/10/2026",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            channel: "Channel A",
            symbol: "ETH",
            state: "TP",
            pnl: "+10.00%",
          }),
        ],
        limits: [
          expect.objectContaining({
            channel: "Channel B",
            entry: "100 - 90",
            state: "Limit",
          }),
        ],
        total: 1,
      }),
    );
    expect(prisma.dailySheetSetting.update).toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      "tester",
      "daily_sheet.sync",
      expect.objectContaining({ dateKey: "2026-10-27" }),
    );
  });

  it("writes live uPnL for processing positions without changing the total", async () => {
    const { svc, client, marketData } = setup(
      [record({ status: "OPEN", realizedPnl: null })],
      { ETH: 110 },
    );

    const out = await svc.syncDate("27/10/26", "tester");
    expect(out).toMatchObject({ dateKey: "2026-10-27", rows: 1 });
    expect(marketData.getAllMids).toHaveBeenCalled();
    expect(client.writeTab).toHaveBeenCalledWith(
      "27/10/26",
      "NHẬT KÝ TRADING TOPCOIN - 27/10/2026",
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            state: "Processing",
            pnl: "+100.00% (uPnL)",
          }),
        ],
        pnlPct: 0,
        pnlText: "0.00%",
      }),
    );
  });

  it("does not create tabs before the persisted start date", async () => {
    const { svc, client } = setup([]);
    await expect(svc.syncDate("26/10/26", "tester")).resolves.toMatchObject({
      skipped: true,
      rows: 0,
    });
    expect(client.writeTab).not.toHaveBeenCalled();
  });

  it("initializes the start date from the local day on first boot", async () => {
    const { svc, prisma } = setup([]);
    prisma.dailySheetSetting.findUnique.mockResolvedValueOnce(null as never);
    const out = await svc.status();
    expect(out.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(prisma.dailySheetSetting.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ id: "singleton", startDate: expect.any(Date) }),
      }),
    );
  });

  it("rejects when the sheet is not configured", async () => {
    const svc = new DailySheetService(
      { dailySheetSetting: { findUnique: jest.fn() } } as never,
      { record: jest.fn() } as never,
      { ...CONFIG, dailySheetSpreadsheetId: "" } as never,
      {} as never,
      { getAllMids: jest.fn(async () => ({})) } as never,
    );
    await expect(svc.syncDate("2026-10-27", "tester")).rejects.toThrow(/not configured/);
  });
});
