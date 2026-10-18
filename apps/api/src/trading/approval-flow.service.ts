import { Injectable } from "@nestjs/common";
import { CardKind } from "@tracking-auto/card-renderer";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { PublicationsService } from "../reporting/publications.service";
import { ApproveSignalDto } from "../signals/dto/signal.dto";
import { SignalsService } from "../signals/signals.service";
import { OpenModeService } from "./open-mode.service";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";

export interface ApproveOutcome {
  approval: unknown;
  position: unknown | null;
  openError: string | null;
  published: boolean;
}

/** Publish knobs for approve — /pos defers the render behind the style dialog. */
export interface ApprovePublishOptions {
  /** Card image style persisted on the position (inheritance source). */
  cardKind?: CardKind;
  /** Hold the render job this long (style dialog, 5 minutes). */
  renderDelayMs?: number;
}

@Injectable()
export class ApprovalFlowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly signals: SignalsService,
    private readonly trading: VirtualTradingService,
    private readonly accounts: VirtualAccountsService,
    private readonly publications: PublicationsService,
    private readonly openMode: OpenModeService,
  ) {}

  private async resolveAccount(accountId?: string) {
    if (accountId) return this.accounts.get(accountId);
    try {
      return await this.accounts.defaultAccount();
    } catch {
      throw new Error("NO_ACCOUNT: create a virtual account first");
    }
  }

  private destinationOrNull(explicit?: string): string | null {
    const chat = explicit ?? process.env.REPORT_DESTINATION_CHAT_ID ?? "";
    return chat.trim().length > 0 ? chat.trim() : null;
  }

  /**
   * Approve a signal and immediately open the paper position
   * (approve = open). Publish failure never fails the open.
   */
  async approveSignal(
    signalId: string,
    dto: ApproveSignalDto,
    actor: string,
    accountId?: string,
    destinationChatId?: string,
    publishOpts: ApprovePublishOptions = {},
  ): Promise<ApproveOutcome> {
    const approval = await this.signals.approve(signalId, dto, actor);
    const account = await this.resolveAccount(accountId);
    try {
      const { position, created } = await this.trading.openApproved(signalId, account.id, actor);
      let published = false;
      if (created) {
        published = await this.publishOpened(
          position.id,
          Number((position as { entryPrice: unknown }).entryPrice),
          actor,
          destinationChatId,
          publishOpts,
        );
      }
      return { approval, position, openError: null, published };
    } catch (err) {
      const openError = err instanceof Error ? err.message : "unknown open failure";
      await this.audit.record(actor, "position.open_failed", { signalId, openError });
      return { approval, position: null, openError, published: false };
    }
  }

  /** Explicit retry for APPROVE-mode signals whose open failed or is pending. */
  async openSignal(
    signalId: string,
    accountId: string | undefined,
    actor: string,
    destinationChatId?: string,
  ) {
    const account = await this.resolveAccount(accountId);
    const { position, created } = await this.trading.openApproved(signalId, account.id, actor);
    const published = created
      ? await this.publishOpened(
          position.id,
          Number((position as { entryPrice: unknown }).entryPrice),
          actor,
          destinationChatId,
        )
      : false;
    return { position, created, published };
  }

  private async publishOpened(
    positionId: string,
    markPrice: number,
    actor: string,
    destinationChatId?: string,
    publishOpts: ApprovePublishOptions = {},
  ): Promise<boolean> {
    const destination = this.destinationOrNull(destinationChatId);
    if (!destination) {
      await this.audit.record(actor, "publication.skipped", {
        positionId,
        reason: "no destination chat configured",
      });
      return false;
    }
    try {
      await this.publications.requestPositionPublish(
        positionId,
        "filled",
        {
          markPrice,
          destinationChatId: destination,
          ...(publishOpts.cardKind ? { cardKind: publishOpts.cardKind } : {}),
          ...(publishOpts.renderDelayMs ? { renderDelayMs: publishOpts.renderDelayMs } : {}),
        },
        actor,
      );
      return true;
    } catch (err) {
      await this.audit.record(actor, "publication.skipped", {
        positionId,
        reason: err instanceof Error ? err.message : "unknown",
      });
      return false;
    }
  }

  /**
   * AUTO-mode trigger, called after ingest creates a clean PENDING_APPROVAL
   * signal. Returns what happened; never throws (ingest must not fail).
   */
  async processNewSignal(
    signalId: string,
  ): Promise<{ action: "opened" | "wait" | "skip"; reason?: string; positionId?: string }> {
    if ((await this.openMode.getMode()) !== "AUTO") {
      return { action: "wait", reason: "manual-mode" };
    }
    let account;
    try {
      account = await this.resolveAccount(undefined);
    } catch {
      return { action: "skip", reason: "no-account" };
    }
    if (account.mode !== "AUTO") return { action: "wait" };
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: { versions: { orderBy: { versionNumber: "desc" }, take: 1 } },
    });
    if (!signal || signal.status !== "PENDING_APPROVAL" || !signal.versions[0]) {
      return { action: "skip", reason: "not-clean" };
    }
    try {
      const outcome = await this.approveSignal(
        signalId,
        { signalVersionId: signal.versions[0].id },
        "system:auto",
        account.id,
      );
      if (!outcome.position) {
        return { action: "skip", reason: outcome.openError ?? "open-failed" };
      }
      return { action: "opened", positionId: (outcome.position as { id: string }).id };
    } catch (err) {
      return { action: "skip", reason: err instanceof Error ? err.message : "auto-failed" };
    }
  }
}
