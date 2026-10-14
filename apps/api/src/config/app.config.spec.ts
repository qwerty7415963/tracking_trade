import { loadAppConfig } from "./app.config";

describe("loadAppConfig", () => {
  it("parses comma-separated operators", () => {
    expect(loadAppConfig({ OPERATOR_USERNAMES: "alice, bob " }).operatorUsernames).toEqual([
      "alice",
      "bob",
    ]);
  });

  it("defaults to empty operator list (fail-safe)", () => {
    expect(loadAppConfig({}).operatorUsernames).toEqual([]);
  });

  it("always boots with trading disabled", () => {
    expect(loadAppConfig({ OPERATOR_USERNAMES: "alice" }).tradingEnabled).toBe(false);
  });

  it("defaults database and redis urls to local compose", () => {
    const config = loadAppConfig({});
    expect(config.databaseUrl).toContain("localhost:5434");
    expect(config.redisUrl).toContain("localhost:6379");
  });

  it("defaults paper-trading settings", () => {
    const config = loadAppConfig({});
    expect(config.hyperliquidApiUrl).toBe("https://api.hyperliquid.xyz");
    expect(config.riskBudgetUsdc).toBe(50);
    expect(config.marketPollMs).toBe(5000);
    expect(config.defaultAccountId).toBe("");
  });

  it("parses paper-trading overrides", () => {
    const config = loadAppConfig({
      RISK_BUDGET_USDC: "25",
      MARKET_POLL_MS: "10000",
      VIRTUAL_DEFAULT_ACCOUNT_ID: "acc-1",
      REPORT_DESTINATION_CHAT_ID: "@chan",
    });
    expect(config.riskBudgetUsdc).toBe(25);
    expect(config.marketPollMs).toBe(10000);
    expect(config.defaultAccountId).toBe("acc-1");
    expect(config.reportDestinationChatId).toBe("@chan");
  });

  it("always boots with trading disabled even if env tries otherwise", () => {
    const config = loadAppConfig({ TRADING_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(config.tradingEnabled).toBe(false);
  });
});
