// Virtual (paper) perpetual account on Hyperliquid-style markets.
// Pure functions. MVP: PnL + cross-margin ratio + liquidation approx.
// No fees, no funding (explicitly out of MVP scope).

export type VirtualDirection = "LONG" | "SHORT";

export interface CoinSpec {
  coin: string;
  szDecimals: number;
  minSize: number;
  sizeIncrement: number;
  /** Maintenance margin rate, e.g. 0.01 = 1%. */
  maintenanceMarginRate: number;
}

export const DEFAULT_MMR = 0.01;

function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

export function roundDownToStep(size: number, increment: number): number {
  if (increment <= 0) return size;
  return Math.floor(size / increment + 1e-9) * increment;
}

// ---------------------------------------------------------------------------
// Position sizing: risk a fixed USDC budget if SL is hit.
// size (coin units) = riskBudget / |entry - stopLoss|, rounded DOWN.
// ---------------------------------------------------------------------------

export interface PerpSizeInput {
  riskBudget: number;
  entryPrice: number;
  stopLossPrice: number;
  minSize: number;
  sizeIncrement: number;
  maxNotional?: number;
}

export interface PerpSizeResult {
  size: number;
  rejected: boolean;
  reason: string | null;
}

export function calcPerpSize(input: PerpSizeInput): PerpSizeResult {
  const { riskBudget, entryPrice, stopLossPrice, minSize, sizeIncrement } = input;
  if (!(riskBudget > 0)) return { size: 0, rejected: true, reason: "INVALID_RISK_BUDGET" };
  const stopDistance = Math.abs(entryPrice - stopLossPrice);
  if (!(stopDistance > 0) || !Number.isFinite(stopDistance)) {
    return { size: 0, rejected: true, reason: "INVALID_STOP_DISTANCE" };
  }
  if (!(minSize > 0) || !(sizeIncrement > 0)) {
    return { size: 0, rejected: true, reason: "INVALID_SIZE_SPEC" };
  }
  const raw = riskBudget / stopDistance;
  const size = roundDownToStep(raw, sizeIncrement);
  if (size < minSize) {
    return { size: 0, rejected: true, reason: "MIN_SIZE_EXCEEDS_BUDGET" };
  }
  if (input.maxNotional !== undefined && size * entryPrice > input.maxNotional) {
    return { size: 0, rejected: true, reason: "MAX_NOTIONAL_EXCEEDED" };
  }
  return { size, rejected: false, reason: null };
}

// ---------------------------------------------------------------------------
// PnL
// ---------------------------------------------------------------------------

export function unrealizedPnl(
  direction: VirtualDirection,
  size: number,
  entryPrice: number,
  markPrice: number,
): number {
  const dir = direction === "LONG" ? 1 : -1;
  return (markPrice - entryPrice) * size * dir;
}

export function realizedPnl(
  direction: VirtualDirection,
  closedSize: number,
  entryPrice: number,
  closePrice: number,
): number {
  return unrealizedPnl(direction, closedSize, entryPrice, closePrice);
}

// ---------------------------------------------------------------------------
// Cross-margin account: equity + margin ratio + liquidation.
// ---------------------------------------------------------------------------

export interface PricedPosition {
  coin: string;
  direction: VirtualDirection;
  size: number;
  entryPrice: number;
  leverage: number;
}

export function accountEquity(
  balance: number,
  positions: PricedPosition[],
  mids: Record<string, number>,
): number {
  let equity = balance;
  for (const p of positions) {
    const mark = mids[p.coin];
    if (typeof mark !== "number" || !Number.isFinite(mark)) continue;
    equity += unrealizedPnl(p.direction, p.size, p.entryPrice, mark);
  }
  return equity;
}

/** Cross maintenance margin in use across all positions. */
export function maintenanceMarginUsed(
  positions: PricedPosition[],
  mids: Record<string, number>,
  mmr: number = DEFAULT_MMR,
): number {
  let used = 0;
  for (const p of positions) {
    const mark = mids[p.coin];
    if (typeof mark !== "number" || !Number.isFinite(mark)) continue;
    used += Math.abs(p.size) * mark * mmr;
  }
  return used;
}

/**
 * Cross margin ratio = maintenance used / equity.
 * >= 1 means liquidation territory. Null when equity <= 0.
 */
export function crossMarginRatio(
  balance: number,
  positions: PricedPosition[],
  mids: Record<string, number>,
  mmr: number = DEFAULT_MMR,
): number | null {
  const equity = accountEquity(balance, positions, mids);
  if (!(equity > 0)) return null;
  return maintenanceMarginUsed(positions, mids, mmr) / equity;
}

/**
 * Approximate liquidation price (isolated-style formula, documented
 * approximation for cross display purposes only).
 * LONG:  entry * (1 - (1/leverage - mmr))
 * SHORT: entry * (1 + (1/leverage - mmr))
 */
