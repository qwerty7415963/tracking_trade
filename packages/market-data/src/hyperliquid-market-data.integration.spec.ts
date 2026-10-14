import { HyperliquidMarketData } from "./hyperliquid-market-data";

// Live Hyperliquid connectivity. Runs only with INTEGRATION_TESTS=1
// so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("Hyperliquid live market data", () => {
  const md = new HyperliquidMarketData();

  it("resolves BTC/ETH/PAXG against the live universe", async () => {
    const meta = await md.getMeta(true);
    expect(meta.universe.length).toBeGreaterThan(0);
    expect(md.resolveCoin("BTC", meta)).toBe("BTC");
    expect(md.resolveCoin("ETH", meta)).toBe("ETH");
    // PAX Gold carries the gold price; there is no XAU coin.
    expect(md.resolveCoin("XAU", meta)).toBe("PAXG");
    expect(md.resolveCoin("GOLD", meta)).toBe("PAXG");
  }, 30000);

  it("returns numeric mids for majors", async () => {
    const mids = await md.getAllMids();
    for (const coin of ["BTC", "ETH", "PAXG"]) {
      expect(typeof mids[coin]).toBe("number");
      expect(mids[coin]).toBeGreaterThan(0);
    }
  }, 30000);
});
