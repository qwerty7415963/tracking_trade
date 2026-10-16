import { Module } from "@nestjs/common";
import { CoinsModule } from "../coins/coins.module";
import { ProfilesModule } from "../profiles/profiles.module";
import { AppConfigModule } from "../config/config.module";
import { SignalUpdatesController } from "./signal-updates.controller";
import { SignalUpdatesService } from "./signal-updates.service";
import { SignalsService } from "./signals.service";

@Module({
  imports: [AppConfigModule, CoinsModule, ProfilesModule],
  controllers: [SignalUpdatesController],
  providers: [SignalsService, SignalUpdatesService],
  exports: [SignalsService, SignalUpdatesService],
})
export class SignalsModule {}
