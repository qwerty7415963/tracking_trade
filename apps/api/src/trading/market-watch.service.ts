import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { REDIS_CLIENT } from "../queue/redis.provider";
import { PublicationsService } from "../reporting/publications.service";
import { MARKET_WATCH_QUEUE_NAME, VirtualTradingService } from "./virtual-trading.service";

@Injectable()
export class MarketWatchService implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;
  private scheduler: Queue | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly trading: VirtualTradingService,
    private readonly publications: PublicationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.scheduler = new Queue(MARKET_WATCH_QUEUE_NAME, { connection: this.redis });
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
          await this.publications.requestPositionPublish(
            ev.positionId,
            ev.kind === "SL" ? "sl" : "tp",
            { markPrice: ev.closePrice },
            "api",
          );
        }
        return { hits: events.length };
      },
      { connection: this.redis },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.scheduler?.close();
  }
}
