import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Job, Worker } from "bullmq";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../queue/redis.provider";
import { PublicationsService } from "./publications.service";
import { PUBLISH_SEND_QUEUE_NAME, SendJobData } from "./renders.service";

@Injectable()
export class PublishSendConsumer implements OnModuleInit, OnModuleDestroy {
  private worker: Worker | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly publications: PublicationsService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(
      PUBLISH_SEND_QUEUE_NAME,
      async (job: Job) => {
        const data = job.data as SendJobData;
        return this.publications.sendPublication(data.publicationId, data);
      },
      { connection: this.redis },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
