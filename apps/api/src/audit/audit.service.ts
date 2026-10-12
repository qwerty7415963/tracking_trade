import { Injectable } from "@nestjs/common";

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  details?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly buffer: AuditEntry[] = [];

  record(actor: string, action: string, details?: Record<string, unknown>): AuditEntry {
    const entry: AuditEntry = {
      at: new Date().toISOString(),
      actor,
      action,
      details,
    };
    this.buffer.push(entry);
    // Phase 1 sink: structured log. DB sink lands with Prisma wiring.
    console.log(JSON.stringify({ audit: entry }));
    return entry;
  }

  entries(): readonly AuditEntry[] {
    return this.buffer;
  }
}
