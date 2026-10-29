export type RenderErrorCode =
  | "POSITION_NOT_FOUND"
  | "POSITION_NOT_OPEN"
  | "POSITION_AMBIGUOUS"
  | "STALE_POSITION_SNAPSHOT"
  | "MISSING_REQUIRED_FIELD"
  | "INVALID_PRICE_FORMAT"
  | "INVALID_PNL"
  | "LAYOUT_OVERFLOW"
  | "RENDER_TIMEOUT"
  | "ARTIFACT_STORAGE_FAILED"
  | "TELEGRAM_PUBLISH_FAILED";

/**
 * Published card image style. `pnl-strip` = the original 1280×180 floating
 * P&L strip; `position-stats` = the Vietnamese position-statistics card
 * (PNL/ROI, size, margin, entry/mark/liquidation). Stored per position
 * (`virtual_positions.card_kind`) so update cards inherit the opening card.
 */
export type CardKind = "pnl-strip" | "position-stats";

export const DEFAULT_CARD_KIND: CardKind = "position-stats";

/** Maintenance margin rate used for liquidation + margin-ratio display. */
export const DEFAULT_MAINTENANCE_MARGIN_RATE = 0.005;

export function isCardKind(value: unknown): value is CardKind {
  return value === "pnl-strip" || value === "position-stats";
}

export interface PositionSnapshot {
  accountId: string;
  positionId: string;
  executionId: string | null;
  symbol: string;
  displaySymbol: string;
  direction: "BUY" | "SELL";
  volume: number;
  entryPrice: number;
  currentPrice: number;
  floatingProfit: number;
  profitCurrency: string;
  brokerSnapshotAt: string;
  snapshotId: string;
  status: "OPEN" | "CLOSED";
  priceDigits: number;
  volumeDigits: number;
  /** Position-stats card extras (optional — pnl-strip never reads them). */
  leverage?: number | null;
  marginType?: string | null;
  liquidationPrice?: number | null;
  /** Per-coin maintenance margin rate (falls back to 0.5%). */
  maintenanceMarginRate?: number | null;
  /**
   * Cross-account margin ratio (maintenance margin used / account equity)
   * supplied by the API. null means it could not be computed; an absent value
   * (older snapshot) falls back to MMR × leverage in the stats view model.
   */
  accountMarginRatio?: number | null;
}

export interface CardViewModel {
  symbol: string;
  directionText: "buy" | "sell";
  directionColor: string;
  volumeText: string;
  priceText: string;
  pnlText: string;
  pnlColor: string;
}

export interface RenderArtifact {
  renderId: string;
  snapshotId: string;
  accountId: string;
  positionId: string;
  executionId: string | null;
  png: Buffer;
  contentHash: string;
  width: number;
  height: number;
  mimeType: "image/png";
  templateVersion: number;
}
