import {
  Direction,
  NormalizedSignal,
  ParserInput,
  PARSER_VERSION,
  SYMBOL_MAP,
  UpdateAction,
} from "./signal-types";

const LONG_RE = /\b(BUY|LONG)\b/;
const SHORT_RE = /\b(SELL|SHORT)\b/;
const FOREX_PAIR = /\b([A-Z]{6})\b/;
const SUFFIXED_SYMBOL = /\b((?:XAU|XAG|BTC|ETH)USD(?:\.\w+)?|US30|NAS100|SPX500|UK100|DE40|JP225)\b/;
const BARE_CRYPTO = /\b(BTC|ETH|SOL|XRP|DOGE)(USD|USDT)?\b/;
const KNOWN_WORDS = /\b(GOLD|SILVER|OIL|WTI|BRENT|NASDAQ|DOW|SP500)\b/;

const ENTRY_RE = /(?:ENTRY|ENTER|@)\s*[:\-]?\s*(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?/i;
const SL_RE = /(?:STOP\s?LOSS|\bSL\b)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i;
const TP_RE = /\bTP\s?(\d)?\s*[:\-]?\s*(\d+(?:\.\d+)?)/gi;
const LIMIT_RE = /\blimit\b/i;
const MARKET_RE = /\bmarket\b/i;

const ACTION_PATTERNS: Array<[UpdateAction, RegExp]> = [
  ["MODIFY_SL", /(?:modif\w*|move|update|change|adjust)\s+(?:the\s+)?s\s?l\b/i],
  ["MODIFY_TP", /(?:modif\w*|move|update|change|adjust)\s+(?:the\s+)?t\s?p\b/i],
  ["PARTIAL_CLOSE", /(?:partial(?:ly)?\s+close|close\s+(?:half|50\s?%|part)|book\s+(?:half|partial|profit))/i],
  ["CLOSE_ALL", /(?:close\s+(?:all|everything|full|now)|exit\s+(?:all|now)|closed)\b/i],
  ["CANCEL_SETUP", /\bcancel(?:led|ling)?\b/i],
  ["TP_HIT", /(?:tp\s?\d?\s*(?:hit|reached|done)|breakeven|\bbe\b)/i],
];

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function detectDirection(upper: string): { direction: Direction | null; ambiguous: boolean } {
  const long = LONG_RE.test(upper);
  const short = SHORT_RE.test(upper);
  if (long && short) return { direction: null, ambiguous: true };
  if (long) return { direction: "LONG", ambiguous: false };
  if (short) return { direction: "SHORT", ambiguous: false };
  return { direction: null, ambiguous: false };
}

function normalizeSymbol(raw: string): string {
  return SYMBOL_MAP[raw] ?? raw;
}

function detectInstrument(upper: string): { instrument: string | null; ambiguous: boolean } {
  const suffixed = upper.match(SUFFIXED_SYMBOL);
  if (suffixed) return { instrument: normalizeSymbol(suffixed[1]), ambiguous: false };
  const bare = upper.match(BARE_CRYPTO);
  if (bare) {
    const mapped = SYMBOL_MAP[bare[1]];
    if (mapped) return { instrument: mapped, ambiguous: false };
  }
  const known = upper.match(KNOWN_WORDS);
  if (known) {
    const mapped = SYMBOL_MAP[known[1]];
    if (mapped) return { instrument: mapped, ambiguous: false };
    return { instrument: null, ambiguous: true };
  }
  const pair = upper.match(FOREX_PAIR);
  if (pair) return { instrument: normalizeSymbol(pair[1]), ambiguous: false };
  return { instrument: null, ambiguous: false };
}

function detectUpdateAction(text: string): UpdateAction {
  for (const [action, re] of ACTION_PATTERNS) {
    if (re.test(text)) return action;
  }
  return "NONE";
}

function takeProfits(text: string): number[] {
  const out: number[] = [];
  TP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TP_RE.exec(text)) !== null) {
    const n = parseNumber(m[2]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function parseSignal(input: ParserInput): NormalizedSignal {
  const text = input.text ?? "";
  const upper = text.toUpperCase();

  const dir = detectDirection(upper);
  const inst = detectInstrument(upper);
  const updateAction = detectUpdateAction(text);

  const entryMatch = text.match(ENTRY_RE);
  const entry = parseNumber(entryMatch?.[1]);
  const entryZoneHigh = parseNumber(entryMatch?.[2]);
  const stopLoss = parseNumber(text.match(SL_RE)?.[1]);
  const tps = takeProfits(text);

  const orderType = LIMIT_RE.test(text) ? "LIMIT" : MARKET_RE.test(text) ? "MARKET" : null;

  const missingFields: string[] = [];
  const ambiguities: string[] = [];
  if (!inst.instrument) missingFields.push("instrument");
  if (inst.ambiguous) ambiguities.push("unknown_symbol_no_fuzzy_match");
  if (!dir.direction) {
    if (dir.ambiguous) ambiguities.push("conflicting_directions");
    else missingFields.push("direction");
  }
  if (updateAction === "NONE") {
    if (entry === null) missingFields.push("entry");
    if (stopLoss === null) missingFields.push("stop_loss");
    if (tps.length === 0) missingFields.push("take_profits");
  }

  const confidence = Math.max(
    0.1,
    1 - 0.15 * missingFields.length - 0.2 * ambiguities.length,
  );

  return {
    eventType: updateAction === "NONE" ? "NEW" : "UPDATE",
    instrument: inst.instrument,
    direction: dir.direction,
    orderType,
    entry,
    entryZoneHigh,
    stopLoss,
    takeProfits: tps,
    updateAction,
    sourceMessageId: input.sourceMessageId,
    sourcePlatform: input.sourcePlatform,
    sourceUrl: input.sourceUrl ?? null,
    sourceTimestamp: input.sourceTimestamp ?? null,
    threadId: input.threadId ?? null,
    replyToMessageId: input.replyToMessageId ?? null,
    quotedMessageId: input.quotedMessageId ?? null,
    confidence: Math.round(confidence * 100) / 100,
    missingFields,
    ambiguities,
    parserVersion: PARSER_VERSION,
  };
}

/** Fields required to open a new signal. Never autofilled. */
export function missingRequiredFields(parsed: NormalizedSignal): string[] {
  const required: Array<[keyof NormalizedSignal, string]> = [
    ["instrument", "instrument"],
    ["direction", "direction"],
    ["entry", "entry"],
    ["stopLoss", "stop_loss"],
  ];
  const missing = required
    .filter(([key]) => parsed[key] === null)
    .map(([, name]) => name);
  if (parsed.takeProfits.length === 0) missing.push("take_profits");
  return missing;
}

export const UPDATE_ACTION_ALLOWLIST: UpdateAction[] = [
  "MODIFY_SL",
  "MODIFY_TP",
  "PARTIAL_CLOSE",
  "CLOSE_ALL",
  "CANCEL_SETUP",
  "TP_HIT",
];
