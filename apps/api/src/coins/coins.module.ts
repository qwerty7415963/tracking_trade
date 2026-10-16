import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { CoinsController } from "./coins.controller";
import { CoinsService } from "./coins.service";

@Module({
  imports: [AppConfigModule],
  controllers: [CoinsController],
  providers: [CoinsService],
  exports: [CoinsService],
})
export class CoinsModule {}
