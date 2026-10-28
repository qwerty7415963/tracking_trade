import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DelayedError, Job, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";
import { REDIS_CLIENT } from "../queue/redis.provider";
import { PublicationsService } from "./publications.service";
import { createCardRenderer, isUpdateCardStatus, processRenderJob, RenderRunnerDeps } from "./render-job";
import {
  PUBLISH_SEND_QUEUE_NAME,
  RENDER_QUEUE_NAME,
  RendersService,
  RenderJobData,
} from "./renders.service";

/**
 * Hosts the `card-render` queue consumer inside the API process (replaces the
 * separate screenshot-worker service). Concurrency is 1 so a Chromium render
 * never competes with itself; HTTP traffic stays on other event-loop ticks.
 */
/** How often a held update card re-checks that the /pos dialog is over. */
const HOLD_POLL_MS = 5000;

@Injectable()
export class RenderConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private sendQueue: Queue | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly marketData: MarketDataService,
    private readonly publications: PublicationsService,
    private readonly renders: RendersService,
  ) {}

  onModuleInit(): void {
    if (!this.config.renderWorkerEnabled) return;
    this.sendQueue = new Queue(PUBLISH_SEND_QUEUE_NAME, { connection: this.redis });
    const deps: RenderRunnerDeps = {
      prisma: this.prisma,
      marketData: this.marketData,
      publications: this.publications,
      renders: this.renders,
      sendQueue: this.sendQueue,
      renderer: createCardRenderer(),
    };
    this.worker = new Worker(
      RENDER_QUEUE_NAME,
      async (job: Job, token?: string) => {
        const data = job.data as RenderJobData;
        // For a market open card, wait until the live mark differs from the
        // entry price so the card does not show a zero PnL/ROI. Fall back to
        // the deadline if the price never changes.
        if (data.awaitPriceChange === true && data.status === "filled") {
          const deadline = Number(data.priceChangeDeadline ?? 0);
          if (Number.isFinite(deadline) && deadline > Date.now()) {
            let position: { entryPrice: unknown } | null = null;
            try {
              position = await this.prisma.virtualPosition.findUnique({
                where: { id: data.virtualPositionId },
                select: { entryPrice: true },
              });
            } catch {
              position = null;
            }
            const entry = position ? Number(position.entryPrice) : NaN;
            if (Number.isFinite(entry)) {
              let mark: number | null = null;
              try {
                mark = await this.marketData.getMid(
                  (await this.prisma.virtualPosition.findUnique({
                    where: { id: data.virtualPositionId },
                    select: { coin: true },
                  }))?.coin ?? "",
                );
              } catch {
                mark = null;
              }
              if (mark !== null && mark === entry) {
                const pollMs = Math.max(1000, Number(data.priceChangePollMs ?? 3000));
                const remaining = deadline - Date.now();
                if (remaining > 0 && token) {
                  await job.moveToDelayed(Date.now() + Math.min(pollMs, remaining), token);
                  throw new DelayedError();
                }
              }
            }
          }
        }
        // A TP/SL/close card must show the style the operator picks, so it
        // waits out a pending /pos dialog (kind is read live at render time).
        // Re-checked every few seconds: the hold frees itself when the dialog
        // job is promoted (style chosen) or runs out (5 min default).
        if (isUpdateCardStatus(data.status)) {
          const left = await this.publications.styleDialogRemainingMs(data.virtualPositionId);
          if (left > 0 && token) {
            await job.moveToDelayed(Date.now() + Math.min(left, HOLD_POLL_MS), token);
            throw new DelayedError();
          }
        }
        const result = await processRenderJob(deps, data, job.id);
        console.log(`card rendered ${result.artifactPath}`);
        return result;
      },
      { connection: this.redis, concurrency: 1 },
    );
    console.log("card render consumer running");
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.sendQueue?.close();
  }
}
