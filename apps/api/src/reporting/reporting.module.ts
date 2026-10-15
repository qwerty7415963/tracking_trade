import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { QueueModule } from "../queue/queue.module";
import { BotApiSender, TELEGRAM_SENDER } from "./publications.service";
import {
  PositionRendersController,
  PublicationsController,
  RendersController,
} from "./reporting.controller";
import { RendersService } from "./renders.service";
import { PublicationsService } from "./publications.service";
import { PublishSendConsumer } from "./publish-send.consumer";

@Module({
  imports: [AppConfigModule, MarketDataModule, QueueModule],
  controllers: [PositionRendersController, PublicationsController, RendersController],
  providers: [
    RendersService,
    PublicationsService,
    PublishSendConsumer,
    {
      provide: TELEGRAM_SENDER,
      useFactory: () => new BotApiSender(process.env.TELEGRAM_BOT_TOKEN ?? ""),
    },
  ],
  exports: [RendersService, PublicationsService],
})
export class ReportingModule {}
