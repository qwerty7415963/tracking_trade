import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Source } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateSourceDto, UpdateSourceDto } from "./dto/source.dto";
import { TelegramCollectorService } from "../telegram/telegram-collector.service";
import { XCollectorService } from "../x/x-collector.service";

export interface SourceHealth {
  enabled: boolean;
  status: "ok" | "error";
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

export interface ConnectionTestResult {
  ok: boolean;
  code: string | null;
}

export interface BulkItemResult {
  input: string;
  status: "created" | "skipped-duplicate" | "deleted" | "failed";
  sourceId: string | null;
  reason: string | null;
}

/** Parse "x:@handle" / "tg:@handle" / "@handle" / raw id. Default platform TELEGRAM. */
export function parseSourceRef(raw: string): { platform: string; handle: string } {
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("x:")) return { platform: "X", handle: trimmed.slice(2).trim() };
  if (lower.startsWith("tg:") || lower.startsWith("telegram:")) {
    return { platform: "TELEGRAM", handle: trimmed.split(":").slice(1).join(":").trim() };
  }
  return { platform: "TELEGRAM", handle: trimmed };
}

export function normalizeHandle(handle: string): string {
  return handle.trim().replace(/^@+/, "");
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function matchesExternalId(source: Source, platform: string, normalizedHandle: string): boolean {
  return (
    source.platform === platform &&
    (source.externalSourceId.toLowerCase() === normalizedHandle ||
      normalizeHandle(source.externalSourceId).toLowerCase() === normalizedHandle)
  );
}

@Injectable()
export class SourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly telegram: TelegramCollectorService,
    private readonly x: XCollectorService,
  ) {}

  list(): Promise<Source[]> {
    return this.prisma.source.findMany({
      where: { deletedAt: null },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async get(id: string): Promise<Source> {
    const source = await this.prisma.source.findFirst({ where: { id, deletedAt: null } });
    if (!source) throw new NotFoundException(`source ${id} not found`);
    return source;
  }

  /**
   * Resolve a user-supplied ref (uuid id, @handle, or display name) to exactly
   * one source. Never guesses: 0 hits or 2+ hits both throw with a clear message.
   */
  async resolve(ref: string, platform?: string): Promise<Source> {
    const trimmed = ref.trim();
    if (!trimmed) throw new NotFoundException("empty source ref");
    if (UUID_PATTERN.test(trimmed)) {
      const direct = await this.prisma.source.findFirst({
        where: { id: trimmed, deletedAt: null },
      });
      if (direct && (!platform || direct.platform === platform)) return direct;
    }

    const { platform: parsedPlatform, handle } = parseSourceRef(trimmed);
    const wantedPlatform = platform ?? parsedPlatform;
    const normalized = normalizeHandle(handle).toLowerCase();
    if (!normalized) throw new NotFoundException("empty source ref");

    const candidates = await this.prisma.source.findMany({ where: { deletedAt: null } });
    const handleHits = candidates.filter((s) => matchesExternalId(s, wantedPlatform, normalized));
    if (handleHits.length === 1) return handleHits[0];
    if (handleHits.length > 1) {
      const names = handleHits.map((s) => `${s.displayName} (${s.id})`).join(", ");
      throw new ConflictException(`ambiguous "${trimmed}", matches: ${names} — use id`);
    }

    const nameHits = candidates.filter(
      (s) => s.platform === wantedPlatform && s.displayName.toLowerCase() === normalized,
    );
    if (nameHits.length === 0) {
      throw new NotFoundException(`no source matches "${trimmed}"`);
    }
    if (nameHits.length > 1) {
      const names = nameHits.map((s) => `${s.displayName} (${s.id})`).join(", ");
      throw new ConflictException(`ambiguous "${trimmed}", matches: ${names} — use id`);
    }
    return nameHits[0];
  }

  /**
   * Bulk create, one result per line. A bad line never fails the batch;
   * existing (platform, externalSourceId) rows are skipped, not duplicated.
   */
  async bulkCreate(
    items: Array<{ raw: string; sourceKind?: string; priority?: number }>,
    actor: string,
  ): Promise<BulkItemResult[]> {
    const results: BulkItemResult[] = [];
    for (const item of items) {
      const { platform, handle } = parseSourceRef(item.raw);
      const normalized = normalizeHandle(handle).toLowerCase();
      if (!normalized) {
        results.push({ input: item.raw, status: "failed", sourceId: null, reason: "empty line" });
        continue;
      }
      const existing = (await this.prisma.source.findMany({ where: { deletedAt: null } })).find(
        (s) => matchesExternalId(s, platform, normalized),
      );
      if (existing) {
        results.push({
          input: item.raw,
          status: "skipped-duplicate",
          sourceId: existing.id,
          reason: null,
        });
        continue;
      }
      try {
        const created = await this.create(
          {
            platform,
            externalSourceId: normalized,
            displayName: handle.trim(),
            sourceKind: item.sourceKind ?? "SIGNAL",
            priority: item.priority ?? 0,
          },
          actor,
        );
        results.push({ input: item.raw, status: "created", sourceId: created.id, reason: null });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const existing = (
            await this.prisma.source.findMany({ where: { deletedAt: null } })
          ).find((s) => matchesExternalId(s, platform, normalized));
          results.push({
            input: item.raw,
            status: "skipped-duplicate",
            sourceId: existing?.id ?? null,
            reason: null,
          });
        } else {
          results.push({
            input: item.raw,
            status: "failed",
            sourceId: null,
            reason: err instanceof Error ? err.message.split(":")[0] : "unknown error",
          });
        }
      }
    }
    return results;
  }

  /** Bulk soft-delete by id refs. One result per line, same never-fail-batch rule. */
  async bulkRemove(refs: string[], actor: string): Promise<BulkItemResult[]> {
    const results: BulkItemResult[] = [];
    for (const ref of refs) {
      if (!ref.trim()) {
        results.push({ input: ref, status: "failed", sourceId: null, reason: "empty line" });
        continue;
      }
      try {
        const source = await this.resolve(ref);
        await this.remove(source.id, actor);
        results.push({ input: ref, status: "deleted", sourceId: source.id, reason: null });
      } catch (err) {
        results.push({
          input: ref,
          status: "failed",
          sourceId: null,
          reason: err instanceof Error ? err.message.split(":")[0] : "unknown error",
        });
      }
    }
    return results;
  }

  async create(dto: CreateSourceDto, actor: string): Promise<Source> {
    const source = await this.prisma.source.create({
      data: {
        platform: dto.platform,
        externalSourceId: dto.externalSourceId,
        displayName: dto.displayName,
        sourceKind: dto.sourceKind,
        priority: dto.priority ?? 0,
        collectionConfigJson: (dto.collectionConfig ?? Prisma.DbNull) as Prisma.InputJsonValue,
        parserProfileId: dto.parserProfileId,
        createdBy: actor,
      },
    });
    await this.audit.record(actor, "source.create", { sourceId: source.id });
    return source;
  }

  async update(id: string, dto: UpdateSourceDto, actor: string): Promise<Source> {
    await this.get(id);
    const source = await this.prisma.source.update({
      where: { id },
      data: {
        displayName: dto.displayName,
        sourceKind: dto.sourceKind,
        priority: dto.priority,
        collectionConfigJson:
          dto.collectionConfig === undefined
            ? undefined
            : (dto.collectionConfig as Prisma.InputJsonValue),
        parserProfileId: dto.parserProfileId,
        updatedBy: actor,
      },
    });
    await this.audit.record(actor, "source.update", { sourceId: id });
    return source;
  }

  async remove(id: string, actor: string): Promise<Source> {
    await this.get(id);
    const source = await this.prisma.source.update({
      where: { id },
      data: { deletedAt: new Date(), enabled: false, updatedBy: actor },
    });
    await this.audit.record(actor, "source.delete", { sourceId: id });
    return source;
  }

  async setEnabled(id: string, enabled: boolean, actor: string): Promise<Source> {
    await this.get(id);
    const source = await this.prisma.source.update({
      where: { id },
      data: { enabled, updatedBy: actor },
    });
    await this.audit.record(actor, enabled ? "source.enable" : "source.disable", { sourceId: id });
    return source;
  }

  async health(id: string): Promise<SourceHealth> {
    const source = await this.get(id);
    return {
      enabled: source.enabled,
      status: source.lastErrorCode ? "error" : "ok",
      lastErrorCode: source.lastErrorCode,
      lastErrorAt: source.lastErrorAt ? source.lastErrorAt.toISOString() : null,
    };
  }

  async testConnection(id: string, actor: string): Promise<ConnectionTestResult> {
    const source = await this.get(id);
    const result =
      source.platform === "TELEGRAM"
        ? await this.telegram.checkSource(source)
        : await this.x.checkSource(source);
    await this.prisma.source.update({
      where: { id },
      data: {
        lastErrorCode: result.code,
        lastErrorAt: result.ok ? null : new Date(),
      },
    });
    await this.audit.record(actor, "source.test-connection", { sourceId: id, ok: result.ok });
    return result;
  }
}
