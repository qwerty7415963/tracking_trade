import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MT5BridgeAdapter, BRIDGE_PORT } from "../bridge/mt5-bridge.adapter";
export { BRIDGE_PORT };
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { ExecutionService } from "./execution.service";
import { KillSwitchService } from "./kill-switch.service";
import { ReconciliationService } from "./reconciliation.service";
import { ExecutionsController, OperationsController } from "./operations.controller";

@Module({
  imports: [AppConfigModule],
  controllers: [OperationsController, ExecutionsController],
  providers: [
    {
      provide: BRIDGE_PORT,
      useFactory: (config: AppConfig) =>
        new MT5BridgeAdapter(config.mt5BridgeUrl, config.mt5BridgeApiKey),
      inject: [APP_CONFIG],
    },
    ExecutionService,
    KillSwitchService,
    ReconciliationService,
  ],
  exports: [BRIDGE_PORT, ExecutionService, KillSwitchService, ReconciliationService],
})
export class ExecutionModule {}
