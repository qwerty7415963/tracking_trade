import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Source } from "@prisma/client";
import { SignalsService } from "../signals/signals.service";
import { SourcesService } from "../sources/sources.service";
import { TelegramCollectorService, TelegramMessageInput } from "../telegram/telegram-collector.service";
import { ApprovalFlowService } from "../trading/approval-flow.service";

/** Re-check for newly added/enabled sources (no restart needed after /source_add). */
const RESYNC_MS = 60_000;

/**
 * Owns the realtime read loop: every enabled Telegram source is subscribed
 * once via USER_SESSION; new posts are ingested + parsed, edits become new
 * revisions. One bad source never breaks the rest.
 */
@Injectable()
export class IngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly subscribed = new Set<string>();
  private enabledIds = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly sources: SourcesService,
    private readonly telegram: TelegramCollectorService,
    private readonly signals: SignalsService,
    private readonly flow: ApprovalFlowService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.resync();
    this.timer = setInterval(() => {
      void this.resync().catch(() => undefined);
    }, RESYNC_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Subscribe every enabled Telegram source; safe to call repeatedly. */
  async resync(): Promise<void> {
    let rows: Source[];
    try {
      rows = await this.sources.list();
    } catch {
      return; // DB not ready yet; the next tick retries.
    }
    this.enabledIds = new Set(
      rows.filter((s) => s.platform === "TELEGRAM" && s.enabled).map((s) => s.id),
    );
    for (const source of rows) {
      if (source.platform !== "TELEGRAM" || !source.enabled) continue;
      if (this.subscribed.has(source.id)) continue;
      try {
        await this.telegram.subscribeNewMessages(source.externalSourceId, (msg) =>
          this.handleNew(source.id, msg),
        );
        await this.telegram.subscribeEditMessages(source.externalSourceId, (msg) =>
          this.handleEdit(source.id, msg),
        );
        this.subscribed.add(source.id);
      } catch (err) {
        console.warn(
          `[ingestion] subscribe failed for ${source.id}: ${err instanceof Error ? err.message : "unknown error"}`,
        );
      }
    }
  }

  private async handleNew(sourceId: string, msg: TelegramMessageInput): Promise<void> {
    if (!this.enabledIds.has(sourceId)) return;
    try {
      const res = await this.telegram.ingestMessage(sourceId, msg);
      if (res.deduplicated || !res.id) return;
      await this.parseAndMaybeAutoOpen(res.id);
    } catch {
      // One bad message must never kill the loop.
    }
  }

  private async handleEdit(sourceId: string, msg: TelegramMessageInput): Promise<void> {
    if (!this.enabledIds.has(sourceId)) return;
    try {
      const res = await this.telegram.ingestEdit(sourceId, msg);
      if (res.deduplicated || !res.id) return;
      await this.parseAndMaybeAutoOpen(res.id);
    } catch {
      // One bad message must never kill the loop.
    }
  }

  /** Parse a fresh message, then run the AUTO hook (no-op unless global AUTO). */
  private async parseAndMaybeAutoOpen(rowId: string): Promise<void> {
    const outcome = await this.signals.ingestSourceMessage(rowId, "ingestion");
    if (outcome.kind === "SIGNAL" && outcome.signalId) {
      await this.flow.processNewSignal(outcome.signalId);
    }
  }
}
