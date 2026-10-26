import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { REDIS_CLIENT } from "../queue/redis.provider";
import { AuditService } from "../audit/audit.service";
import { PublicationsService } from "../reporting/publications.service";
import { MARKET_WATCH_QUEUE_NAME, MarketHitEvent, VirtualTradingService } from "./virtual-trading.service";
import { SETTLE_QUEUE_NAME, SettleJobData, settleJobId } from "./settle.service";

@Injectable()
export class MarketWatchService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private scheduler: Queue | null = null;
  private settleQueue: Queue | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly trading: VirtualTradingService,
    private readonly publications: PublicationsService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.scheduler = new Queue(MARKET_WATCH_QUEUE_NAME, { connection: this.redis });
    this.settleQueue = new Queue(SETTLE_QUEUE_NAME, { connection: this.redis });
    // Repeatable price watch (deduplicated by scheduler id).
    await this.scheduler.upsertJobScheduler(
      "market-watch",
      { every: this.config.marketPollMs },
      { name: "watch", data: {} },
    );
    this.worker = new Worker(
      MARKET_WATCH_QUEUE_NAME,
      async () => {
        const events = await this.trading.pollMarketOnce();
        for (const ev of events) {
          if (ev.kind === "ENTRY") {
            // DCA fill: the row is already updated, so the card renders the
            // new size/average straight away (no settle — nothing to close).
            try {
              await this.publications.requestPositionPublish(
                ev.positionId,
                "entry",
                { markPrice: ev.markPrice },
                "worker",
              );
            } catch (err) {
              await this.audit.record("worker", "publication.skipped", {
                positionId: ev.positionId,
                reason: err instanceof Error ? err.message.split(":")[0] : "unknown",
              });
            }
            continue;
          }
          await this.enqueueSettle(ev);
        }
        return { hits: events.length };
      },
      { connection: this.redis },
    );
  }

  /**
   * One settle job per hit. The jobId is stable, so re-detection while a
   * settle is in flight is a no-op; a job that exhausted its attempts is
   * dropped and re-queued so an open position can never be stranded.
   */
  /** ENTRY events never reach here — the caller publishes those directly. */
  private async enqueueSettle(ev: MarketHitEvent): Promise<void> {
    const queue = this.settleQueue;
    if (!queue) return;
    const jobId = settleJobId(ev);
    const existing = await queue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === "failed") await existing.remove().catch(() => undefined);
      else return;
    }
    const data: SettleJobData = {
      positionId: ev.positionId,
      kind: ev.kind === "SL" ? "SL" : "TP",
      markPrice: ev.markPrice,
      tpIndex: ev.tpIndex ?? 0,
    };
    await queue.add("settle-position", data, {
      jobId,
      attempts: 5,
      backoff: { type: "fixed", delay: 30_000 },
      removeOnComplete: 100,
      removeOnFail: 200,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.scheduler?.close();
    await this.settleQueue?.close();
  }
}
