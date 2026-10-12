import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../database/prisma.service";

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    actor: string,
    action: string,
    details?: Record<string, unknown>,
  ): Promise<AuditEntry> {
    const row = await this.prisma.auditLog.create({
      data: {
        actor,
        action,
        details: (details ?? Prisma.DbNull) as Prisma.InputJsonValue,
      },
    });
    return {
      at: row.createdAt.toISOString(),
      actor: row.actor,
      action: row.action,
      details,
    };
  }
}
