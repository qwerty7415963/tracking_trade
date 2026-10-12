// Risk engine: pure functions. Limits are injectable; defaults are
// conservative placeholders until open-decisions #6 is settled.

export type KillSwitchMode = "OFF" | "STOP_NEW_TRADES" | "STOP_ALL_MUTATIONS";

export interface SymbolSpec {
  symbol: string;
  mapped: boolean;
  spread: number;
  maxSpread: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  stopDistance: number;
  tickValue: number;
  tickSize: number;
  contractSize: number;
}

export interface RiskLimits {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxTotalOpenRisk: number;
  maxPositions: number;
  maxPositionsPerSymbol: number;
  maxPriceDeviation: number;
  requireStopLoss: boolean;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxRiskPerTrade: 100,
  maxDailyLoss: 300,
  maxTotalOpenRisk: 500,
  maxPositions: 5,
  maxPositionsPerSymbol: 1,
  maxPriceDeviation: 10,
  requireStopLoss: true,
};

export interface RiskCheckInput {
  accountId: string;
  expectedAccountId: string;
  bridgeAlive: boolean;
  killSwitch: KillSwitchMode;
  isNewOrder: boolean;
  signalExpired: boolean;
  approvalValid: boolean;
  spec: SymbolSpec | null;
  priceDeviation: number;
  volume: number;
  marginFree: number;
  marginRequired: number;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  entryPrice: number;
  direction: "LONG" | "SHORT";
  openRisk: number;
  dailyLoss: number;
  openPositions: number;
  openPositionsForSymbol: number;
  unknownOpenCommand: boolean;
  estimatedTradeRisk: number;
}

export interface RiskResult {
  passed: boolean;
  failures: string[];
}

export function evaluateRisk(input: RiskCheckInput, limits: RiskLimits): RiskResult {
  const failures: string[] = [];
  const fail = (code: string) => failures.push(code);

  if (input.accountId !== input.expectedAccountId) fail("WRONG_ACCOUNT");
  if (!input.bridgeAlive) fail("BRIDGE_DEAD");
  if (input.killSwitch === "STOP_ALL_MUTATIONS") fail("KILL_SWITCH_ALL");
  if (input.isNewOrder && input.killSwitch === "STOP_NEW_TRADES") fail("KILL_SWITCH_NEW");
  if (input.signalExpired) fail("SIGNAL_EXPIRED");
  if (!input.approvalValid) fail("APPROVAL_INVALID");
  if (!input.spec || !input.spec.mapped) fail("NO_SYMBOL_MAP");
  if (input.unknownOpenCommand) fail("UNKNOWN_COMMAND_PENDING");

  const spec = input.spec;
  if (spec) {
    if (spec.spread > spec.maxSpread) fail("SPREAD_TOO_HIGH");
    if (input.priceDeviation > limits.maxPriceDeviation) fail("PRICE_DEVIATION");
    if (input.volume < spec.minVolume || input.volume > spec.maxVolume) fail("VOLUME_OUT_OF_RANGE");
    if (!isStepAligned(input.volume, spec.minVolume, spec.volumeStep)) fail("VOLUME_STEP");
    if (input.marginFree < input.marginRequired) fail("INSUFFICIENT_MARGIN");
    if (limits.requireStopLoss && input.stopLossPrice === null) fail("STOP_LOSS_REQUIRED");
    if (!stopDistanceOk(input, spec)) fail("STOP_DISTANCE");
    if (!stopLossSideOk(input)) fail("INVALID_SLTP_SIDE");
  }

  if (input.estimatedTradeRisk > limits.maxRiskPerTrade) fail("RISK_PER_TRADE");
  if (input.dailyLoss >= limits.maxDailyLoss) fail("DAILY_LOSS_LIMIT");
  if (input.openRisk + input.estimatedTradeRisk > limits.maxTotalOpenRisk) {
    fail("TOTAL_OPEN_RISK");
  }
  if (input.isNewOrder && input.openPositions >= limits.maxPositions) fail("MAX_POSITIONS");
  if (input.isNewOrder && input.openPositionsForSymbol >= limits.maxPositionsPerSymbol) {
    fail("MAX_POSITIONS_PER_SYMBOL");
  }

  return { passed: failures.length === 0, failures };
}

export function isVolumeStepAligned(volume: number, min: number, step: number): boolean {
  const steps = Math.round((volume - min) / step);
  return Math.abs(min + steps * step - volume) < 1e-9;
}

function isStepAligned(volume: number, min: number, step: number): boolean {
  return isVolumeStepAligned(volume, min, step);
}

function stopDistanceOk(input: RiskCheckInput, spec: SymbolSpec): boolean {
  if (input.stopLossPrice === null) return true;
  const distance = Math.abs(input.entryPrice - input.stopLossPrice);
  return distance >= spec.stopDistance;
}

function stopLossSideOk(input: RiskCheckInput): boolean {
  if (input.stopLossPrice === null) return true;
  if (input.takeProfitPrice === null) return true;
  if (input.direction === "LONG") {
    return input.stopLossPrice < input.entryPrice && input.takeProfitPrice > input.entryPrice;
  }
  return input.stopLossPrice > input.entryPrice && input.takeProfitPrice < input.entryPrice;
}

export interface PositionSizeInput {
  riskBudget: number;
  stopDistance: number;
  tickValue: number;
  tickSize: number;
  volumeStep: number;
  minVolume: number;
  maxVolume: number;
}

export interface PositionSizeResult {
  volume: number;
  recomputedRisk: number;
  rejected: boolean;
  reason: string | null;
}

/** Size from monetary risk budget, round DOWN to broker step, recompute risk. */
export function calcPositionSize(input: PositionSizeInput): PositionSizeResult {
  const { riskBudget, stopDistance, tickValue, tickSize, volumeStep, minVolume, maxVolume } = input;
  if (stopDistance <= 0 || tickValue <= 0 || tickSize <= 0 || volumeStep <= 0) {
    return { volume: 0, recomputedRisk: 0, rejected: true, reason: "INVALID_BROKER_SPEC" };
  }
  const raw = riskBudget / ((stopDistance / tickSize) * tickValue);
  const stepped = minVolume + Math.floor((raw - minVolume) / volumeStep) * volumeStep;
  const volume = Math.max(0, Math.min(stepped, maxVolume));
  const recomputedRisk = (stopDistance / tickSize) * tickValue * volume;
  if (volume < minVolume) {
    return { volume: 0, recomputedRisk, rejected: true, reason: "MIN_VOLUME_EXCEEDS_BUDGET" };
  }
  if (recomputedRisk > riskBudget) {
    return { volume: 0, recomputedRisk, rejected: true, reason: "RISK_EXCEEDS_BUDGET" };
  }
  return { volume: Math.round(volume * 1e8) / 1e8, recomputedRisk, rejected: false, reason: null };
}
