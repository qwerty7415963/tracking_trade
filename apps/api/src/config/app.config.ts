export const APP_CONFIG = "APP_CONFIG";
export const APP_VERSION = "0.1.0";

export interface AppConfig {
  operatorUsernames: string[];
  tradingEnabled: boolean;
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
  };
}
