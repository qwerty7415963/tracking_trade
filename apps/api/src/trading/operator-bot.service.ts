import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { SignalUpdatesService } from "../signals/signal-updates.service";
import { SignalsService } from "../signals/signals.service";
import { ApprovalFlowService } from "./approval-flow.service";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";
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
  "/approve <signalId> - approve + open paper position",
  "/reject <signalId> [reason] - reject a signal",
  "/open <signalId> [accountId] - retry open for approved signal",
  "/close <positionId> - close position at market",
  "/positions [status] - list virtual positions",
  "/account [id] - account summary (equity, margin, PnL)",
  "/mode [auto|approve] [accountId] - get/set open mode",
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
  "/help - this message",
].join("\n");

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

@Injectable()
export class OperatorBotService implements OnModuleInit, OnModuleDestroy {
  private running = false;
  private offset = 0;
  private readonly seen = new Set<string>();
  private readonly lastCommandAt = new Map<string, number>();
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

  // ------------------------------------------------------------- messages

  async handleMessage(msg: TgMessage): Promise<void> {
    if (msg.chat?.type !== "private") return;
    const username = msg.from?.username;
    if (!isOperator(username, this.config.operatorUsernames)) return;
    const parsed = parseCommand(msg.text);
    if (!parsed) return;
    const key = `${username}`.toLowerCase();
    const now = Date.now();
    if (now - (this.lastCommandAt.get(key) ?? 0) < 2000) {
      await this.send(msg.chat.id, "Too fast — wait a moment and retry.");
      return;
    }
    this.lastCommandAt.set(key, now);
    const actor = `tg:${username}`;
    const reply = async (text: string) => this.send(msg.chat.id, text);
    try {
      await this.dispatch(parsed, actor, reply, msg.text);
    } catch (err) {
      await reply(`Failed: ${err instanceof Error ? err.message : "unknown error"}`);
    }
  }

  async dispatch(
    parsed: ParsedCommand,
    actor: string,
    reply: (text: string) => Promise<void>,
    rawText?: string,
  ): Promise<void> {
    const [a, b] = parsed.args;
    switch (parsed.name) {
      case "start":
      case "help":
        await reply(HELP);
        return;
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
          position: { closePrice: number | null };
        };
        await reply(`Closed ${r.closedSize} @ ${JSON.stringify(r.position.closePrice)}.`);
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
                `${p.id.slice(0, 8)} ${p.coin} ${p.direction} ${String(p.remainingSize)} @ ${String(p.entryPrice)} [${p.status}]`,
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
          this.signals.list("NEEDS_REVIEW"),
          this.updates.reviewQueue(),
        ]);
        const lines = [
          `signals: ${sigs.length}`,
          ...sigs.slice(0, 5).map((s) => `- ${s.id} ${s.instrument} ${s.direction}`),
          `updates: ${upds.length}`,
        ];
        await reply(lines.join("\n"));
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
                `${icon(s.enabled)} ${s.displayName} (${s.platform}) p${s.priority} ${s.id.slice(0, 8)}`,
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
      default:
        await reply("Unknown command. /help for list.");
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
          await answer(out.position ? "Approved + opened." : `Approved. Open failed.`);
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
      this.signals.list("NEEDS_REVIEW"),
      this.updates.reviewQueue(),
    ]);
    for (const s of sigs as Array<{ id: string; instrument: string; direction: string }>) {
      const key = `s:${s.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      await this.notifyAll(
        `REVIEW signal ${s.id}\n${s.instrument} ${s.direction}`,
        this.reviewKeyboard("signal", s.id),
      );
    }
    for (const u of upds as Array<{ id: string }>) {
      const key = `u:${u.id}`;
      if (this.seen.has(key)) continue;
      this.seen.add(key);
      await this.notifyAll(
        `REVIEW update ${u.id}`,
        this.reviewKeyboard("update", u.id),
      );
    }
  }
}
