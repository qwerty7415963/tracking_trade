import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { createHash, randomUUID } from "crypto";
import { Prisma, Signal } from "@prisma/client";
import {
  NormalizedSignal,
  UPDATE_ACTION_ALLOWLIST,
  matchUpdate,
  missingRequiredFields,
  parseSignal,
  takeProfitSpecsFromPayload,
} from "@tracking-auto/domain";
import { AuditService } from "../audit/audit.service";
import { CoinsService } from "../coins/coins.service";
import { PrismaService } from "../database/prisma.service";
import { ProfilesService } from "../profiles/profiles.service";
import { ApproveSignalDto, RejectSignalDto } from "./dto/signal.dto";

const APPROVABLE = ["PENDING_APPROVAL", "NEEDS_REVIEW"];
const FINAL = ["CLOSED", "CANCELLED", "EXPIRED", "EXECUTION_FAILED", "REJECTED"];

export interface IngestOutcome {
  kind: "SIGNAL" | "UPDATE";
  signalId?: string;
  updateId?: string;
  status: string;
}

export interface OperatorSignalOptions {
  /** Explicit post link (REST override — bot/REST text auto-detects links). */
  sourceUrl?: string | null;
  /** Explicit channel name (`src="Kaka trades"`); wins when set — the hidden fallback for links auto-resolve cannot name. */
  sourceName?: string | null;
}

export interface OperatorSignalResult {
  signalId: string;
  versionId: string;
  status: string;
  instrument: string;
  direction: string;
  entryMarket: boolean;
}

/** Caption/source name when nothing else resolves. */
export const DEFAULT_OPERATOR_SOURCE_NAME = "Operator (manual)";

/**
 * Pull post links out of free operator text. The FIRST link becomes the
 * source url (full `https://…`, bare `t.me/…`, or the legacy `url=` prefix);
 * every link is stripped from the returned text so parseSignal never sees
 * one. Link-free text comes back untouched.
 */
const SOURCE_URL_RE = /(^|\s)(?:url=)?((?:https?:\/\/)?t\.me\/[^\s]+|https?:\/\/[^\s]+)/i;

export function extractSourceUrl(raw: string): { text: string; url: string | null } {
  if (!SOURCE_URL_RE.test(raw)) return { text: raw, url: null };
  let first: string | null = null;
  const text = raw
    .replace(new RegExp(SOURCE_URL_RE.source, "gi"), (_m, _lead: string, link: string) => {
      if (first === null) {
        let url = link.replace(/[.,;:!?'")\]]+$/, "");
        if (url) {
          if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
          first = url;
        }
      }
      return "";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, url: first };
}

/**
 * getChat target for a Telegram post link: `t.me/name/1` → `@name`,
 * `t.me/c/<id>/1` → `-100<id>` (private channels, only when the bot is a
 * member). `t.me/+…` invite links and non-Telegram URLs → null.
 */
export function telegramChatTarget(url: string): string | null {
  const privateChannel = url.match(/^https?:\/\/t\.me\/c\/(\d+)(?:\/\d+)?\/?$/i);
  if (privateChannel) return `-100${privateChannel[1]}`;
  const publicPost = url.match(/^https?:\/\/t\.me\/(?:s\/)?([A-Za-z0-9_]+)(?:\/\d+)?\/?$/i);
  if (!publicPost) return null;
  const slug = publicPost[1];
  // Service paths that are not channel usernames.
  if (["joinchat", "addstickers", "addemoji", "share", "proxy", "socks"].includes(slug.toLowerCase())) {
    return null;
  }
  return `@${slug}`;
}

/**
 * Channel title via Bot API getChat — best-effort: network errors, timeouts
 * and "chat not found" all collapse to null so /pos never fails on lookup.
 */
async function fetchChatTitle(target: string, token: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/getChat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: target }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; result?: { title?: unknown } };
    const title = typeof body.result?.title === "string" ? body.result.title.trim() : "";
    return title || null;
  } catch {
    return null;
  }
}

/**
 * Row id of the originating post inside a version payload. Payloads are
 * stored camelCase (`sourceMessageId`); very old rows may use snake_case.
 */
