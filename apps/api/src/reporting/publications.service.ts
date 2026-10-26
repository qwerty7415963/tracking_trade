import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { payloadRowId } from "../signals/signals.service";
import {
  CardKind,
  DEFAULT_CARD_KIND,
  isCardKind,
  PositionSnapshot,
} from "@tracking-auto/card-renderer";
import {
  buildPostLink,
  crossLiquidationPrice,
  crossMarginRatio,
  effectiveMmrFor,
} from "@tracking-auto/domain";
import { MarketDataService } from "../market-data/market-data.service";

/** Max wait for the original card before an update posts standalone. */
export const ORIGINAL_HOLD_MS = 5 * 60 * 1000;
import {
  RENDER_JOB_ID_PREFIX,
  RendersService,
  SendJobData,
} from "./renders.service";

export const TELEGRAM_SENDER = "TELEGRAM_SENDER";

export interface TelegramSendResult {
  ok: boolean;
  telegramMessageId: string | null;
  unknown: boolean;
}

export interface TelegramSender {
  sendPhoto(input: {
    chatId: string;
    photo: Buffer;
    caption: string;
    replyToMessageId?: string;
  }): Promise<TelegramSendResult>;
}

/** Minimal Bot API sender (sendPhoto). Retries live in the publish queue. */
export class BotApiSender implements TelegramSender {
  constructor(private readonly token: string) {}

