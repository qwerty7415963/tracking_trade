import { Global, Module } from "@nestjs/common";
import { AppConfigModule } from "../config/config.module";
import { OperatorGuard } from "./operator.guard";

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [OperatorGuard],
  exports: [OperatorGuard],
})
export class AuthModule {}
