export const APP_CONFIG = "APP_CONFIG";
export const APP_VERSION = "0.1.0";

export interface AppConfig {
  operatorUsernames: string[];
  operatorChatIds: string[];
  operatorBotEnabled: boolean;
  tradingEnabled: boolean;
  databaseUrl: string;
  redisUrl: string;
  hyperliquidApiUrl: string;
  riskBudgetUsdc: number;
  defaultAccountId: string;
  reportDestinationChatId: string;
  marketPollMs: number;
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

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    operatorUsernames: parseUsernames(env.OPERATOR_USERNAMES),
    operatorChatIds: parseChatIds(env.OPERATOR_CHAT_IDS),
    // Single poller only: enable in worker, keep off in api to avoid duplicate DMs.
    operatorBotEnabled: env.OPERATOR_BOT_ENABLED === "true",
    // ADR-0011: live trading is always disabled by default after boot.
    tradingEnabled: false,
    databaseUrl: env.DATABASE_URL ?? "postgresql://tracking:tracking@localhost:5434/tracking",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    hyperliquidApiUrl: env.HYPERLIQUID_API_URL ?? "https://api.hyperliquid.xyz",
    riskBudgetUsdc: parseNumber(env.RISK_BUDGET_USDC, 50),
    defaultAccountId: env.VIRTUAL_DEFAULT_ACCOUNT_ID ?? "",
    reportDestinationChatId: env.REPORT_DESTINATION_CHAT_ID ?? "",
    marketPollMs: parseNumber(env.MARKET_POLL_MS, 5000),
    signalMaxAgeHours: Number(env.SIGNAL_MAX_AGE_HOURS ?? 24),
  };
}
