import { Inject, Injectable, Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import {
  HyperliquidAssetMeta,
  HyperliquidMarketData,
  HyperliquidMeta,
} from "@tracking-auto/market-data";
import { effectiveMmrFor } from "@tracking-auto/domain";

export interface AssetSpec {
  coin: string;
  szDecimals: number;
  minSize: number;
  sizeIncrement: number;
  maintenanceMarginRate: number;
}

/** Minimum order notional (USDC) enforced for paper sizing realism. */
export const MIN_NOTIONAL_USDC = 10;

@Injectable()
export class MarketDataService {
  private readonly client: HyperliquidMarketData;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new HyperliquidMarketData(config.hyperliquidApiUrl);
  }

  getAllMids(): Promise<Record<string, number>> {
    return this.client.getAllMids();
  }

  getMeta(force = false): Promise<HyperliquidMeta> {
    return this.client.getMeta(force);
  }

  async resolveCoin(canonical: string): Promise<string | null> {
    const meta = await this.getMeta();
    return this.client.resolveCoin(canonical, meta);
  }

  async getMid(coin: string): Promise<number | null> {
    return this.client.getMid(coin);
  }

  /**
   * Tradable spec for a coin: size decimals/step from meta,
   * min size from the $10 notional floor, MMR default 1%.
   */
  async assetSpec(coin: string): Promise<AssetSpec | null> {
    const meta = await this.getMeta();
    const asset: HyperliquidAssetMeta | undefined = meta.universe.find(
      (a) => a.name === coin,
    );
    if (!asset) return null;
    const sizeIncrement = 1 / 10 ** asset.szDecimals;
    const mids = await this.getAllMids().catch(() => ({} as Record<string, number>));
    const refPrice = mids[coin] > 0 ? mids[coin] : 1;
    const minSize = Math.ceil(MIN_NOTIONAL_USDC / refPrice / sizeIncrement) * sizeIncrement;
    return {
      coin,
      szDecimals: asset.szDecimals,
      minSize,
      sizeIncrement,
      maintenanceMarginRate: effectiveMmrFor(coin, 0),
    };
  }
}

@Module({
  imports: [AppConfigModule],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