export function payloadRowId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { sourceMessageId?: unknown; source_message_id?: unknown };
  if (typeof p.sourceMessageId === "string" && p.sourceMessageId) return p.sourceMessageId;
  if (typeof p.source_message_id === "string" && p.source_message_id) return p.source_message_id;
  return null;
}

@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly coins: CoinsService,
    private readonly profiles: ProfilesService,
  ) {}

  list(status?: string): Promise<Signal[]> {
    return this.prisma.signal.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
    });
  }

  async get(id: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id },
      include: {
        versions: { orderBy: { versionNumber: "desc" } },
        approvals: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!signal) throw new NotFoundException(`signal ${id} not found`);
    return signal;
  }

  /** NEEDS_REVIEW signals with latest version + source, for human-readable review cards. */
  reviewQueueDetailed() {
    return this.prisma.signal.findMany({
      where: { status: "NEEDS_REVIEW" },
      orderBy: { createdAt: "asc" },
      include: {
        source: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });
  }

  /** Original post backing a signal version payload (null when gone). */
  getReviewMessage(rowId: string | null | undefined) {
    if (!rowId) return Promise.resolve(null);
    return this.prisma.sourceMessage.findUnique({
      where: { id: rowId },
      include: { source: true },
    });
  }

  async ingestSourceMessage(messageId: string, actor: string): Promise<IngestOutcome> {
    const message = await this.prisma.sourceMessage.findUnique({
      where: { id: messageId },
      include: { source: true },
    });
    if (!message || message.source.deletedAt) {
      throw new NotFoundException(`source message ${messageId} not found`);
    }
    const coinUniverse = await this.coins.enabledSymbols().catch(() => [] as string[]);
    const profile = await this.profiles
      .getProfile(message.source.parserProfileId)
      .catch(() => null);
    const parsed = parseSignal(
      {
        text: message.contentRaw,
        sourceMessageId: message.id,
        sourcePlatform: message.source.platform,
        sourceUrl: message.sourceUrl,
        sourceTimestamp: message.sourceTimestamp ? message.sourceTimestamp.toISOString() : null,
        threadId: message.threadId,
        replyToMessageId: message.replyToMessageId,
        quotedMessageId: message.quotedMessageId,
      },
      { coinUniverse, profile },
    );
    if (parsed.eventType === "NEW" && parsed.instrument && !coinUniverse.includes(parsed.instrument)) {
      parsed.ambiguities.push(`unmapped_symbol_${parsed.instrument}`);
    }
    if (parsed.eventType === "UPDATE") {
      const updateId = await this.handleUpdate(message.sourceId, message.authorId, parsed, actor);
      return { kind: "UPDATE", updateId, status: "CREATED" };
    }
    // Same row re-ingested (retry/redelivery): idempotent, return existing.
    const sameRowSignalId = await this.findSignalIdByPostRows([message.id]);
    if (sameRowSignalId) {
      const current = await this.prisma.signal.findUnique({ where: { id: sameRowSignalId } });
      if (current) return { kind: "SIGNAL", signalId: current.id, status: current.status };
    }
    if (message.revision > 1) {
      const edited = await this.appendEditVersion(message, parsed, actor);
      if (edited) return { kind: "SIGNAL", signalId: edited.id, status: edited.status };
    }
    const signal = await this.handleNewSignal(message.sourceId, parsed, actor);
    return { kind: "SIGNAL", signalId: signal.id, status: signal.status };
  }

  /**
   * Signal already spawned from any of these post rows (highest version
   * first). One indexed-plus-JSON query per NEW ingest; fine at this scale.
   */
  private async findSignalIdByPostRows(rowIds: string[]): Promise<string | null> {
    if (rowIds.length === 0) return null;
    const linked = await this.prisma.signalVersion.findMany({
      where: {
        OR: rowIds.flatMap((id) => [
          { normalizedPayloadJson: { path: ["sourceMessageId"], equals: id } },
          { normalizedPayloadJson: { path: ["source_message_id"], equals: id } },
        ]),
      },
      orderBy: { versionNumber: "desc" },
      select: { signalId: true },
    });
    if (linked.length === 0) return null;
    return linked[0].signalId;
  }

  /**
   * An edited message supersedes the signal created from an earlier revision
   * of the same (sourceId, externalMessageId) instead of spawning a duplicate.
   * Old approvals stay bound to the old version id, so they go stale
   * automatically (approve() requires the latest version id).
   * Returns null when no originating signal exists — caller falls back to new.
   */
  private async appendEditVersion(
    message: { id: string; sourceId: string; externalMessageId: string },
    parsed: NormalizedSignal,
    actor: string,
  ): Promise<{ id: string; status: string } | null> {
    const priorRows = await this.prisma.sourceMessage.findMany({
      where: { sourceId: message.sourceId, externalMessageId: message.externalMessageId },
      select: { id: true },
    });
    const priorIds = priorRows.map((r) => r.id).filter((id) => id !== message.id);
    if (priorIds.length === 0) return null;
    const signalId = await this.findSignalIdByPostRows(priorIds);
    if (!signalId) return null;
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!signal) return null;
    const next = (signal.versions[0]?.versionNumber ?? 0) + 1;
    const missing = missingRequiredFields(parsed);
    const recomputed =
      missing.length > 0 || parsed.ambiguities.length > 0 ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
    // A FINAL signal stays FINAL: editing a decided signal must not reopen it.
    const status = FINAL.includes(signal.status) ? signal.status : recomputed;
    return this.prisma.$transaction(async (tx) => {
      await tx.signalVersion.create({
        data: {
          signalId: signal.id,
          versionNumber: next,
          eventType: "EDIT",
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          orderType: parsed.orderType,
          entry: parsed.entry,
          stopLoss: parsed.stopLoss,
          takeProfits: (parsed.takeProfits ?? []) as Prisma.InputJsonValue,
          normalizedPayloadJson: { ...parsed } as unknown as Prisma.InputJsonValue,
          parserVersion: parsed.parserVersion,
        },
      });
      const updated = await tx.signal.update({ where: { id: signal.id }, data: { status } });
      await this.audit.record(
        actor,
        "signal.edited",
        { signalId: signal.id, versionNumber: next, status, missing },
        tx,
      );
      return updated;
    });
  }

  /**
   * Operator manual completion ("Bổ sung"): merge the original post with
   * operator-typed numbers, re-parse, and append a MANUAL version to the same
   * signal. Returns the version + origin message so callers can rebuild cards.
   */
  async appendManualVersion(signalId: string, operatorText: string, actor: string) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: {
        source: true,
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
      },
    });
    if (!signal) throw new NotFoundException(`signal ${signalId} not found`);
    if (FINAL.includes(signal.status)) {
      throw new ConflictException(`signal ${signalId} is ${signal.status}, cannot complete`);
    }
    const originRowId = payloadRowId(signal.versions[0]?.normalizedPayloadJson);
    const origin = originRowId
      ? await this.prisma.sourceMessage.findUnique({
          where: { id: originRowId },
          include: { source: true },
        })
      : null;
    const coinUniverse = await this.coins.enabledSymbols().catch(() => [] as string[]);
    const profile = await this.profiles
      .getProfile(signal.source.parserProfileId)
      .catch(() => null);
    const parsed = parseSignal(
      {
        text: `${origin?.contentRaw ?? ""}\n${operatorText}`,
        sourceMessageId: origin?.id ?? signal.id,
        sourcePlatform: signal.source.platform,
        sourceUrl: origin?.sourceUrl ?? null,
        sourceTimestamp: origin?.sourceTimestamp ? origin.sourceTimestamp.toISOString() : null,
        threadId: origin?.threadId ?? null,
        replyToMessageId: origin?.replyToMessageId ?? null,
        quotedMessageId: origin?.quotedMessageId ?? null,
      },
      { coinUniverse, profile },
    );
    if (parsed.eventType !== "NEW") {
      throw new BadRequestException("input still reads as an update, cannot complete");
    }
    if (parsed.instrument && !coinUniverse.includes(parsed.instrument)) {
      parsed.ambiguities.push(`unmapped_symbol_${parsed.instrument}`);
    }
    const usable =
      parsed.instrument ||
      parsed.direction ||
      parsed.entry !== null ||
      parsed.stopLoss !== null ||
      parsed.takeProfits.length > 0;
    if (!usable) {
      throw new BadRequestException("nothing usable parsed, try again or /cancel");
    }
    // Refuse no-op replies (e.g. "ok"): at least one of the 5 required
    // fields must be newly filled or changed versus the latest version.
    const base = signal.versions[0];
    const same =
      (base?.instrument ?? "UNKNOWN") === (parsed.instrument ?? "UNKNOWN") &&
      (base?.direction ?? "UNKNOWN") === (parsed.direction ?? "UNKNOWN") &&
      String(base?.entry ?? "") === String(parsed.entry ?? "") &&
      String(base?.stopLoss ?? "") === String(parsed.stopLoss ?? "") &&
      JSON.stringify(base?.takeProfits ?? []) === JSON.stringify(parsed.takeProfits ?? []);
    if (same) {
      throw new BadRequestException("nothing new parsed, try again or /cancel");
    }
    const next = (signal.versions[0]?.versionNumber ?? 0) + 1;
    const missing = missingRequiredFields(parsed);
    const status =
      missing.length > 0 || parsed.ambiguities.length > 0 ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.signalVersion.create({
        data: {
          signalId: signal.id,
          versionNumber: next,
          eventType: "MANUAL",
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          orderType: parsed.orderType,
          entry: parsed.entry,
          stopLoss: parsed.stopLoss,
          takeProfits: (parsed.takeProfits ?? []) as Prisma.InputJsonValue,
          normalizedPayloadJson: { ...parsed } as unknown as Prisma.InputJsonValue,
          parserVersion: parsed.parserVersion,
        },
      });
      const updated = await tx.signal.update({ where: { id: signal.id }, data: { status } });
      await this.audit.record(
        actor,
        "signal.manual",
        { signalId: signal.id, versionNumber: next, status, missing },
        tx,
      );
      return {
        signalId: signal.id,
        status: updated.status,
        version: created,
        message: origin,
        source: signal.source,
      };
    });
  }

  /**
   * Display name for the synthetic MANUAL source behind a /pos signal.
   * Order: explicit `src="…"` (hidden fallback for private links the bot
   * cannot resolve) → name of an already-ingested post with the same url →
   * Telegram getChat on the link → "Operator (manual)".
   */
  private async resolveOperatorSourceName(
    opts: OperatorSignalOptions,
    sourceUrl: string | null,
  ): Promise<string> {
    const explicit = opts.sourceName?.trim();
    if (explicit) return explicit;
    if (!sourceUrl) return DEFAULT_OPERATOR_SOURCE_NAME;
    try {
      const known = await this.prisma.sourceMessage.findFirst({
        where: { sourceUrl },
        include: { source: { select: { displayName: true } } },
      });
      const tracked = known?.source?.displayName?.trim();
      if (tracked) return tracked;
    } catch {
      // Lookup is best-effort: fall through to getChat.
    }
    const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
    const target = telegramChatTarget(sourceUrl);
    if (!token || !target) return DEFAULT_OPERATOR_SOURCE_NAME;
    const title = await fetchChatTitle(target, token);
    return title ?? DEFAULT_OPERATOR_SOURCE_NAME;
  }

  /**
   * Operator-initiated signal ("/pos"): parse operator-typed text like an
   * ingest, persist a synthetic MANUAL source post, and return the fresh
   * version ready for immediate approval. No review card — the operator
   * issuing the command is the reviewer.
   */
  async createOperatorSignal(
    operatorText: string,
    actor: string,
    opts: OperatorSignalOptions = {},
  ): Promise<OperatorSignalResult> {
    const raw = operatorText.trim();
    if (!raw) throw new BadRequestException("empty signal text");
    // Auto-detect the post link anywhere in the text (legacy url= prefix
    // included); the parser must never see it. opts.sourceUrl (REST) wins.
    const detected = extractSourceUrl(raw);
    const text = detected.text;
    const sourceUrl = opts.sourceUrl ?? detected.url;
    if (!text) throw new BadRequestException("empty signal text");
    const coinUniverse = await this.coins.enabledSymbols().catch(() => [] as string[]);
    const parsed = parseSignal(
      {
        text,
        sourceMessageId: "",
        sourcePlatform: "MANUAL",
        sourceUrl,
        sourceTimestamp: new Date().toISOString(),
        threadId: null,
        replyToMessageId: null,
        quotedMessageId: null,
      },
      { coinUniverse, profile: null },
    );
    if (parsed.eventType !== "NEW") {
      throw new BadRequestException(
        "input reads as an update — /pos expects a fresh setup (instrument, direction, entry, SL, TP)",
      );
    }
    const missing = missingRequiredFields(parsed);
    if (missing.length > 0) {
      throw new ConflictException(
        `missing ${missing.join(", ")} — resend with all required fields`,
      );
    }
    if (!parsed.instrument || !coinUniverse.includes(parsed.instrument)) {
      throw new ConflictException(
        `unknown coin ${parsed.instrument ?? "?"} — add it first (/coin_add)`,
      );
    }
    // Validate first, then persist the synthetic source post the parsed
    // payload will reference (caption needs a real SourceMessage row).
    const sourceName = await this.resolveOperatorSourceName(opts, sourceUrl);
    const externalSourceId =
      sourceName === DEFAULT_OPERATOR_SOURCE_NAME ? "operator" : sourceName.toLowerCase();
    const source = await this.prisma.source.upsert({
      where: { platform_externalSourceId: { platform: "MANUAL", externalSourceId } },
      create: {
        platform: "MANUAL",
        externalSourceId,
        displayName: sourceName,
        sourceKind: "MANUAL",
        createdBy: actor,
      },
      update: {},
    });
    const message = await this.prisma.sourceMessage.create({
      data: {
        sourceId: source.id,
        externalMessageId: `op-${randomUUID()}`,
        contentRaw: text,
        authorName: actor,
        sourceUrl,
        sourceTimestamp: new Date(),
        contentHash: createHash("sha256").update(text, "utf8").digest("hex"),
      },
    });
    parsed.sourceMessageId = message.id;
    const status = parsed.ambiguities.length > 0 ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
    const { signal, version } = await this.prisma.$transaction(async (tx) => {
      const sig = await tx.signal.create({
        data: {
          sourceId: source.id,
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          status: "DETECTED",
        },
      });
      const ver = await tx.signalVersion.create({
        data: {
          signalId: sig.id,
          versionNumber: 1,
          eventType: "MANUAL",
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          orderType: parsed.orderType,
          entry: parsed.entry,
          stopLoss: parsed.stopLoss,
          takeProfits: (parsed.takeProfits ?? []) as Prisma.InputJsonValue,
          normalizedPayloadJson: { ...parsed } as unknown as Prisma.InputJsonValue,
          parserVersion: parsed.parserVersion,
        },
      });
      const updated = await tx.signal.update({ where: { id: sig.id }, data: { status } });
      await this.audit.record(
        actor,
        "signal.operator_create",
        { signalId: sig.id, sourceMessageId: message.id, status, missing },
        tx,
      );
      return { signal: updated, version: ver };
    });
    return {
      signalId: signal.id,
      versionId: version.id,
      status: signal.status,
      instrument: version.instrument,
      direction: version.direction,
      entryMarket: parsed.entryMarket,
    };
  }

  /** Short summaries for candidate-pick buttons, in input order. */
  async summarizeSignals(ids: string[]) {
    if (ids.length === 0) return [];
    const rows = await this.prisma.signal.findMany({
      where: { id: { in: ids } },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    const byId = new Map(rows.map((s) => [s.id, s]));
    return ids.flatMap((id) => {
      const s = byId.get(id);
      if (!s) return [];
      const v = s.versions[0];
      return [
        {
          id: s.id,
          status: s.status,
          direction: v?.direction ?? s.direction,
          instrument: v?.instrument ?? s.instrument,
          entry: v?.entry == null ? null : String(v.entry),
        },
      ];
    });
  }

  private async handleNewSignal(
    sourceId: string,
    parsed: NormalizedSignal,
    actor: string,
  ): Promise<Signal> {
    const missing = missingRequiredFields(parsed);
    const status = missing.length > 0 || parsed.ambiguities.length > 0 ? "NEEDS_REVIEW" : "PENDING_APPROVAL";
    return this.prisma.$transaction(async (tx) => {
      const signal = await tx.signal.create({
        data: {
          sourceId,
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          status: "DETECTED",
        },
      });
      await tx.signalVersion.create({
        data: {
          signalId: signal.id,
          versionNumber: 1,
          eventType: "NEW",
          instrument: parsed.instrument ?? "UNKNOWN",
          direction: parsed.direction ?? "UNKNOWN",
          orderType: parsed.orderType,
          entry: parsed.entry,
          stopLoss: parsed.stopLoss,
          takeProfits: (parsed.takeProfits ?? []) as Prisma.InputJsonValue,
          normalizedPayloadJson: { ...parsed } as unknown as Prisma.InputJsonValue,
          parserVersion: parsed.parserVersion,
        },
      });
      const updated = await tx.signal.update({ where: { id: signal.id }, data: { status } });
      await this.audit.record(
        actor,
        "signal.detected",
        { signalId: signal.id, status, missing },
        tx,
      );
      return updated;
    });
  }

  private async handleUpdate(
    sourceId: string,
    authorId: string | null,
    parsed: NormalizedSignal,
    actor: string,
  ): Promise<string> {
    const row = await this.prisma.signalUpdate.create({
      data: { sourceMessageId: parsed.sourceMessageId, validationStatus: "MATCHING" },
    });
    const { matchConfidence, matchedSignalId, validationStatus, reviewReason } =
      await this.runMatching(sourceId, authorId, parsed);
    const updated = await this.prisma.signalUpdate.update({
      where: { id: row.id },
      data: { matchedSignalId, matchConfidence, validationStatus, reviewReason },
    });
    await this.audit.record(actor, "signal.update.received", {
      updateId: row.id,
      validationStatus,
    });
    return updated.id;
  }

  private async runMatching(
    sourceId: string,
    authorId: string | null,
    parsed: NormalizedSignal,
  ): Promise<{
    matchConfidence: number | null;
    matchedSignalId: string | null;
    validationStatus: string;
    reviewReason: string | null;
  }> {
    const signals = await this.prisma.signal.findMany({
      where: { status: { notIn: FINAL } },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        updates: { include: { sourceMessage: true } },
      },
    });
    const externalIds = new Set<string>();
    const rowIds = new Set<string>();
    for (const s of signals) {
      const rowId = payloadRowId(s.versions[0]?.normalizedPayloadJson);
      if (rowId) rowIds.add(rowId);
      for (const u of s.updates) externalIds.add(u.sourceMessage.externalMessageId);
    }
    const messages = await this.prisma.sourceMessage.findMany({
      where: { externalMessageId: { in: [...externalIds] }, sourceId },
    });
    const byExternalId = new Map(messages.map((m) => [m.externalMessageId, m]));
    const originRows =
      rowIds.size > 0
        ? await this.prisma.sourceMessage.findMany({ where: { id: { in: [...rowIds] } } })
        : [];
    const byRowId = new Map(originRows.map((m) => [m.id, m]));
    const candidates = signals.map((s) => {
      const payload = s.versions[0]?.normalizedPayloadJson as {
        thread_id?: string | null;
      } | null;
      const originRowId = payloadRowId(s.versions[0]?.normalizedPayloadJson);
      const origin = originRowId ? byRowId.get(originRowId) : undefined;
      const ids = [
        ...(origin ? [origin.externalMessageId] : []),
        ...s.updates.map((u) => u.sourceMessage.externalMessageId),
      ];
      return {
        signalId: s.id,
        sourceId: s.sourceId,
        authorId: origin?.authorId ?? null,
        threadId: origin?.threadId ?? (payload?.thread_id as string | null) ?? null,
        instrument: s.versions[0]?.instrument ?? s.instrument,
        direction: s.versions[0]?.direction ?? s.direction,
        entryPrice: s.versions[0]?.entry ? Number(s.versions[0].entry) : null,
        createdAt: s.createdAt,
        messageExternalIds: ids,
      };
    });
    const result = matchUpdate(parsed, candidates, { sourceId, authorId });
    if (result.kind === "NO_MATCH") {
      return {
        matchConfidence: null,
        matchedSignalId: null,
        validationStatus: "UNVERIFIED",
        reviewReason: "no matching signal",
      };
    }
    if (result.kind === "AMBIGUOUS") {
      return {
        matchConfidence: null,
        matchedSignalId: null,
        validationStatus: "AMBIGUOUS",
        reviewReason: `multiple candidates: ${result.signalIds.join(",")}`,
      };
    }
    const allowed = UPDATE_ACTION_ALLOWLIST.includes(parsed.updateAction);
    if (!allowed) {
      return {
        matchConfidence: result.confidence,
        matchedSignalId: result.signalId,
        validationStatus: "ACTION_PENDING_REVIEW",
        reviewReason: `action not allowlisted: ${parsed.updateAction}`,
      };
    }
    if (parsed.updateAction === "TP_HIT") {
      // Policy for TP_HIT auto-close is undecided (open-decisions #7).
      return {
        matchConfidence: result.confidence,
        matchedSignalId: result.signalId,
        validationStatus: "ACTION_PENDING_REVIEW",
        reviewReason: "TP_HIT policy undecided",
      };
    }
    return {
      matchConfidence: result.confidence,
      matchedSignalId: result.signalId,
      validationStatus: "VALIDATED",
      reviewReason: null,
    };
  }

  async approve(id: string, dto: ApproveSignalDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      const signal = await tx.signal.findUnique({
        where: { id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!signal) throw new NotFoundException(`signal ${id} not found`);
      if (!APPROVABLE.includes(signal.status)) {
        throw new ConflictException(`signal ${id} is ${signal.status}, cannot approve`);
      }
      const latest = signal.versions[0];
      if (!latest || latest.id !== dto.signalVersionId) {
        throw new ConflictException("approval stale: signal version changed, re-approve required");
      }
      // Approving an unopenable version can never lead to a position:
      // refuse early with a clear reason instead of failing at open.
      const unopenable: string[] = [];
      const payload = latest.normalizedPayloadJson as { entryMarket?: unknown } | null;
      const entryMarket = payload?.entryMarket === true;
      if (!latest.instrument || latest.instrument === "UNKNOWN") unopenable.push("instrument");
      if (!latest.direction || latest.direction === "UNKNOWN") unopenable.push("direction");
      if (!entryMarket && latest.entry === null) unopenable.push("entry");
      if (latest.stopLoss === null) unopenable.push("stop_loss");
      const latestTps = Array.isArray(latest.takeProfits) ? latest.takeProfits : [];
      const latestSpecs = takeProfitSpecsFromPayload(latest.normalizedPayloadJson);
      if (latestTps.length === 0 && latestSpecs.length === 0) unopenable.push("take_profits");
      if (unopenable.length > 0) {
        throw new ConflictException(
          `signal ${id} missing ${unopenable.join(", ")} — complete it first (Bổ sung)`,
        );
      }
      const approval = await tx.approval.create({
        data: {
          signalId: id,
          signalVersionId: dto.signalVersionId,
          decision: "APPROVED",
          approvedBy: actor,
          reason: dto.reason,
        },
      });
      await tx.signal.update({ where: { id }, data: { status: "APPROVED" } });
      await this.audit.record(actor, "signal.approve", { signalId: id }, tx);
      return approval;
    });
  }

  async reject(id: string, dto: RejectSignalDto, actor: string) {
    return this.prisma.$transaction(async (tx) => {
      const signal = await tx.signal.findUnique({
        where: { id },
        include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
      });
      if (!signal) throw new NotFoundException(`signal ${id} not found`);
      if (!APPROVABLE.includes(signal.status)) {
        throw new ConflictException(`signal ${id} is ${signal.status}, cannot reject`);
      }
      const latest = signal.versions[0];
      if (!latest) throw new BadRequestException(`signal ${id} has no versions`);
      const approval = await tx.approval.create({
        data: {
          signalId: id,
          signalVersionId: latest.id,
          decision: "REJECTED",
          approvedBy: actor,
          reason: dto.reason,
        },
      });
      await tx.signal.update({ where: { id }, data: { status: "REJECTED" } });
      await this.audit.record(actor, "signal.reject", { signalId: id }, tx);
      return approval;
    });
  }

  async expire(id: string, actor: string) {
    const signal = await this.prisma.signal.findUnique({ where: { id } });
    if (!signal) throw new NotFoundException(`signal ${id} not found`);
    if (FINAL.includes(signal.status)) {
      throw new ConflictException(`signal ${id} is already ${signal.status}`);
    }
    const updated = await this.prisma.signal.update({ where: { id }, data: { status: "EXPIRED" } });
    await this.audit.record(actor, "signal.expire", { signalId: id });
    return updated;
  }
}
