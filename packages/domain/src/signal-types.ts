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
  /** True when the ENTRY block says `market` (`entry market 2950 2900`). */
  entryMarket: boolean;
  /** All entry levels as written (first one = `entry`). Zone forms collapse to
   *  a single level; a ladder out of order falls back to the first level. For
   *  `entry market`, this holds only the DCA levels after the market fill. */
  entries: number[];
  stopLoss: number | null;
  takeProfits: number[];
  leverage: number | null;
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
// Values are canonical names; the market-data resolver confirms them
// against the live Hyperliquid universe (data-driven mapping).
export const SYMBOL_MAP: Record<string, string> = {
  GOLD: "XAU",
  XAUUSD: "XAU",
  XAU: "XAU",
  SILVER: "XAG",
  XAGUSD: "XAG",
  XAG: "XAG",
  BTC: "BTC",
  BTCUSD: "BTC",
  ETH: "ETH",
  ETHUSD: "ETH",
  SOL: "SOL",
};

export type KillSwitchMode = "OFF" | "STOP_NEW_TRADES" | "STOP_ALL_MUTATIONS";

const FOREX_PAIR = /\b([A-Z]{6})\b/;
const SUFFIXED_SYMBOL = /\b((?:XAU|XAG|BTC|ETH)USD(?:\.\w+)?|US30|NAS100|SPX500|UK100|DE40|JP225)\b/;
const BARE_CRYPTO = /\b(BTC|ETH|SOL|XRP|DOGE)(USD|USDT)?\b/;
