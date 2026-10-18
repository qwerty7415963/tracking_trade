import { Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { MarketDataModule } from "../market-data/market-data.module";
import { ReportingModule } from "../reporting/reporting.module";
import { SignalsModule } from "../signals/signals.module";
import { ApprovalFlowService } from "./approval-flow.service";
import { CoinsModule } from "../coins/coins.module";
import { KillSwitchService } from "./kill-switch.service";
import { MarketWatchService } from "./market-watch.service";
import { OpenModeService } from "./open-mode.service";
import { OperatorBotService } from "./operator-bot.service";
import { SourcesModule } from "../sources/sources.module";
import { QueueModule } from "../queue/queue.module";
import { SignalApprovalsController } from "./signal-approvals.controller";
import { AccountsController, OperationsController, PositionsController } from "./trading.controller";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";

@Module({
  imports: [AppConfigModule, CoinsModule, MarketDataModule, QueueModule, SignalsModule, ReportingModule, SourcesModule],
  controllers: [AccountsController, PositionsController, SignalApprovalsController, OperationsController],
  providers: [
    VirtualAccountsService,
    VirtualTradingService,
    ApprovalFlowService,
    KillSwitchService,
    OpenModeService,
    OperatorBotService,
    MarketWatchService,
  ],
  exports: [VirtualAccountsService, VirtualTradingService, ApprovalFlowService, KillSwitchService, OpenModeService],
})
export class TradingModule {}
