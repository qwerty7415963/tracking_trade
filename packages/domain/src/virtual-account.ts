// Virtual (paper) perpetual account on Hyperliquid-style markets.
// Pure functions. MVP: PnL + cross-margin ratio + liquidation approx.
// No fees, no funding (explicitly out of MVP scope).

import { bracketFor, DEFAULT_MMR, maintenanceMarginFor } from "./margin-tiers";

export type VirtualDirection = "LONG" | "SHORT";

export interface CoinSpec {
  coin: string;
  szDecimals: number;
  minSize: number;
  sizeIncrement: number;
  /** Maintenance margin rate, e.g. 0.01 = 1%. */
  maintenanceMarginRate: number;
}

function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

export function roundDownToStep(size: number, increment: number): number {
  if (increment <= 0) return size;
  return Math.floor(size / increment + 1e-9) * increment;
}

// ---------------------------------------------------------------------------
// Position sizing: fixed USDC notional per coin.
// size (coin units) = notional / entryPrice, rounded DOWN.
// ---------------------------------------------------------------------------

export interface PerpSizeInput {
  notional: number;
  entryPrice: number;
  minSize: number;
  sizeIncrement: number;
}

export interface PerpSizeResult {
  size: number;
  rejected: boolean;
  reason: string | null;
}

export function calcPerpSizeByNotional(input: PerpSizeInput): PerpSizeResult {
  const { notional, entryPrice, minSize, sizeIncrement } = input;
  if (!(notional > 0) || !Number.isFinite(notional)) {
    return { size: 0, rejected: true, reason: "INVALID_NOTIONAL" };
  }
  if (!(entryPrice > 0) || !Number.isFinite(entryPrice)) {
    return { size: 0, rejected: true, reason: "INVALID_ENTRY_PRICE" };
  }
  if (!(minSize > 0) || !(sizeIncrement > 0)) {
    return { size: 0, rejected: true, reason: "INVALID_SIZE_SPEC" };
  }
  const raw = notional / entryPrice;
  const size = roundDownToStep(raw, sizeIncrement);
  if (size < minSize) {
    return { size: 0, rejected: true, reason: "MIN_SIZE_EXCEEDS_NOTIONAL" };
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

/** Cross maintenance margin in use across all positions (tiered MMR). */
export function maintenanceMarginUsed(
  positions: PricedPosition[],
  mids: Record<string, number>,
): number {
  let used = 0;
  for (const p of positions) {
    const mark = mids[p.coin];
    if (typeof mark !== "number" || !Number.isFinite(mark)) continue;
    used += maintenanceMarginFor(p.coin, Math.abs(p.size) * mark);
  }
  return used;
}

/**
 * Cross margin ratio = total maintenance used / equity.
 * >= 1 means liquidation territory. Null when equity <= 0.
 */
export function crossMarginRatio(
  balance: number,
  positions: PricedPosition[],
  mids: Record<string, number>,
): number | null {
  const equity = accountEquity(balance, positions, mids);
  if (!(equity > 0)) return null;
  return maintenanceMarginUsed(positions, mids) / equity;
}

/**
 * Binance-style cross liquidation price for one position, holding other
 * positions at their current marks:
 *
 *   MP = (WB − side×Q×EP + UPNL_other + cum − TMM_other) / (Q × (MMR − side))
 *
 * side = +1 LONG, −1 SHORT. Bracket is resolved at the current notional and
 * refined at the computed liquidation notional (brackets can switch tiers).
 * Returns null when there is no positive solution (e.g. account is
 * over-collateralised for a long).
 */
export function crossLiquidationPrice(
  balance: number,
  position: PricedPosition,
  otherPositions: PricedPosition[],
  mids: Record<string, number>,
): number | null {
  const quantity = Math.abs(position.size);
  if (!(quantity > 0) || !(position.entryPrice > 0) || !Number.isFinite(balance)) {
    return null;
  }
  const mark = mids[position.coin];
  if (typeof mark !== "number" || !Number.isFinite(mark) || !(mark > 0)) return null;

  const side = position.direction === "LONG" ? 1 : -1;
  let upnlOther = 0;
  let maintenanceOther = 0;
  for (const other of otherPositions) {
    const otherMark = mids[other.coin];
    if (typeof otherMark !== "number" || !Number.isFinite(otherMark)) continue;
    upnlOther += unrealizedPnl(
      other.direction,
      Math.abs(other.size),
      other.entryPrice,
      otherMark,
    );
    maintenanceOther += maintenanceMarginFor(
      other.coin,
      Math.abs(other.size) * otherMark,
    );
  }

  let notional = quantity * mark;
  let price: number | null = null;
  for (let iteration = 0; iteration < 8; iteration += 1) {
    const bracket = bracketFor(position.coin, notional);
    const denominator = quantity * (bracket.mmr - side);
    if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-12) return null;
    const numerator =
      balance -
      side * quantity * position.entryPrice +
      upnlOther +
      bracket.maintenanceAmount -
      maintenanceOther;
    const next = numerator / denominator;
    if (!Number.isFinite(next) || next <= 0) return null;
    price = next;
    const nextNotional = quantity * next;
    const nextBracket = bracketFor(position.coin, nextNotional);
    if (
      nextBracket.notionalFloor === bracket.notionalFloor &&
      nextBracket.notionalCap === bracket.notionalCap
    ) {
      break;
    }
    notional = nextNotional;
  }
  return price;
}

/**
 * LEGACY isolated-style approximation (kept for older callers/tests).
 * New code must use crossLiquidationPrice().
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
  return { passed: failures.length === 0, failures };
}
