import {
  accountEquity,
  calcPerpSizeByNotional,
  crossLiquidationPrice,
  crossMarginRatio,
  detectTpSlHit,
  evaluateVirtualRisk,
  liquidationPrice,
  maintenanceMarginUsed,
  realizedPnl,
  roundDownToStep,
  splitTps,
  unrealizedPnl,
  VirtualRiskInput,
} from "./virtual-account";
import { maintenanceMarginFor } from "./margin-tiers";

function baseRisk(overrides: Partial<VirtualRiskInput> = {}): VirtualRiskInput {
  return {
    killSwitch: "OFF",
    approvalValid: true,
    coinMapped: true,
    size: 0.05,
    minSize: 0.001,
    sizeIncrement: 0.001,
    notional: 175,
    leverage: 10,
    equity: 10000,
    openPositions: 0,
    maxPositions: 5,
    isMutation: false,
    ...overrides,
  };
}

describe("calcPerpSizeByNotional", () => {
  it("sizes from fixed USDC notional", () => {
    const r = calcPerpSizeByNotional({
      notional: 100000,
      entryPrice: 3500,
      minSize: 0.001,
      sizeIncrement: 0.001,
    });
    expect(r.rejected).toBe(false);
    expect(r.reason).toBeNull();
    expect(r.size).toBeCloseTo(28.571, 9);
  });

  it("rounds DOWN to increment", () => {
    const r = calcPerpSizeByNotional({
      notional: 50000,
      entryPrice: 3500,
      minSize: 0.001,
      sizeIncrement: 0.1,
    });
    expect(r.size).toBeCloseTo(14.2, 9);
    const r2 = calcPerpSizeByNotional({
      notional: 55000,
      entryPrice: 3500,
      minSize: 0.001,
      sizeIncrement: 0.1,
    });
    expect(r2.size).toBeCloseTo(15.7, 9);
  });

  it("rejects when min size exceeds the notional size", () => {
    const r = calcPerpSizeByNotional({
      notional: 10,
      entryPrice: 3500,
      minSize: 1,
      sizeIncrement: 0.001,
    });
    expect(r.rejected).toBe(true);
    expect(r.reason).toBe("MIN_SIZE_EXCEEDS_NOTIONAL");
  });

  it("rejects invalid inputs", () => {
    expect(
      calcPerpSizeByNotional({ notional: 0, entryPrice: 1, minSize: 1, sizeIncrement: 1 }).reason,
    ).toBe("INVALID_NOTIONAL");
    expect(
      calcPerpSizeByNotional({ notional: 10, entryPrice: 0, minSize: 1, sizeIncrement: 1 }).reason,
    ).toBe("INVALID_ENTRY_PRICE");
    expect(
      calcPerpSizeByNotional({ notional: 10, entryPrice: 5, minSize: 0, sizeIncrement: 0 }).reason,
    ).toBe("INVALID_SIZE_SPEC");
  });
});

describe("roundDownToStep", () => {
  it("floors to step", () => {
    expect(roundDownToStep(0.559, 0.1)).toBeCloseTo(0.5, 9);
    expect(roundDownToStep(2, 0.5)).toBe(2);
  });
});

describe("unrealizedPnl / realizedPnl", () => {
  it("long profits when price rises", () => {
    expect(unrealizedPnl("LONG", 1, 3000, 3100)).toBe(100);
  });
  it("long loses when price falls", () => {
    expect(unrealizedPnl("LONG", 2, 3000, 2950)).toBe(-100);
  });
  it("short profits when price falls", () => {
    expect(unrealizedPnl("SHORT", 0.5, 2600, 2500)).toBe(50);
  });
  it("realized equals unrealized at close", () => {
    expect(realizedPnl("SHORT", 0.5, 2600, 2500)).toBe(50);
  });
});

