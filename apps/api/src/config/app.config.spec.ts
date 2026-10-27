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

  it("parses operator chat ids, dropping junk", () => {
    expect(loadAppConfig({ OPERATOR_CHAT_IDS: "123, -100456 ,abc,," }).operatorChatIds).toEqual([
      "123",
      "-100456",
    ]);
    expect(loadAppConfig({}).operatorChatIds).toEqual([]);
  });

  it("gates the operator bot poller (default off)", () => {
    expect(loadAppConfig({}).operatorBotEnabled).toBe(false);
    expect(loadAppConfig({ OPERATOR_BOT_ENABLED: "true" }).operatorBotEnabled).toBe(true);
    expect(loadAppConfig({ OPERATOR_BOT_ENABLED: "yes" }).operatorBotEnabled).toBe(false);
  });

  it("always boots with trading disabled", () => {
    expect(loadAppConfig({ OPERATOR_USERNAMES: "alice" }).tradingEnabled).toBe(false);
  });

  it("hosts the card render consumer unless explicitly disabled", () => {
    expect(loadAppConfig({}).renderWorkerEnabled).toBe(true);
    expect(loadAppConfig({ RENDER_WORKER_ENABLED: "true" }).renderWorkerEnabled).toBe(true);
    expect(loadAppConfig({ RENDER_WORKER_ENABLED: "false" }).renderWorkerEnabled).toBe(false);
  });

  it("defaults database and redis urls to local compose", () => {
    const config = loadAppConfig({});
    expect(config.databaseUrl).toContain("localhost:5434");
    expect(config.redisUrl).toContain("localhost:6379");
  });

  it("defaults paper-trading settings", () => {
    const config = loadAppConfig({});
    expect(config.hyperliquidApiUrl).toBe("https://api.hyperliquid.xyz");
    expect(config.marketPollMs).toBe(5000);
    expect(config.posMarketEntryDelayMs).toBe(3000);
    expect(config.posMarketCardMinAgeMs).toBe(3000);
    expect(config.dailySheetTemplateTab).toBe("TEMPLATE");
    expect(config.dailySheetTimezone).toBe("Asia/Ho_Chi_Minh");
    expect(config.dailySheetSyncMs).toBe(300_000);
    expect(config.dailySheetMorningAt).toBe("08:00");
    expect(config.settlePublishTimeoutMs).toBe(60_000);
    expect(config.defaultAccountId).toBe("");
  });

  it("parses paper-trading overrides", () => {
    const config = loadAppConfig({
      MARKET_POLL_MS: "10000",
      SETTLE_PUBLISH_TIMEOUT_MS: "30000",
      POS_MARKET_ENTRY_DELAY_MS: "5000",
      POS_MARKET_CARD_MIN_AGE_MS: "60000",
      DAILY_SHEET_SPREADSHEET_ID: "sheet-1",
      DAILY_SHEET_ACCOUNT_ID: "acc-1",
      DAILY_SHEET_SYNC_MS: "60000",
      GOOGLE_SERVICE_ACCOUNT_JSON: "C:/secrets/sa.json",
      VIRTUAL_DEFAULT_ACCOUNT_ID: "acc-1",
      REPORT_DESTINATION_CHAT_ID: "@chan",
    });
    expect(config.marketPollMs).toBe(10000);
    expect(config.posMarketEntryDelayMs).toBe(5000);
    expect(config.posMarketCardMinAgeMs).toBe(30000);
    expect(config.dailySheetSpreadsheetId).toBe("sheet-1");
    expect(config.dailySheetAccountId).toBe("acc-1");
    expect(config.dailySheetSyncMs).toBe(60000);
    expect(config.googleServiceAccountJson).toBe("C:/secrets/sa.json");
    expect(config.settlePublishTimeoutMs).toBe(30000);
    expect(config.defaultAccountId).toBe("acc-1");
    expect(config.reportDestinationChatId).toBe("@chan");
  });

  it("always boots with trading disabled even if env tries otherwise", () => {
    const config = loadAppConfig({ TRADING_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(config.tradingEnabled).toBe(false);
  });
});
