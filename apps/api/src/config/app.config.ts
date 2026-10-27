export const APP_CONFIG = "APP_CONFIG";
export const APP_VERSION = "0.1.0";

export interface AppConfig {
  operatorUsernames: string[];
  operatorChatIds: string[];
  operatorBotEnabled: boolean;
  /** Host the card-render BullMQ consumer in this process (default on). */
  renderWorkerEnabled: boolean;
  tradingEnabled: boolean;
  databaseUrl: string;
  redisUrl: string;
  hyperliquidApiUrl: string;
  defaultAccountId: string;
  reportDestinationChatId: string;
  marketPollMs: number;
  /** /pos entry-market: wait before taking the execution mid. */
  posMarketEntryDelayMs: number;
  /** /pos entry-market: card cannot render before entry + this age. */
  posMarketCardMinAgeMs: number;
  /** Google service account JSON path for the daily report sheet. */
  googleServiceAccountJson: string;
  dailySheetSpreadsheetId: string;
  dailySheetTemplateTab: string;
  dailySheetAccountId: string;
  dailySheetTimezone: string;
  dailySheetSyncMs: number;
  dailySheetMorningAt: string;
  /** Optional YYYY-MM-DD override; otherwise first boot's local date is stored. */
  dailySheetStartDate: string;
  /** How long a TP/SL settle waits for its card before closing anyway. */
  settlePublishTimeoutMs: number;
  signalMaxAgeHours: number;
}

function parseUsernames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function parseChatIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^-?\d+$/.test(s));
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** /pos market delays: clamp to a safe, human-scale window. */
function parseDelayMs(raw: string | undefined, fallback: number): number {
  const n = parseNumber(raw, fallback);
  return Math.min(30_000, Math.max(0, Math.floor(n)));
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    operatorUsernames: parseUsernames(env.OPERATOR_USERNAMES),
    operatorChatIds: parseChatIds(env.OPERATOR_CHAT_IDS),
    // Single poller only: enable in api, keep off in any extra replica.
    operatorBotEnabled: env.OPERATOR_BOT_ENABLED === "true",
    // Render consumer lives in the API by default; set "false" for replicas
    // that should only serve HTTP.
    renderWorkerEnabled: env.RENDER_WORKER_ENABLED !== "false",
    // ADR-0011: live trading is always disabled by default after boot.
    tradingEnabled: false,
    databaseUrl: env.DATABASE_URL ?? "postgresql://tracking:tracking@localhost:5434/tracking",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    hyperliquidApiUrl: env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz",
    defaultAccountId: env.VIRTUAL_DEFAULT_ACCOUNT_ID ?? "",
    reportDestinationChatId: env.REPORT_DESTINATION_CHAT_ID ?? "",
    marketPollMs: parseNumber(env.MARKET_POLL_MS, 5000),
    posMarketEntryDelayMs: parseDelayMs(env.POS_MARKET_ENTRY_DELAY_MS, 3000),
    posMarketCardMinAgeMs: parseDelayMs(env.POS_MARKET_CARD_MIN_AGE_MS, 3000),
    googleServiceAccountJson: env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
    dailySheetSpreadsheetId: env.DAILY_SHEET_SPREADSHEET_ID ?? "",
    dailySheetTemplateTab: env.DAILY_SHEET_TEMPLATE_TAB ?? "TEMPLATE",
    dailySheetAccountId: env.DAILY_SHEET_ACCOUNT_ID ?? "",
    dailySheetTimezone: env.DAILY_SHEET_TIMEZONE ?? "Asia/Ho_Chi_Minh",
    dailySheetSyncMs: Math.max(60_000, parseNumber(env.DAILY_SHEET_SYNC_MS, 300_000)),
    dailySheetMorningAt: env.DAILY_SHEET_MORNING_AT ?? "08:00",
    dailySheetStartDate: env.DAILY_SHEET_START_DATE ?? "",
    settlePublishTimeoutMs: parseNumber(env.SETTLE_PUBLISH_TIMEOUT_MS, 60_000),
    signalMaxAgeHours: Number(env.SIGNAL_MAX_AGE_HOURS ?? 24),
  };
}
