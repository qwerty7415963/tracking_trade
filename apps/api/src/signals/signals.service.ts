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
import { PrismaService } from "../database/prisma.service";
import { ApproveSignalDto, RejectSignalDto } from "./dto/signal.dto";

const APPROVABLE = ["PENDING_APPROVAL", "NEEDS_REVIEW"];
const FINAL = ["CLOSED", "CANCELLED", "EXPIRED", "EXECUTION_FAILED", "REJECTED"];

export interface IngestOutcome {
  kind: "SIGNAL" | "UPDATE";
  signalId?: string;
  updateId?: string;
  status: string;
}

@Injectable()
export class SignalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
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

  async ingestSourceMessage(messageId: string, actor: string): Promise<IngestOutcome> {
    const message = await this.prisma.sourceMessage.findUnique({
      where: { id: messageId },
      include: { source: true },
    });
    if (!message || message.source.deletedAt) {
      throw new NotFoundException(`source message ${messageId} not found`);
    }
    const parsed = parseSignal({
      text: message.contentRaw,
      sourceMessageId: message.id,
      sourcePlatform: message.source.platform,
      sourceUrl: message.sourceUrl,
      sourceTimestamp: message.sourceTimestamp ? message.sourceTimestamp.toISOString() : null,
      threadId: message.threadId,
      replyToMessageId: message.replyToMessageId,
      quotedMessageId: message.quotedMessageId,
    });
    if (parsed.eventType === "UPDATE") {
      const updateId = await this.handleUpdate(message.sourceId, message.authorId, parsed, actor);
      return { kind: "UPDATE", updateId, status: "CREATED" };
    }
    const signal = await this.handleNewSignal(message.sourceId, parsed, actor);
    return { kind: "SIGNAL", signalId: signal.id, status: signal.status };
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
    for (const s of signals) {
      const payload = s.versions[0]?.normalizedPayloadJson as {
        source_message_id?: string;
      } | null;
      if (payload?.source_message_id) externalIds.add(payload.source_message_id);
      for (const u of s.updates) externalIds.add(u.sourceMessage.externalMessageId);
    }
    const messages = await this.prisma.sourceMessage.findMany({
      where: { externalMessageId: { in: [...externalIds] }, sourceId },
    });
    const byExternalId = new Map(messages.map((m) => [m.externalMessageId, m]));
    const candidates = signals.map((s) => {
      const payload = s.versions[0]?.normalizedPayloadJson as {
        source_message_id?: string;
        thread_id?: string | null;
      } | null;
      const origin = payload?.source_message_id
        ? byExternalId.get(payload.source_message_id)
        : undefined;
      const ids = [
        ...(payload?.source_message_id ? [payload.source_message_id] : []),
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
