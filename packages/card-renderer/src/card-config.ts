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
 * Position-stats card (kind `position-stats`): dark Binance-style panel,
 * green/red P&L palette, Vietnamese labels. `lineFontSize` sizes the small
 * grid labels, `pnlFontSize` the headline PNL/ROI numbers.
 */
export const STATS_CARD_THEME: CardTheme = {
  width: 1280,
  height: 540,
  background: "#13171C",
  primaryText: "#EAECEF",
  secondaryText: "#8F96A3",
  positivePnl: "#2EBD85",
  negativePnl: "#F6465D",
  zeroPnl: "#8F96A3",
  buyColor: "#2EBD85",
  sellColor: "#F6465D",
  leftPadding: 48,
  rightPadding: 48,
  fontFamily: "Arial, Helvetica, sans-serif",
  lineFontSize: 24,
  pnlFontSize: 64,
  maxSnapshotAgeMs: 5000,
  pnlPrecision: 2,
  maxFieldChars: 24,
};