  async sendPhoto(input: {
    chatId: string;
    photo: Buffer;
    caption: string;
    replyToMessageId?: string;
  }): Promise<TelegramSendResult> {
    if (!this.token) throw new Error("TELEGRAM_PUBLISH_FAILED: missing bot token");
    if (input.caption.length > 1024) {
      throw new Error("TELEGRAM_PUBLISH_FAILED: caption over 1024 chars");
    }
    const form = new FormData();
    form.set("chat_id", input.chatId);
    form.set("photo", new Blob([new Uint8Array(input.photo)], { type: "image/png" }), "card.png");
    form.set("caption", input.caption);
    form.set("parse_mode", "HTML");
    if (input.replyToMessageId) form.set("reply_to_message_id", input.replyToMessageId);
    let res: Response;
    try {
      res = await fetch(`https://api.telegram.org/bot${this.token}/sendPhoto`, {
        method: "POST",
        body: form,
      });
    } catch {
      return { ok: false, telegramMessageId: null, unknown: true };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429 || res.status >= 500) {
        return { ok: false, telegramMessageId: null, unknown: false };
      }
      throw new Error(`TELEGRAM_PUBLISH_FAILED: ${res.status} ${text.slice(0, 200)}`);
    }
    const body = (await res.json()) as { ok: boolean; result?: { message_id: number } };
    if (!body.ok || !body.result) return { ok: false, telegramMessageId: null, unknown: true };
    return { ok: true, telegramMessageId: String(body.result.message_id), unknown: false };
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export type CardStatus = "filled" | "entry" | "tp" | "sl" | "close";

export interface PositionPublishRequest {
  positionId: string;
  status: CardStatus;
  markPrice: number;
  destinationChatId?: string;
  replyToMessageId?: string;
}

/** Caption exactly per template #11 (docs/07-reporting). */
export function buildOpenCaption(input: {
  direction: "LONG" | "SHORT";
  instrument: string;
  status: string;
  entry: string;
  stopLoss: string;
  takeProfit: string;
  sourceDisplayName: string;
  sourceUrl: string | null;
}): string {
  const direction = input.direction === "LONG" ? "Long" : "Short";
  const lines = [
    `${escapeHtml(direction)} ${escapeHtml(input.instrument)} - ${escapeHtml(input.status)}`,
    "",
    `- Entry: ${escapeHtml(input.entry)}`,
    `- SL: ${escapeHtml(input.stopLoss)}`,
    `- TP: ${escapeHtml(input.takeProfit)}`,
    "",
    escapeHtml(input.sourceDisplayName),
  ];
  // No URL (operator-created signals): name the source, never invent a link.
  if (input.sourceUrl) {
    lines.push("", escapeHtml(input.sourceUrl));
  }
  return lines.join("\n");
}

/** ` (đã khớp 2/3 lệnh)` for multi-entry rows; empty for single-level ones. */
function entryFillNote(position: { entries: unknown; pendingEntries: unknown }): string {
  const total = Array.isArray(position.entries) ? position.entries.length : 0;
  const pending = Array.isArray(position.pendingEntries) ? position.pendingEntries.length : 0;
  if (total < 2) return "";
  return ` (đã khớp ${Math.max(0, total - pending)}/${total} lệnh)`;
}

/**
 * Every TP in order; the first `hitCount` levels carry `(đã khớp TPn)`.
 * Count-based because a `tp` card publishes BEFORE the slice closes (settle
 * order: card first), so its own TP comes from `tpIndex` — `filledTps` would
 * only show the previous ones. Duplicate prices stay distinguishable.
 */
function takeProfitList(tps: number[], hitCount: number): string {
  return tps
    .map((tp, i) => (i < hitCount ? `${tp} (đã khớp TP${i + 1})` : String(tp)))
    .join(", ");
}

function decimals(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

function asNumber(value: unknown): number {
  return value instanceof Object && "toNumber" in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value);
}

function displayBase(coin: string): string {
  return coin.includes(":") ? coin.split(":").slice(-1)[0] : coin;
}

@Injectable()
export class PublicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(TELEGRAM_SENDER) private readonly sender: TelegramSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(RendersService) private readonly renders: RendersService,
    private readonly marketData: MarketDataService,
  ) {}

  async requestPositionPublish(
    positionId: string,
    status: CardStatus,
    opts: {
      /** Omit for open cards so the worker resolves the live mark at render time. */
      markPrice?: number;
      destinationChatId?: string;
      replyToMessageId?: string;
      /** Persist + render this card style; omit to inherit the position's. */
      cardKind?: CardKind;
      /** Freeze this size on the card instead of the position's total size. */
      volume?: number;
      /** Override snapshot status (partial manual exit stays OPEN). */
      open?: boolean;
      /** Hold the render job (the /pos style dialog waits 5 minutes). */
      renderDelayMs?: number;
      /** TP ordinal for `tp` cards — the caption marks that level as hit. */
      tpIndex?: number;
    },
    actor: string,
  ) {
    const destination = (opts.destinationChatId ?? this.config.reportDestinationChatId ?? "").trim();
    if (!destination) {
      throw new Error("PUBLICATION_VALIDATION_FAILED: no destination chat configured");
    }
    let replyTo = opts.replyToMessageId;
    if (!replyTo) {
      const original = await this.prisma.telegramPublication.findFirst({
        where: { virtualPositionId: positionId, publicationStatus: "PUBLISHED" },
        orderBy: { publishedAt: "asc" },
      });
      replyTo = original?.telegramMessageId ?? undefined;
    }
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id: positionId },
      select: { cardKind: true, size: true },
    });
    let cardKind: CardKind;
    if (opts.cardKind) {
      cardKind = opts.cardKind;
      await this.prisma.virtualPosition.update({
        where: { id: positionId },
        data: { cardKind },
      });
    } else {
      cardKind = isCardKind(position?.cardKind) ? position.cardKind : DEFAULT_CARD_KIND;
    }
    const publication = await this.prisma.telegramPublication.create({
      data: { virtualPositionId: positionId, publicationStatus: "PENDING" },
    });
    await this.renders.requestRender(
      {
        virtualPositionId: positionId,
        ...(opts.markPrice !== undefined ? { markPrice: opts.markPrice } : {}),
        publicationId: publication.id,
        status,
        destinationChatId: destination,
        replyToMessageId: replyTo,
        actor,
        cardKind,
        // Freeze the open size so the card still renders if the position
        // closes before the (possibly delayed) render runs.
        ...(opts.volume !== undefined
          ? { volume: opts.volume }
          : position
            ? { volume: asNumber(position.size) }
            : {}),
        ...(opts.open !== undefined ? { open: opts.open } : {}),
        ...(opts.renderDelayMs && opts.renderDelayMs > 0 ? { delayMs: opts.renderDelayMs } : {}),
        ...(opts.tpIndex !== undefined ? { tpIndex: opts.tpIndex } : {}),
      },
      actor,
      `${RENDER_JOB_ID_PREFIX}${publication.id}`,
    );
    await this.audit.record(actor, "publication.requested", {
      publicationId: publication.id,
      cardKind,
      ...(opts.renderDelayMs ? { renderDelayMs: opts.renderDelayMs } : {}),
    });
    return { publicationId: publication.id, status: "PENDING", cardKind };
  }

  /**
   * /pos style dialog: persist the operator's card choice on the position
   * (source for TP/SL inheritance) and promote the still-delayed render
   * job. "expired" = the 5-minute window passed (default card rendered).
   *
   * Every pending publication of the position is offered to the renderer:
   * a TP/SL card enqueued mid-dialog is newer but not the dialog job.
   */
  async chooseCardStyle(
    positionId: string,
    cardKind: CardKind,
    actor: string,
  ): Promise<"promoted" | "expired"> {
    const publications = await this.prisma.telegramPublication.findMany({
      where: { virtualPositionId: positionId, publicationStatus: { in: ["PENDING", "RETRY_PENDING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (publications.length === 0) return "expired";
    const { outcome } = await this.renders.promoteFirstDelayed(
      publications.map((row) => row.id),
      cardKind,
      actor,
    );
    if (outcome === "promoted") {
      await this.prisma.virtualPosition.update({
        where: { id: positionId },
        data: { cardKind },
      });
    }
    return outcome;
  }

  /**
   * Milliseconds left on the /pos style dialog still gating this position's
   * update cards (0 = no dialog waiting). The render consumer holds TP/SL/
   * close jobs for that long so they render the style actually chosen.
   */
  async styleDialogRemainingMs(positionId: string): Promise<number> {
    const rows = await this.prisma.telegramPublication.findMany({
      where: { virtualPositionId: positionId, publicationStatus: "PENDING" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
      take: 10,
    });
    if (rows.length === 0) return 0;
    return this.renders.dialogRemainingMs(rows.map((row) => row.id));
  }

  /** Recent FINAL_FAILURE publications (operator-bot failure notices). */
  async listRecentFailures(sinceMs: number) {
    const since = new Date(Date.now() - sinceMs);
    const rows = await this.prisma.telegramPublication.findMany({
      where: { publicationStatus: "FINAL_FAILURE", createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      include: { position: { select: { coin: true } } },
    });
    return rows.map((row) => ({
      publicationId: row.id,
      positionId: row.virtualPositionId,
      coin: row.position?.coin ?? null,
      reason: row.renderedText ?? null,
    }));
  }

  async getPublication(id: string) {
    const publication = await this.prisma.telegramPublication.findUnique({ where: { id } });
    if (!publication) throw new NotFoundException(`publication ${id} not found`);
    return publication;
  }

  /**
   * Send retries exhausted (consumer "failed" on the last attempt). Terminal
   * rows drive the operator bot's ❌ sweep; PUBLISHED rows are never downgraded.
   */
  async markSendFailed(publicationId: string, reason: string, actor: string): Promise<void> {
    const publication = await this.prisma.telegramPublication
      .findUnique({ where: { id: publicationId }, select: { publicationStatus: true } })
      .catch(() => null);
    if (!publication || publication.publicationStatus === "PUBLISHED") return;
    const code = (reason || "SEND_FAILED").split(":")[0].slice(0, 200);
    await this.prisma.telegramPublication
      .update({
        where: { id: publicationId },
        data: { publicationStatus: "FINAL_FAILURE", renderedText: code },
      })
      .catch(() => undefined);
    await this.audit.record(actor, "publication.failed", { publicationId, reason: code });
  }

  /** Build card data for a virtual position at an explicit mark. No rendering. */
  async buildSnapshot(
    positionId: string,
    markPrice: number,
    opts?: { status?: CardStatus; volume?: number; open?: boolean },
  ) {
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id: positionId },
      include: {
        account: { select: { name: true, marginType: true, balance: true } },
        signal: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 }, source: true } },
      },
    });
    if (!position) throw new NotFoundException(`position ${positionId} not found`);
    if (!Number.isFinite(markPrice)) throw new ConflictException("INVALID markPrice: refusing to guess");
    const version = position.signal?.versions[0];
    const rowId = payloadRowId(version?.normalizedPayloadJson);
    const sourceMessage = rowId
      ? await this.prisma.sourceMessage.findUnique({
          where: { id: rowId },
          include: { source: true },
        })
      : null;
    // Freeze the open size: the open card must stay renderable even after the
    // position closes (its `remainingSize` hits 0). Update cards (tp/sl/close)
    // render as CLOSED.
    const volume = opts?.volume ?? asNumber(position.size);
    const isOpen =
      opts?.open ?? (!opts?.status || opts.status === "filled" || opts.status === "entry");
    const entry = asNumber(position.entryPrice);
    const floating =
      (position.direction === "LONG" ? 1 : -1) * (markPrice - entry) * volume;
    // Account-level cross margin ratio, same formula as /accounts: total
    // maintenance margin (tiered MMR) over equity across all positions.
    const balance = asNumber(position.account?.balance);
    let accountMarginRatio: number | null = null;
    let liquidation: number | null = null;
    if (position.account && Number.isFinite(balance)) {
      const opens = await this.prisma.virtualPosition.findMany({
        where: { accountId: position.accountId, status: { in: ["OPEN", "TP_HIT"] } },
      });
      const mids = await this.marketData.getAllMids().catch(() => null);
      const otherPriced = opens
        .filter((p) => p.id !== position.id)
        .map((p) => ({
          coin: p.coin,
          direction: p.direction as "LONG" | "SHORT",
          size: asNumber(p.remainingSize),
          entryPrice: asNumber(p.entryPrice),
          leverage: p.leverage,
        }));
      // Keep the card self-consistent: count THIS position at the frozen
      // request size (not its live remaining size), so a card rendered after
      // the position closed or partially TP'd still shows a ratio matching the
      // size/margin printed on the card.
      const currentPriced = {
        coin: position.coin,
        direction: (position.direction === "SHORT" ? "SHORT" : "LONG") as
          | "LONG"
          | "SHORT",
        size: Math.abs(volume),
        entryPrice: entry,
        leverage: position.leverage,
      };
      const priced = [...otherPriced, currentPriced];
      const midsComplete =
        mids !== null &&
        priced.every(
          (p) => typeof mids[p.coin] === "number" && Number.isFinite(mids[p.coin]),
        );
      if (midsComplete) {
        accountMarginRatio = crossMarginRatio(balance, priced, mids);
        liquidation = crossLiquidationPrice(balance, currentPriced, otherPriced, mids);
      }
    }
    const snapshot: PositionSnapshot = {
      accountId: position.accountId,
      positionId: position.id,
      executionId: null,
      symbol: position.coin,
      displaySymbol: displayBase(position.coin),
      direction: position.direction === "SHORT" ? "SELL" : "BUY",
      volume,
      entryPrice: entry,
      currentPrice: markPrice,
      floatingProfit: floating,
      profitCurrency: "USDC",
      brokerSnapshotAt: new Date().toISOString(),
      snapshotId: `snap_${position.id}_${Date.now()}`,
      status: isOpen ? "OPEN" : "CLOSED",
      priceDigits: decimals(entry),
      volumeDigits: decimals(volume),
      // Position-stats card extras (pnl-strip ignores them).
      leverage: position.leverage,
      marginType: position.account?.marginType ?? null,
      accountName: position.account?.name ?? null,
      maintenanceMarginRate: effectiveMmrFor(
        position.coin,
        Math.abs(volume) * markPrice,
      ),
      accountMarginRatio,
      liquidationPrice: liquidation,
    };
    return { snapshot, position, signal: position.signal, version, sourceMessage };
  }

  /**
   * Send a worker-rendered card. Caption is built in the API from live DB
   * data; the PNG is read from the shared artifacts directory. Never touches
   * trading state.
   */
  async sendPublication(publicationId: string, request: SendJobData) {
    const publication = await this.getPublication(publicationId);
    if (publication.publicationStatus === "PUBLISHED") {
      // The row is already done; the PNG is no longer needed for retries.
      await this.renders.deleteArtifact(publicationId);
      return publication;
    }
    if (!request.destinationChatId.trim()) {
      throw new Error("PUBLICATION_VALIDATION_FAILED: no destination chat configured");
    }
    // Update cards (tp/sl/close) must thread under the original filled card.
    // Re-resolve at send time: the original may have published after request.
    // Hold (retryable) while fresh; post orphaned + audit past the timeout.
    let replyTo = request.replyToMessageId;
    if (!replyTo && request.status !== "filled") {
      const original = await this.prisma.telegramPublication.findFirst({
        where: { virtualPositionId: request.positionId, publicationStatus: "PUBLISHED" },
        orderBy: { publishedAt: "asc" },
      });
      if (original?.telegramMessageId) {
        replyTo = original.telegramMessageId;
      } else if (Date.now() - publication.createdAt.getTime() < ORIGINAL_HOLD_MS) {
        // Still waiting for the original card. Record the hold so this row
        // stops looking like an un-rendered card (it must not shadow the
        // /pos style dialog), then let the send job retry.
        if (publication.publicationStatus === "PENDING") {
          await this.prisma.telegramPublication.update({
            where: { id: publicationId },
            data: { publicationStatus: "RETRY_PENDING" },
          });
        }
        throw new Error("ORIGINAL_NOT_PUBLISHED_YET: retryable");
      } else {
        await this.audit.record(request.actor, "publication.orphaned", {
          publicationId,
          positionId: request.positionId,
        });
      }
    }
    const { position, signal, version, sourceMessage, snapshot } = await this.buildSnapshot(
      request.positionId,
      request.markPrice,
      { status: request.status },
    );
    const photo = await this.renders.readArtifact(publicationId);
    // Telegram ingestion never stores a URL: fall back to the canonical
    // t.me post link. X sources without URL still fail validation (review);
    // operator-created (MANUAL) signals may publish without any link.
    const sourceUrl =
      sourceMessage?.sourceUrl ??
      (sourceMessage
        ? buildPostLink(
            sourceMessage.source.platform,
            sourceMessage.source.externalSourceId,
            sourceMessage.externalMessageId,
          )
        : null);
    const isOperatorSource = sourceMessage?.source?.sourceKind === "MANUAL";
    if (!sourceUrl && !isOperatorSource) {
      throw new Error("PUBLICATION_VALIDATION_FAILED: missing required source_url");
    }
    const tps: number[] = Array.isArray(version?.takeProfits)
      ? (version.takeProfits as number[])
      : [];
    const filledTps = Array.isArray(position.filledTps) ? (position.filledTps as number[]) : [];
    // A `tp` card knows the ordinal it is about (it publishes before the
    // close); every other card annotates the TPs already in filledTps.
    const hitCount = Math.min(
      tps.length,
      request.tpIndex !== undefined ? request.tpIndex + 1 : filledTps.length,
    );
    const caption = buildOpenCaption({
      direction: position.direction === "SHORT" ? "SHORT" : "LONG",
      instrument: snapshot.displaySymbol,
      // A DCA fill card reads "filled": the template vocabulary stays
      // limit/filled/tp/sl/close and the entry note carries the ladder.
      status: request.status === "entry" ? "filled" : request.status,
      entry: String(snapshot.entryPrice) + entryFillNote(position),
      stopLoss: position.stopLoss === null ? "" : String(asNumber(position.stopLoss)),
      takeProfit: takeProfitList(tps, hitCount),
      sourceDisplayName: signal?.source.displayName ?? "unknown source",
      sourceUrl,
    });

    const sent = await this.sender.sendPhoto({
      chatId: request.destinationChatId,
      photo,
      caption,
      replyToMessageId: replyTo,
    });
    if (!sent.ok && sent.unknown) {
      await this.prisma.telegramPublication.update({
        where: { id: publicationId },
        data: { publicationStatus: "UNKNOWN", renderedText: caption },
      });
      await this.audit.record(request.actor, "publication.unknown", { publicationId });
      return { status: "UNKNOWN" as const };
    }
    if (!sent.ok) {
      await this.prisma.telegramPublication.update({
        where: { id: publicationId },
        data: { publicationStatus: "RETRY_PENDING", renderedText: caption },
      });
      throw new Error("TELEGRAM_PUBLISH_FAILED: retryable");
    }
    const updated = await this.prisma.telegramPublication.update({
      where: { id: publicationId },
      data: {
        senderAccountId: null,
        destinationChannelName: request.destinationChatId,
        sourceDisplayName: signal?.source.displayName,
        sourceUrl: sourceMessage?.sourceUrl,
        renderedText: caption,
        telegramMessageId: sent.telegramMessageId,
        publicationStatus: "PUBLISHED",
        publishedAt: new Date(),
      },
    });
    // The card has been sent and the row is terminal-success; the PNG is no
    // longer needed for retries, so drop it immediately instead of waiting
    // for a periodic mtime sweep. Best-effort: a failed unlink leaves the
    // publication PUBLISHED.
    await this.renders.deleteArtifact(publicationId);
    await this.audit.record(request.actor, "publication.published", {
      publicationId,
      telegramMessageId: sent.telegramMessageId,
    });
    return updated;
  }
}
