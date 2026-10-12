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
});
