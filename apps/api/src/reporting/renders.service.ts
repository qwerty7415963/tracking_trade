import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue, Job } from "bullmq";
import { promises as fs } from "fs";
import { join } from "path";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { REDIS_CLIENT } from "../queue/redis.provider";
import Redis from "ioredis";

export const RENDER_QUEUE = "RENDER_QUEUE";
export const RENDER_QUEUE_NAME = "card-render";
export const PUBLISH_SEND_QUEUE = "PUBLISH_SEND_QUEUE";
export const PUBLISH_SEND_QUEUE_NAME = "telegram-send";
export const RENDER_JOB_ID_PREFIX = "render:";
export const SEND_JOB_ID_PREFIX = "send:";

export interface RenderJobData {
  virtualPositionId: string;
  markPrice?: number;
  publicationId?: string;
  status?: "filled" | "tp" | "sl" | "close";
  destinationChatId?: string;
  replyToMessageId?: string;
  actor?: string;
}

export interface SendJobData {
  publicationId: string;
  positionId: string;
  status: "filled" | "tp" | "sl" | "close";
  markPrice: number;
  destinationChatId: string;
  replyToMessageId?: string;
  artifactPath: string;
  actor: string;
}

export type RenderJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "RETRYABLE_FAILURE"
  | "FINAL_FAILURE";

export interface RenderRequest {
  virtualPositionId: string;
  markPrice?: number;
  publicationId?: string;
  status?: "filled" | "tp" | "sl" | "close";
  destinationChatId?: string;
  replyToMessageId?: string;
  actor?: string;
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
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private queue(name: string): Queue {
    return new Queue(name, { connection: this.redis });
  }

  artifactsDir(): string {
    const dir = (process.env.ARTIFACTS_DIR ?? "").trim();
    return dir.length > 0 ? dir : "./artifacts";
  }

  async requestRender(request: RenderRequest, actor: string, jobId?: string) {
    const queue = this.queue(RENDER_QUEUE_NAME);
    try {
      const job = await queue.add("render-card", request, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
        ...(jobId ? { jobId } : {}),
      });
      await this.audit.record(actor, "render.requested", {
        renderId: job.id,
        positionId: request.virtualPositionId,
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
      const artifactPath = this.artifactPathFor(renderId);
      const exists = await fs
        .stat(artifactPath)
        .then(() => true)
        .catch(() => false);
      return {
        renderId,
        status: mapJobStatus(state),
        artifact: exists ? { path: artifactPath } : null,
        failedReason: state === "failed" ? String(job.failedReason ?? "") : null,
      };
    } finally {
      await queue.close();
    }
  }

  artifactPathFor(renderId: string): string {
    return join(this.artifactsDir(), `${renderId}.png`);
  }

  async writeArtifact(renderId: string, png: Buffer): Promise<string> {
    try {
      const directory = this.artifactsDir();
      await fs.mkdir(directory, { recursive: true });
      const artifactPath = this.artifactPathFor(renderId);
      await fs.writeFile(artifactPath, png);
      return artifactPath;
    } catch (err) {
      throw new Error(
        `ARTIFACT_STORAGE_FAILED: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async readArtifact(renderId: string): Promise<Buffer> {
    try {
      return await fs.readFile(this.artifactPathFor(renderId));
    } catch {
      throw new NotFoundException(`render artifact ${renderId} not found`);
    }
  }

  /** Retention: 7 days (open-decisions #10). Deletes files by mtime; no DB. */
  async purgeOldArtifacts(retentionDays = 7, directory?: string): Promise<number> {
    const dir = directory ?? this.artifactsDir();
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    let removed = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".png")) continue;
      const path = join(dir, entry.name);
      try {
        const stat = await fs.stat(path);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(path);
          removed += 1;
        }
      } catch {
        continue;
      }
    }
    return removed;
  }
}
