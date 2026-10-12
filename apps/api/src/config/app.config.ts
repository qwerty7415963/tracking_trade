export const APP_CONFIG = "APP_CONFIG";
export const APP_VERSION = "0.1.0";

export interface AppConfig {
  operatorUsernames: string[];
  tradingEnabled: boolean;
  databaseUrl: string;
  redisUrl: string;
  mt5BridgeUrl: string;
  mt5BridgeApiKey: string;
  mt5AccountId: string;
  signalMaxAgeHours: number;
  bridgeTimeoutMs: number;
}

function parseUsernames(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    operatorUsernames: parseUsernames(env.OPERATOR_USERNAMES),
    // ADR-0011: live trading is always disabled by default after boot.
    tradingEnabled: false,
    databaseUrl: env.DATABASE_URL ?? "postgresql://tracking:tracking@localhost:5434/tracking",
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    mt5BridgeUrl: env.MT5_BRIDGE_URL ?? "http://localhost:8080",
    mt5BridgeApiKey: env.MT5_BRIDGE_API_KEY ?? "",
    mt5AccountId: env.MT5_ACCOUNT_ID ?? "",
    signalMaxAgeHours: Number(env.SIGNAL_MAX_AGE_HOURS ?? 24),
    bridgeTimeoutMs: Number(env.BRIDGE_TIMEOUT_MS ?? 15000),
  };
}
