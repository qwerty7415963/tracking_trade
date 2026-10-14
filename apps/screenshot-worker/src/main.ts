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
import { TradingModule } from "../../api/src/trading/trading.module";
import { RendersService, RENDER_QUEUE_NAME, PUBLISH_QUEUE_NAME } from "../../api/src/reporting/renders.service";
import { PublicationsService, PositionPublishRequest } from "../../api/src/reporting/publications.service";
import { VirtualTradingService, MARKET_WATCH_QUEUE_NAME } from "../../api/src/trading/virtual-trading.service";
import { MarketDataService } from "../../api/src/market-data/market-data.service";
import { PrismaService } from "../../api/src/database/prisma.service";

@Module({
  imports: [AppConfigModule, DatabaseModule, AuditModule, ReportingModule, TradingModule],
})
class WorkerModule {}

interface RenderJobData {
  virtualPositionId: string;
}

interface PublishJobData extends PositionPublishRequest {
  publicationId: string;
  destinationChatId: string;
}

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
  const trading = app.get(VirtualTradingService);
  const marketData = app.get(MarketDataService);
  const prisma = app.get(PrismaService);

  const renderWorker = new Worker(
    RENDER_QUEUE_NAME,
    async (job: Job) => {
      const { virtualPositionId } = job.data as RenderJobData;
      const position = await prisma.virtualPosition.findUnique({ where: { id: virtualPositionId } });
      if (!position) throw new Error(`POSITION_NOT_FOUND: ${virtualPositionId}`);
      const mid = await marketData.getMid(position.coin);
      if (mid === null) throw new Error(`NO_QUOTE for ${position.coin}`);
      const card = await publications.renderPositionCard(virtualPositionId, mid);
      const row = await renders.saveArtifact({
        renderId: String(job.id),
        snapshotId: card.snapshot.snapshotId,
        accountId: card.snapshot.accountId,
        virtualPositionId: card.snapshot.positionId,
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
      const { publicationId, positionId, status, markPrice, destinationChatId, replyToMessageId } =
        job.data as PublishJobData;
      return publications.publishPositionCardNow(
        publicationId,
        { positionId, status, markPrice, destinationChatId, replyToMessageId },
        "worker",
      );
    },
    { connection: redis },
  );

  const marketWorker = new Worker(
    MARKET_WATCH_QUEUE_NAME,
    async () => {
      const events = await trading.pollMarketOnce();
      for (const ev of events) {
        await publications.requestPositionPublish(
          ev.positionId,
          ev.kind === "SL" ? "sl" : "tp",
          { markPrice: ev.closePrice },
          "worker",
        );
      }
      return { hits: events.length };
    },
    { connection: redis },
  );

  // Repeatable price watch (deduplicated by scheduler id).
  const watchQueue = new Queue(MARKET_WATCH_QUEUE_NAME, { connection: redis });
  const appConfig = app.get<AppConfig>(APP_CONFIG);
  await watchQueue.upsertJobScheduler(
    "market-watch",
    { every: appConfig.marketPollMs },
    { name: "watch", data: {} },
  );
  await watchQueue.close();

  const shutdown = async () => {
    await renderWorker.close();
    await publishWorker.close();
    await marketWorker.close();
    redis.disconnect();
    await app.close();
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
  console.log("render+publish+watch worker running");
}

void bootstrap();
