import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { IngestionModule } from "./ingestion/ingestion.module";
import { AuthModule } from "./auth/auth.module";
import { CoinsModule } from "./coins/coins.module";
import { ProfilesModule } from "./profiles/profiles.module";
import { AuditModule } from "./audit/audit.module";
import { MarketDataModule } from "./market-data/market-data.module";
import { ReportingModule } from "./reporting/reporting.module";
import { ReportingConsumersModule } from "./reporting/reporting-consumers.module";
import { DailySheetModule } from "./reporting/daily-sheet/daily-sheet.module";
import { QueueModule } from "./queue/queue.module";
import { SignalsModule } from "./signals/signals.module";
import { SourcesModule } from "./sources/sources.module";
import { TradingModule } from "./trading/trading.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    AuthModule,
    CoinsModule,
    ProfilesModule,
    DatabaseModule,
    AuditModule,
    QueueModule,
    MarketDataModule,
    SourcesModule,
    SignalsModule,
    IngestionModule,
    TradingModule,
    ReportingModule,
    ReportingConsumersModule,
    DailySheetModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
