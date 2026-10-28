import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../queue/redis.provider";
import { SETTLE_QUEUE_NAME, SettleJobData, SettleService } from "./settle.service";

@Injectable()
export class SettleConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly settle: SettleService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      SETTLE_QUEUE_NAME,
      async (job: Job) => this.settle.settle(job.data as SettleJobData, job),
      { connection: this.redis, concurrency: 3 },
    );
    // attemptsMade is incremented before this event fires, so the last
    // attempt is the only one that must leave a trace.
    this.worker.on("failed", (job, err) => {
      if (!job) return;
      if (job.attemptsMade < (job.opts.attempts ?? 1)) return;
      void this.settle.markFailed(job.data as SettleJobData, err?.message ?? "SETTLE_FAILED");
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
