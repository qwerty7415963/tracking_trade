import { Controller, Get, Inject } from "@nestjs/common";
import Redis from "ioredis";
import { APP_CONFIG, APP_VERSION, AppConfig } from "../config/app.config";
import { PrismaService } from "../database/prisma.service";
import { REDIS_CLIENT } from "../queue/redis.provider";

type DepStatus = "up" | "down";

export interface HealthReport {
  status: string;
  trading: string;
  version: string;
  deps: Record<"db" | "redis", DepStatus>;
}

@Controller("v1/health")
export class HealthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([this.pingDb(), this.pingRedis()]);
    return {
      status: db === "up" && redis === "up" ? "ok" : "degraded",
      trading: this.config.tradingEnabled ? "enabled" : "disabled",
      version: APP_VERSION,
      deps: { db, redis },
    };
  }

  private async pingDb(): Promise<DepStatus> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return "up";
    } catch {
      return "down";
    }
  }

  private async pingRedis(): Promise<DepStatus> {
    try {
      await this.redis.ping();
      return "up";
    } catch {
      return "down";
    }
  }
}
