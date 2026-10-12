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
