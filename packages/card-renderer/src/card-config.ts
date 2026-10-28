export interface CardTheme {
  width: number;
  height: number;
  background: string;
  primaryText: string;
  secondaryText: string;
  positivePnl: string;
  negativePnl: string;
  zeroPnl: string;
  buyColor: string;
  sellColor: string;
  leftPadding: number;
  rightPadding: number;
  fontFamily: string;
  lineFontSize: number;
  pnlFontSize: number;
  /** Device pixel ratio: the PNG is width×scale by height×scale. */
  scale?: number;
  maxSnapshotAgeMs: number;
  pnlPrecision: number;
  maxFieldChars: number;
}

export const DEFAULT_CARD_THEME: CardTheme = {
  width: 1280,
  height: 180,
  background: "#000000",
  primaryText: "#F5F5F5",
  secondaryText: "#B8B8B8",
  positivePnl: "#1685F8",
  negativePnl: "#F04452",
  zeroPnl: "#B8B8B8",
  buyColor: "#1685F8",
  sellColor: "#F04452",
  leftPadding: 64,
  rightPadding: 64,
  fontFamily: "Arial, Helvetica, sans-serif",
  lineFontSize: 48,
  pnlFontSize: 66,
  maxSnapshotAgeMs: 5000,
  pnlPrecision: 2,
  maxFieldChars: 24,
};

/**
 * Position-stats card (kind `position-stats`): Binance dark-mode position
 * panel, 520×240 CSS px rendered at 2× (1040×480 PNG) with BinancePlex
 * (IBM Plex Sans fallback). `lineFontSize` is the label size; the numeric
 * values stay at 18px (`pnlFontSize`). Vertical gaps flex to fit the height.
 */
export const STATS_CARD_THEME: CardTheme = {
  width: 1040,
  height: 480,
  background: "#1f2630",
  primaryText: "#dee5ec",
  secondaryText: "#848e9c",
  positivePnl: "#31bc82",
  negativePnl: "#f94463",
  zeroPnl: "#848e9c",
  buyColor: "#0ecb81",
  sellColor: "#f6465d",
  leftPadding: 16,
  rightPadding: 16,
  fontFamily: 'BinancePlex, "IBM Plex Sans", Arial, sans-serif',
  lineFontSize: 17,
  pnlFontSize: 22,
  scale: 2,
  maxSnapshotAgeMs: 5000,
  pnlPrecision: 2,
  maxFieldChars: 24,
};
