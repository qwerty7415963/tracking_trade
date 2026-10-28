import { ConflictException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { randomBytes } from "crypto";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { SignalUpdatesService } from "../signals/signal-updates.service";
import { isCardKind } from "@tracking-auto/card-renderer";
import { CARD_STYLE_TIMEOUT_MS, PublicationsService } from "../reporting/publications.service";
import { SignalsService, extractSourceUrl, payloadRowId } from "../signals/signals.service";
import { ApprovalFlowService } from "./approval-flow.service";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";
import { OpenModeService } from "./open-mode.service";
import { CoinsService } from "../coins/coins.service";
import { SOURCE_KINDS } from "../sources/dto/source.dto";
import { SourcesService } from "../sources/sources.service";

interface TgUser {
  id: number;
  username?: string;
}

interface TgChat {
  id: number;
  type: string;
}

interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
}

interface TgCallback {
  id: string;
  from: TgUser;
  message?: TgMessage;
  data?: string;
}

interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallback;
}

export interface ParsedCommand {
  name: string;
  args: string[];
}

export function parseCommand(text: string | undefined): ParsedCommand | null {
  if (!text || !text.startsWith("/")) return null;
  const [raw, ...args] = text.trim().split(/\s+/);
  const name = raw.slice(1).split("@")[0].toLowerCase();
  return { name, args };
}

export function isOperator(username: string | undefined, allowlist: string[]): boolean {
  if (!username) return false;
  return allowlist.includes(username.toLowerCase());
}

const HELP = [
  "/pos <signal text + post link> [src=\"..\"] [chat=..] [acc=..] [vol=amount] - create + approve + pick card, publish",
  "/account_create <name> <balance> [leverage] [mode] - create a virtual account",
  "/approve <signalId> - approve + open paper position",
  "/reject <signalId> [reason] - reject a signal",
  "/open <signalId> [accountId] - retry open for approved signal",
  "/close <positionId> - close position at market",
  "/tp <positionId> [size|percent|all] - take profit now at market (default all)",
  "/sl <positionId> <price> - move stop loss for an open position",
  "/positions [status] - list virtual positions",
  "/accounts - list all virtual accounts",
  "/account [id] - account summary (equity, margin, PnL)",
  "/mode [auto|approve] [accountId] - get/set per-account open mode",
  "/openmode [manual|auto] - get/set global open switch",
  "/deposit <accountId> <amount> - add virtual funds",
  "/withdraw <accountId> <amount> - remove virtual funds",
  "/reset <accountId> <balance> - close all + reset balance",
  "/review - pending review queue",
  "/sources - list followed channels",
  "/source_add - add channels (1 per line after command)",
  "/source_del - delete channels (1 per line, handle or id)",
  "/source_edit <handle|id> name=.. kind=.. priority=.. - edit channel",
  "/source_enable|/source_disable <handle|id> [...] - toggle channels",
  "/source_health <handle|id> [...] - show stored channel health",
  "/coins - list tradable coins",
  "/coin_add - add coins (1 per line after command)",
  "/coin_del - delete coins (1 per line)",
  "/coin_enable|/coin_disable <SYM> [...] - toggle coins",
  "/vol [SYM] [amount|reset] - view/set fixed position notional (USDC)",
  "/cancel - abort a pending manual completion",
  "/help - this message",
].join("\n");

/** Manual-completion input waits 5 minutes for the operator's reply. */
const FILL_TIMEOUT_MS = 5 * 60 * 1000;
/** Candidate-pick nonces live 15 minutes (callback_data 64-byte limit). */
const PICK_TTL_MS = 15 * 60 * 1000;
/** Max review items per /review side (5 signals + 5 updates). */
const REVIEW_PAGE = 5;

