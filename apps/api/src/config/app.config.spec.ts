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

  it("always boots with trading disabled even if env tries otherwise", () => {
    const config = loadAppConfig({ TRADING_ENABLED: "true" } as NodeJS.ProcessEnv);
    expect(config.tradingEnabled).toBe(false);
  });
});
