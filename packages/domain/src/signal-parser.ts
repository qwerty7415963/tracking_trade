import {
  Direction,
  NormalizedSignal,
  ParserInput,
  PARSER_VERSION,
  SYMBOL_MAP,
  TakeProfitSpec,
  UpdateAction,
} from "./signal-types";

const LONG_RE = /\b(BUY|LONG)\b/;
const SHORT_RE = /\b(SELL|SHORT)\b/;
const FOREX_PAIR = /\b([A-Z]{6})\b/;
const SUFFIXED_SYMBOL = /\b((?:XAU|XAG|BTC|ETH)USD(?:\.\w+)?|US30|NAS100|SPX500|UK100|DE40|JP225)\b/;
const BARE_CRYPTO = /\b(BTC|ETH|SOL|XRP|DOGE)(USD|USDT)?\b/;
const KNOWN_WORDS = /\b(GOLD|SILVER|OIL|WTI|BRENT|NASDAQ|DOW|SP500)\b/;

// Entry can be a single price, a zone (`3000 - 2950`) or a ladder of levels
// (`3000 2950 2900`, `3000, 2950`). Every number carries `(?![xX])` so a
// leverage token right after it (`Entry 3000 5x`) ends the run instead of
// being read as another level.
const ENTRY_RE =
  /(?:ENTRY|ENTER|@)\s*[:\-]?\s*(\d+(?:\.\d+)?(?![xX])(?:[-–,\s]+\d+(?:\.\d+)?(?![xX]))*)/i;
/** `entry market` (optionally followed by DCA levels): `entry market 2950 2900`. */
const ENTRY_MARKET_RE =
  /(?:ENTRY|ENTER|@)\s*[:\-]?\s*(?:market|mkt)\b\s*((?:\d+(?:\.\d+)?(?![xX])(?:[-–,\s]+\d+(?:\.\d+)?(?![xX]))*)?)/i;
const SL_RE = /(?:STOP\s?LOSS|\bSL\b)\s*[:\-]?\s*(\d+(?:\.\d+)?)/i;
const TP_RE = /\bTP(\d)?\s*[:\-]?\s*(\d+(?:\.\d+)?)(?!\d)(?!\s*%)/gi;
const LIMIT_RE = /\blimit\b/i;
const MARKET_RE = /\bmarket\b/i;
const LEVERAGE_RE = /(\d+)\s?[xX](?![A-Za-z])/;
const TICKER_RE = /[$#]([A-Za-z]{2,12})\b|\b([A-Za-z]{2,12})\/(?:USDT|USD)\b|\b([A-Za-z]{2,12})(?:USDT|USD)\b/;
const TP_PCT_RE = /(\d+(?:\.\d+)?)\s*%/g;

export interface CoinProfile {
  /** Channel-specific nicknames, e.g. { "PAWS": "BTC" }. Overrides SYMBOL_MAP. */
  coinAliases?: Record<string, string>;
}

export interface ParseOptions {
  /**
   * Uppercase tradable symbols (operator coin list) used to confirm
   * plain-word tickers. Marker-prefixed tickers ($/#//USDT) are extracted
   * regardless; membership is gated by the caller (coin list).
   */
  coinUniverse?: string[];
  profile?: CoinProfile | null;
}

/** US-style thousand separators: "1,223" -> "1223". */
function normalizeNumbers(text: string): string {
  let out = text;
  let prev = "";
  while (out !== prev) {
    prev = out;
    out = out.replace(/(\d),(\d)/g, "$1$2");
  }
  return out;
}

/** Strip pair quote suffixes: "BTC/USDT" -> "BTC". */
function stripPairSuffix(text: string): string {
  return text.replace(/\/(USDT|USD|PERP)\b/gi, "");
}

/** Ticker with an explicit marker: $ETH, #ZEC, ZEC/USDT, ZECUSDT. */
function detectTickerCandidate(text: string): string | null {
  const m = text.match(TICKER_RE);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? m[3] ?? "").toUpperCase();
  return raw.length > 0 ? raw : null;
}

function countDecimals(value: number): number {
  const dot = String(value).indexOf(".");
  return dot < 0 ? 0 : String(value).length - dot - 1;
}

function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(decimals));
}

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

/** Profile aliases override the built-in map (per-channel nicknames). */
function resolveAlias(raw: string, profile?: CoinProfile | null): string {
  const override = profile?.coinAliases?.[raw.toUpperCase()];
  if (override) return override;
  return normalizeSymbol(raw);
}

