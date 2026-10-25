import { Inject, Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { PublicationsService, CardStatus } from "../reporting/publications.service";
import { KillSwitchService } from "./kill-switch.service";
import { MarketHitEvent, VirtualTradingService } from "./virtual-trading.service";

export const SETTLE_QUEUE_NAME = "position-settle";

/** BullMQ rejects ":" inside custom job ids — keep the key colon-free. */
export function settleJobId(ev: Pick<MarketHitEvent, "positionId" | "kind" | "tpIndex">): string {
  return ev.kind === "TP"
    ? `settle-${ev.positionId}-TP-${ev.tpIndex}`
    : `settle-${ev.positionId}-SL`;
}

export interface SettleJobData {
  positionId: string;
  kind: "TP" | "SL";
  /** Price frozen at detection; the card and the close both use it. */
  markPrice: number;
  tpIndex: number;
  /** Written after the first attempt created the card (retry-safe). */
  publicationId?: string;
}

export interface SettleResult {
  publicationId: string | null;
  publishState: "PUBLISHED" | "TIMEOUT" | "FAILED" | "SKIPPED";
  closeState: "CLOSED" | "ALREADY_CLOSED" | "SKIPPED";
}

const PUBLISH_POLL_MS = 500;

@Injectable()
export class SettleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly trading: VirtualTradingService,
    private readonly publications: PublicationsService,
    private readonly killSwitch: KillSwitchService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * TP/SL settlement: publish the card first (render + reply under the
   * original post), close the position afterwards.
   *
   * - The close price is frozen at detection, so a late close never changes
   *   the PnL; the position simply shows as open for up to the publish wait.
   * - The wait is bounded (`settlePublishTimeoutMs`, default 60s): a card
   *   still held by an undelivered original must never keep a hit position
   *   open. The card keeps retrying in the send queue and posts later.
   * - Every step is idempotent: retries reuse the stored publicationId and
   *   skip a close that already happened.
   */
  async settle(data: SettleJobData, job?: Pick<Job, "updateData">): Promise<SettleResult> {
    this.assertMutable();
    const status: CardStatus = data.kind === "SL" ? "sl" : "tp";
    let publicationId = data.publicationId ?? null;
    let publishState: SettleResult["publishState"];
    if (publicationId) {
      publishState = await this.waitForPublication(publicationId);
    } else {
      try {
        const created = await this.publications.requestPositionPublish(
          data.positionId,
          status,
          { markPrice: data.markPrice },
          "worker",
        );
        publicationId = created.publicationId;
        await job?.updateData({ ...data, publicationId });
        publishState = await this.waitForPublication(publicationId);
      } catch (err) {
        // No card possible (no destination, bad payload, ...): the position
        // still has to settle. The reason is audited for the operator.
        publishState = "SKIPPED";
        await this.audit.record("worker", "settle.publish_skipped", {
          positionId: data.positionId,
          kind: data.kind,
          reason: err instanceof Error ? err.message.split(":")[0] : "unknown",
        });
      }
    }
    if (publishState === "TIMEOUT") {
      await this.audit.record("worker", "settle.publish_timeout", {
        positionId: data.positionId,
        kind: data.kind,
        publicationId,
        waitedMs: this.config.settlePublishTimeoutMs,
      });
    }
    const closeState = await this.closePosition(data);
    return { publicationId, publishState, closeState };
  }

  /** Final settle failure (consumer, last attempt): leave a trace. */
  async markFailed(data: SettleJobData, reason: string): Promise<void> {
    await this.audit.record("worker", "settle.failed", {
      positionId: data.positionId,
      kind: data.kind,
      tpIndex: data.tpIndex,
      publicationId: data.publicationId ?? null,
      reason: (reason || "SETTLE_FAILED").split(":")[0].slice(0, 200),
    });
  }

  private assertMutable(): void {
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") {
      // Retryable: the job comes back once the kill switch is lifted.
      throw new Error("KILL_SWITCH: settle deferred");
    }
  }

  private async waitForPublication(publicationId: string): Promise<"PUBLISHED" | "TIMEOUT" | "FAILED"> {
    const deadline = Date.now() + Math.max(0, this.config.settlePublishTimeoutMs);
    for (;;) {
      const row = await this.prisma.telegramPublication
        .findUnique({ where: { id: publicationId }, select: { publicationStatus: true } })
        .catch(() => null);
      const status = row?.publicationStatus;
      if (status === "PUBLISHED") return "PUBLISHED";
      if (status === "FINAL_FAILURE" || status === "UNKNOWN") return "FAILED";
      if (Date.now() >= deadline) return "TIMEOUT";
      await new Promise((resolve) => setTimeout(resolve, PUBLISH_POLL_MS));
    }
  }

  private async closePosition(data: SettleJobData): Promise<"CLOSED" | "ALREADY_CLOSED" | "SKIPPED"> {
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id: data.positionId },
      select: { status: true, filledTps: true },
    });
    if (!position) return "SKIPPED";
    // Idempotency: a retried job must never close the same slice twice.
    const filled = Array.isArray(position.filledTps) ? position.filledTps.length : 0;
    if (data.kind === "TP") {
      if (filled > data.tpIndex) {
        await this.audit.record("worker", "settle.already_settled", {
          positionId: data.positionId,
          tpIndex: data.tpIndex,
          filledTps: filled,
        });
        return "ALREADY_CLOSED";
      }
    } else if (!["OPEN", "TP_HIT"].includes(position.status)) {
      return "ALREADY_CLOSED";
    }
    this.assertMutable();
    try {
      if (data.kind === "SL") {
        await this.trading.applySlHit(data.positionId, data.markPrice, "worker");
      } else {
        await this.trading.applyTpHit(data.positionId, data.markPrice, "worker");
      }
      return "CLOSED";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes(", not open")) return "ALREADY_CLOSED";
      throw err;
    }
  }
}
