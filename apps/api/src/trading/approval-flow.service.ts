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
  /** Limit order is resting; its text placement post is already published. */
  awaitingEntry: boolean;
}

/** Publish knobs for approve — /pos defers the render behind the style dialog. */
export interface ApprovePublishOptions {
  /** Card image style persisted on the position (inheritance source). */
  cardKind?: CardKind;
  /** Hold the render job this long (style dialog, 1 minute). */
  renderDelayMs?: number;
  /** Optional per-command notional override for /pos. */
  targetNotional?: number;
  /** /pos entry-market only: wait before taking the execution mid. */
  marketEntryDelayMs?: number;
  /** /pos entry-market only: maximum wait for a price change before opening. */
  marketEntryMaxWaitMs?: number;
  /** /pos entry-market only: open card cannot render before entry + this age. */
  marketCardMinAgeMs?: number;
  /** /pos entry-market only: maximum wait for mark to differ from entry before publishing. */
  marketCardPriceChangeMaxMs?: number;
  /** Poll interval for the price-change wait. */
  marketCardPriceChangePollMs?: number;
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
      const { position, created, awaitingEntry } = await this.trading.openApproved(
        signalId,
        account.id,
        actor,
        {
          ...(publishOpts.marketEntryDelayMs
            ? { marketEntryDelayMs: publishOpts.marketEntryDelayMs }
            : {}),
          ...(publishOpts.marketEntryMaxWaitMs !== undefined
            ? { marketEntryMaxWaitMs: publishOpts.marketEntryMaxWaitMs }
            : {}),
          ...(publishOpts.targetNotional !== undefined
            ? { targetNotional: publishOpts.targetNotional }
            : {}),
        },
      );
      let published = false;
      if (awaitingEntry && publishOpts.cardKind) {
        await this.prisma.virtualPosition.update({
          where: { id: position.id },
          data: { cardKind: publishOpts.cardKind, styleChosen: true },
        });
      }
      if (created) {
        published = awaitingEntry
          ? await this.publishLimitText(position.id, actor, destinationChatId)
          : await this.publishOpened(position.id, actor, destinationChatId, publishOpts);
      }
      return { approval, position, openError: null, published, awaitingEntry };
    } catch (err) {
      const openError = err instanceof Error ? err.message : "unknown open failure";
      await this.audit.record(actor, "position.open_failed", { signalId, openError });
      return { approval, position: null, openError, published: false, awaitingEntry: false };
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
    const { position, created, awaitingEntry } = await this.trading.openApproved(
      signalId,
      account.id,
      actor,
    );
    const published = created
      ? awaitingEntry
        ? await this.publishLimitText(position.id, actor, destinationChatId)
        : await this.publishOpened(position.id, actor, destinationChatId)
      : false;
    return { position, created, published, awaitingEntry };
  }

  /** Immediately announce a resting limit order; failures never fail the open. */
  private async publishLimitText(
    positionId: string,
    actor: string,
    destinationChatId?: string,
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
      await this.publications.requestLimitTextPublish(
        positionId,
        { destinationChatId: destination },
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

  private async publishOpened(
    positionId: string,
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
      const minRenderAt =
        publishOpts.marketCardMinAgeMs && publishOpts.marketCardMinAgeMs > 0
          ? Date.now() + publishOpts.marketCardMinAgeMs
          : undefined;
      const priceChangeMaxMs = publishOpts.marketCardPriceChangeMaxMs ?? 0;
      const priceChangeDeadline =
        priceChangeMaxMs > 0 ? Date.now() + priceChangeMaxMs : undefined;
      await this.publications.requestPositionPublish(
        positionId,
        "filled",
        {
          destinationChatId: destination,
          ...(publishOpts.cardKind ? { cardKind: publishOpts.cardKind } : {}),
          ...(publishOpts.renderDelayMs ? { renderDelayMs: publishOpts.renderDelayMs } : {}),
          ...(minRenderAt ? { minRenderAt } : {}),
          ...(priceChangeDeadline
            ? {
                awaitPriceChange: true,
                priceChangeDeadline,
                priceChangePollMs: publishOpts.marketCardPriceChangePollMs ?? 3000,
              }
            : {}),
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
