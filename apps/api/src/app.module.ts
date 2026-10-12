import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { OperatorGuard } from "./auth/operator.guard";
import { AuditModule } from "./audit/audit.module";
import { QueueModule } from "./queue/queue.module";
import { SourcesModule } from "./sources/sources.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    DatabaseModule,
    AuditModule,
    QueueModule,
    SourcesModule,
  ],
  controllers: [HealthController],
  providers: [OperatorGuard],
  exports: [OperatorGuard],
})
export class AppModule {}
