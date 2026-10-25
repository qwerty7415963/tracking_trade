import { chromium } from "playwright";
import { DEFAULT_CARD_THEME } from "./card-config";
import { PositionSnapshot } from "./card-types";
import { FloatingPnLCardRenderer } from "./card-renderer";

// Needs a Playwright browser (npx playwright install chromium).
// Runs only with INTEGRATION_TESTS=1 so plain `npm test` (and CI) stays hermetic.
const describeIntegration = process.env.INTEGRATION_TESTS ? describe : describe.skip;

describeIntegration("FloatingPnLCardRenderer (real browser)", () => {
  it("renders a 1280x180 PNG from a verified snapshot", async () => {
    const renderer = new FloatingPnLCardRenderer(() => chromium.launch(), DEFAULT_CARD_THEME);
    const snapshot: PositionSnapshot = {
      accountId: "acc1",
      positionId: "p1",
      executionId: "e1",
      symbol: "XAUUSD.a",
      displaySymbol: "XAUUSD",
      direction: "BUY",
      volume: 1,
      entryPrice: 4172.493,
      currentPrice: 4172.845,
      floatingProfit: 35.2,
      profitCurrency: "USD",
      brokerSnapshotAt: new Date().toISOString(),
      snapshotId: "snap-live",
      status: "OPEN",
      priceDigits: 3,
      volumeDigits: 2,
    };
    const outcome = await renderer.render(snapshot);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.width).toBe(1280);
    expect(outcome.artifact.height).toBe(180);
    expect(outcome.artifact.mimeType).toBe("image/png");
    expect(outcome.artifact.png.length).toBeGreaterThan(1000);
  }, 60000);

  it("renders the stats card at 1040x480 (2x device scale)", async () => {
    const renderer = new FloatingPnLCardRenderer(() => chromium.launch(), DEFAULT_CARD_THEME);
    const snapshot: PositionSnapshot = {
      accountId: "acc1",
      positionId: "p1",
      executionId: "e1",
      symbol: "BTCUSDT",
      displaySymbol: "BTCUSDT",
      direction: "BUY",
      volume: 0.1,
      entryPrice: 4172.493,
      currentPrice: 4172.845,
      floatingProfit: 35.2,
      profitCurrency: "USDT",
      brokerSnapshotAt: new Date().toISOString(),
      snapshotId: "snap-stats",
      status: "OPEN",
      priceDigits: 3,
      volumeDigits: 2,
      leverage: 10,
      marginType: "CROSS",
      accountName: "Vĩnh cửu",
      maintenanceMarginRate: 0.01,
      liquidationPrice: 2275,
    };
    const outcome = await renderer.render(snapshot, new Date(), "position-stats");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.artifact.width).toBe(1040);
    expect(outcome.artifact.height).toBe(480);
    expect(outcome.artifact.templateVersion).toBe(10);
    expect(outcome.artifact.png.length).toBeGreaterThan(1000);
  }, 60000);
});
