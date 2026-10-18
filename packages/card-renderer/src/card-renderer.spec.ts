import { DEFAULT_CARD_THEME, STATS_CARD_THEME } from "./card-config";
import { PositionSnapshot } from "./card-types";
import { validateSnapshot } from "./snapshot-validator";
import { buildViewModel } from "./view-model";
import { buildStatsViewModel, formatGrouped } from "./stats-view-model";
import { renderCardHtml } from "./card-template";
import { renderStatsHtml } from "./stats-card-template";
import {
  FloatingPnLCardRenderer,
  parsePngDimensions,
} from "./card-renderer";

function snapshot(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
  return {
    accountId: "acc1",
    positionId: "p1",
    executionId: "e1",
    symbol: "XAUUSD.a",
    displaySymbol: "XAUUSD",
    direction: "BUY",
    volume: 1,
    entryPrice: 4172.493,
    currentPrice: 4172.845,
    floatingProfit: 35.2,
    profitCurrency: "USD",
    brokerSnapshotAt: new Date().toISOString(),
    snapshotId: "snap1",
    status: "OPEN",
    priceDigits: 3,
    volumeDigits: 2,
    ...overrides,
  };
}

const NOW = new Date();

describe("validateSnapshot", () => {
  it("accepts a fresh open snapshot", () => {
    expect(validateSnapshot(snapshot(), DEFAULT_CARD_THEME, NOW).ok).toBe(true);
  });

  it("rejects closed positions", () => {
    const result = validateSnapshot(snapshot({ status: "CLOSED" }), DEFAULT_CARD_THEME, NOW);
    expect(result).toEqual(expect.objectContaining({ code: "POSITION_NOT_OPEN" }));
  });

  it("rejects stale snapshots", () => {
    const old = new Date(NOW.getTime() - 60_000).toISOString();
    const result = validateSnapshot(
      snapshot({ brokerSnapshotAt: old }),
      DEFAULT_CARD_THEME,
      NOW,
    );
    expect(result).toEqual(expect.objectContaining({ code: "STALE_POSITION_SNAPSHOT" }));
  });

  it("rejects missing fields", () => {
    const { entryPrice: _dropped, ...rest } = snapshot();
    void _dropped;
    const result = validateSnapshot(rest, DEFAULT_CARD_THEME, NOW);
    expect(result).toEqual(expect.objectContaining({ code: "MISSING_REQUIRED_FIELD" }));
  });

  it("rejects invalid pnl", () => {
    const result = validateSnapshot(
      snapshot({ floatingProfit: Number.NaN }),
      DEFAULT_CARD_THEME,
      NOW,
    );
    expect(result).toEqual(expect.objectContaining({ code: "INVALID_PNL" }));
  });
});

describe("buildViewModel", () => {
  it("formats the reference example", () => {
    const result = buildViewModel(snapshot(), DEFAULT_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.symbol).toBe("XAUUSD");
    expect(result.model.directionText).toBe("buy");
    expect(result.model.directionColor).toBe(DEFAULT_CARD_THEME.buyColor);
    expect(result.model.volumeText).toBe("1");
    expect(result.model.priceText).toBe("4172.493 → 4172.845");
    expect(result.model.pnlText).toBe("35.20");
    expect(result.model.pnlColor).toBe(DEFAULT_CARD_THEME.positivePnl);
  });

  it("colors direction and pnl independently (buy losing shows red pnl)", () => {
    const result = buildViewModel(snapshot({ floatingProfit: -12.4 }), DEFAULT_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.directionColor).toBe(DEFAULT_CARD_THEME.buyColor);
    expect(result.model.pnlColor).toBe(DEFAULT_CARD_THEME.negativePnl);
    expect(result.model.pnlText).toBe("-12.40");
  });

  it("colors zero pnl neutral", () => {
    const result = buildViewModel(snapshot({ floatingProfit: 0 }), DEFAULT_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.pnlColor).toBe(DEFAULT_CARD_THEME.zeroPnl);
  });
});

describe("renderCardHtml", () => {
  it("embeds values and escapes html", () => {
    const vm = buildViewModel(snapshot({ displaySymbol: "X<Y" }), DEFAULT_CARD_THEME);
    expect(vm.ok).toBe(true);
    if (!vm.ok) return;
    const html = renderCardHtml(vm.model, DEFAULT_CARD_THEME);
    expect(html).toContain("X&lt;Y");
    expect(html).toContain("1280");
  });
});

describe("formatGrouped", () => {
  it("groups thousands with ascii commas", () => {
    expect(formatGrouped(50056.7, 2)).toBe("50,056.70");
    expect(formatGrouped(2502.83, 2)).toBe("2,502.83");
    expect(formatGrouped(-1234.5, 1)).toBe("-1,234.5");
    expect(formatGrouped(716.384, 3)).toBe("716.384");
  });
});

