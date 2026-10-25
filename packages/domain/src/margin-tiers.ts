/**
 * Self-defined maintenance-margin schedule (perpetual futures).
 *
 * MMR is a risk parameter chosen by the venue, not derived from price/size.
 * We intentionally do NOT copy Binance live tables: these brackets are ours,
 * editable in one place. Maintenance amounts are derived automatically so the
 * maintenance margin is continuous at every bracket boundary:
 *
 *   MM(notional) = notional × MMR(bracket) − maintenanceAmount(bracket)
 *
 * The ratio itself stays the standard futures formula:
 *   marginRatio = Σ MM(all open positions) / account equity
 */

export interface MarginTier {
  /** Inclusive upper notional bound (USDT); use Infinity for the last tier. */
  cap: number;
  /** Maintenance margin rate, e.g. 0.005 = 0.5%. */
  mmr: number;
}

export interface MarginBracket {
  notionalFloor: number;
  notionalCap: number;
  mmr: number;
  maintenanceAmount: number;
}

/** Default schedule used by every symbol unless overridden below. */
export const DEFAULT_MARGIN_TIERS: readonly MarginTier[] = [
  { cap: 100_000, mmr: 0.005 },
  { cap: 500_000, mmr: 0.0065 },
  { cap: 1_000_000, mmr: 0.01 },
  { cap: 5_000_000, mmr: 0.02 },
  { cap: Number.POSITIVE_INFINITY, mmr: 0.05 },
];

/**
 * Optional per-symbol overrides. Empty by default (same schedule everywhere).
 * Example: BTC: [{ cap: 300_000, mmr: 0.004 }, ...].
 */
export const SYMBOL_MARGIN_TIERS: Readonly<Record<string, readonly MarginTier[]>> = {};

/** Default MMR for legacy callers / unknown symbols (first bracket). */
export const DEFAULT_MMR = DEFAULT_MARGIN_TIERS[0].mmr;

export function normalizeMarginSymbol(coin: string): string {
  return coin.trim().toUpperCase().replace(/(USDT|USDC)$/, "");
}

export function marginTiersFor(coin: string): readonly MarginTier[] {
  return SYMBOL_MARGIN_TIERS[normalizeMarginSymbol(coin)] ?? DEFAULT_MARGIN_TIERS;
}

/** Expand MMR tiers into brackets with continuous maintenance amounts. */
export function bracketsFor(coin: string): MarginBracket[] {
  const tiers = marginTiersFor(coin);
  const brackets: MarginBracket[] = [];
  let floor = 0;
  let cum = 0;
  let previousMmr = tiers[0]?.mmr ?? DEFAULT_MMR;
  for (const tier of tiers) {
    const maintenanceAmount = floor === 0 ? 0 : cum + floor * (tier.mmr - previousMmr);
    brackets.push({
      notionalFloor: floor,
      notionalCap: tier.cap,
      mmr: tier.mmr,
      maintenanceAmount,
    });
    floor = tier.cap;
    cum = maintenanceAmount;
    previousMmr = tier.mmr;
  }
  return brackets;
}

/** Bracket containing the notional (floor < notional ≤ cap). */
export function bracketFor(coin: string, notional: number): MarginBracket {
  const brackets = bracketsFor(coin);
  const value = Math.abs(notional);
  if (!(value > 0)) return brackets[0];
  return brackets.find((bracket) => value <= bracket.notionalCap) ?? brackets[brackets.length - 1];
}

/** MAINTENANCE margin for one position, never negative. */
export function maintenanceMarginFor(coin: string, notional: number): number {
  const value = Math.abs(notional);
  if (!(value > 0)) return 0;
  const bracket = bracketFor(coin, value);
  return Math.max(0, value * bracket.mmr - bracket.maintenanceAmount);
}

/** Effective MMR at this notional (maintenance / notional), for display. */
export function effectiveMmrFor(coin: string, notional: number): number {
  const value = Math.abs(notional);
  if (!(value > 0)) return marginTiersFor(coin)[0]?.mmr ?? DEFAULT_MMR;
  return maintenanceMarginFor(coin, value) / value;
}
