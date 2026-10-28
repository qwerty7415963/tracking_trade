import { CardTheme } from "./card-config";
import {
  DEFAULT_MAINTENANCE_MARGIN_RATE,
  PositionSnapshot,
  RenderErrorCode,
} from "./card-types";

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
  return `${sign}${formatGrouped(value, precision)}`;
}

function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatGrouped(value, 2)}%`;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1).toLowerCase() : value;
}

/**
 * View model for the Vietnamese position-stats card. PnL is derived from the
 * entry price and size (dir × (mark − entry) × size); the snapshot's
 * `floatingProfit` is only a fallback when those inputs are unusable.
 * Notional and margin track the live mark: notional = size × mark,
 * margin = notional / leverage. ROI stays anchored to the entry margin
 * (size × entry / leverage) so a mark move does not change the return on the
 * capital used to open the position. The margin ratio is the account cross
 * ratio supplied by the API (maintenance used / equity); older snapshots
 * without it fall back to MMR × leverage. Missing leverage/margin/liquidation
 * renders "--" instead of guessing.
 */
export function buildStatsViewModel(
  snapshot: PositionSnapshot,
  theme: CardTheme,
): StatsViewModelResult {
  const isBuy = snapshot.direction === "BUY";
  const direction = isBuy ? 1 : -1;
  const { volume, entryPrice, currentPrice } = snapshot;
  const pricesUsable =
    Number.isFinite(volume) && Number.isFinite(entryPrice) && Number.isFinite(currentPrice);
  const fallbackPnl =
    typeof snapshot.floatingProfit === "number" && Number.isFinite(snapshot.floatingProfit)
      ? snapshot.floatingProfit
      : 0;
  const pnl = pricesUsable
    ? direction * (currentPrice - entryPrice) * volume
    : fallbackPnl;
  const entryNotional = volume * entryPrice;
  const notional = pricesUsable ? volume * currentPrice : entryNotional;
  const leverage =
    typeof snapshot.leverage === "number" && Number.isFinite(snapshot.leverage)
      ? snapshot.leverage
      : null;
  const margin = leverage !== null && leverage > 0 ? notional / leverage : null;
  const initialMargin =
    leverage !== null && leverage > 0 ? entryNotional / leverage : null;
  const roiPct =
    initialMargin !== null && initialMargin > 0 ? (pnl / initialMargin) * 100 : null;
  const mmr =
    typeof snapshot.maintenanceMarginRate === "number" &&
    Number.isFinite(snapshot.maintenanceMarginRate) &&
    snapshot.maintenanceMarginRate > 0
      ? snapshot.maintenanceMarginRate
      : DEFAULT_MAINTENANCE_MARGIN_RATE;
  const accountRatio = snapshot.accountMarginRatio;
  const ratioPct =
    typeof accountRatio === "number" && Number.isFinite(accountRatio) && accountRatio >= 0
      ? accountRatio * 100
      : accountRatio === null
        ? null
        : leverage !== null && leverage > 0
          ? leverage * mmr * 100
          : null;
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
    pnlText: formatSigned(pnl, theme.pnlPrecision),
    roiText: roiPct === null ? "--" : formatPercent(roiPct),
    pnlColor:
      pnl > 0 ? theme.positivePnl : pnl < 0 ? theme.negativePnl : theme.zeroPnl,
    notionalText: formatGrouped(notional, 2),
    marginText: margin === null ? "--" : formatGrouped(margin, 2),
    marginRatioText: ratioPct === null ? "--" : `${ratioPct.toFixed(2)}%`,
    entryText: formatGrouped(snapshot.entryPrice, snapshot.priceDigits),
    markText: formatGrouped(snapshot.currentPrice, snapshot.priceDigits),
    liqText: liq === null ? "--" : formatGrouped(liq, snapshot.priceDigits),
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
