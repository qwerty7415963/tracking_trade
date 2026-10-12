import { Injectable } from "@nestjs/common";
import { KillSwitchMode } from "@tracking-auto/domain";
import { AuditService } from "../audit/audit.service";

@Injectable()
export class KillSwitchService {
  // In-memory by design: kill switch never auto-engages after restart.
  private mode: KillSwitchMode = "OFF";

  getMode(): KillSwitchMode {
    return this.mode;
  }

  constructor(private readonly audit: AuditService) {}

  async setMode(mode: KillSwitchMode, actor: string): Promise<KillSwitchMode> {
    this.mode = mode;
    await this.audit.record(actor, "kill-switch.set", { mode });
    return this.mode;
  }
}
