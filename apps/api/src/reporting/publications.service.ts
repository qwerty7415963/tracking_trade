import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Queue } from "bullmq";
import Redis from "ioredis";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { BrokerStateService } from "../bridge/broker-state.service";
import { REDIS_CLIENT } from "../queue/redis.provider";
import {
  FloatingPnLCardRenderer,
  PositionSnapshot,
} from "@tracking-auto/card-renderer";
import { chromium } from "playwright";
import { PUBLISH_QUEUE_NAME, RendersService } from "./renders.service";

export const CARD_RENDERER = "CARD_RENDERER";
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

export interface PublishRequest {
  executionId: string;
  destinationChatId: string;
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

@Injectable()
export class PublicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brokerState: BrokerStateService,
    @Inject(CARD_RENDERER) private readonly renderer: FloatingPnLCardRenderer,
    @Inject(TELEGRAM_SENDER) private readonly sender: TelegramSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(RendersService) private readonly renders: RendersService,
  ) {}

  async requestPublish(request: PublishRequest, actor: string) {
    const queue = new Queue(PUBLISH_QUEUE_NAME, { connection: this.redis });
    try {
      const publication = await this.prisma.telegramPublication.create({
        data: { executionId: request.executionId, publicationStatus: "PENDING" },
      });
      const job = await queue.add("publish", { ...request, publicationId: publication.id },
        {
          attempts: 5,
          backoff: { type: "exponential", delay: 5000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
      await this.audit.record(actor, "publication.requested", {
        publicationId: publication.id,
        jobId: job.id,
      });
      return { publicationId: publication.id, status: "PENDING" };
    } finally {
      await queue.close();
    }
  }

  async getPublication(id: string) {
    const publication = await this.prisma.telegramPublication.findUnique({ where: { id } });
    if (!publication) throw new NotFoundException(`publication ${id} not found`);
    return publication;
  }

  /** Build a verified snapshot and render the card. Read-only for trading. */
  async renderExecutionCard(executionId: string, snapshotId: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id: executionId },
    });
    if (!execution) throw new NotFoundException(`execution ${executionId} not found`);
    const command = await this.prisma.executionCommand.findUnique({
      where: { id: execution.executionCommandId },
    });
    if (!command) throw new NotFoundException("execution command not found");

    const signal = command.signalId
      ? await this.prisma.signal.findUnique({
          where: { id: command.signalId },
          include: {
            versions: { orderBy: { versionNumber: "desc" }, take: 1 },
            source: true,
          },
        })
      : null;
    const version = signal?.versions[0];
    const sourceMessage = version
      ? await this.prisma.sourceMessage.findFirst({
          where: {
            sourceId: signal?.sourceId,
            externalMessageId: (
              version.normalizedPayloadJson as { source_message_id?: string } | null
            )?.source_message_id,
          },
        })
      : null;

    const accountId = command.accountId || this.config.mt5AccountId;
    const positions = await this.brokerState.positions(accountId);
    const position = positions.find((p) => p.positionId === execution.brokerPositionId);
    if (!position) throw new ConflictException("POSITION_NOT_OPEN: nothing to render");
    if (position.profit === null || position.profit === undefined) {
      throw new ConflictException("MISSING_REQUIRED_FIELD: broker did not provide P&L");
    }
    if (position.currentPrice === null || position.currentPrice === undefined) {
      throw new ConflictException("MISSING_REQUIRED_FIELD: broker did not provide quote");
    }
    const entry = execution.fillPrice ? Number(execution.fillPrice) : Number(version?.entry ?? NaN);
    const priceDigits = decimals(Number.isFinite(entry) ? entry : position.openPrice);
    const snapshot: PositionSnapshot = {
      accountId,
      positionId: position.positionId,
      executionId: execution.id,
      symbol: position.symbol,
      displaySymbol: position.symbol.replace(/\.a$/, ""),
      direction: position.direction === "SHORT" ? "SELL" : "BUY",
      volume: position.volume,
      entryPrice: Number.isFinite(entry) ? entry : position.openPrice,
      currentPrice: position.currentPrice,
      floatingProfit: position.profit,
      profitCurrency: "USD",
      brokerSnapshotAt: new Date().toISOString(),
      snapshotId,
      status: "OPEN",
      priceDigits,
      volumeDigits: decimals(position.volume),
    };

    const rendered = await this.renderer.render(snapshot);
    if (!rendered.ok) throw new ConflictException(`render failed: ${rendered.code}`);
    return { snapshot, artifact: rendered.artifact, execution, command, signal, version, sourceMessage };
  }

  /** Render + send inline. Called by the worker; never touches execution state. */
  async publishNow(
    publicationId: string,
    request: PublishRequest,
    actor: string,
  ) {
    let card: Awaited<ReturnType<PublicationsService["renderExecutionCard"]>>;
    try {
      card = await this.renderExecutionCard(request.executionId, `snap_${publicationId}`);
    } catch (err) {
      const code = err instanceof Error ? err.message.split(":")[0] : "UNKNOWN";
      await this.prisma.telegramPublication.update({
        where: { id: publicationId },
        data: { publicationStatus: "FINAL_FAILURE", renderedText: code },
      });
      throw err;
    }
    const { artifact, execution, signal, version, sourceMessage, snapshot } = card;
    await this.renders.saveArtifact({
      renderId: `pub_${publicationId}`,
      snapshotId: snapshot.snapshotId,
      accountId: snapshot.accountId,
      positionId: snapshot.positionId,
      executionId: snapshot.executionId,
      png: artifact.png,
      contentHash: artifact.contentHash,
      width: artifact.width,
      height: artifact.height,
      templateVersion: artifact.templateVersion,
    });

    const caption = buildOpenCaption({
      direction: version?.direction === "SHORT" ? "SHORT" : "LONG",
      instrument: snapshot.displaySymbol,
      status: "filled",
      entry: String(snapshot.entryPrice),
      stopLoss: execution.actualSl ? String(Number(execution.actualSl)) : "",
      takeProfit: execution.actualTp ? String(Number(execution.actualTp)) : "",
      sourceDisplayName: signal?.source.displayName ?? "unknown source",
      sourceUrl: sourceMessage?.sourceUrl ?? null,
    });

    const sent = await this.sender.sendPhoto({
      chatId: request.destinationChatId,
      photo: artifact.png,
      caption,
      replyToMessageId: request.replyToMessageId,
    });
    if (!sent.ok && sent.unknown) {
      await this.prisma.telegramPublication.update({
        where: { id: publicationId },
        data: { publicationStatus: "UNKNOWN", renderedText: caption },
      });
      await this.audit.record(actor, "publication.unknown", { publicationId });
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
    await this.audit.record(actor, "publication.published", {
      publicationId,
      telegramMessageId: sent.telegramMessageId,
    });
    return updated;
  }

}

export function createDefaultRenderer(): FloatingPnLCardRenderer {
  // Import only; the browser launches on first render, never in unit tests.
  return new FloatingPnLCardRenderer(() => chromium.launch());
}
