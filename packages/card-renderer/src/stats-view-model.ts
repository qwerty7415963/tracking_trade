import { CardTheme } from "./card-config";
import { PositionSnapshot, RenderErrorCode } from "./card-types";

export interface StatsCardViewModel {
  symbol: string;
  directionBadge: "L" | "S";
  directionColor: string;
  /** Account display name; empty string hides the chip (older rows). */
  accountName: string;
  marginTypeText: string;
  pnlText: string;
  roiText: string;
  pnlColor: string;
  notionalText: string;
  marginText: string;
  marginRatioText: string;
  entryText: string;
  markText: string;
  liqText: string;
}

export type StatsViewModelResult =
  | { ok: true; model: StatsCardViewModel }
  | { ok: false; code: RenderErrorCode; detail: string };

/** 50056.7 → "50,056.70" (thousands groups, ASCII commas for font safety). */
export function formatGrouped(value: number, precision: number): string {
  const [int, frac] = Math.abs(value).toFixed(precision).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${value < 0 ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

function formatSigned(value: number, precision: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(precision)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

/**
 * View model for the Vietnamese position-stats card. Derives margin,
 * ROI and margin ratio from the snapshot (not stored anywhere); missing
 * leverage/margin/liquidation renders "--" instead of guessing.
 */
export function buildStatsViewModel(
  snapshot: PositionSnapshot,
  theme: CardTheme,
): StatsViewModelResult {
  const isBuy = snapshot.direction === "BUY";
  const notional = snapshot.volume * snapshot.entryPrice;
  const leverage =
    typeof snapshot.leverage === "number" && Number.isFinite(snapshot.leverage)
      ? snapshot.leverage
      : null;
  const margin = leverage !== null && leverage > 0 ? notional / leverage : null;
  const roiPct = margin !== null && margin > 0 ? (snapshot.floatingProfit / margin) * 100 : null;
  const ratioPct = leverage !== null && leverage > 0 ? 100 / leverage : null;
  const liq =
    typeof snapshot.liquidationPrice === "number" && Number.isFinite(snapshot.liquidationPrice)
      ? snapshot.liquidationPrice
      : null;

  const model: StatsCardViewModel = {
    symbol: snapshot.displaySymbol,
    directionBadge: isBuy ? "L" : "S",
    directionColor: isBuy ? theme.buyColor : theme.sellColor,
    accountName: (snapshot.accountName ?? "").trim(),
    marginTypeText: `${capitalize((snapshot.marginType ?? "cross").trim() || "cross")} ${
      leverage ?? "?"
    }X`,
    pnlText: formatSigned(snapshot.floatingProfit, theme.pnlPrecision),
    roiText: roiPct === null ? "--" : formatPercent(roiPct),
    pnlColor:
      snapshot.floatingProfit > 0
        ? theme.positivePnl
        : snapshot.floatingProfit < 0
          ? theme.negativePnl
          : theme.zeroPnl,
    notionalText: formatGrouped(notional, 2),
    marginText: margin === null ? "--" : formatGrouped(margin, 2),
    marginRatioText: ratioPct === null ? "--" : `${ratioPct.toFixed(2)}%`,
    entryText: snapshot.entryPrice.toFixed(snapshot.priceDigits),
    markText: snapshot.currentPrice.toFixed(snapshot.priceDigits),
    liqText: liq === null ? "--" : liq.toFixed(snapshot.priceDigits),
  };

  const fields: Record<string, string> = {
    symbol: model.symbol,
    accountName: model.accountName,
    pnl: model.pnlText,
    roi: model.roiText,
    notional: model.notionalText,
    margin: model.marginText,
    entry: model.entryText,
    mark: model.markText,
    liq: model.liqText,
  };
  for (const [name, text] of Object.entries(fields)) {
    if (text.length > theme.maxFieldChars * 3) {
      return { ok: false, code: "LAYOUT_OVERFLOW", detail: name };
    }
  }
  return { ok: true, model };
}
