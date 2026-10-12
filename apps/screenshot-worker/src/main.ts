import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Worker, Job } from "bullmq";
import Redis from "ioredis";
import { AppConfigModule } from "../../api/src/config/config.module";
import { loadAppConfig } from "../../api/src/config/app.config";
import { DatabaseModule } from "../../api/src/database/database.module";
import { AuditModule } from "../../api/src/audit/audit.module";
import { ReportingModule } from "../../api/src/reporting/reporting.module";
import { RendersService, RENDER_QUEUE_NAME, PUBLISH_QUEUE_NAME } from "../../api/src/reporting/renders.service";
import { PublicationsService } from "../../api/src/reporting/publications.service";

@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule, ReportingModule],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const config = loadAppConfig();
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: false });
  const renders = app.get(RendersService);
  const publications = app.get(PublicationsService);

  const renderWorker = new Worker(
    RENDER_QUEUE_NAME,
    async (job: Job) => {
      const { accountId, positionId, executionId } = job.data as {
        accountId: string;
        positionId: string;
        executionId?: string;
      };
      if (!executionId) throw new Error("POSITION_AMBIGUOUS: executionId required");
      const card = await publications.renderExecutionCard(executionId, `snap_${String(job.id)}`);
      if (card.snapshot.positionId !== positionId || card.snapshot.accountId !== accountId) {
        throw new Error("POSITION_AMBIGUOUS: snapshot does not match request");
      }
      const row = await renders.saveArtifact({
        renderId: String(job.id),
        snapshotId: card.snapshot.snapshotId,
        accountId: card.snapshot.accountId,
        positionId: card.snapshot.positionId,
        executionId: card.snapshot.executionId,
        png: card.artifact.png,
        contentHash: card.artifact.contentHash,
        width: card.artifact.width,
        height: card.artifact.height,
        templateVersion: card.artifact.templateVersion,
      });
      return { artifactId: row.id };
    },
    { connection: redis },
  );

  const publishWorker = new Worker(
    PUBLISH_QUEUE_NAME,
    async (job: Job) => {
      const { publicationId, executionId, destinationChatId, replyToMessageId } = job.data as {
        publicationId: string;
        executionId: string;
        destinationChatId: string;
        replyToMessageId?: string;
      };
      return publications.publishNow(
        publicationId,
        { executionId, destinationChatId, replyToMessageId },
        "worker",
      );
    },
    { connection: redis },
  );

  const shutdown = async () => {
    await renderWorker.close();
    await publishWorker.close();
    redis.disconnect();
    await app.close();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log("render+publish worker running");
}

void bootstrap();