/** Lines after the /command line: one item per line, blanks ignored. */
export function commandLines(rawText: string | undefined): string[] {
  if (!rawText) return [];
  return rawText
    .split("\n")
    .slice(1)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

/**
 * Tokens on the /command line. Quoted values keep spaces:
 * `/source_edit @chan name="My Channel" priority=1`.
 */
export function commandLineTokens(rawText: string | undefined): string[] {
  if (!rawText) return [];
  const withoutCommand = rawText.split("\n")[0].trim().replace(/^\/[^\s]+\s*/, "");
  const tokens =
    withoutCommand.match(/[^\s"']+="[^"]*"|[^\s"']+='[^']*'|"[^"]*"|'[^']*'|\S+/g) ?? [];
  return tokens.map((token) => {
    if (
      token.length >= 2 &&
      ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'")))
    ) {
      return token.slice(1, -1);
    }
    return token;
  });
}

/**
 * Flags pulled out of /pos free text: src="<channel name>",
 * chat=<destination>, acc=<accountId>. Quoted values keep spaces
 * (`src="Kaka trades"`). Post links are NOT flags — they stay in the text
 * and are auto-detected by extractSourceUrl inside createOperatorSignal.
 * Returns the remaining signal text with flags stripped.
 */
export function extractPosFlags(raw: string | undefined): {
  text: string;
  src: string | null;
  chat: string | null;
  acc: string | null;
  vol: string | null;
} {
  let text = raw ?? "";
  const pick = (key: string): string | null => {
    const re = new RegExp(`(^|\\s)${key}=("[^"]*"|'[^']*'|\\S+)`);
    const m = text.match(re);
    if (!m) return null;
    text = text.replace(re, " ");
    const value = m[2];
    const quote = value[0];
    if (value.length >= 2 && (quote === '"' || quote === "'") && value.endsWith(quote)) {
      return value.slice(1, -1);
    }
    return value;
  };
  const src = pick("src");
  const chat = pick("chat");
  const acc = pick("acc");
  let vol = pick("vol") ?? pick("volume");
  if (!vol) {
    const match = text.match(/(^|\s)vol(?:ume)?\s+(\d+(?:\.\d+)?)(?=\s|$)/i);
    if (match) {
      vol = match[2];
      text = text.replace(match[0], " ");
    }
  }
  // Strip the /pos command token itself (first token of the first line).
  text = text.replace(/(^|\s)\/[a-z_]+(@\w+)?/i, " ");
  return { text: text.replace(/\s+/g, " ").trim(), src, chat, acc, vol };
}

/** Shorten long original posts for review cards (Telegram 4096-char limit). */
export function truncateText(text: string, max = 800): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max).trimEnd()}…`;
}

export function displayOrDash(value: string | null | undefined): string {
  if (!value || value === "UNKNOWN") return "—";
  return value;
}

export function formatReviewReason(missing: string[], ambiguities: string[]): string {
  if (missing.length > 0) return `thiếu ${missing.join(", ")}`;
  if (ambiguities.length > 0) return ambiguities.join(", ");
  return "đủ field cơ bản";
}

export function formatReviewTime(iso: string | null | undefined): string {
  if (!iso) return "không rõ giờ";
  return iso.slice(0, 16).replace("T", " ");
}

/**
 * Real Telegram forward target. Only Telegram numeric message ids qualify;
 * X posts and non-numeric ids fall back to the stored-text copy in the card.
 */
export function forwardTarget(
  platform: string,
  sourceExternalId: string,
  externalMessageId: string,
): { chatId: string; messageId: number } | null {
  if (platform !== "TELEGRAM") return null;
  if (!/^\d+$/.test(externalMessageId)) return null;
  const handle = sourceExternalId.trim().replace(/^@+/, "");
  if (!handle) return null;
  const chatId = /^-?\d+$/.test(handle) ? handle : `@${handle}`;
  return { chatId, messageId: Number(externalMessageId) };
}

import { buildPostLink } from "@tracking-auto/domain";

/** Kept for existing callers/tests; canonical helper lives in domain. */
export const postLink = buildPostLink;

/**
 * Channel posts carry no sender (the channel itself is the author), so
 * author_name is NULL for most ingested posts. Fall back to the channel
 * name instead of showing "unknown".
 */
export function reviewAuthor(author: string | null | undefined, sourceName: string): string {
  if (author && author.trim()) return author.trim();
  if (sourceName && sourceName.trim()) return sourceName.trim();
  return "không rõ tác giả";
}

export interface SignalReviewInput {
  status: string;
  versionNumber: number | null;
  eventType: string | null;
  instrument: string | null;
  direction: string | null;
  orderType: string | null;
  entry: string | null;
  stopLoss: string | null;
  takeProfits: number[];
  leverage: string | null;
  missing: string[];
  ambiguities: string[];
  sourceName: string;
  platform: string;
  messageText: string | null;
  author: string | null;
  timestamp: string | null;
  url: string | null;
}

export function formatSignalReviewCard(input: SignalReviewInput): string {
  const lines = [
    `🔍 REVIEW — ${displayOrDash(input.direction)} ${displayOrDash(input.instrument)} [${input.status}${input.versionNumber ? ` v${input.versionNumber}` : ""}]`,
    `Lý do: ${formatReviewReason(input.missing, input.ambiguities)}`,
    `Entry: ${displayOrDash(input.entry)} | SL: ${displayOrDash(input.stopLoss)} | TP: ${input.takeProfits.length > 0 ? input.takeProfits.join(", ") : "—"}${input.leverage ? ` | Lev: ${input.leverage}x` : ""}`,
    `Nguồn: ${input.sourceName} (${input.platform}) • ${formatReviewTime(input.timestamp)}`,
  ];
  if (input.messageText && input.messageText.trim()) {
    lines.push(`Bài gốc (${reviewAuthor(input.author, input.sourceName)}):`, `"${truncateText(input.messageText)}"`);
  } else {
    lines.push("Bài gốc: không còn lưu trong DB.");
  }
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}

export interface UpdateReviewInput {
  action: string | null;
  validationStatus: string;
  confidence: string | null;
  reason: string | null;
  matchedSummary: string | null;
  sourceName: string;
  platform: string;
  messageText: string | null;
  author: string | null;
  timestamp: string | null;
  url: string | null;
}

export function formatUpdateReviewCard(input: UpdateReviewInput): string {
  const lines = [
    `🔍 REVIEW update — ${displayOrDash(input.action)} [${input.validationStatus}]`,
    `Khớp: ${input.matchedSummary ?? "chưa khớp signal nào"}`,
    `Lý do: ${input.reason ?? "—"}`,
    `Nguồn: ${input.sourceName} (${input.platform}) • ${formatReviewTime(input.timestamp)}`,
  ];
  if (input.messageText && input.messageText.trim()) {
    lines.push(`Bài gốc (${reviewAuthor(input.author, input.sourceName)}):`, `"${truncateText(input.messageText)}"`);
  } else {
    lines.push("Bài gốc: không còn lưu trong DB.");
  }
  if (input.url) lines.push(input.url);
  return lines.join("\n");
}

@Injectable()
export class OperatorBotService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private offset = 0;
  private readonly seen = new Set<string>();
  private readonly lastCommandAt = new Map<string, number>();
  private readonly pendingInput = new Map<string, { signalId: string; expiresAt: number }>();
  private readonly pickNonces = new Map<
    string,
    { updateId: string; signalId: string; expiresAt: number }
  >();
  /** positionId -> operator private chat, for card-failure notices. */
  private readonly publicationChat = new Map<string, number>();
  private readonly notifiedFailures = new Set<string>();
  private readonly failureSweepMs = 10 * 60 * 1000;
  private reviewTimer: ReturnType<typeof setInterval> | null = null;
  private bootedAt = new Date(0);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly audit: AuditService,
    private readonly signals: SignalsService,
    private readonly updates: SignalUpdatesService,
    private readonly flow: ApprovalFlowService,
    private readonly accounts: VirtualAccountsService,
    private readonly trading: VirtualTradingService,
    private readonly sources: SourcesService,
    private readonly coins: CoinsService,
    private readonly openMode: OpenModeService,
    private readonly publications: PublicationsService,
  ) {}

  private get token(): string {
    return process.env.TELEGRAM_BOT_TOKEN ?? "";
  }

  /** DM targets for review/alert notifications (fail-open list, may be empty). */
  private notifyTargets(): string[] {
    return this.config.operatorChatIds;
  }

  /** Fan-out to every operator DM; one blocked user must not break the rest. */
  private async notifyAll(text: string, replyMarkup?: unknown): Promise<void> {
    const targets = this.notifyTargets();
    if (targets.length === 0) {
      console.warn("[operator-bot] no OPERATOR_CHAT_IDS configured, notification dropped");
      return;
    }
    for (const chatId of targets) {
      try {
        await this.send(chatId, text, replyMarkup);
      } catch {
        // One failing target must never break the rest.
      }
    }
  }

  /**
   * Review fan-out: try a real Telegram forward of the original post first,
   * then always send the human-readable card with action buttons. A failed
   * forward (private channel, protected content, X source) falls back to the
   * stored-text copy already embedded in the card.
   */
  private async notifyReviewCard(
    forward: { chatId: string; messageId: number } | null,
    text: string,
    replyMarkup?: unknown,
  ): Promise<void> {
    const targets = this.notifyTargets();
    if (targets.length === 0) {
      console.warn("[operator-bot] no OPERATOR_CHAT_IDS configured, notification dropped");
      return;
    }
    for (const chatId of targets) {
      try {
        if (forward) {
          try {
            await this.api("forwardMessage", {
              chat_id: chatId,
              from_chat_id: forward.chatId,
              message_id: forward.messageId,
            });
          } catch {
            // Fall back to the stored-text copy in the card.
          }
        }
        await this.send(chatId, text, replyMarkup);
      } catch {
        // One failing target must never break the rest.
      }
    }
  }

  onModuleInit(): void {
    if (!this.token) {
      console.warn("[operator-bot] disabled: TELEGRAM_BOT_TOKEN not set");
      return;
    }
    if (!this.config.operatorBotEnabled) {
      console.warn("[operator-bot] disabled: OPERATOR_BOT_ENABLED is not true");
      return;
    }
    this.bootedAt = new Date();
    this.running = true;
    void this.sendBootDigest().catch(() => undefined);
    void this.pollLoop();
    this.reviewTimer = setInterval(() => {
      void this.pollReviews().catch(() => undefined);
      void this.pollPublicationFailures().catch(() => undefined);
    }, 30_000);
    this.reviewTimer.unref?.();
  }

  onModuleDestroy(): void {
    this.running = false;
    if (this.reviewTimer) clearInterval(this.reviewTimer);
  }

  // ------------------------------------------------------------ transport

  private async api<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`telegram api ${method} failed: ${res.status}`);
    const body = (await res.json()) as { ok: boolean; result: T };
    if (!body.ok) throw new Error(`telegram api ${method} not ok`);
    return body.result;
  }

  async pollOnce(): Promise<void> {
    const updates = await this.api<TgUpdate[]>("getUpdates", {
      offset: this.offset,
      timeout: 25,
      allowed_updates: ["message", "callback_query"],
    });
    for (const u of updates) {
      this.offset = Math.max(this.offset, u.update_id + 1);
      try {
        if (u.message) await this.handleMessage(u.message);
        else if (u.callback_query) await this.handleCallback(u.callback_query);
      } catch {
        // One bad update must never kill the loop.
      }
    }
  }

  private async pollLoop(): Promise<void> {
    let backoff = 1000;
    while (this.running) {
      try {
        await this.pollOnce();
        backoff = 1000;
      } catch {
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  private async send(chatId: number | string, text: string, replyMarkup?: unknown): Promise<void> {
    await this.api("sendMessage", { chat_id: chatId, text, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) });
  }

  /** Publish the update card for a manual TP/close; a card failure must not
   *  undo the ledger action, so it only reports the reason. */
  private async publishManualCard(
    positionId: string,
    status: "tp" | "close",
    opts: { markPrice?: number; volume: number; open: boolean },
    actor: string,
  ): Promise<string> {
    try {
      await this.publications.requestPositionPublish(positionId, status, opts, actor);
      return " Card published.";
    } catch (err) {
      const reason = err instanceof Error ? err.message.split(":")[0] : "error";
      return ` Card skipped: ${reason}.`;
    }
  }

  // ------------------------------------------------------------- messages

  async handleMessage(msg: TgMessage): Promise<void> {
    if (msg.chat?.type !== "private") return;
    const username = msg.from?.username;
    if (!isOperator(username, this.config.operatorUsernames)) return;
    const key = `${username}`.toLowerCase();
    const actor = `tg:${username}`;
    const reply = async (text: string, replyMarkup?: unknown) =>
      this.send(msg.chat.id, text, replyMarkup);
    const parsed = parseCommand(msg.text);
    if (!parsed) {
      // Plain-text reply: only meaningful as pending manual-completion input.
      const pending = this.pendingInput.get(key);
      if (pending) await this.handleFillInput(msg, pending, key, actor, reply);
      return;
    }
    // A fresh command supersedes any pending manual input.
    this.pendingInput.delete(key);
    const now = Date.now();
    if (now - (this.lastCommandAt.get(key) ?? 0) < 2000) {
      await this.send(msg.chat.id, "Too fast — wait a moment and retry.");
      return;
    }
    this.lastCommandAt.set(key, now);
    try {
      await this.dispatch(parsed, actor, reply, msg.text, msg.chat.id);
    } catch (err) {
      await reply(`Failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  async dispatch(
    parsed: ParsedCommand,
    actor: string,
    reply: (text: string, replyMarkup?: unknown) => Promise<void>,
    rawText?: string,
    chatId?: number | string,
  ): Promise<void> {
    const [a, b] = parsed.args;
    switch (parsed.name) {
      case "start":
      case "help":
        await reply(HELP);
        return;
      case "cancel":
        await reply("Đã hủy nhập liệu bổ sung (nếu có).");
        return;
      case "pos": {
        const flags = extractPosFlags(rawText);
        // Link-only input is not a signal: strip it before the usage check.
        if (!extractSourceUrl(flags.text).text) {
          await reply(
            [
              "Usage: /pos <signal text + post link> [src=\"..\"] [chat=..] [acc=..]",
              "Example: /pos LONG BTC @100000 SL 98000 TP 105000 lev 5 https://t.me/channel/123",
              "Paste the post link anywhere in the text — no url= needed (auto-detected).",
              "src = channel name (fallback e.g. src=\"Kaka trades\"), chat = destination, acc = account id",
            ].join("\n"),
          );
          return;
        }
        try {
          const created = await this.signals.createOperatorSignal(flags.text, actor, {
            sourceName: flags.src,
          });
          const marketEntryPollMs = created.entryMarket
            ? (this.config.posMarketEntryPollMs ?? 0)
            : 0;
          const marketEntryMaxWaitMs = created.entryMarket
            ? (this.config.posMarketEntryMaxWaitMs ?? 0)
            : 0;
          const marketCardMinAgeMs = created.entryMarket
            ? (this.config.posMarketCardMinAgeMs ?? 0)
            : 0;
          const marketCardPriceChangeMaxMs = created.entryMarket
            ? (this.config.posMarketCardPriceChangeMaxMs ?? 0)
            : 0;
          if (marketEntryMaxWaitMs > 0) {
            await reply(
              `Đang chờ giá thay đổi (tối đa ${marketEntryMaxWaitMs / 1000}s)…`,
            );
          }
          let targetNotional: number | undefined;
          if (flags.vol) {
            const parsedVol = Number(flags.vol);
            if (!Number.isFinite(parsedVol) || parsedVol <= 0) {
              await reply("vol must be a number > 0");
              return;
            }
            targetNotional = parsedVol;
          }
          const out = await this.flow.approveSignal(
            created.signalId,
            { signalVersionId: created.versionId },
            actor,
            flags.acc ?? undefined,
            flags.chat ?? undefined,
            {
              renderDelayMs: CARD_STYLE_TIMEOUT_MS,
              ...(marketEntryPollMs > 0 ? { marketEntryDelayMs: marketEntryPollMs } : {}),
              ...(marketEntryMaxWaitMs > 0 ? { marketEntryMaxWaitMs } : {}),
              ...(marketCardMinAgeMs > 0 ? { marketCardMinAgeMs } : {}),
              ...(marketCardPriceChangeMaxMs > 0 ? { marketCardPriceChangeMaxMs } : {}),
              ...(targetNotional !== undefined ? { targetNotional } : {}),
            },
          );
          if (out.position) {
            const pos = out.position as { id: string };
            if (chatId !== undefined) this.publicationChat.set(pos.id, Number(chatId));
            if (out.awaitingEntry) {
              await reply(
                `✅ ${created.direction} ${created.instrument} → lệnh chờ entry ${pos.id}\n` +
                  `Chọn loại card khi entry khớp (1 phút, hết giờ dùng card PnL):`,
                this.cardStyleKeyboard(pos.id),
              );
            } else if (out.published) {
              await reply(
                `✅ ${created.direction} ${created.instrument} → position ${pos.id}\n` +
                  `Chọn loại card đăng lên channel (1 phút, hết giờ dùng card PnL):`,
                this.cardStyleKeyboard(pos.id),
              );
            } else {
              await reply(
                `✅ ${created.direction} ${created.instrument} → position ${pos.id}\n` +
                  "Open OK, card skipped: no destination chat (set chat= or REPORT_DESTINATION_CHAT_ID).",
              );
            }
          } else {
            await reply(`⚠️ Approved but open failed: ${out.openError ?? "unknown"}`);
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          await reply(
            msg.includes("missing") || msg.includes("unknown coin")
              ? `❌ ${msg}`
              : `❌ /pos failed: ${msg}`,
          );
        }
        return;
      }
      case "approve": {
        if (!a) {
          await reply("Usage: /approve <signalId>");
          return;
        }
        const full = await this.signals.get(a);
        const latest = full.versions[0];
        if (!latest) {
          await reply("Signal has no versions.");
          return;
        }
        const out = await this.flow.approveSignal(a, { signalVersionId: latest.id }, actor);
        await reply(
          out.position
            ? `Approved + opened position ${(out.position as { id: string }).id}${out.published ? " (card publishing)" : " (card skipped)"}`
            : `Approved. Open failed: ${out.openError ?? "unknown"}`,
        );
        return;
      }
      case "reject": {
        if (!a) {
          await reply("Usage: /reject <signalId> [reason]");
          return;
        }
        const reason = parsed.args.slice(1).join(" ") || undefined;
        await this.signals.reject(a, { reason }, actor);
        await reply(`Signal ${a} rejected.`);
        return;
      }
      case "open": {
        if (!a) {
          await reply("Usage: /open <signalId> [accountId]");
          return;
        }
        const out = await this.flow.openSignal(a, b, actor);
        await reply(`Opened position ${(out.position as { id: string }).id}.`);
        return;
      }
      case "close": {
        if (!a) {
          await reply("Usage: /close <positionId>");
          return;
        }
        const r = (await this.trading.closePosition(a, actor)) as unknown as {
          closedSize: number;
          cancelled?: boolean;
          position: { closePrice: number | null };
        };
        if (r.cancelled) {
          await reply("Đã hủy lệnh chờ entry.");
          return;
        }
        const closePrice = Number(r.position.closePrice);
        const card = await this.publishManualCard(a, "close", {
          markPrice: Number.isFinite(closePrice) ? closePrice : undefined,
          volume: r.closedSize,
          open: false,
        }, actor);
        await reply(`Closed ${r.closedSize} @ ${JSON.stringify(r.position.closePrice)}.${card}`);
        return;
      }
      case "tp": {
        if (!a) {
          await reply("Usage: /tp <positionId> [size|percent|all]");
          return;
        }
        const arg = (b ?? "").trim().toLowerCase();
        const opts: { size?: number; percent?: number } = {};
        if (arg && arg !== "all") {
          if (arg.endsWith("%")) {
            const percent = Number(arg.slice(0, -1));
            if (!Number.isFinite(percent)) {
              await reply("Usage: /tp <positionId> [size|percent|all]");
              return;
            }
            opts.percent = percent;
          } else {
            const size = Number(arg);
            if (!Number.isFinite(size)) {
              await reply("Usage: /tp <positionId> [size|percent|all]");
              return;
            }
            opts.size = size;
          }
        }
        const r = await this.trading.takeProfitManual(a, opts, actor);
        const card = await this.publishManualCard(a, "tp", {
          markPrice: r.markPrice,
          volume: r.fullyClosed ? r.closedSize : r.remainingSize,
          open: !r.fullyClosed,
        }, actor);
        const head = r.fullyClosed ? "TP toàn bộ" : "TP một phần";
        await reply(
          `${head}: ${Number(r.closedSize.toFixed(6))} @ ${r.markPrice} → PnL ${r.realized.toFixed(2)}; còn ${Number(r.remainingSize.toFixed(6))}.${card}`,
        );
        return;
      }
      case "sl": {
        if (!a || !b) {
          await reply("Usage: /sl <positionId> <price>");
          return;
        }
        const price = Number(b);
        if (!Number.isFinite(price)) {
          await reply("Usage: /sl <positionId> <price>");
          return;
        }
        const r = await this.trading.updateStopLoss(a, price, actor);
        await reply(`SL ${r.old ?? "-"} → ${r.new}.`);
        return;
      }
      case "positions": {
        const rows = await this.trading.listPositions(a);
        if (rows.length === 0) {
          await reply("No positions.");
          return;
        }
        await reply(
          rows
            .slice(0, 10)
            .map(
              (p) =>
                `${p.id} ${p.coin} ${p.direction} ${String(p.remainingSize)} @ ${String(p.entryPrice)} [${p.status}]`,
            )
            .join("\n"),
        );
        return;
      }
      case "account_create": {
        const tokens = commandLineTokens(rawText);
        const [name, balanceRaw, leverageRaw, modeRaw] =
          tokens.length > 0 ? tokens : parsed.args;
        if (!name || !balanceRaw) {
          await reply("Usage: /account_create <name> <balance> [leverage] [mode]");
          return;
        }
        const balance = Number(balanceRaw);
        if (!Number.isFinite(balance) || balance < 0) {
          await reply("balance must be a number >= 0");
          return;
        }
        const leverage = leverageRaw ? Number(leverageRaw) : 10;
        if (!Number.isInteger(leverage) || leverage < 1 || leverage > 50) {
          await reply("leverage must be an integer between 1 and 50");
          return;
        }
        const mode = (modeRaw ?? "APPROVE").toUpperCase();
        if (mode !== "APPROVE" && mode !== "AUTO") {
          await reply("mode must be APPROVE or AUTO");
          return;
        }
        try {
          const account = await this.accounts.create(
            { name, balance, leverage, mode },
            actor,
          );
          await reply(
            `Created account ${account.id}\n${account.name} [${account.mode} ${account.leverage}x] bal=${String(account.balance)}`,
          );
        } catch (err) {
          await reply(`Failed: ${err instanceof Error ? err.message.split(":")[0] : "error"}`);
        }
        return;
      }
      case "accounts": {
        const rows = await this.accounts.list();
        if (rows.length === 0) {
          await reply("Chưa có tài khoản ảo nào.");
          return;
        }
        await reply(
          rows
            .map(
              (acc) =>
                `${acc.id} ${acc.name} [${acc.mode} ${acc.leverage}x] bal=${String(acc.balance)}`,
            )
            .join("\n"),
        );
        return;
      }
      case "account": {
        const acc = a
          ? await this.accounts.view(a)
          : await this.accounts.view((await this.accounts.defaultAccount()).id);
        const summary = [
          `${acc.account.name} (${acc.account.mode} ${acc.account.leverage}x)`,
          `balance=${String(acc.account.balance)} equity=${acc.equity.toFixed(2)}`,
          `marginRatio=${acc.marginRatio === null ? "n/a" : acc.marginRatio.toFixed(4)}`,
          `realized=${Number(acc.realizedPnl).toFixed(2)} opens=${acc.openPositions.length}`,
        ].join("\n");
        await reply(summary);
        return;
      }
      case "mode": {
        if (!b) {
          const acc = a
            ? await this.accounts.get(a)
            : await this.accounts.defaultAccount();
          await reply(`mode=${acc.mode}`);
          return;
        }
        const upper = b.toUpperCase();
        if (upper !== "AUTO" && upper !== "APPROVE") {
          await reply("Usage: /mode [auto|approve] [accountId]");
          return;
        }
        const target = a ?? (await this.accounts.defaultAccount()).id;
        await this.accounts.setMode(target, upper, actor);
        await reply(`mode=${upper}`);
        return;
      }
      case "openmode": {
        if (!a) {
          await reply(`openmode=${await this.openMode.getMode()}`);
          return;
        }
        const upper = a.toUpperCase();
        if (upper !== "MANUAL" && upper !== "AUTO") {
          await reply("Usage: /openmode [manual|auto]");
          return;
        }
        await this.openMode.setMode(upper, actor);
        await reply(`openmode=${upper}`);
        return;
      }
      case "deposit":
      case "withdraw": {
        if (!a || !b || !(Number(b) > 0)) {
          await reply(`Usage: /${parsed.name} <accountId> <amount>`);
          return;
        }
        const fn =
          parsed.name === "deposit"
            ? this.accounts.deposit.bind(this.accounts)
            : this.accounts.withdraw.bind(this.accounts);
        const acc = await fn(a, Number(b), actor);
        await reply(`balance=${String(acc.balance)}`);
        return;
      }
      case "reset": {
        if (!a || !(Number(b) >= 0)) {
          await reply("Usage: /reset <accountId> <balance>");
          return;
        }
        await this.accounts.reset(a, Number(b), actor, (pid) =>
          this.trading.closePosition(pid, actor).then(() => undefined),
        );
        await reply(`Account reset to ${b}.`);
        return;
      }
      case "review": {
        const [sigs, upds] = await Promise.all([
          this.signals.reviewQueueDetailed(),
          this.updates.reviewQueue(),
        ]);
        if (sigs.length === 0 && upds.length === 0) {
          await reply("Hết hàng đợi review. 🎉");
          return;
        }
        await reply(`signals: ${sigs.length}\nupdates: ${upds.length} (mỗi item 1 tin riêng kèm nút)`);
        for (const s of sigs.slice(0, REVIEW_PAGE)) {
          const version = s.versions[0];
          const payload = (version?.normalizedPayloadJson ?? null) as {
            missingFields?: string[];
            ambiguities?: string[];
          } | null;
          const message = await this.signals.getReviewMessage(payloadRowId(version?.normalizedPayloadJson)).catch(() => null);
          const link = message
            ? postLink(message.source.platform, message.source.externalSourceId, message.externalMessageId, message.sourceUrl)
            : null;
          const line =
            `- ${displayOrDash(version?.direction ?? s.direction)} ${displayOrDash(version?.instrument ?? s.instrument)} [${s.status}] ${s.source.displayName} — ${formatReviewReason(payload?.missingFields ?? [], payload?.ambiguities ?? [])}${link ? `\n  ${link}` : ""}`;
          await reply(line, this.signalCardKeyboard(s.id));
        }
        if (sigs.length > REVIEW_PAGE) {
          await reply(`… +${sigs.length - REVIEW_PAGE} signals nữa (xử lý bớt rồi /review lại)`);
        }
        for (const u of upds.slice(0, REVIEW_PAGE)) {
          const matched = u.matchedSignal?.versions[0];
          const link = postLink(
            u.sourceMessage.source.platform,
            u.sourceMessage.source.externalSourceId,
            u.sourceMessage.externalMessageId,
            u.sourceMessage.sourceUrl,
          );
          const line =
            `- ${displayOrDash(u.actionType)} [${u.validationStatus}] ${matched ? `${displayOrDash(matched.direction)} ${displayOrDash(matched.instrument)}` : "chưa khớp"} — ${u.reviewReason ?? "—"}${link ? `\n  ${link}` : ""}`;
          if (u.validationStatus === "AMBIGUOUS") {
            const picker = await this.candidatePicker(u.id, u.reviewReason);
            await reply(
              `${line}${picker ? `\nỨng viên:\n${picker.legend}` : ""}`,
              picker ? picker.keyboard : this.updateCardKeyboard(u.id, []),
            );
          } else {
            await reply(line, this.updateCardKeyboard(u.id, []));
          }
        }
        if (upds.length > REVIEW_PAGE) {
          await reply(`… +${upds.length - REVIEW_PAGE} updates nữa (xử lý bớt rồi /review lại)`);
        }
        return;
      }
      case "sources": {
        const rows = await this.sources.list();
        if (rows.length === 0) {
          await reply("No sources followed yet. Use /source_add to add the first channel.");
          return;
        }
        const icon = (enabled: boolean) => (enabled ? "✅" : "⏸️");
        await reply(
          rows
            .slice(0, 15)
            .map(
              (s) =>
                `${icon(s.enabled)} ${s.displayName} (${s.platform}) p${s.priority} ${s.id}`,
            )
            .join("\n") + (rows.length > 15 ? `\n… +${rows.length - 15} more` : ""),
        );
        return;
      }
      case "source_add": {
        const items = commandLines(rawText);
        const lines = items.length > 0 ? items : parsed.args;
        if (lines.length === 0) {
          await reply("Usage:\n/source_add\n@channel1\n@channel2");
          return;
        }
        const results = await this.sources.bulkCreate(lines.map((raw) => ({ raw })), actor);
        const icon: Record<string, string> = {
          created: "✅",
          "skipped-duplicate": "⏭️",
          deleted: "🗑️",
          failed: "❌",
        };
        await reply(
          results
            .map(
              (r) =>
                `${icon[r.status] ?? "•"} ${r.input} — ${r.status}${r.reason ? `: ${r.reason}` : ""}`,
            )
            .join("\n"),
        );
        return;
      }
      case "source_del": {
        const items = commandLines(rawText);
        const refs = items.length > 0 ? items : parsed.args;
        if (refs.length === 0) {
          await reply("Usage:\n/source_del\n@channel1\n@channel2");
          return;
        }
        const results = await this.sources.bulkRemove(refs, actor);
        await reply(
          results
            .map((r) => `${r.status === "deleted" ? "🗑️" : "❌"} ${r.input} — ${r.status}${r.reason ? `: ${r.reason}` : ""}`)
            .join("\n"),
        );
        return;
      }
      case "source_edit": {
        const tokens = commandLineTokens(rawText);
        const [ref, ...rest] = tokens.length > 0 ? tokens : parsed.args;
        if (!ref) {
          await reply('Usage: /source_edit <handle|id> name=".." kind=.. priority=..');
          return;
        }
        const patch: Record<string, string | number> = {};
        for (const token of rest) {
          const eq = token.indexOf("=");
          if (eq <= 0) continue;
          const key = token.slice(0, eq).toLowerCase();
          let value = token.slice(eq + 1);
          if (
            value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))
          ) {
            value = value.slice(1, -1);
          }
          if (key === "name" && value) {
            patch.displayName = value;
          } else if (key === "kind" && value) {
            const kind = value.toUpperCase();
            if (!(SOURCE_KINDS as readonly string[]).includes(kind)) {
              await reply(`kind must be one of: ${SOURCE_KINDS.join(", ")}`);
              return;
            }
            patch.sourceKind = kind;
          } else if (key === "priority" && value !== "") {
            const priority = Number(value);
            if (!Number.isInteger(priority) || priority < 0) {
              await reply("priority must be an integer >= 0");
              return;
            }
            patch.priority = priority;
          }
        }
        if (Object.keys(patch).length === 0) {
          await reply('Usage: /source_edit <handle|id> name=".." kind=.. priority=..');
          return;
        }
        const target = await this.sources.resolve(ref);
        const updated = await this.sources.update(target.id, patch, actor);
        await reply(`Updated ${updated.displayName} (${updated.platform}) p${updated.priority}.`);
        return;
      }
      case "source_enable":
      case "source_disable": {
        if (parsed.args.length === 0) {
          await reply(`Usage: /${parsed.name} <handle|id> [handle|id ...]`);
          return;
        }
        const enable = parsed.name === "source_enable";
        const lines: string[] = [];
        for (const ref of parsed.args) {
          try {
            const target = await this.sources.resolve(ref);
            await this.sources.setEnabled(target.id, enable, actor);
            lines.push(`${enable ? "✅" : "⏸️"} ${target.displayName} ${enable ? "enabled" : "disabled"}`);
          } catch (err) {
            lines.push(`❌ ${ref} — ${err instanceof Error ? err.message : "unknown error"}`);
          }
        }
        await reply(lines.join("\n"));
        return;
      }
      case "source_health": {
        if (parsed.args.length === 0) {
          await reply("Usage: /source_health <handle|id> [handle|id ...]");
          return;
        }
        const lines: string[] = [];
        for (const ref of parsed.args) {
          try {
            const target = await this.sources.resolve(ref);
            const health = await this.sources.health(target.id);
            const error = health.lastErrorCode
              ? ` lastError=${health.lastErrorCode} at=${health.lastErrorAt ?? "unknown"}`
              : "";
            lines.push(
              `${health.status === "ok" ? "✅" : "⚠️"} ${target.displayName} — ${target.enabled ? "enabled" : "disabled"}, status=${health.status}${error}`,
            );
          } catch (err) {
            lines.push(`❌ ${ref} — ${err instanceof Error ? err.message : "unknown error"}`);
          }
        }
        await reply(lines.join("\n"));
        return;
      }
      case "coins": {
        const rows = await this.coins.list();
        if (rows.length === 0) {
          await reply("No tradable coins yet. Use /coin_add to add the first symbol.");
          return;
        }
        const icon = (enabled: boolean) => (enabled ? "✅" : "⏸️");
        await reply(rows.map((c) => `${icon(c.enabled)} ${c.symbol}`).join("\n"));
        return;
      }
      case "coin_add": {
        const items = commandLines(rawText);
        const lines = items.length > 0 ? items : parsed.args;
        if (lines.length === 0) {
          await reply("Usage:\n/coin_add\nBTC\nZEC");
          return;
        }
        const out: string[] = [];
        for (const raw of lines) {
          try {
            const created = await this.coins.create({ symbol: raw }, actor);
            out.push(`✅ ${created.symbol} — created`);
          } catch (err) {
            if (err instanceof ConflictException) {
              out.push(`⏭️ ${raw.trim()} — skipped-duplicate`);
            } else {
              out.push(`❌ ${raw} — ${err instanceof Error ? err.message : "unknown error"}`);
            }
          }
        }
        await reply(out.join("\n"));
        return;
      }
      case "coin_del": {
        const items = commandLines(rawText);
        const refs = items.length > 0 ? items : parsed.args;
        if (refs.length === 0) {
          await reply("Usage:\n/coin_del\nBTC\nZEC");
          return;
        }
        const out: string[] = [];
        for (const ref of refs) {
          try {
            const target = await this.coins.resolve(ref);
            await this.coins.remove(target.id, actor);
            out.push(`🗑️ ${target.symbol} — deleted`);
          } catch (err) {
            out.push(`❌ ${ref} — ${err instanceof Error ? err.message : "unknown error"}`);
          }
        }
        await reply(out.join("\n"));
        return;
      }
      case "coin_enable":
      case "coin_disable": {
        if (parsed.args.length === 0) {
          await reply(`Usage: /${parsed.name} <SYM> [SYM ...]`);
          return;
        }
        const enable = parsed.name === "coin_enable";
        const out: string[] = [];
        for (const ref of parsed.args) {
          try {
            const target = await this.coins.resolve(ref);
            const updated = await this.coins.update(target.id, { enabled: enable }, actor);
            out.push(`${enable ? "✅" : "⏸️"} ${updated.symbol} ${enable ? "enabled" : "disabled"}`);
          } catch (err) {
            out.push(`❌ ${ref} — ${err instanceof Error ? err.message : "unknown error"}`);
          }
        }
        await reply(out.join("\n"));
        return;
      }
      case "vol": {
        if (parsed.args.length === 0) {
          const rows = await this.coins.listNotionals();
          if (rows.length === 0) {
            await reply("No tradable coins yet. Use /coin_add to add the first symbol.");
            return;
          }
          await reply(
            rows
              .map((row) => `${row.symbol} notional=${row.notionalUsd}${row.enabled ? "" : " (disabled)"}`)
              .join("\n"),
          );
          return;
        }
        if (parsed.args.length !== 2) {
          await reply("Usage: /vol <SYM> <amount|reset>");
          return;
        }
        const [ref, value] = parsed.args;
        try {
          if (value.toLowerCase() === "reset") {
            const updated = await this.coins.resetNotional(ref, actor);
            await reply(`${updated.symbol} notional=${updated.notionalUsd} (default)`);
            return;
          }
          const amount = Number(value);
          if (!Number.isFinite(amount) || amount <= 0) {
            await reply("Usage: /vol <SYM> <amount|reset>");
            return;
          }
          const updated = await this.coins.setNotional(ref, amount, actor);
          await reply(`${updated.symbol} notional=${updated.notionalUsd}`);
        } catch (err) {
          await reply(`ERR ${ref} — ${err instanceof Error ? err.message : "unknown error"}`);
        }
        return;
      }
      default:
        await reply("Unknown command. /help for list.");
    }
  }

  /**
   * Plain-text reply to a pending "Bổ sung" prompt: merge the original post
   * with the operator's numbers and append a MANUAL version to the same signal.
   */
  private async handleFillInput(
    msg: TgMessage,
    pending: { signalId: string; expiresAt: number },
    key: string,
    actor: string,
    reply: (text: string, replyMarkup?: unknown) => Promise<void>,
  ): Promise<void> {
    if (Date.now() > pending.expiresAt) {
      this.pendingInput.delete(key);
      await reply("Hết hạn nhập liệu (5 phút). Bấm ✏️ Bổ sung lại nếu cần.");
      return;
    }
    const text = (msg.text ?? "").trim();
    if (!text) return;
    try {
      const out = await this.signals.appendManualVersion(pending.signalId, text, actor);
      this.pendingInput.delete(key);
      const card = this.signalCardText(
        {
          id: out.signalId,
          status: out.status,
          instrument: out.version.instrument,
          direction: out.version.direction,
          source: { displayName: out.source.displayName, platform: out.source.platform },
          versions: [out.version],
        },
        out.message,
      );
      await reply(`${card}\n(Đã bổ sung từ nhập tay)`, this.signalCardKeyboard(pending.signalId));
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      if (message.includes("cannot complete") || message.includes("not found")) {
        this.pendingInput.delete(key);
      }
      await reply(`Bổ sung thất bại: ${message.split(":")[0]}. Nhập lại hoặc /cancel.`);
    }
  }

  // ------------------------------------------------------------ callbacks

  async handleCallback(cb: TgCallback): Promise<void> {
    const answer = async (text: string) =>
      this.api("answerCallbackQuery", { callback_query_id: cb.id, text }).catch(() => undefined);
    if (!isOperator(cb.from?.username, this.config.operatorUsernames)) {
      await answer("Not authorized.");
      return;
    }
    const [action, kind, id] = (cb.data ?? "").split(":");
    const actor = `tg:${cb.from.username}`;
    try {
      if ((action === "appr" || action === "rej") && kind === "signal" && id) {
        if (action === "rej") {
          await this.signals.reject(id, {}, actor);
          await answer("Rejected.");
        } else {
          const full = await this.signals.get(id);
          const latest = full.versions[0];
          if (!latest) {
            await answer("No versions.");
            return;
          }
          const out = await this.flow.approveSignal(id, { signalVersionId: latest.id }, actor);
          await answer(
            out.position ? "Approved + opened." : `Approved. Open failed: ${out.openError ?? "unknown"}`,
          );
        }
        if (cb.message) {
          await this.api("editMessageText", {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `${cb.message.text ?? ""}\n\n[${action === "rej" ? "REJECTED" : "APPROVED"} by @${cb.from.username}]`,
          }).catch(() => undefined);
        }
        return;
      }
      if (action === "rej" && kind === "update" && id) {
        await this.updates.reject(id, {}, actor);
        await answer("Rejected.");
        return;
      }
      if (action === "appr" && kind === "update" && id) {
        try {
          await this.updates.approve(id, {}, actor);
          await answer("Approved.");
        } catch (err) {
          await answer(`Failed: ${err instanceof Error ? err.message.split(":")[0] : "error"}`);
          return;
        }
        if (cb.message) {
          await this.api("editMessageText", {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `${cb.message.text ?? ""}\n\n[APPROVED by @${cb.from.username}]`,
          }).catch(() => undefined);
        }
        return;
      }
      if (action === "fill" && kind === "signal" && id) {
        const full = await this.signals.get(id).catch(() => null);
        if (!full || !["NEEDS_REVIEW", "PENDING_APPROVAL"].includes(full.status)) {
          await answer("Signal đã chốt, không bổ sung.");
          return;
        }
        const latest = full.versions[0];
        const payload = (latest?.normalizedPayloadJson ?? null) as {
          missingFields?: string[];
        } | null;
        const missing = payload?.missingFields ?? [];
        this.pendingInput.set(`${cb.from.username}`.toLowerCase(), {
          signalId: id,
          expiresAt: Date.now() + FILL_TIMEOUT_MS,
        });
        await answer("Đã ghi nhận, reply số còn thiếu.");
        if (cb.message) {
          await this.api("sendMessage", {
            chat_id: cb.message.chat.id,
            text: `✏️ Bổ sung cho signal (còn thiếu: ${missing.length > 0 ? missing.join(", ") : "xem card"}).\nReply tin này với phần còn thiếu, vd: long entry 1224 sl 1068 tp 1300,1350\nGõ /cancel để hủy (5 phút).`,
          }).catch(() => undefined);
        }
        return;
      }
      if (action === "pick" && kind) {
        const entry = this.pickNonces.get(kind);
        if (!entry || Date.now() > entry.expiresAt) {
          this.pickNonces.delete(kind);
          await answer("Hết hạn, bấm lại /review.");
          return;
        }
        this.pickNonces.delete(kind);
        try {
          await this.updates.approve(entry.updateId, { signalId: entry.signalId }, actor);
          await answer("Approved.");
        } catch (err) {
          await answer(`Failed: ${err instanceof Error ? err.message.split(":")[0] : "error"}`);
          return;
        }
        if (cb.message) {
          await this.api("editMessageText", {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `${cb.message.text ?? ""}\n\n[APPROVED by @${cb.from.username}]`,
          }).catch(() => undefined);
        }
        return;
      }
      if (action === "style" && id && isCardKind(kind)) {
        if (cb.message) this.publicationChat.set(id, Number(cb.message.chat.id));
        const outcome = await this.publications.chooseCardStyle(id, kind, actor);
        const label = kind === "position-stats" ? "Thống kê" : "PnL";
        const suffix =
          outcome === "promoted"
            ? `\n\n[Card ${label} by @${cb.from.username}]`
            : outcome === "scheduled"
              ? `\n\n[Card ${label} — sẽ đăng khi entry khớp]`
              : "\n\n[Hết thời gian chọn — card thống kê]";
        await answer(
          outcome === "promoted"
            ? `Đã chọn card ${label} — đang đăng…`
            : outcome === "scheduled"
              ? `Đã chọn card ${label} — sẽ đăng khi entry khớp.`
              : "Hết thời gian chọn — dùng card thống kê.",

        );
        if (cb.message) {
          await this.api("editMessageText", {
            chat_id: cb.message.chat.id,
            message_id: cb.message.message_id,
            text: `${cb.message.text ?? ""}${suffix}`,
            reply_markup: { inline_keyboard: [] },
          }).catch(() => undefined);
        }
        return;
      }
      await answer("Unknown action.");
    } catch (err) {
      await answer(`Failed: ${err instanceof Error ? err.message.split(":")[0] : "error"}`);
    }
  }

  // ---------------------------------------------------------------- reviews

  private reviewKeyboard(kind: "signal" | "update", id: string) {
    return {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `appr:${kind}:${id}` },
          { text: "Reject", callback_data: `rej:${kind}:${id}` },
        ],
      ],
    };
  }

  /** Signal card actions: approve/reject plus manual completion. */
  private signalCardKeyboard(id: string) {
    return {
      inline_keyboard: [
        [
          { text: "Approve", callback_data: `appr:signal:${id}` },
          { text: "Reject", callback_data: `rej:signal:${id}` },
        ],
        [{ text: "✏️ Bổ sung", callback_data: `fill:signal:${id}` }],
      ],
    };
  }

  /** /pos style dialog: pick the card image before the delayed render runs. */
  private cardStyleKeyboard(positionId: string) {
    return {
      inline_keyboard: [
        [
          { text: "① Card PnL", callback_data: `style:pnl-strip:${positionId}` },
          { text: "② Card Thống kê", callback_data: `style:position-stats:${positionId}` },
        ],
      ],
    };
  }

  /** Update card actions: matched updates get Approve; ambiguous get picks. */
  private updateCardKeyboard(updateId: string, candidates: Array<{ nonce: string; label: string }>) {
    if (candidates.length === 0) {
      return {
        inline_keyboard: [
          [
            { text: "Approve", callback_data: `appr:update:${updateId}` },
            { text: "Reject", callback_data: `rej:update:${updateId}` },
          ],
        ],
      };
    }
    return {
      inline_keyboard: [
        candidates.map((c) => ({ text: c.label, callback_data: `pick:${c.nonce}` })),
        [{ text: "Reject", callback_data: `rej:update:${updateId}` }],
      ],
    };
  }

  /** Shared full-card builder for push notifications and manual-completion refresh. */
  private signalCardText(
    s: {
      id: string;
      status: string;
      instrument: string;
      direction: string;
      source: { displayName: string; platform: string };
      versions: Array<{
        versionNumber: number;
        eventType: string | null;
        instrument: string;
        direction: string;
        orderType: string | null;
        entry: unknown;
        stopLoss: unknown;
        takeProfits: unknown;
        normalizedPayloadJson: unknown;
      }>;
    },
    message: {
      contentRaw: string;
      authorName: string | null;
      sourceTimestamp: Date | null;
      sourceUrl: string | null;
      externalMessageId: string;
      source: { displayName: string; platform: string; externalSourceId: string };
    } | null,
  ): string {
    const version = s.versions[0];
    const payload = (version?.normalizedPayloadJson ?? null) as {
      missingFields?: string[];
      ambiguities?: string[];
      leverage?: number | null;
    } | null;
    const tps = Array.isArray(version?.takeProfits)
      ? (version?.takeProfits as number[]).map((n) => Number(n)).filter((n) => Number.isFinite(n))
      : [];
    return formatSignalReviewCard({
      status: s.status,
      versionNumber: version?.versionNumber ?? null,
      eventType: version?.eventType ?? null,
      instrument: version?.instrument ?? s.instrument,
      direction: version?.direction ?? s.direction,
      orderType: version?.orderType ?? null,
      entry: version?.entry == null ? null : String(version.entry),
      stopLoss: version?.stopLoss == null ? null : String(version.stopLoss),
      takeProfits: tps,
      leverage: typeof payload?.leverage === "number" ? String(payload.leverage) : null,
      missing: payload?.missingFields ?? [],
      ambiguities: payload?.ambiguities ?? [],
      sourceName: s.source.displayName,
      platform: s.source.platform,
      messageText: message?.contentRaw ?? null,
      author: message?.authorName ?? null,
      timestamp: message?.sourceTimestamp ? message.sourceTimestamp.toISOString() : null,
      url: message
        ? postLink(message.source.platform, message.source.externalSourceId, message.externalMessageId, message.sourceUrl)
        : null,
    });
  }

  /**
   * Candidate picker for AMBIGUOUS updates: legend lines + one-tap buttons.
   * Returns null when no resolvable candidates (caller falls back to Approve/Reject).
   */
  private async candidatePicker(
    updateId: string,
    reviewReason: string | null,
  ): Promise<{ legend: string; keyboard: ReturnType<OperatorBotService["updateCardKeyboard"]> } | null> {
    const ids = [
      ...new Set(
        [...(reviewReason ?? "").matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi)].map((m) =>
          m[0].toLowerCase(),
        ),
      ),
    ].slice(0, 4);
    if (ids.length === 0) return null;
    const summaries = await this.signals.summarizeSignals(ids).catch(() => []);
    const shown = summaries.slice(0, 4);
    if (shown.length === 0) return null;
    const buttons = shown.map((cand, i) => ({
      label: `${i + 1}️⃣ ${cand.direction} ${cand.instrument}`,
      nonce: this.mintPickNonce(updateId, cand.id),
    }));
    const legend = shown
      .map(
        (cand, i) =>
          `${i + 1}️⃣ ${displayOrDash(cand.direction)} ${displayOrDash(cand.instrument)}${cand.entry ? ` @ ${cand.entry}` : ""}`,
      )
      .join("\n");
    return { legend, keyboard: this.updateCardKeyboard(updateId, buttons) };
  }

  /** Short-lived nonce map (callback_data caps at 64 bytes). */
  private mintPickNonce(updateId: string, signalId: string): string {
    if (this.pickNonces.size > 500) {
      const now = Date.now();
      for (const [nonce, entry] of this.pickNonces) {
        if (entry.expiresAt <= now) this.pickNonces.delete(nonce);
      }
    }
    let nonce = randomBytes(4).toString("hex");
    while (this.pickNonces.has(nonce)) nonce = randomBytes(4).toString("hex");
    this.pickNonces.set(nonce, { updateId, signalId, expiresAt: Date.now() + PICK_TTL_MS });
    return nonce;
  }

  private async sendBootDigest(): Promise<void> {
    const [sigs, upds] = await Promise.all([
      this.signals.list("NEEDS_REVIEW"),
      this.updates.reviewQueue(),
    ]);
    for (const s of sigs) this.seen.add(`s:${s.id}`);
    for (const u of upds as Array<{ id: string }>) this.seen.add(`u:${u.id}`);
    if (sigs.length === 0 && upds.length === 0) return;
    await this.notifyAll(
      `Review backlog on boot — signals: ${sigs.length}, updates: ${upds.length}. Use /review.`,
    );
  }

  async pollReviews(): Promise<void> {
    const [sigs, upds] = await Promise.all([
      this.signals.reviewQueueDetailed(),
      this.updates.reviewQueue(),
    ]);
    for (const s of sigs) {
      const key = `s:${s.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const version = s.versions[0];
      const message = await this.signals.getReviewMessage(payloadRowId(version?.normalizedPayloadJson)).catch(() => null);
      const text = this.signalCardText(s, message);
      const forward = message
        ? forwardTarget(message.source.platform, message.source.externalSourceId, message.externalMessageId)
        : null;
      await this.notifyReviewCard(forward, text, this.signalCardKeyboard(s.id));
    }
    for (const u of upds) {
      const key = `u:${u.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      const matched = u.matchedSignal?.versions[0];
      const text = formatUpdateReviewCard({
        action: u.actionType,
        validationStatus: u.validationStatus,
        confidence: u.matchConfidence == null ? null : String(u.matchConfidence),
        reason: u.reviewReason,
        matchedSummary: matched
          ? `${displayOrDash(matched.direction)} ${displayOrDash(matched.instrument)}`
          : null,
        sourceName: u.sourceMessage.source.displayName,
        platform: u.sourceMessage.source.platform,
        messageText: u.sourceMessage.contentRaw,
        author: u.sourceMessage.authorName,
        timestamp: u.sourceMessage.sourceTimestamp
          ? u.sourceMessage.sourceTimestamp.toISOString()
          : null,
        url: postLink(
          u.sourceMessage.source.platform,
          u.sourceMessage.source.externalSourceId,
          u.sourceMessage.externalMessageId,
          u.sourceMessage.sourceUrl,
        ),
      });
      const forward = forwardTarget(
        u.sourceMessage.source.platform,
        u.sourceMessage.source.externalSourceId,
        u.sourceMessage.externalMessageId,
      );
      if (u.validationStatus === "AMBIGUOUS") {
        const picker = await this.candidatePicker(u.id, u.reviewReason);
        await this.notifyReviewCard(
          forward,
          `${text}${picker ? `\nỨng viên:\n${picker.legend}` : ""}`,
          picker ? picker.keyboard : this.updateCardKeyboard(u.id, []),
        );
      } else {
        await this.notifyReviewCard(forward, text, this.updateCardKeyboard(u.id, []));
      }
    }
  }

  /**
   * Card-failure notices: a render/publish that ends FINAL_FAILURE posts
   * nothing, so tell the operator who requested it (their private chat, else
   * the review DM fan-out).
   */
  async pollPublicationFailures(): Promise<void> {
    const failures = await this.publications.listRecentFailures(this.failureSweepMs);
    for (const f of failures) {
      const key = `pf:${f.publicationId}`;
      if (this.notifiedFailures.has(key)) continue;
      this.notifiedFailures.add(key);
      if (!f.positionId) continue;
      const text = `❌ Không đăng được card${f.coin ? ` ${f.coin}` : ""}: ${f.reason ?? "unknown"}`;
      const chatId = this.publicationChat.get(f.positionId);
      if (chatId != null) {
        await this.send(chatId, text).catch(() => undefined);
      } else {
        await this.notifyAll(text);
      }
    }
  }
}
