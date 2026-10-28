import { Module } from "@nestjs/common";
import { APP_CONFIG, loadAppConfig } from "./app.config";

@Module({
  // useFactory (not useValue): loadAppConfig() must run at DI time, after
  // ConfigModule.forRoot has loaded .env into process.env. With useValue the
  // expression is evaluated at import time, before .env is loaded, so flags
  // like OPERATOR_BOT_ENABLED would read as empty locally.
  providers: [{ provide: APP_CONFIG, useFactory: () => loadAppConfig() }],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
