import {
  accountEquity,
  calcPerpSize,
  crossMarginRatio,
  detectTpSlHit,
  evaluateVirtualRisk,
  liquidationPrice,
  realizedPnl,
  roundDownToStep,
  splitTps,
  unrealizedPnl,
  VirtualRiskInput,
} from "./virtual-account";

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
    dailyRealizedLoss: 0,
    maxDailyLoss: 300,
    estimatedRisk: 50,
    maxRiskPerTrade: 100,
    isMutation: false,
    ...overrides,
  };
}

describe("calcPerpSize", () => {
  it("sizes from risk budget over stop distance", () => {
    // risk $50, stop 100 away -> 0.5 units
    const r = calcPerpSize({
      riskBudget: 50,
      entryPrice: 3500,
      stopLossPrice: 3400,
      minSize: 0.001,
      sizeIncrement: 0.001,
    });
    expect(r).toEqual({ size: 0.5, rejected: false, reason: null });
  });

  it("rounds DOWN to increment", () => {
    const r = calcPerpSize({
      riskBudget: 50,
      entryPrice: 3500,
      stopLossPrice: 3400,
      minSize: 0.001,
      sizeIncrement: 0.1,
    });
    expect(r.size).toBe(0.5);
    const r2 = calcPerpSize({
      riskBudget: 55,
      entryPrice: 3500,
      stopLossPrice: 3400,
      minSize: 0.001,
      sizeIncrement: 0.1,
    });
    expect(r2.size).toBe(0.5); // 0.55 floored to 0.5
  });

  it("rejects when min size exceeds budget", () => {
    const r = calcPerpSize({
      riskBudget: 1,
      entryPrice: 3500,
      stopLossPrice: 3400,
      minSize: 1,
      sizeIncrement: 0.001,
    });
    expect(r.rejected).toBe(true);
    expect(r.reason).toBe("MIN_SIZE_EXCEEDS_BUDGET");
  });

  it("rejects invalid inputs", () => {
    expect(
      calcPerpSize({ riskBudget: 0, entryPrice: 1, stopLossPrice: 2, minSize: 1, sizeIncrement: 1 })
        .reason,
    ).toBe("INVALID_RISK_BUDGET");
    expect(
      calcPerpSize({ riskBudget: 10, entryPrice: 5, stopLossPrice: 5, minSize: 1, sizeIncrement: 1 })
        .reason,
    ).toBe("INVALID_STOP_DISTANCE");
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
    // notional 3100, mmr 1% -> 31 / 10100
    expect(crossMarginRatio(10000, positions, { ETH: 3100 }, 0.01)).toBeCloseTo(31 / 10100, 9);
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
    ["DAILY_LOSS_LIMIT", { dailyRealizedLoss: 300 }],
    ["RISK_PER_TRADE", { estimatedRisk: 500 }],
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