function detectInstrument(
  upper: string,
  ticker: string | null,
  coinUniverse?: string[],
  profile?: CoinProfile | null,
): { instrument: string | null; ambiguous: boolean } {
  const suffixed = upper.match(SUFFIXED_SYMBOL);
  if (suffixed) return { instrument: resolveAlias(suffixed[1], profile), ambiguous: false };
  const bare = upper.match(BARE_CRYPTO);
  if (bare) {
    const mapped = SYMBOL_MAP[bare[1]];
    if (mapped) return { instrument: mapped, ambiguous: false };
  }
  if (ticker) return { instrument: resolveAlias(ticker, profile), ambiguous: false };
  if (profile?.coinAliases) {
    const words = upper.match(/\b([A-Z]{2,12})\b/g) ?? [];
    for (const w of words) {
      if (profile.coinAliases[w]) return { instrument: profile.coinAliases[w], ambiguous: false };
    }
  }
  const known = upper.match(KNOWN_WORDS);
  if (known) {
    const mapped = SYMBOL_MAP[known[1]];
    if (mapped) return { instrument: mapped, ambiguous: false };
    return { instrument: null, ambiguous: true };
  }
  const pair = upper.match(FOREX_PAIR);
  if (pair) return { instrument: resolveAlias(pair[1], profile), ambiguous: false };
  if (coinUniverse) {
    const allowed = new Set(coinUniverse.map((c) => c.toUpperCase()));
    const words = upper.match(/\b([A-Z]{2,12})\b/g) ?? [];
    for (const w of words) {
      if (allowed.has(w)) return { instrument: resolveAlias(w, profile), ambiguous: false };
    }
  }
  return { instrument: null, ambiguous: false };
}

function detectUpdateAction(text: string): UpdateAction {
  for (const [action, re] of ACTION_PATTERNS) {
    if (re.test(text)) return action;
  }
  return "NONE";
}

function takeProfitSpecs(text: string): TakeProfitSpec[] {
  const out: TakeProfitSpec[] = [];
  const headRe = /\bTP(\d)?\s*[:\-]?\s*/gi;
  const heads = [...text.matchAll(headRe)];
  for (let i = 0; i < heads.length; i += 1) {
    const start = heads[i].index + heads[i][0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : text.length;
    const segment = text.slice(start, end);
    for (const token of segment.split(/[-–,\s]+/)) {
      if (!token) continue;
      const percent = token.match(/^(\d+(?:\.\d+)?)%$/);
      if (percent) {
        const value = parseNumber(percent[1]);
        if (value !== null) out.push({ kind: "percent", value });
        continue;
      }
      const risk = token.match(/^(\d+(?:\.\d+)?)[Rr]$/);
      if (risk) {
        const value = parseNumber(risk[1]);
        if (value !== null) out.push({ kind: "r", multiple: value });
        continue;
      }
      // Plain leverage tokens such as `5x` are never TP prices.
      const price = token.match(/^(\d+(?:\.\d+)?)(?![xX])$/);
      if (price) {
        const value = parseNumber(price[1]);
        if (value !== null) out.push({ kind: "price", value });
        continue;
      }
      break;
    }
  }
  return out;
}

export function takeProfitSpecsFromPayload(payload: unknown): TakeProfitSpec[] {
  const raw = (payload as { takeProfitSpecs?: unknown } | null)?.takeProfitSpecs;
  if (!Array.isArray(raw)) return [];
  const out: TakeProfitSpec[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const kind = (item as { kind?: unknown }).kind;
    const value = Number((item as { value?: unknown; multiple?: unknown }).value ?? (item as { multiple?: unknown }).multiple);
    if (!Number.isFinite(value)) continue;
    if (kind === "price") out.push({ kind: "price", value });
    else if (kind === "r") out.push({ kind: "r", multiple: value });
    else if (kind === "percent") out.push({ kind: "percent", value });
  }
  return out;
}

export function resolveTakeProfitSpecs(
  specs: TakeProfitSpec[],
  entry: number | null,
  stopLoss: number | null,
  direction: Direction | null,
): number[] | null {
  if (specs.length === 0) return [];
  // Price-only specs can resolve without entry/SL/direction.
  if (specs.every((spec) => spec.kind === "price")) {
    return specs.map((spec) => spec.value);
  }
  if (entry === null || stopLoss === null || direction === null) return null;
  const risk = Math.abs(entry - stopLoss);
  if (!(risk > 0) || !Number.isFinite(risk)) return null;
  const decimals = Math.max(
    countDecimals(entry),
    countDecimals(stopLoss),
    ...specs.map((spec) => (spec.kind === "r" ? countDecimals(spec.multiple) : 0)),
  );
  const out: number[] = [];
  for (const spec of specs) {
    if (spec.kind === "price") {
      out.push(spec.value);
      continue;
    }
    if (spec.kind === "r") {
      const raw = direction === "LONG" ? entry + spec.multiple * risk : entry - spec.multiple * risk;
      out.push(roundTo(raw, decimals));
      continue;
    }
    const sign = direction === "LONG" ? 1 : -1;
    out.push(roundTo(entry * (1 + (sign * spec.value) / 100), countDecimals(entry)));
  }
  return out;
}

/** Split the matched entry run into levels: `1223 - 1154` / `3000 2950`. */
function entryLevels(run: string | null | undefined): number[] {
  if (!run) return [];
  const out: number[] = [];
  for (const token of run.split(/[-–,\s]+/)) {
    if (!token) continue;
    const n = parseNumber(token);
    if (n !== null) out.push(n);
  }
  return out;
}

function takeProfitPercents(text: string): number[] {
  const out: number[] = [];
  TP_PCT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TP_PCT_RE.exec(text)) !== null) {
    const n = parseNumber(m[1]);
    if (n !== null) out.push(n);
  }
  return out;
}

