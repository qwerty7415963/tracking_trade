import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { QueueModule } from "../queue/queue.module";
import { ReportingModule } from "./reporting.module";
import { PublishSendConsumer } from "./publish-send.consumer";
import { RenderConsumer } from "./render.consumer";

/**
 * API-only queue consumers. The API renders cards (Chromium + Chromium deps
 * live in the API image now) and sends the photo; the legacy screenshot
 * worker is no longer part of the compose stack.
 */
@Module({
  imports: [AppConfigModule, MarketDataModule, ReportingModule, QueueModule],
  providers: [PublishSendConsumer, RenderConsumer],
})
export class ReportingConsumersModule {}
