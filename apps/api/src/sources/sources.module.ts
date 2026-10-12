import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import {
  TELEGRAM_PORT_FACTORY,
  TelegramCollectorService,
  defaultPortFactory,
} from "../telegram/telegram-collector.service";
import { XCollectorService } from "../x/x-collector.service";
import { SourcesController } from "./sources.controller";
import { SourcesService } from "./sources.service";

@Module({
  imports: [AppConfigModule],
  controllers: [SourcesController],
  providers: [
    SourcesService,
    TelegramCollectorService,
    XCollectorService,
    { provide: TELEGRAM_PORT_FACTORY, useFactory: () => defaultPortFactory },
  ],
})
export class SourcesModule {}
