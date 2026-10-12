import { DEFAULT_CARD_THEME } from "./card-config";
import { PositionSnapshot } from "./card-types";
import { validateSnapshot } from "./snapshot-validator";
import { buildViewModel } from "./view-model";
import { renderCardHtml } from "./card-template";
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
