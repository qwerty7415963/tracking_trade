import {
  HyperliquidMarketData,
  HyperliquidMeta,
} from "./hyperliquid-market-data";

const META: HyperliquidMeta = {
  universe: [
    { name: "BTC", szDecimals: 5 },
    { name: "ETH", szDecimals: 4 },
    { name: "SOL", szDecimals: 3 },
    { name: "PAXG", szDecimals: 3 },
  ],
};

function mockFetch(routes: Record<string, unknown>): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { type: string };
    const payload = routes[body.type];
    if (payload === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;
}

describe("HyperliquidMarketData.getAllMids", () => {
  it("parses string prices to numbers and drops junk", async () => {
    const md = new HyperliquidMarketData(
      "https://x",
      mockFetch({ allMids: { BTC: "67000.5", ETH: "3500", BAD: "NaN" } }),
    );
    await expect(md.getAllMids()).resolves.toEqual({ BTC: 67000.5, ETH: 3500 });
  });

  it("throws on HTTP failure", async () => {
    const md = new HyperliquidMarketData("https://x", mockFetch({}));
    await expect(md.getAllMids()).rejects.toThrow("HYPERLIQUID_HTTP_FAILED");
  });
});

describe("HyperliquidMarketData.getMeta", () => {
  it("caches within TTL and refetches on force", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => META } as unknown as Response;
    }) as typeof fetch;
    const md = new HyperliquidMarketData("https://x", fetchFn, 60_000);
    await md.getMeta();
    await md.getMeta();
    expect(calls).toBe(1);
    await md.getMeta(true);
    expect(calls).toBe(2);
  });

  it("rejects malformed meta", async () => {
    const md = new HyperliquidMarketData("https://x", mockFetch({ meta: { nope: 1 } }));
    await expect(md.getMeta()).rejects.toThrow("HYPERLIQUID_BAD_META");
  });
});

describe("HyperliquidMarketData.resolveCoin", () => {
  const md = new HyperliquidMarketData();

  it.each([
    ["BTC", "BTC"],
    ["btc", "BTC"],
    ["ETHUSD", "ETH"],
    ["XAU", "PAXG"],
    ["XAUUSD", "PAXG"],
    ["GOLD", "PAXG"],
    ["XAUUSD.a", "PAXG"],
    ["PAXG", "PAXG"],
  ])("resolves %s -> %s", (input, expected) => {
    expect(md.resolveCoin(input, META)).toBe(expected);
  });

  it.each([["EURUSD", "AAPL", "", "   "]])("rejects unsupported %s", (input) => {
    expect(md.resolveCoin(input, META)).toBeNull();
  });
});
