import { DEFAULT_CARD_THEME, STATS_CARD_THEME } from "./card-config";
import { PositionSnapshot } from "./card-types";
import { validateSnapshot } from "./snapshot-validator";
import { buildViewModel } from "./view-model";
import { buildStatsViewModel, formatGrouped } from "./stats-view-model";
import { renderCardHtml } from "./card-template";
import { renderStatsHtml, STATS_CARD_TUNING } from "./stats-card-template";
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

  it("accepts closed snapshots (tp/sl/close update cards)", () => {
    const result = validateSnapshot(snapshot({ status: "CLOSED" }), DEFAULT_CARD_THEME, NOW);
    expect(result.ok).toBe(true);
  });

  it("rejects an invalid status value", () => {
    const result = validateSnapshot(
      snapshot({ status: "FOO" as never }),
      DEFAULT_CARD_THEME,
      NOW,
    );
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
      "pnl-strip",
    );
    expect(result).toEqual(expect.objectContaining({ code: "INVALID_PNL" }));
  });

  it("lets position-stats omit floatingProfit (it derives PnL itself)", () => {
    const { floatingProfit: _dropped, ...rest } = snapshot();
    void _dropped;
    expect(validateSnapshot(rest, STATS_CARD_THEME, NOW, "position-stats").ok).toBe(true);
    expect(validateSnapshot(rest, DEFAULT_CARD_THEME, NOW, "pnl-strip").ok).toBe(false);
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
      liquidationPrice: 2275,
      maintenanceMarginRate: 0.01,
      ...overrides,
    });
  }

  it("derives notional and margin at mark, ROI at entry margin, and MMR x leverage fallback", () => {
    // PnL (4172.845−4172.493)×1, notional 1×mark, margin /10.
    const result = buildStatsViewModel(stats(), STATS_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.notionalText).toBe("4,172.85");
    expect(result.model.marginText).toBe("417.28");
    expect(result.model.roiText).toBe("+0.08%");
    expect(result.model.marginRatioText).toBe("10.00%");
    expect(result.model.pnlText).toBe("+0.35");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.positivePnl);
  });

  it("tracks the mark price for notional and margin", () => {
    // 41.1924016427545 ETH: entry 2427.63, mark 2383.75, 10x.
    const result = buildStatsViewModel(
      stats({
        volume: 41.1924016427545,
        entryPrice: 2427.63,
        currentPrice: 2383.75,
        leverage: 10,
        priceDigits: 2,
      }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.notionalText).toBe("98,192.39");
    expect(result.model.marginText).toBe("9,819.24");
    expect(result.model.pnlText).toBe("-1,807.52");
    expect(result.model.roiText).toBe("-18.08%");
  });

  it("ignores a stale floatingProfit when price × size are usable", () => {
    const result = buildStatsViewModel(stats({ floatingProfit: 9999 }), STATS_CARD_THEME);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.pnlText).toBe("+0.35");
  });

  it("falls back to floatingProfit when prices are unusable", () => {
    const result = buildStatsViewModel(
      stats({ currentPrice: Number.NaN, floatingProfit: 12.5 }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.pnlText).toBe("+12.50");
    expect(result.model.roiText).toBe("+3.00%");
    // Mark is unusable: notional/margin fall back to entry.
    expect(result.model.notionalText).toBe("4,172.49");
    expect(result.model.marginText).toBe("417.25");
  });

  it("treats an unusable fallback PnL as zero", () => {
    const result = buildStatsViewModel(
      stats({ currentPrice: Number.NaN, floatingProfit: Number.NaN }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.pnlText).toBe("0.00");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.zeroPnl);
  });

  it("renders zero PnL neutral", () => {
    const result = buildStatsViewModel(
      stats({ entryPrice: 100, currentPrice: 100, volume: 2, floatingProfit: 0 }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.pnlText).toBe("0.00");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.zeroPnl);
    const html = renderStatsHtml(result.model, STATS_CARD_THEME);
    expect(html).toContain('class="big zero"');
  });

  it("derives PNL from prices and notional/margin from the live mark", () => {
    // size 2: entry notional 200, mark notional 210, margin 42 at 5x.
    const result = buildStatsViewModel(
      stats({
        volume: 2,
        entryPrice: 100,
        currentPrice: 105,
        floatingProfit: 10,
        leverage: 5,
        priceDigits: 2,
      }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.notionalText).toBe("210.00");
    expect(result.model.marginText).toBe("42.00");
    expect(result.model.pnlText).toBe("+10.00");
    // ROI uses the entry margin (200/5), not the live margin.
    expect(result.model.roiText).toBe("+25.00%");
    // No accountMarginRatio: legacy fallback is MMR × leverage.
    expect(result.model.marginRatioText).toBe("5.00%");
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

  it("uses the account cross margin ratio supplied by the API", () => {
    // 0.0012718 = maintenance 12.75 / equity 10025 from the API snapshot.
    const result = buildStatsViewModel(
      stats({ accountMarginRatio: 0.0012718 }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.marginRatioText).toBe("0.13%");
  });

  it("renders -- when the account ratio is unavailable", () => {
    const result = buildStatsViewModel(
      stats({ accountMarginRatio: null }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.marginRatioText).toBe("--");
  });

  it("picks the S badge, cross-20x chip and negative colors", () => {
    const result = buildStatsViewModel(
      stats({
        direction: "SELL",
        leverage: 20,
      }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.directionBadge).toBe("S");
    expect(result.model.directionColor).toBe(STATS_CARD_THEME.sellColor);
    expect(result.model.marginTypeText).toBe("Cross 20X");
    // SELL loses when mark > entry: −(4172.845−4172.493)×1.
    expect(result.model.pnlText).toBe("-0.35");
    expect(result.model.roiText).toBe("-0.17%");
    // No accountMarginRatio: legacy MMR 1% × 20x.
    expect(result.model.marginRatioText).toBe("20.00%");
    expect(result.model.pnlColor).toBe(STATS_CARD_THEME.negativePnl);
  });

  it("formats entry, mark and liquidation with price digits", () => {
    const result = buildStatsViewModel(
      stats({ priceDigits: 3, liquidationPrice: 4010.5 }),
      STATS_CARD_THEME,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.entryText).toBe("4,172.493");
    expect(result.model.markText).toBe("4,172.845");
    expect(result.model.liqText).toBe("4,010.500");
  });
});

describe("renderStatsHtml", () => {
  it("renders the Vietnamese labels and values", () => {
    const vm = buildStatsViewModel(
      snapshot({ leverage: 10, liquidationPrice: 2275 }),
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
      "Vĩnh cửu",
      "Cross 10X",
    ]) {
      expect(html).toContain(label);
    }
    // Badge "L" in the header.
    expect(html).toMatch(/<span class="badge long"><span class="badge-txt">L<\/span><\/span>/);
    expect(html).toContain(
      `translate(${STATS_CARD_TUNING.badgeTextOffsetX}px,${STATS_CARD_TUNING.badgeTextOffsetY}px)`,
    );
    // CSS is authored at theme.width/scale (420) and scaled by the renderer.
    expect(html).toContain(`${STATS_CARD_THEME.width / 2}px`);
    expect(html).toContain(`${STATS_CARD_THEME.height / 2}px`);
    // Embedded IBM Plex Sans, no network font fetch.
    expect(html).toContain("@font-face");
    expect(html).toContain("IBM Plex Sans");
    expect(html).toContain("data:font/woff2;base64,");
    // Binance chrome: indicator bars, share/swap svgs, dotted underlines, tags.
    expect(html).toContain('class="bars"');
    // Thousands separators are wrapped so the comma can be nudged optically.
    expect(html).toContain('4<span class="num-sep">,</span>172.85');
    expect(html).toContain(`margin-left:${STATS_CARD_TUNING.numberSepShift}px`);
    expect((html.match(/class="bar-item/g) ?? []).length).toBe(4);
    expect((html.match(/class="bar-item off"/g) ?? []).length).toBe(1);
    expect((html.match(/<rect/g) ?? []).length).toBe(4);
    expect((html.match(/<circle/g) ?? []).length).toBe(7); // 3 share icon + 4 dots
    expect((html.match(/<svg/g) ?? []).length).toBe(6);
    // Swap icon: heads reversed (top ←, bottom →), one wing per tip, wings
    // flaring out of the gap — geometry derived from the tunable knobs.
    const swapGap = STATS_CARD_TUNING.swapLineGap;
    const swapWing = STATS_CARD_TUNING.swapWingLen;
    expect(html).toContain(
      `d="M20 ${12 - swapGap / 2}H4l${swapWing} -${swapWing}M4 ${12 + swapGap / 2}H20l-${swapWing} ${swapWing}"`,
    );
    expect(html).not.toContain("M16 4.5l4 4-4 4");
    // The swap row gets its own gap knob; the PNL/share row keeps labelRowGap.
    expect(html).toContain(
      `.lrow{display:flex;align-items:center;gap:${STATS_CARD_TUNING.labelRowGap}px}`,
    );
    expect(html).toContain(`.lrow.swap{gap:${STATS_CARD_TUNING.swapIconGap}px}`);
    expect(html).toContain('class="lrow swap"');
    expect(html).toContain(`fill="${STATS_CARD_TUNING.barOffColor}"`);
    // Tags: fill + border come from the hand-tunable table.
    expect(html).toContain(`background:${STATS_CARD_TUNING.tagBackground}`);
    expect(html).toContain(`border:${STATS_CARD_TUNING.tagBorder}`);
    expect(html).toContain(
      `background:${STATS_CARD_TUNING.bodyBackground ?? STATS_CARD_THEME.background}`,
    );
    expect(html).toContain(STATS_CARD_TUNING.pnlUpColor ?? STATS_CARD_THEME.positivePnl);
    expect(html).toContain("BinancePlex");
    expect(html).toContain(`width:${STATS_CARD_TUNING.badgeSize}px`);
    // Label uses the theme size; symbol/value use the hand-tunable sizes.
    expect(html).toContain(
      `font-size:${STATS_CARD_TUNING.labelFontSize ?? STATS_CARD_THEME.lineFontSize}px`,
    );
    expect(html).toContain(`font-size:${STATS_CARD_TUNING.symbolFontSize}px`);
    expect(html).toContain(`font-size:${STATS_CARD_TUNING.valueFontSize}px`);
    // Selective underlines — 5 labels (PNL, ROI, Tỉ lệ ký quỹ, Giá vào lệnh,
    // Giá thanh lý); Giá đánh dấu / Kích thước / Margin are `.lbl.plain`.
    expect((html.match(/class="lbl"/g) ?? []).length).toBe(5);
    expect(html).toContain(`class="lbl plain">${STATS_CARD_TUNING.labels.mark}`);
    // Underline is a gradient so dash/gap stay tunable at a fixed label width.
    expect(html).toContain("repeating-linear-gradient(to right");
    expect(html).toContain(`${STATS_CARD_TUNING.labelLineDash}px`);
    expect(html).not.toContain("border-bottom");
    expect(html).not.toContain('class="ph"');
  });

  it("renders the fixed account tag and escapes html", () => {
    const vm = buildStatsViewModel(snapshot({ displaySymbol: "X<Y" }), STATS_CARD_THEME);
    expect(vm.ok).toBe(true);
    if (!vm.ok) return;
    const html = renderStatsHtml(vm.model, STATS_CARD_THEME);
    expect(html).toContain("X&lt;Y");
    expect(html).toContain('<span class="tag acc">Vĩnh cửu</span>');
    // The margin-type tag is still rendered separately.
    expect(html.split('class="tag"').length - 1).toBe(1);
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

  it("renders closed snapshots instead of short-circuiting", async () => {
    const factory = jest.fn(async () => {
      throw new Error("no browser");
    });
    const renderer = new FloatingPnLCardRenderer(factory);
    const outcome = await renderer.render(snapshot({ status: "CLOSED" }));
    expect(factory).toHaveBeenCalled();
    expect(outcome).not.toEqual(expect.objectContaining({ code: "POSITION_NOT_OPEN" }));
  });
});