export function liquidationPrice(
  direction: VirtualDirection,
  entryPrice: number,
  leverage: number,
  mmr: number = DEFAULT_MMR,
): number | null {
  if (!(leverage > 0) || !(entryPrice > 0)) return null;
  const buffer = 1 / leverage - mmr;
  if (buffer <= 0) return null;
  return direction === "LONG" ? entryPrice * (1 - buffer) : entryPrice * (1 + buffer);
}

// ---------------------------------------------------------------------------
// Multi-TP split: TP1 closes 50%, the rest split equally.
// Single TP closes 100%. Last level always takes the remainder so the
// slices sum exactly to the total (no dust left behind).
// ---------------------------------------------------------------------------

export function splitTps(totalSize: number, tpCount: number): number[] {
  if (!(totalSize > 0) || !(tpCount >= 1)) return [];
  if (tpCount === 1) return [totalSize];
  const out: number[] = [];
  let remaining = totalSize;
  const first = floorTo(totalSize * 0.5, 8);
  out.push(first);
  remaining = totalSize - first;
  for (let i = 1; i < tpCount - 1; i += 1) {
    const slice = floorTo((totalSize * 0.5) / (tpCount - 1), 8);
    out.push(slice);
    remaining -= slice;
  }
  out.push(Math.max(0, remaining));
  return out;
}

// ---------------------------------------------------------------------------
// TP/SL hit detection on a mark price. One hit per poll: the caller advances
// to the next TP afterwards (each hit gets its own card + publication).
// SL wins ties (conservative).
// ---------------------------------------------------------------------------

export type HitResult =
  | { kind: "NONE" }
  | { kind: "TP"; tpPrice: number }
  | { kind: "SL"; slPrice: number };

export function detectTpSlHit(params: {
  direction: VirtualDirection;
  markPrice: number;
  stopLoss: number | null;
  remainingTps: number[];
}): HitResult {
  const { direction, markPrice, stopLoss, remainingTps } = params;
  if (!Number.isFinite(markPrice)) return { kind: "NONE" };
  const slHit =
    stopLoss !== null &&
    Number.isFinite(stopLoss) &&
    (direction === "LONG" ? markPrice <= stopLoss : markPrice >= stopLoss);
  if (slHit && stopLoss !== null) return { kind: "SL", slPrice: stopLoss };
  const nextTp = remainingTps[0];
  if (nextTp !== undefined && Number.isFinite(nextTp)) {
    const tpHit = direction === "LONG" ? markPrice >= nextTp : markPrice <= nextTp;
    if (tpHit) return { kind: "TP", tpPrice: nextTp };
  }
  return { kind: "NONE" };
}

// ---------------------------------------------------------------------------
// Virtual risk gate (adapted from the MT5 risk engine to paper perps).
// ---------------------------------------------------------------------------

export interface VirtualRiskInput {
  killSwitch: "OFF" | "STOP_NEW_TRADES" | "STOP_ALL_MUTATIONS";
  approvalValid: boolean;
  coinMapped: boolean;
  size: number;
  minSize: number;
  sizeIncrement: number;
  notional: number;
  leverage: number;
  equity: number;
  openPositions: number;
  maxPositions: number;
  dailyRealizedLoss: number;
  maxDailyLoss: number;
  estimatedRisk: number;
  maxRiskPerTrade: number;
  isMutation: boolean;
}

export interface VirtualRiskResult {
  passed: boolean;
  failures: string[];
}

export function evaluateVirtualRisk(input: VirtualRiskInput): VirtualRiskResult {
  const failures: string[] = [];
  const fail = (code: string) => failures.push(code);

  if (input.killSwitch === "STOP_ALL_MUTATIONS") fail("KILL_SWITCH_ALL");
  if (!input.isMutation && input.killSwitch === "STOP_NEW_TRADES") fail("KILL_SWITCH_NEW");
  if (!input.approvalValid) fail("APPROVAL_INVALID");
  if (!input.coinMapped) fail("NO_SYMBOL_MAP");
  if (!(input.size >= input.minSize)) fail("SIZE_TOO_SMALL");
  if (input.sizeIncrement > 0) {
    const steps = Math.round(input.size / input.sizeIncrement);
    if (Math.abs(steps * input.sizeIncrement - input.size) > 1e-9) fail("SIZE_STEP");
  }
  if (!(input.leverage > 0)) fail("INVALID_LEVERAGE");
  if (input.notional / input.leverage > input.equity) fail("INSUFFICIENT_MARGIN");
  if (!input.isMutation && input.openPositions >= input.maxPositions) fail("MAX_POSITIONS");
  if (input.dailyRealizedLoss >= input.maxDailyLoss) fail("DAILY_LOSS_LIMIT");
  if (input.estimatedRisk > input.maxRiskPerTrade) fail("RISK_PER_TRADE");
  return { passed: failures.length === 0, failures };
}