describe("accountEquity / crossMarginRatio / liquidationPrice", () => {
  const positions = [
    { coin: "ETH", direction: "LONG" as const, size: 1, entryPrice: 3000, leverage: 10 },
  ];

  it("equity = balance + unrealized", () => {
    expect(accountEquity(10000, positions, { ETH: 3100 })).toBe(10100);
    expect(accountEquity(10000, positions, { ETH: 2900 })).toBe(9900);
  });

  it("ignores coins without a quote", () => {
    expect(accountEquity(10000, positions, {})).toBe(10000);
  });

  it("margin ratio = maintenance / equity", () => {
    // notional 3100, tier-1 MMR 0.5% -> 15.5 / 10100
    expect(crossMarginRatio(10000, positions, { ETH: 3100 })).toBeCloseTo(
      (3100 * 0.005) / 10100,
      9,
    );
  });

  it("returns null on non-positive equity", () => {
    expect(crossMarginRatio(-5000, positions, { ETH: 3100 })).toBeNull();
  });

  it("liquidation below entry for LONG, above for SHORT at 10x", () => {
    const longLiq = liquidationPrice("LONG", 3000, 10, 0.01);
    expect(longLiq).toBeCloseTo(3000 * (1 - (0.1 - 0.01)), 9);
    expect(longLiq).toBeLessThan(3000);
    const shortLiq = liquidationPrice("SHORT", 3000, 10, 0.01);
    expect(shortLiq).toBeGreaterThan(3000);
  });

  it("returns null for invalid leverage", () => {
    expect(liquidationPrice("LONG", 3000, 0)).toBeNull();
  });
});

describe("tiered maintenance margin", () => {
  it("uses the self-defined tier-1 MMR", () => {
    expect(maintenanceMarginFor("ETH", 50_000)).toBeCloseTo(250, 9);
    expect(maintenanceMarginFor("ETH", 100_000)).toBeCloseTo(500, 9);
  });

  it("is continuous at the first bracket boundary", () => {
    expect(maintenanceMarginFor("ETH", 99_999)).toBeCloseTo(499.995, 6);
    expect(maintenanceMarginFor("ETH", 100_000)).toBeCloseTo(500, 6);
    // 100001 × 0.65% − 150 = 500.0065
    expect(maintenanceMarginFor("ETH", 100_001)).toBeCloseTo(500.0065, 6);
  });

  it("sums maintenance across positions", () => {
    const many = [
      { coin: "ETH", direction: "LONG" as const, size: 1, entryPrice: 3000, leverage: 10 },
      { coin: "SOL", direction: "LONG" as const, size: 10, entryPrice: 100, leverage: 10 },
    ];
    const expected =
      maintenanceMarginFor("ETH", 3100) + maintenanceMarginFor("SOL", 1500);
    expect(maintenanceMarginUsed(many, { ETH: 3100, SOL: 150 })).toBeCloseTo(
      expected,
      9,
    );
  });
});

describe("crossLiquidationPrice", () => {
  const longPosition = {
    coin: "ETH",
    direction: "LONG" as const,
    size: 1,
    entryPrice: 3000,
    leverage: 10,
  };

  it("LONG liquidates below entry and equity equals MM there", () => {
    const liq = crossLiquidationPrice(300, longPosition, [], { ETH: 3000 });
    expect(liq).not.toBeNull();
    const price = liq as number;
    expect(price).toBeLessThan(3000);
    expect(accountEquity(300, [longPosition], { ETH: price })).toBeCloseTo(
      maintenanceMarginFor("ETH", price),
      4,
    );
  });

  it("SHORT liquidates above entry and equity equals MM there", () => {
    const shortPosition = {
      ...longPosition,
      direction: "SHORT" as const,
    };
    const liq = crossLiquidationPrice(300, shortPosition, [], { ETH: 3000 });
    expect(liq).not.toBeNull();
    const price = liq as number;
    expect(price).toBeGreaterThan(3000);
    expect(accountEquity(300, [shortPosition], { ETH: price })).toBeCloseTo(
      maintenanceMarginFor("ETH", price),
      4,
    );
  });

  it("returns null when the account is too over-collateralised", () => {
    expect(crossLiquidationPrice(10_000, longPosition, [], { ETH: 3000 })).toBeNull();
  });
});

