import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { MarketDataModule } from "./market-data/market-data.module";
import { ReportingModule } from "./reporting/reporting.module";
import { QueueModule } from "./queue/queue.module";
import { SignalsModule } from "./signals/signals.module";
import { SourcesModule } from "./sources/sources.module";
import { TradingModule } from "./trading/trading.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    AuthModule,
    DatabaseModule,
    AuditModule,
    QueueModule,
    MarketDataModule,
    SourcesModule,
    SignalsModule,
    TradingModule,
    ReportingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
