import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue, Job } from "bullmq";
import { promises as fs } from "fs";
import { join } from "path";
import { CardKind } from "@tracking-auto/card-renderer";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { REDIS_CLIENT } from "../queue/redis.provider";
import Redis from "ioredis";

export const RENDER_QUEUE = "RENDER_QUEUE";
export const RENDER_QUEUE_NAME = "card-render";
export const PUBLISH_SEND_QUEUE = "PUBLISH_SEND_QUEUE";
export const PUBLISH_SEND_QUEUE_NAME = "telegram-send";
// BullMQ rejects custom job ids containing ":" â€” keep prefixes colon-free.
export const RENDER_JOB_ID_PREFIX = "render-";
export const SEND_JOB_ID_PREFIX = "send-";

export interface RenderJobData {
  virtualPositionId: string;
  markPrice?: number;
  publicationId?: string;
  status?: "filled" | "entry" | "tp" | "sl" | "close";
  destinationChatId?: string;
  replyToMessageId?: string;
  actor?: string;
  /** Card image style; undefined renders the pnl-strip default. */
  cardKind?: CardKind;
  /** Position size frozen when the card was requested (open card). */
  volume?: number;
  /** Snapshot status override: partial manual exits are still OPEN. */
  open?: boolean;
  /** Non-zero only for the /pos style dialog: marks the job being chosen. */
  delayMs?: number;
  /** Earliest render time (epoch ms). Promotion cannot run the card sooner. */
  minRenderAt?: number;
  /** TP ordinal the card is about (`tp` cards) - caption marks it as hit. */
  tpIndex?: number;
}

export interface SendJobData {
  publicationId: string;
  positionId: string;
  status: "filled" | "entry" | "tp" | "sl" | "close";
  markPrice: number;
  /** TP ordinal just hit; the card publishes before the slice closes. */
  tpIndex?: number;
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
  status?: "filled" | "entry" | "tp" | "sl" | "close";
  destinationChatId?: string;
  replyToMessageId?: string;
  actor?: string;
  /** Card image style; undefined renders the pnl-strip default. */
  cardKind?: CardKind;
  /** Position size frozen at request time; keeps open cards renderable
   *  even if the position closes before the (delayed) render runs. */
  volume?: number;
  /** Snapshot status override: partial manual exits are still OPEN. */
  open?: boolean;
  /** Hold the job this many ms (used by the /pos style dialog, 1 minute). */
  delayMs?: number;
  /** Earliest render time (epoch ms). Promotion cannot run the card sooner. */
  minRenderAt?: number;
  /** TP ordinal this card is about (`tp` cards) - caption marks it as hit. */
  tpIndex?: number;
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
        ...(request.delayMs && request.delayMs > 0 ? { delay: request.delayMs } : {}),
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

  /**
   * /pos style dialog promotion: if the publication's render job is still
   * waiting (delayed by the 5-minute dialog), rewrite it with the chosen
   * kind and run it now. "expired" = job gone or already running/done
   * (the default pnl-strip card was rendered on timeout).
   */
  async promoteRender(
    publicationId: string,
    cardKind: CardKind,
    actor: string,
  ): Promise<"promoted" | "expired"> {
    const { outcome } = await this.promoteFirstDelayed([publicationId], cardKind, actor);
    return outcome;
  }

  /**
   * Same promotion across every pending publication of one position.
   *
   * TP/SL/close cards enqueue their render job *without* a delay, so right
   * after a TP the newest PENDING row is usually not the dialog job: picking
   * it answers "Háº¿t thá»i gian chá»n" while the real dialog job is still
   * delayed. Choose the job that carries the dialog marker (`delayMs`); fall
   * back to a plain delayed job for jobs enqueued before that marker existed.
   */
  async promoteFirstDelayed(
    publicationIds: string[],
    cardKind: CardKind,
    actor: string,
  ): Promise<{ publicationId: string | null; outcome: "promoted" | "expired" }> {
    const queue = this.queue(RENDER_QUEUE_NAME);
    try {
      const candidates: Array<{ publicationId: string; job: Job; state: string; dialog: boolean }> = [];
      const states: Record<string, string> = {};
      for (const publicationId of publicationIds) {
        const job = await queue.getJob(`${RENDER_JOB_ID_PREFIX}${publicationId}`);
        if (!job) {
          states[publicationId] = "missing";
          continue;
        }
        const state = await job.getState();
        states[publicationId] = state;
        if (state !== "delayed" && state !== "waiting" && state !== "prioritized") continue;
        const data = job.data as RenderJobData;
        candidates.push({ publicationId, job, state, dialog: Number(data.delayMs ?? 0) > 0 });
      }
      const pick = candidates.find((c) => c.dialog) ?? candidates.find((c) => c.state === "delayed");
      if (!pick) {
        await this.audit.record(actor, "render.promotion_miss", { publicationIds, states });
        return { publicationId: null, outcome: "expired" };
      }
      const data = pick.job.data as RenderJobData;
      const minRenderAt = Number(data.minRenderAt ?? 0);
      const minDelay =
        Number.isFinite(minRenderAt) && minRenderAt > Date.now()
          ? minRenderAt - Date.now()
          : 0;
      await pick.job.remove();
      await queue.add("render-card", { ...data, cardKind }, {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 200,
        ...(minDelay > 0 ? { delay: minDelay } : {}),
        jobId: `${RENDER_JOB_ID_PREFIX}${pick.publicationId}`,
      });
      await this.audit.record(actor, "render.promoted", {
        publicationId: pick.publicationId,
        cardKind,
        jobState: pick.state,
        dialogJob: pick.dialog,
      });
      return { publicationId: pick.publicationId, outcome: "promoted" };
    } finally {
      await queue.close();
    }
  }

  /**
   * Milliseconds left before a pending /pos style dialog expires, for the
   * given publications (0 when none is waiting). Uses the same rule
   * `promoteFirstDelayed` uses to recognise the dialog job: `delayMs` marker
   * + still in the `delayed` state. Update cards poll this so they only
   * render after the operator picked (or missed) the style.
   */
  async dialogRemainingMs(publicationIds: string[]): Promise<number> {
    if (publicationIds.length === 0) return 0;
    const queue = this.queue(RENDER_QUEUE_NAME);
    try {
      for (const publicationId of publicationIds) {
        const job = await queue.getJob(`${RENDER_JOB_ID_PREFIX}${publicationId}`);
        if (!job) continue;
        if (Number((job.data as RenderJobData).delayMs ?? 0) <= 0) continue;
        if ((await job.getState()) !== "delayed") continue;
        const delay = Number(job.opts.delay ?? 0);
        if (delay <= 0) continue;
        const remaining = job.timestamp + delay - Date.now();
        if (remaining > 0) return remaining;
      }
      return 0;
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

  /** Remove the rendered PNG once the publication is published and no retry
   *  needs it. Missing files are a no-op; other errors propagate. */
  async deleteArtifact(renderId: string): Promise<void> {
    try {
      await fs.unlink(this.artifactPathFor(renderId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