describe("splitTps", () => {
  it("single TP takes all", () => {
    expect(splitTps(1.5, 1)).toEqual([1.5]);
  });

  it("TP1 takes 50%, rest split equally and sum exactly", () => {
    const parts = splitTps(1, 3);
    expect(parts[0]).toBe(0.5);
    expect(parts[1]).toBe(0.25);
    expect(parts[2]).toBe(0.25);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("two TPs split 50/50", () => {
    expect(splitTps(2, 2)).toEqual([1, 1]);
  });

  it("sums exactly for awkward sizes", () => {
    const parts = splitTps(0.333, 4);
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(0.333, 9);
    expect(parts.every((p) => p > 0)).toBe(true);
  });

  it("returns [] for invalid input", () => {
    expect(splitTps(0, 3)).toEqual([]);
    expect(splitTps(1, 0)).toEqual([]);
  });
});

describe("detectTpSlHit", () => {
  it("LONG TP hit at or above first remaining TP", () => {
    expect(
      detectTpSlHit({ direction: "LONG", markPrice: 3100, stopLoss: 2900, remainingTps: [3100, 3200] }),
    ).toEqual({ kind: "TP", tpPrice: 3100 });
  });

  it("LONG SL hit at or below SL", () => {
    expect(
      detectTpSlHit({ direction: "LONG", markPrice: 2900, stopLoss: 2900, remainingTps: [3100] }),
    ).toEqual({ kind: "SL", slPrice: 2900 });
  });

  it("SL wins ties", () => {
    // gap candle touching both: conservative SL first
    expect(
      detectTpSlHit({ direction: "LONG", markPrice: 2900, stopLoss: 2900, remainingTps: [2900] }),
    ).toEqual({ kind: "SL", slPrice: 2900 });
  });

  it("SHORT mirrored", () => {
    expect(
      detectTpSlHit({ direction: "SHORT", markPrice: 2400, stopLoss: 2700, remainingTps: [2400] }),
    ).toEqual({ kind: "TP", tpPrice: 2400 });
    expect(
      detectTpSlHit({ direction: "SHORT", markPrice: 2700, stopLoss: 2700, remainingTps: [2400] }),
    ).toEqual({ kind: "SL", slPrice: 2700 });
  });

  it("NONE when nothing hit or price invalid", () => {
    expect(
      detectTpSlHit({ direction: "LONG", markPrice: 3000, stopLoss: 2900, remainingTps: [3100] }),
    ).toEqual({ kind: "NONE" });
    expect(
      detectTpSlHit({ direction: "LONG", markPrice: NaN, stopLoss: 2900, remainingTps: [3100] }),
    ).toEqual({ kind: "NONE" });
  });
});

describe("evaluateVirtualRisk", () => {
  it("passes a clean open", () => {
    expect(evaluateVirtualRisk(baseRisk())).toEqual({ passed: true, failures: [] });
  });

  it.each([
    ["KILL_SWITCH_ALL", { killSwitch: "STOP_ALL_MUTATIONS" }],
    ["KILL_SWITCH_NEW", { killSwitch: "STOP_NEW_TRADES" }],
    ["APPROVAL_INVALID", { approvalValid: false }],
    ["NO_SYMBOL_MAP", { coinMapped: false }],
    ["SIZE_TOO_SMALL", { size: 0.0001 }],
    ["INSUFFICIENT_MARGIN", { equity: 1 }],
    ["MAX_POSITIONS", { openPositions: 5 }],
  ])("rejects %s", (code, overrides) => {
    const result = evaluateVirtualRisk(baseRisk(overrides as Partial<VirtualRiskInput>));
    expect(result.passed).toBe(false);
    expect(result.failures).toContain(code);
  });

  it("mutations bypass new-order-only gates", () => {
    const result = evaluateVirtualRisk(
      baseRisk({ isMutation: true, killSwitch: "STOP_NEW_TRADES", openPositions: 99 }),
    );
    expect(result.passed).toBe(true);
  });

  it("allows unlimited open positions when maxPositions is Infinity", () => {
    const result = evaluateVirtualRisk(
      baseRisk({ openPositions: 999, maxPositions: Number.POSITIVE_INFINITY }),
    );
    expect(result.failures).not.toContain("MAX_POSITIONS");
  });

  it("STOP_ALL_MUTATIONS blocks even mutations", () => {
    const result = evaluateVirtualRisk(baseRisk({ isMutation: true, killSwitch: "STOP_ALL_MUTATIONS" }));
    expect(result.failures).toContain("KILL_SWITCH_ALL");
  });
});
