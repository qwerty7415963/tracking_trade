import { CardTheme } from "./card-config";
import { CardViewModel, PositionSnapshot, RenderErrorCode } from "./card-types";

export type ViewModelResult =
  | { ok: true; model: CardViewModel }
  | { ok: false; code: RenderErrorCode; detail: string };

function formatPrice(value: number, digits: number): string {
  return value.toFixed(digits);
}

function formatVolume(value: number, digits: number): string {
  const fixed = value.toFixed(digits);
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function formatPnl(value: number, precision: number): string {
  return value.toFixed(precision);
}

export function buildViewModel(snapshot: PositionSnapshot, theme: CardTheme): ViewModelResult {
  const isBuy = snapshot.direction === "BUY";
  const model: CardViewModel = {
    symbol: snapshot.displaySymbol,
    directionText: isBuy ? "buy" : "sell",
    directionColor: isBuy ? theme.buyColor : theme.sellColor,
    volumeText: formatVolume(snapshot.volume, snapshot.volumeDigits),
    priceText: `${formatPrice(snapshot.entryPrice, snapshot.priceDigits)} → ${formatPrice(
      snapshot.currentPrice,
      snapshot.priceDigits,
    )}`,
    pnlText: formatPnl(snapshot.floatingProfit, theme.pnlPrecision),
    pnlColor:
      snapshot.floatingProfit > 0
        ? theme.positivePnl
        : snapshot.floatingProfit < 0
          ? theme.negativePnl
          : theme.zeroPnl,
  };
  const fields: Record<string, string> = {
    symbol: model.symbol,
    volume: model.volumeText,
    pnl: model.pnlText,
    price: model.priceText,
  };
  for (const [name, text] of Object.entries(fields)) {
    if (text.length > theme.maxFieldChars * 3) {
      return { ok: false, code: "LAYOUT_OVERFLOW", detail: name };
    }
  }
  return { ok: true, model };
}
