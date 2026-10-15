import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { PositionSnapshot } from "@tracking-auto/card-renderer";
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

export type CardStatus = "filled" | "tp" | "sl" | "close";

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
  if (!input.sourceUrl) {
    throw new Error("PUBLICATION_VALIDATION_FAILED: missing required source_url");
  }
  const direction = input.direction === "LONG" ? "Long" : "Short";
  return [
    `${escapeHtml(direction)} ${escapeHtml(input.instrument)} - ${escapeHtml(input.status)}`,
    "",
    `- Entry: ${escapeHtml(input.entry)}`,
    `- SL: ${escapeHtml(input.stopLoss)}`,
    `- TP: ${escapeHtml(input.takeProfit)}`,
    "",
    escapeHtml(input.sourceDisplayName),
    "",
    escapeHtml(input.sourceUrl),
  ].join("\n");
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
  ) {}

  async requestPositionPublish(
    positionId: string,
    status: CardStatus,
    opts: { markPrice: number; destinationChatId?: string; replyToMessageId?: string },
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
    const publication = await this.prisma.telegramPublication.create({
      data: { virtualPositionId: positionId, publicationStatus: "PENDING" },
    });
    await this.renders.requestRender(
      {
        virtualPositionId: positionId,
        markPrice: opts.markPrice,
        publicationId: publication.id,
        status,
        destinationChatId: destination,
        replyToMessageId: replyTo,
        actor,
      },
      actor,
      `${RENDER_JOB_ID_PREFIX}${publication.id}`,
    );
    await this.audit.record(actor, "publication.requested", {
      publicationId: publication.id,
    });
    return { publicationId: publication.id, status: "PENDING" };
  }

  async getPublication(id: string) {
    const publication = await this.prisma.telegramPublication.findUnique({ where: { id } });
    if (!publication) throw new NotFoundException(`publication ${id} not found`);
    return publication;
  }

  /** Build card data for a virtual position at an explicit mark. No rendering. */
  async buildSnapshot(positionId: string, markPrice: number, volumeOverride?: number) {
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id: positionId },
      include: {
        signal: { include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 }, source: true } },
      },
    });
    if (!position) throw new NotFoundException(`position ${positionId} not found`);
    if (!Number.isFinite(markPrice)) throw new ConflictException("INVALID markPrice: refusing to guess");
    const version = position.signal?.versions[0];
    const sourceMessage = version
      ? await this.prisma.sourceMessage.findFirst({
          where: {
            sourceId: position.signal?.sourceId,
            externalMessageId: (
              version.normalizedPayloadJson as { source_message_id?: string } | null
            )?.source_message_id,
          },
        })
      : null;
    const volume = volumeOverride ?? asNumber(position.remainingSize);
    const entry = asNumber(position.entryPrice);
    const floating =
      (position.direction === "LONG" ? 1 : -1) * (markPrice - entry) * volume;
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
      status: volume > 0 ? "OPEN" : "CLOSED",
      priceDigits: decimals(entry),
      volumeDigits: decimals(volume),
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
    if (publication.publicationStatus === "PUBLISHED") return publication;
    if (!request.destinationChatId.trim()) {
      throw new Error("PUBLICATION_VALIDATION_FAILED: no destination chat configured");
    }
    const { position, signal, version, sourceMessage, snapshot } = await this.buildSnapshot(
      request.positionId,
      request.markPrice,
    );
    const photo = await this.renders.readArtifact(publicationId);
    const tps: number[] = Array.isArray(version?.takeProfits)
      ? (version.takeProfits as number[])
      : [];
    const caption = buildOpenCaption({
      direction: position.direction === "SHORT" ? "SHORT" : "LONG",
      instrument: snapshot.displaySymbol,
      status: request.status,
      entry: String(snapshot.entryPrice),
      stopLoss: position.stopLoss === null ? "" : String(asNumber(position.stopLoss)),
      takeProfit: tps.length > 0 ? String(tps[tps.length - 1]) : "",
      sourceDisplayName: signal?.source.displayName ?? "unknown source",
      sourceUrl: sourceMessage?.sourceUrl ?? null,
    });

    const sent = await this.sender.sendPhoto({
      chatId: request.destinationChatId,
      photo,
      caption,
      replyToMessageId: request.replyToMessageId,
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
    await this.audit.record(request.actor, "publication.published", {
      publicationId,
      telegramMessageId: sent.telegramMessageId,
    });
    return updated;
  }
}
