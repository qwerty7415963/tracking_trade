import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Worker, Job, Queue } from "bullmq";
import Redis from "ioredis";
import { AppConfigModule } from "../../api/src/config/config.module";
import { APP_CONFIG, AppConfig } from "../../api/src/config/app.config";
import { DatabaseModule } from "../../api/src/database/database.module";
import { AuditModule } from "../../api/src/audit/audit.module";
import { ReportingModule } from "../../api/src/reporting/reporting.module";
import {
  PUBLISH_SEND_QUEUE_NAME,
  RENDER_QUEUE_NAME,
  RendersService,
  RenderJobData,
  SEND_JOB_ID_PREFIX,
} from "../../api/src/reporting/renders.service";
import { PublicationsService } from "../../api/src/reporting/publications.service";
import { MarketDataService } from "../../api/src/market-data/market-data.service";
import { PrismaService } from "../../api/src/database/prisma.service";
import { DEFAULT_CARD_KIND } from "@tracking-auto/card-renderer";
import { createDefaultRenderer } from "./renderer";

@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule, ReportingModule],
})
class WorkerModule {}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["error", "warn", "log"],
  });
  const redis = new Redis(app.get<AppConfig>(APP_CONFIG).redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
  const renders = app.get(RendersService);
  const publications = app.get(PublicationsService);
  const marketData = app.get(MarketDataService);
  const prisma = app.get(PrismaService);
  const renderer = createDefaultRenderer();
  const sendQueue = new Queue(PUBLISH_SEND_QUEUE_NAME, { connection: redis });

  const renderWorker = new Worker(
    RENDER_QUEUE_NAME,
    async (job: Job) => {
      const data = job.data as RenderJobData;
      const renderId = data.publicationId ?? String(job.id);
      try {
        let markPrice = data.markPrice;
        if (markPrice === undefined) {
          const position = await prisma.virtualPosition.findUnique({
            where: { id: data.virtualPositionId },
          });
          if (!position) throw new Error(`POSITION_NOT_FOUND: ${data.virtualPositionId}`);
          const mid = await marketData.getMid(position.coin);
          if (mid === null) throw new Error(`NO_QUOTE for ${position.coin}`);
          markPrice = mid;
        }
        const card = await publications.buildSnapshot(data.virtualPositionId, markPrice);
        const rendered = await renderer.render(card.snapshot, new Date(), data.cardKind ?? DEFAULT_CARD_KIND);
        if (!rendered.ok) throw new Error(`RENDER_FAILED: ${rendered.code}`);
        const artifactPath = await renders.writeArtifact(renderId, rendered.artifact.png);
        if (data.publicationId) {
          await sendQueue.add(
            "send-photo",
            {
              publicationId: data.publicationId,
              positionId: data.virtualPositionId,
              status: data.status ?? "filled",
              markPrice,
              destinationChatId: data.destinationChatId ?? "",
              replyToMessageId: data.replyToMessageId,
              artifactPath,
              actor: data.actor ?? "worker",
            },
            {
              jobId: `${SEND_JOB_ID_PREFIX}${data.publicationId}`,
              // ~5 min total: covers ORIGINAL_HOLD_MS for late originals
              // plus genuine send retries (429/5xx).
              attempts: 10,
              backoff: { type: "fixed", delay: 30000 },
              removeOnComplete: 100,
              removeOnFail: 200,
            },
          );
        }
        return { artifactPath };
      } catch (err) {
        if (data.publicationId) {
          const code = err instanceof Error ? err.message.split(":")[0] : "UNKNOWN";
          await prisma.telegramPublication
            .update({
              where: { id: data.publicationId },
              data: { publicationStatus: "FINAL_FAILURE", renderedText: code },
            })
            .catch(() => {});
        }
        throw err;
      }
    },
    { connection: redis },
  );

  const shutdown = async () => {
    await renderWorker.close();
    await sendQueue.close();
    redis.disconnect();
    await app.close();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log("render worker running");
}

void bootstrap();
