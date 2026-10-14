import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { QueueModule } from "../queue/queue.module";
import { BotApiSender, CARD_RENDERER, TELEGRAM_SENDER, createDefaultRenderer } from "./publications.service";
import {
  PositionRendersController,
  PublicationsController,
  RendersController,
} from "./reporting.controller";
import { RendersService } from "./renders.service";
import { PublicationsService } from "./publications.service";

@Module({
  imports: [AppConfigModule, MarketDataModule, QueueModule],
  controllers: [PositionRendersController, RendersController, PublicationsController],
  providers: [
    RendersService,
    PublicationsService,
    {
      provide: CARD_RENDERER,
      useFactory: () => createDefaultRenderer(),
    },
    {
      provide: TELEGRAM_SENDER,
      useFactory: () => new BotApiSender(process.env.TELEGRAM_BOT_TOKEN ?? ""),
    },
  ],
  exports: [RendersService, PublicationsService],
})
export class ReportingModule {}
