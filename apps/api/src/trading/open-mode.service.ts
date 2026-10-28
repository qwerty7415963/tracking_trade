import { BadRequestException, Injectable } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";

export const OPEN_MODES = ["MANUAL", "AUTO"] as const;
export type OpenMode = (typeof OPEN_MODES)[number];

const OPEN_MODE_KEY = "open_mode";

/**
 * Global open-mode switch, read fresh from DB on every check (no cache,
 * so a flip takes effect immediately). Missing row fails safe to MANUAL:
 * every post waits for manual approval.
 */
@Injectable()
export class OpenModeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getMode(): Promise<OpenMode> {
    const row = await this.prisma.systemSetting
      .findUnique({ where: { key: OPEN_MODE_KEY } })
      .catch(() => null);
    return row?.value === "AUTO" ? "AUTO" : "MANUAL";
  }

  async setMode(mode: string, actor: string): Promise<OpenMode> {
    const upper = mode.trim().toUpperCase();
    if (!OPEN_MODES.includes(upper as OpenMode)) {
      throw new BadRequestException("mode must be MANUAL or AUTO");
    }
    const next = upper as OpenMode;
    await this.prisma.systemSetting.upsert({
      where: { key: OPEN_MODE_KEY },
      create: { key: OPEN_MODE_KEY, value: next, updatedBy: actor },
      update: { value: next, updatedBy: actor },
    });
    await this.audit.record(actor, "system.open-mode", { mode: next });
    return next;
  }
}
