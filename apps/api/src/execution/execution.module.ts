import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { BridgeController } from "../bridge/bridge.controller";
import { BrokerStateService } from "../bridge/broker-state.service";
import { ExecutionService } from "./execution.service";
import { KillSwitchService } from "./kill-switch.service";
import { ReconciliationService } from "./reconciliation.service";
import { ExecutionsController, OperationsController } from "./operations.controller";

@Module({
  imports: [AppConfigModule],
  controllers: [OperationsController, ExecutionsController, BridgeController],
  providers: [BrokerStateService, ExecutionService, KillSwitchService, ReconciliationService],
  exports: [BrokerStateService, ExecutionService, KillSwitchService, ReconciliationService],
})
export class ExecutionModule {}