export function parseSignal(input: ParserInput, opts: ParseOptions = {}): NormalizedSignal {
  const rawText = input.text ?? "";
  const ticker = detectTickerCandidate(rawText);
  const text = stripPairSuffix(normalizeNumbers(rawText));
  const upper = text.toUpperCase();

  const dir = detectDirection(upper);
  const inst = detectInstrument(upper, ticker, opts.coinUniverse, opts.profile);
  const updateAction = detectUpdateAction(text);

  const marketMatch = text.match(ENTRY_MARKET_RE);
  const entryMarket = marketMatch !== null;
  const entryMatch = text.match(ENTRY_RE);
  const entryRun = entryMarket ? (marketMatch?.[1] ?? "") : (entryMatch?.[1] ?? "");
  const levels = entryLevels(entryRun);
  // A dash between exactly two numbers is a zone (`1223 - 1154`): one entry
  // plus a reference high. Anything else is a ladder of entry levels.
  const isEntryZone = !entryMarket && /[-–]/.test(entryRun) && levels.length === 2;
  const entry = entryMarket ? null : levels.length > 0 ? levels[0] : null;
  const entryZoneHigh = isEntryZone ? levels[1] : null;
  let entries = isEntryZone ? [levels[0]] : levels;
  // DCA only works when the ladder points away from the entry: LONG falls to
  // lower levels, SHORT climbs to higher ones. Anything else is noise.
  const entriesWrongOrder =
    !isEntryZone &&
    entries.length > 1 &&
    dir.direction !== null &&
    !(dir.direction === "LONG"
      ? entries.every((v, i) => i === 0 || v <= entries[i - 1])
      : entries.every((v, i) => i === 0 || v >= entries[i - 1]));
  if (entriesWrongOrder) entries = [entries[0]];
  const stopLoss = parseNumber(text.match(SL_RE)?.[1]);
  const tpSpecs = takeProfitSpecs(text);
  let tps = resolveTakeProfitSpecs(tpSpecs, entry, stopLoss, dir.direction);
  if (tps === null) tps = [];
  const levMatch = rawText.match(LEVERAGE_RE);
  const leverage = parseNumber(levMatch?.[1] ?? undefined);

  const orderType = entryMarket
    ? "MARKET"
    : LIMIT_RE.test(text)
      ? "LIMIT"
      : MARKET_RE.test(text)
        ? "MARKET"
        : null;

  const missingFields: string[] = [];
  const ambiguities: string[] = [];
  if (!inst.instrument) missingFields.push("instrument");
  if (inst.ambiguous) ambiguities.push("unknown_symbol_no_fuzzy_match");
  if (entriesWrongOrder) ambiguities.push("entries_wrong_order");
  if (!dir.direction) {
    if (dir.ambiguous) ambiguities.push("conflicting_directions");
    else missingFields.push("direction");
  }
  if (updateAction === "NONE") {
    if (!entryMarket && entry === null) missingFields.push("entry");
    if (stopLoss === null) missingFields.push("stop_loss");
  if (tps.length === 0) {
    if (tpSpecs.length > 0 && tpSpecs.some((spec) => spec.kind !== "price")) {
      missingFields.push("take_profits");
    } else if (tpSpecs.length === 0) {
      missingFields.push("take_profits");
    }
  } else if (tpSpecs.some((spec) => spec.kind === "percent")) {
    ambiguities.push("tp_percent_converted");
  }
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
    entryMarket,
    entries,
    stopLoss,
    takeProfits: tps,
    takeProfitSpecs: tpSpecs,
    leverage,
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
    ...(parsed.entryMarket ? [] : ([["entry", "entry"]] as Array<[keyof NormalizedSignal, string]>)),
    ["stopLoss", "stop_loss"],
  ];
  const missing = required
    .filter(([key]) => parsed[key] === null)
    .map(([, name]) => name);
  if (parsed.takeProfits.length === 0 && parsed.takeProfitSpecs.length === 0) missing.push("take_profits");
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
