import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataService } from "./market-data.service";

@Module({
  imports: [AppConfigModule],
  providers: [MarketDataService],
  exports: [MarketDataService],
})
export class MarketDataModule {}
