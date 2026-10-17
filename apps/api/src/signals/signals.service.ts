import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, Signal } from "@prisma/client";
import {
  NormalizedSignal,
  UPDATE_ACTION_ALLOWLIST,
  matchUpdate,
  missingRequiredFields,
  parseSignal,
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
      if (!latest.instrument || latest.instrument === "UNKNOWN") unopenable.push("instrument");
      if (!latest.direction || latest.direction === "UNKNOWN") unopenable.push("direction");
      if (latest.entry === null) unopenable.push("entry");
      if (latest.stopLoss === null) unopenable.push("stop_loss");
      const latestTps = Array.isArray(latest.takeProfits) ? latest.takeProfits : [];
      if (latestTps.length === 0) unopenable.push("take_profits");
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
