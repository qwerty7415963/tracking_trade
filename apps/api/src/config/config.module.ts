import { Module } from "@nestjs/common";
import { APP_CONFIG, loadAppConfig } from "./app.config";

@Module({
  providers: [{ provide: APP_CONFIG, useValue: loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
