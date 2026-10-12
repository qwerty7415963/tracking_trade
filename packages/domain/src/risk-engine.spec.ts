import {
  DEFAULT_RISK_LIMITS,
  RiskCheckInput,
  calcPositionSize,
  evaluateRisk,
} from "./risk-engine";

function baseInput(overrides: Partial<RiskCheckInput> = {}): RiskCheckInput {
  return {
    accountId: "acc1",
    expectedAccountId: "acc1",
    bridgeAlive: true,
    killSwitch: "OFF",
    isNewOrder: true,
    signalExpired: false,
    approvalValid: true,
    spec: {
      symbol: "XAUUSD.a",
      mapped: true,
      spread: 20,
      maxSpread: 35,
      minVolume: 0.01,
      maxVolume: 10,
      volumeStep: 0.01,
      stopDistance: 5,
      tickValue: 1,
      tickSize: 0.01,
      contractSize: 100,
    },
    priceDeviation: 2,
    volume: 0.05,
    marginFree: 10000,
    marginRequired: 500,
    stopLossPrice: 2340,
    takeProfitPrice: 2360,
    entryPrice: 2345,
    direction: "LONG",
    openRisk: 0,
    dailyLoss: 0,
    openPositions: 0,
    openPositionsForSymbol: 0,
    unknownOpenCommand: false,
    estimatedTradeRisk: 50,
    ...overrides,
  };
}

describe("evaluateRisk", () => {
  it("passes a clean order", () => {
    expect(evaluateRisk(baseInput(), DEFAULT_RISK_LIMITS)).toEqual({ passed: true, failures: [] });
  });

  it.each([
    ["WRONG_ACCOUNT", { accountId: "other" }],
    ["BRIDGE_DEAD", { bridgeAlive: false }],
    ["KILL_SWITCH_NEW", { killSwitch: "STOP_NEW_TRADES" }],
    ["KILL_SWITCH_ALL", { killSwitch: "STOP_ALL_MUTATIONS", isNewOrder: false }],
    ["SIGNAL_EXPIRED", { signalExpired: true }],
    ["APPROVAL_INVALID", { approvalValid: false }],
    ["NO_SYMBOL_MAP", { spec: null }],
    ["UNKNOWN_COMMAND_PENDING", { unknownOpenCommand: true }],
    ["SPREAD_TOO_HIGH", { spec: { ...baseInput().spec!, spread: 100 } }],
    ["VOLUME_OUT_OF_RANGE", { volume: 99 }],
    ["INSUFFICIENT_MARGIN", { marginFree: 10 }],
    ["STOP_LOSS_REQUIRED", { stopLossPrice: null }],
    ["STOP_DISTANCE", { stopLossPrice: 2344.9 }],
    ["INVALID_SLTP_SIDE", { stopLossPrice: 2350, takeProfitPrice: 2340 }],
    ["RISK_PER_TRADE", { estimatedTradeRisk: 500 }],
    ["DAILY_LOSS_LIMIT", { dailyLoss: 300 }],
    ["MAX_POSITIONS", { openPositions: 5 }],
    ["MAX_POSITIONS_PER_SYMBOL", { openPositionsForSymbol: 1 }],
  ])("rejects %s", (code, overrides) => {
    const result = evaluateRisk(baseInput(overrides as Partial<RiskCheckInput>), DEFAULT_RISK_LIMITS);
    expect(result.passed).toBe(false);
    expect(result.failures).toContain(code);
  });

  it("kill switch never auto-closes: mutation check only gates new actions", () => {
    const result = evaluateRisk(
      baseInput({ isNewOrder: false, killSwitch: "STOP_NEW_TRADES" }),
      DEFAULT_RISK_LIMITS,
    );
    expect(result.passed).toBe(true);
  });
});

describe("calcPositionSize", () => {
  const spec = {
    riskBudget: 100,
    stopDistance: 50,
    tickValue: 1,
    tickSize: 0.01,
    volumeStep: 0.01,
    minVolume: 0.01,
    maxVolume: 10,
  };

  it("rounds down to step and recomputes risk within budget", () => {
    const result = calcPositionSize(spec);
    expect(result.rejected).toBe(false);
    expect(result.volume).toBeGreaterThan(0);
    expect(result.recomputedRisk).toBeLessThanOrEqual(spec.riskBudget);
  });

  it("rejects when minimum volume exceeds budget", () => {
    const result = calcPositionSize({ ...spec, riskBudget: 0.01 });
    expect(result.rejected).toBe(true);
    expect(result.reason).toBe("MIN_VOLUME_EXCEEDS_BUDGET");
  });

  it("rejects invalid broker spec", () => {
    const result = calcPositionSize({ ...spec, tickSize: 0 });
    expect(result.rejected).toBe(true);
    expect(result.reason).toBe("INVALID_BROKER_SPEC");
  });
});
