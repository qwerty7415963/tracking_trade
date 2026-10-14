import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { ReportingModule } from "../reporting/reporting.module";
import { SignalsModule } from "../signals/signals.module";
import { ApprovalFlowService } from "./approval-flow.service";
import { KillSwitchService } from "./kill-switch.service";
import { OperatorBotService } from "./operator-bot.service";
import { SignalApprovalsController } from "./signal-approvals.controller";
import { AccountsController, OperationsController, PositionsController } from "./trading.controller";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";

@Module({
  imports: [AppConfigModule, MarketDataModule, SignalsModule, ReportingModule],
  controllers: [AccountsController, PositionsController, SignalApprovalsController, OperationsController],
  providers: [
    VirtualAccountsService,
    VirtualTradingService,
    ApprovalFlowService,
    KillSwitchService,
    OperatorBotService,
  ],
  exports: [VirtualAccountsService, VirtualTradingService, ApprovalFlowService, KillSwitchService],
})
export class TradingModule {}
