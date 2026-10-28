import { buildDailyReport, formatPct, positionRow, roiPct } from "./daily-sheet.mapper";

function position(overrides: Partial<Parameters<typeof positionRow>[0]> = {}) {
  return {
    id: "p1",
    status: "OPEN",
    coin: "ETH",
    direction: "LONG",
    entryPrice: 100,
    size: 10,
    leverage: 10,
    realizedPnl: null,
    openedAt: new Date("2026-10-27T01:00:00Z"),
    filledAt: new Date("2026-10-27T01:00:00Z"),
    entries: [{ price: 100, notional: 1000 }],
    pendingEntries: [],
    sourceName: "Channel A",
    ...overrides,
  };
}

describe("daily sheet mapper", () => {
  it("uses card-style ROI with two decimals and maps the state from PnL", () => {
    expect(roiPct(position({ status: "CLOSED", realizedPnl: 10 }))).toBe(10);
    expect(positionRow(position({ status: "CLOSED", realizedPnl: 10 }))?.state).toBe("TP");
    expect(positionRow(position({ status: "SL_HIT", realizedPnl: -5 }))?.state).toBe("SL");
    expect(positionRow(position({ status: "CLOSED", realizedPnl: 0 }))?.state).toBe("BE");
    expect(positionRow(position({ status: "OPEN" }))?.state).toBe("Processing");
  });

  it("formats entries in fill order and keeps planned levels for limits", () => {
    const filled = positionRow(
      position({
        entries: [
          { price: 100, notional: 1000 },
          { price: 90, notional: 500 },
        ],
        pendingEntries: [{ price: 90, notional: 500 }],
      }),
    );
    expect(filled?.entry).toBe("100");

    const limit = buildDailyReport([], [
      position({
        status: "PENDING_ENTRY",
        entries: [
          { price: 100, notional: 1000 },
          { price: 90, notional: 500 },
          { price: 80, notional: 500 },
        ],
      }),
    ]);
    expect(limit.limits[0].entry).toBe("100 - 90 - 80");
    expect(limit.limits[0].state).toBe("Limit");
    expect(limit.total).toBe(0);
  });

  it("sums displayed percentages and counts states", () => {
    const report = buildDailyReport(
      [
        position({ id: "p1", status: "CLOSED", realizedPnl: 10 }),
        position({ id: "p2", direction: "SHORT", status: "SL_HIT", realizedPnl: -5 }),
        position({ id: "p3", status: "OPEN" }),
        position({ id: "p4", status: "CLOSED", realizedPnl: 0 }),
      ],
      [],
    );
    expect(report.long).toBe(3);
    expect(report.short).toBe(1);
    expect(report.win).toBe(1);
    expect(report.lose).toBe(1);
    expect(report.be).toBe(1);
    expect(report.processing).toBe(1);
    expect(report.pnlPct).toBe(5);
    expect(report.pnlText).toBe("+5.00%");
  });

  it("formats plus, minus and zero", () => {
    expect(formatPct(1.234)).toBe("+1.23%");
    expect(formatPct(-1.235)).toBe("-1.24%");
    expect(formatPct(0)).toBe("0.00%");
  });
});
