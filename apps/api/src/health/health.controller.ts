import { Controller, Get, Inject } from "@nestjs/common";
import { APP_CONFIG, APP_VERSION, AppConfig } from "../config/app.config";

@Controller("v1/health")
export class HealthController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  check(): { status: string; trading: string; version: string } {
    return {
      status: "ok",
      trading: this.config.tradingEnabled ? "enabled" : "disabled",
      version: APP_VERSION,
    };
  }
}
