import { MarketDataService } from "./market-data.service";

describe("MarketDataService.assetSpec", () => {
  function service(mids: Record<string, number>) {
    const svc = new MarketDataService({ hyperliquidApiUrl: "https://x" } as never);
    const client = {
      getMeta: jest.fn(async () => ({ universe: [{ name: "ETH", szDecimals: 4 }] })),
      getAllMids: jest.fn(async () => mids),
      resolveCoin: jest.fn(),
      getMid: jest.fn(),
    };
    (svc as unknown as { client: unknown }).client = client;
    return svc;
  }

  it("derives step and min size from meta + $10 notional floor", async () => {
    const svc = service({ ETH: 2500 });
    const spec = await svc.assetSpec("ETH");
    // step 0.0001; min = ceil(10/2500 / 0.0001) * 0.0001 = 0.004
    expect(spec).toEqual({
      coin: "ETH",
      szDecimals: 4,
      minSize: 0.004,
      sizeIncrement: 0.0001,
      maintenanceMarginRate: 0.005,
    });
  });

  it("returns null for unknown coins", async () => {
    const svc = service({});
    await expect(svc.assetSpec("NOPE")).resolves.toBeNull();
  });
});
