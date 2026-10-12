import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_CONFIG, loadAppConfig } from "./config/app.config";
import { HealthController } from "./health/health.controller";
import { OperatorGuard } from "./auth/operator.guard";
import { AuditService } from "./audit/audit.service";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true })],
  controllers: [HealthController],
  providers: [
    { provide: APP_CONFIG, useValue: loadAppConfig() },
    OperatorGuard,
    AuditService,
  ],
  exports: [OperatorGuard, AuditService],
})
export class AppModule {}
