import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue, Job } from "bullmq";
import { createHash } from "crypto";
import { promises as fs } from "fs";
import { join } from "path";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { REDIS_CLIENT } from "../queue/redis.provider";
import Redis from "ioredis";

export const RENDER_QUEUE = "RENDER_QUEUE";
export const RENDER_QUEUE_NAME = "card-render";
export const PUBLISH_QUEUE = "PUBLISH_QUEUE";
export const PUBLISH_QUEUE_NAME = "telegram-publish";

export type RenderJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "RETRYABLE_FAILURE"
  | "FINAL_FAILURE";

export interface RenderRequest {
  accountId: string;
  positionId: string;
  executionId?: string;
}

function mapJobStatus(state: string): RenderJobStatus {
  if (state === "completed") return "SUCCEEDED";
  if (state === "active" || state === "prioritized") return "PROCESSING";
  if (state === "failed") return "FINAL_FAILURE";
  if (state === "delayed" || state === "waiting" || state === "paused") return "PENDING";
  return "RETRYABLE_FAILURE";
}

@Injectable()
export class RendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private queue(name: string): Queue {
    return new Queue(name, { connection: this.redis });
  }

  artifactsDir(): string {
    return process.env.ARTIFACTS_DIR ?? "./artifacts";
  }

  async requestRender(request: RenderRequest, actor: string) {
    const queue = this.queue(RENDER_QUEUE_NAME);
    try {
      const job = await queue.add("render-card", request, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      });
      await this.audit.record(actor, "render.requested", {
        renderId: job.id,
        positionId: request.positionId,
      });
      return { renderId: job.id, status: "PENDING" as RenderJobStatus };
    } finally {
      await queue.close();
    }
  }

  async getRender(renderId: string) {
    const queue = this.queue(RENDER_QUEUE_NAME);
    try {
      const job: Job | undefined = await queue.getJob(renderId);
      if (!job) throw new NotFoundException(`render ${renderId} not found`);
      const state = await job.getState();
      const artifact = await this.prisma.renderArtifact.findUnique({
        where: { renderId },
      });
      return {
        renderId,
        status: mapJobStatus(state),
        artifact: artifact
          ? {
              artifactId: artifact.id,
              path: artifact.artifactPath,
              width: artifact.width,
              height: artifact.height,
              contentHash: artifact.contentHash,
            }
          : null,
        failedReason: state === "failed" ? String(job.failedReason ?? "") : null,
      };
    } finally {
      await queue.close();
    }
  }

  async saveArtifact(input: {
    renderId: string;
    snapshotId: string;
    accountId: string;
    positionId: string;
    executionId: string | null;
    png: Buffer;
    contentHash: string;
    width: number;
    height: number;
    templateVersion: number;
  }) {
    try {
      await fs.mkdir(this.artifactsDir(), { recursive: true });
      const filename = `${input.renderId}.png`;
      const path = join(this.artifactsDir(), filename);
      await fs.writeFile(path, input.png);
      const row = await this.prisma.renderArtifact.upsert({
        where: { renderId: input.renderId },
        create: {
          renderId: input.renderId,
          snapshotId: input.snapshotId,
          accountId: input.accountId,
          positionId: input.positionId,
          executionId: input.executionId,
          artifactPath: path,
          contentHash: input.contentHash,
          width: input.width,
          height: input.height,
          templateVersion: input.templateVersion,
        },
        update: {},
      });
      await this.purgeOldArtifacts();
      return row;
    } catch (err) {
      throw new Error(
        `ARTIFACT_STORAGE_FAILED: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /** Retention: 7 days (open-decisions #10). Runs after every successful save. */
  async purgeOldArtifacts(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const old = await this.prisma.renderArtifact.findMany({
      where: { createdAt: { lt: cutoff } },
      select: { id: true, artifactPath: true },
    });
    for (const row of old) {
      await fs.unlink(row.artifactPath).catch(() => {});
      await this.prisma.renderArtifact.delete({ where: { id: row.id } }).catch(() => {});
    }
    return old.length;
  }

  sha256(png: Buffer): string {
    return createHash("sha256").update(png).digest("hex");
  }
}
