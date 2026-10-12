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
