import { Injectable, NotFoundException } from "@nestjs/common";
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
