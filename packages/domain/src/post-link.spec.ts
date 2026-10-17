import { buildPostLink } from "./post-link";

describe("buildPostLink", () => {
  it("prefers a stored URL", () => {
    expect(buildPostLink("TELEGRAM", "chan", "1", "https://t.me/c/9/9")).toBe(
      "https://t.me/c/9/9",
    );
  });

  it("builds t.me links for Telegram numeric messages", () => {
    expect(buildPostLink("TELEGRAM", "traderosho", "4375", null)).toBe(
      "https://t.me/traderosho/4375",
    );
    expect(buildPostLink("TELEGRAM", "@traderosho", "4375", undefined)).toBe(
      "https://t.me/traderosho/4375",
    );
  });

  it("returns null when no link can be built", () => {
    expect(buildPostLink("X", "watcher", "123", null)).toBeNull();
    expect(buildPostLink("TELEGRAM", "chan", "abc", null)).toBeNull();
    expect(buildPostLink("TELEGRAM", "", "1", null)).toBeNull();
    expect(buildPostLink("TELEGRAM", "12345", "1", null)).toBeNull();
    expect(buildPostLink("TELEGRAM", "chan", null, null)).toBeNull();
  });
});
