export const PARSER_VERSION = "1.0.0";

export type Direction = "LONG" | "SHORT";
export type UpdateAction =
  | "MODIFY_SL"
  | "MODIFY_TP"
  | "PARTIAL_CLOSE"
  | "CLOSE_ALL"
  | "CANCEL_SETUP"
  | "TP_HIT"
  | "NONE";

export interface NormalizedSignal {
  eventType: "NEW" | "UPDATE";
  instrument: string | null;
  direction: Direction | null;
  orderType: string | null;
  entry: number | null;
  entryZoneHigh: number | null;
  stopLoss: number | null;
  takeProfits: number[];
  updateAction: UpdateAction;
  sourceMessageId: string;
  sourcePlatform: string;
  sourceUrl: string | null;
  sourceTimestamp: string | null;
  threadId: string | null;
  replyToMessageId: string | null;
  quotedMessageId: string | null;
  confidence: number;
  missingFields: string[];
  ambiguities: string[];
  parserVersion: string;
}

export interface ParserInput {
  text: string;
  sourceMessageId: string;
  sourcePlatform: string;
  sourceUrl?: string | null;
  sourceTimestamp?: string | null;
  threadId?: string | null;
  replyToMessageId?: string | null;
  quotedMessageId?: string | null;
}

// Explicit symbol map only. Unknown symbols are NEVER fuzzy-matched.
export const SYMBOL_MAP: Record<string, string> = {
  GOLD: "XAUUSD.a",
  XAUUSD: "XAUUSD.a",
  SILVER: "XAGUSD.a",
  XAGUSD: "XAGUSD.a",
  BTC: "BTCUSD.a",
  BTCUSD: "BTCUSD.a",
  ETH: "ETHUSD.a",
  ETHUSD: "ETHUSD.a",
};

const FOREX_PAIR = /\b([A-Z]{6})\b/;
const SUFFIXED_SYMBOL = /\b((?:XAU|XAG|BTC|ETH)USD(?:\.\w+)?|US30|NAS100|SPX500|UK100|DE40|JP225)\b/;
const BARE_CRYPTO = /\b(BTC|ETH|SOL|XRP|DOGE)(USD|USDT)?\b/;
