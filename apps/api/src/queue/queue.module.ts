import { Inject, Module, OnModuleDestroy } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AppConfigModule } from "../config/config.module";
import { REDIS_CLIENT, createRedisClient } from "./redis.provider";

export const OUTBOX_QUEUE = "OUTBOX_QUEUE";
export const OUTBOX_QUEUE_NAME = "outbox-dispatch";

@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfig) => createRedisClient(config.redisUrl),
      inject: [APP_CONFIG],
    },
    {
      provide: OUTBOX_QUEUE,
      useFactory: (redis: Redis) => new Queue(OUTBOX_QUEUE_NAME, { connection: redis }),
      inject: [REDIS_CLIENT],
    },
  ],
  exports: [REDIS_CLIENT, OUTBOX_QUEUE],
})
export class QueueModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(OUTBOX_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    this.redis.disconnect();
  }
}
