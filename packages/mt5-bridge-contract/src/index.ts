// MT5 bridge command/response contract (docs/04-risk-execution/mt5-bridge.md).
// Schema version is bumped on breaking changes.

export const BRIDGE_SCHEMA_VERSION = 1;

export type BridgeCommandType =
  | "OPEN"
  | "MODIFY_SLTP"
  | "PARTIAL_CLOSE"
  | "CLOSE_POSITION"
  | "CLOSE_ALL_TARGET"
  | "QUERY_STATE";

export type BridgeResult = "ACCEPTED" | "REJECTED" | "IN_PROGRESS" | "CONFIRMED" | "UNKNOWN";

export interface BridgeCommand {
  commandId: string;
  idempotencyKey: string;
  accountId: string;
  signalId: string | null;
  signalVersionId: string | null;
  executionId: string | null;
  commandType: BridgeCommandType;
  createdAt: string;
  expiresAt: string;
  payload: Record<string, unknown>;
  correlationId: string | null;
  schemaVersion: number;
}

export interface BridgeResponse {
  result: BridgeResult;
  brokerRetcode: number | null;
  brokerOrderId: string | null;
  brokerDealId: string | null;
  brokerPositionId: string | null;
  requestedVolume: number | null;
  filledVolume: number | null;
  fillPrice: number | null;
  actualSl: number | null;
  actualTp: number | null;
  timestamps: Record<string, string>;
  accountSnapshot: Record<string, number> | null;
  error: string | null;
}

export interface BrokerPosition {
  positionId: string;
  orderId: string | null;
  symbol: string;
  direction: "LONG" | "SHORT";
  volume: number;
  openPrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
}

export interface BrokerSymbolInfo {
  symbol: string;
  spread: number;
  minVolume: number;
  maxVolume: number;
  volumeStep: number;
  stopDistance: number;
  tickValue: number;
  tickSize: number;
  contractSize: number;
}

export interface BridgeHeartbeat {
  accountId: string;
  terminal: string | null;
  status: string;
  receivedAt: string;
}
