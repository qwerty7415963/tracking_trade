import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { createHash } from "crypto";
import { Prisma, Source } from "@prisma/client";
import { TelegramClient } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { NewMessage } from "teleproto/events";
import {
  ChannelInvalidError,
  ChannelPrivateError,
  ChatAdminInviteRequiredError,
  FloodWaitError,
  InviteHashExpiredError,
  InviteHashInvalidError,
  PeerFloodError,
  SessionExpiredError,
  SessionRevokedError,
  SlowModeWaitError,
  UnauthorizedError,
  UsernameInvalidError,
  UsernameNotOccupiedError,
} from "teleproto/errors";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { PrismaService } from "../database/prisma.service";

export interface TelegramMessageInput {
  id: string;
  text: string;
  date?: Date;
  authorId?: string;
  authorName?: string;
  replyToId?: string;
  url?: string;
}

export interface TelegramPort {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  fetchLatest(channel: string, limit: number): Promise<TelegramMessageInput[]>;
  subscribe(channel: string, handler: (msg: TelegramMessageInput) => Promise<void>): void;
}

export type TelegramPortFactory = (apiId: number, apiHash: string, session: string) => TelegramPort;

export const TELEGRAM_PORT_FACTORY = "TELEGRAM_PORT_FACTORY";

export interface IngestResult {
  deduplicated: boolean;
  id: string | null;
}

export function defaultPortFactory(apiId: number, apiHash: string, session: string): TelegramPort {
  const client = new TelegramClient(new StringSession(session), apiId, apiHash, {
    connectionRetries: 3,
  });
  return {
    async connect(): Promise<void> {
      await client.connect();
    },
    async disconnect(): Promise<void> {
      await client.disconnect();
    },
    async fetchLatest(channel: string, limit: number): Promise<TelegramMessageInput[]> {
      const messages = await client.getMessages(channel, { limit });
      return messages.map(mapMessage);
    },
    subscribe(channel: string, handler: (msg: TelegramMessageInput) => Promise<void>): void {
      client.addEventHandler(
        async (event) => {
          await handler(mapMessage(event.message as unknown as Parameters<typeof mapMessage>[0]));
        },
        new NewMessage({ chats: [channel] }),
      );
    },
  };
}

function mapMessage(m: {
  id: unknown;
  message?: unknown;
  date?: unknown;
  senderId?: unknown;
  senderName?: unknown;
  replyTo?: { replyToMsgId?: unknown };
}): TelegramMessageInput {
  return {
    id: String(m.id),
    text: typeof m.message === "string" ? m.message : "",
    date: typeof m.date === "number" ? new Date(m.date * 1000) : undefined,
    authorId: safeString(m.senderId),
    authorName: safeString(m.senderName),
    replyToId: safeString(m.replyTo?.replyToMsgId),
    url: undefined,
  };
}

function safeString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function mapCollectionError(err: unknown): string {
  if (
    err instanceof FloodWaitError ||
    err instanceof PeerFloodError ||
    err instanceof SlowModeWaitError
  ) {
    return "JOIN_FLOOD_WAIT";
  }
  if (
    err instanceof SessionRevokedError ||
    err instanceof SessionExpiredError ||
    err instanceof UnauthorizedError
  ) {
    return "SESSION_REVOKED";
  }
  if (
    err instanceof InviteHashExpiredError ||
    err instanceof InviteHashInvalidError ||
    err instanceof ChatAdminInviteRequiredError
  ) {
    return "PRIVATE_NEED_INVITE";
  }
  if (
    err instanceof ChannelInvalidError ||
    err instanceof ChannelPrivateError ||
    err instanceof UsernameInvalidError ||
    err instanceof UsernameNotOccupiedError
  ) {
    return "NOT_A_MEMBER";
  }
  return "UNKNOWN_COLLECTION_ERROR";
}

@Injectable()
export class TelegramCollectorService implements OnModuleDestroy {
  private port: TelegramPort | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(TELEGRAM_PORT_FACTORY) private readonly portFactory: TelegramPortFactory = defaultPortFactory,
  ) {}

  credentials(): { apiId: number; apiHash: string; session: string } | null {
    const apiId = Number(process.env.TELEGRAM_API_ID ?? "");
    const apiHash = process.env.TELEGRAM_API_HASH ?? "";
    const session = process.env.TELEGRAM_SESSION_STRING ?? "";
    if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash || !session) return null;
    return { apiId, apiHash, session };
  }

  private async ensurePort(): Promise<TelegramPort | null> {
    if (this.port) return this.port;
    const creds = this.credentials();
    if (!creds) return null;
    const port = this.portFactory(creds.apiId, creds.apiHash, creds.session);
    await port.connect();
    this.port = port;
    return port;
  }

  async checkSource(source: Source): Promise<{ ok: boolean; code: string | null }> {
    try {
      const port = await this.ensurePort();
      if (!port) return { ok: false, code: "MISSING_CREDENTIALS" };
      await port.fetchLatest(source.externalSourceId, 1);
      return { ok: true, code: null };
    } catch (err) {
      this.resetPort();
      return { ok: false, code: mapCollectionError(err) };
    }
  }

  async ingestMessage(
    sourceId: string,
    input: TelegramMessageInput,
    revision = 1,
  ): Promise<IngestResult> {
    try {
      const row = await this.prisma.sourceMessage.create({
        data: {
          sourceId,
          externalMessageId: input.id,
          revision,
          contentRaw: input.text,
          authorId: input.authorId,
          authorName: input.authorName,
          sourceUrl: input.url,
          replyToMessageId: input.replyToId,
          sourceTimestamp: input.date,
          contentHash: hashContent(input.text),
        },
      });
      return { deduplicated: false, id: row.id };
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        return { deduplicated: true, id: null };
      }
      throw err;
    }
  }

  async backfill(
    source: Source,
    limit: number,
  ): Promise<{ ingested: number; deduplicated: number }> {
    const port = await this.ensurePort();
    if (!port) throw new Error("MISSING_CREDENTIALS");
    const messages = await port.fetchLatest(source.externalSourceId, limit);
    let ingested = 0;
    let deduplicated = 0;
    for (const m of messages) {
      const result = await this.ingestMessage(source.id, m);
      if (result.deduplicated) deduplicated += 1;
      else ingested += 1;
    }
    return { ingested, deduplicated };
  }

  async subscribeNewMessages(
    channel: string,
    handler: (msg: TelegramMessageInput) => Promise<void>,
  ): Promise<void> {
    const port = await this.ensurePort();
    if (!port) throw new Error("MISSING_CREDENTIALS");
    port.subscribe(channel, handler);
  }

  private resetPort(): void {
    const port = this.port;
    this.port = null;
    if (port) void port.disconnect().catch(() => {});
  }

  async onModuleDestroy(): Promise<void> {
    this.resetPort();
  }
}
