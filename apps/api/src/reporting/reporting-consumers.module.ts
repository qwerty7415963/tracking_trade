import { Module } from "@nestjs/common";
import { ReportingModule } from "./reporting.module";
import { PublishSendConsumer } from "./publish-send.consumer";

/**
 * API-only queue consumers. The screenshot worker imports ReportingModule
 * (renders + snapshots) but must never consume telegram-send — only the
 * API process sends photos (single poller/sender principle).
 */
@Module({
  imports: [ReportingModule],
  providers: [PublishSendConsumer],
})
export class ReportingConsumersModule {}