describe("buildStatsViewModel", () => {
  function stats(overrides: Partial<PositionSnapshot> = {}): PositionSnapshot {
    return snapshot({
      leverage: 10,
      marginType: "CROSS",
      accountName: "Vinh cưu",
      liquidationPrice: 2275,
      ...overrides,
    });
  }

  it("derives margin, ROI and margin ratio from leverage", () => {
    // notional 1×4172.493, margin /10, ROI = 35.2/margin.
    const result = buildStatsViewModel(stats(), STATS_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.notionalText).toBe("4,172.49");
    expect(result.model.marginText).toBe("417.25");
    expect(result.model.roiText).toBe("+8.44%");
    expect(result.model.marginRatioText).toBe("10.00%");
    expect(result.model.pnlText).toBe("+35.20");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.positivePnl);
  });

  it("shows -- when leverage and liquidation are missing", () => {
    const result = buildStatsViewModel(
      stats({ leverage: null, liquidationPrice: null }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.marginText).toBe("--");
    expect(result.model.roiText).toBe("--");
    expect(result.model.marginRatioText).toBe("--");
    expect(result.model.liqText).toBe("--");
    expect(result.model.marginTypeText).toBe("Cross ?X");
  });

  it("picks the S badge, cross-20x chip and negative colors", () => {
    const result = buildStatsViewModel(
      stats({
        direction: "SELL",
        floatingProfit: -12.4,
        leverage: 20,
        accountName: "  ",
      }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.directionBadge).toBe("S");
    expect(result.model.directionColor).toBe(STATS_CARD_THEME.sellColor);
    expect(result.model.marginTypeText).toBe("Cross 20X");
    expect(result.model.accountName).toBe("");
    expect(result.model.pnlText).toBe("-12.40");
    expect(result.model.roiText).toBe("-5.94%");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.negativePnl);
  });

  it("formats entry, mark and liquidation with price digits", () => {
    const result = buildStatsViewModel(
      stats({ priceDigits: 3, liquidationPrice: 4010.5 }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.entryText).toBe("4172.493");
    expect(result.model.markText).toBe("4172.845");
    expect(result.model.liqText).toBe("4010.500");
  });
});

describe("renderStatsHtml", () => {
  it("renders the Vietnamese labels and values", () => {
    const vm = buildStatsViewModel(
      snapshot({ leverage: 10, accountName: "Vinh cưu", liquidationPrice: 2275 }),
      STATS_CARD_THEME,
    );
    expect(vm.ok).toBe(true);
    if (!vm.ok) return;
    const html = renderStatsHtml(vm.model, STATS_CARD_THEME);
    for (const label of [
      "PNL (USDT)",
      "ROI",
      "Kích thước (USDT)",
      "Margin (USDT)",
      "Tỉ lệ ký quỹ",
      "Giá vào lệnh (USDT)",
      "Giá đánh dấu (USDT)",
      "Giá thanh lý (USDT)",
      "Vinh cưu",
      "Cross 10X",
      ">L<",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("1280");
    expect(html).toContain(`${STATS_CARD_THEME.height}px`);
  });

  it("hides the account chip and escapes html", () => {
    const vm = buildStatsViewModel(snapshot({ displaySymbol: "X<Y", accountName: null }), STATS_CARD_THEME);
    expect(vm.ok).toBe(true);
    if (!vm.ok) return;
    const html = renderStatsHtml(vm.model, STATS_CARD_THEME);
    expect(html).toContain("X&lt;Y");
    // Only the margin-type chip remains — no account chip without a name.
    expect(html.split('class="chip"').length - 1).toBe(1);
  });
});

describe("parsePngDimensions", () => {
  // 1x1 transparent PNG.
  const tiny = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  it("parses real png dimensions", () => {
    expect(parsePngDimensions(tiny)).toEqual({ width: 1, height: 1 });
  });

  it("rejects non-png buffers", () => {
    expect(parsePngDimensions(Buffer.from("not a png"))).toBeNull();
  });
});

describe("FloatingPnLCardRenderer", () => {
  it("refuses to render without launching trades (no-trade surface)", () => {
    const renderer = new FloatingPnLCardRenderer(async () => {
      throw new Error("should not launch");
    });
    const ownKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(renderer));
    expect(ownKeys).toEqual(expect.arrayContaining(["render"]));
    expect(ownKeys).not.toEqual(
      expect.arrayContaining(["sendCommand", "openOrder", "closeOrder", "trade"]),
    );
  });

  it("returns render failure when the browser fails", async () => {
    const renderer = new FloatingPnLCardRenderer(async () => {
      throw new Error("no browser");
    });
    const outcome = await renderer.render(snapshot());
    expect(outcome.ok).toBe(false);
  });

  it("rejects closed snapshots before touching the browser", async () => {
    const factory = jest.fn(async () => {
      throw new Error("should not launch");
    });
    const renderer = new FloatingPnLCardRenderer(factory);
    const outcome = await renderer.render(snapshot({ status: "CLOSED" }));
    expect(outcome).toEqual(expect.objectContaining({ code: "POSITION_NOT_OPEN" }));
    expect(factory).not.toHaveBeenCalled();
  });
});
