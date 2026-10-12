import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { AuthModule } from "./auth/auth.module";
import { AuditModule } from "./audit/audit.module";
import { QueueModule } from "./queue/queue.module";
import { SignalsModule } from "./signals/signals.module";
import { SourcesModule } from "./sources/sources.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    AuthModule,
    DatabaseModule,
    AuditModule,
    QueueModule,
    SourcesModule,
    SignalsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
