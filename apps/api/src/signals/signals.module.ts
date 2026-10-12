import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { SignalUpdatesController } from "./signal-updates.controller";
import { SignalUpdatesService } from "./signal-updates.service";
import { SignalsController } from "./signals.controller";
import { SignalsService } from "./signals.service";

@Module({
  imports: [AppConfigModule],
  controllers: [SignalsController, SignalUpdatesController],
  providers: [SignalsService, SignalUpdatesService],
  exports: [SignalsService, SignalUpdatesService],
})
export class SignalsModule {}
