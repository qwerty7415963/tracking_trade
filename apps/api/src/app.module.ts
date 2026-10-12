import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppConfigModule } from "./config/config.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { OperatorGuard } from "./auth/operator.guard";
import { AuditService } from "./audit/audit.service";
import { QueueModule } from "./queue/queue.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    DatabaseModule,
    QueueModule,
  ],
  controllers: [HealthController],
  providers: [OperatorGuard, AuditService],
  exports: [OperatorGuard, AuditService],
})
export class AppModule {}
