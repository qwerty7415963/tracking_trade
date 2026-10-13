import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { BrokerStateService } from "../bridge/broker-state.service";

export interface ReconcileReport {
  unknownPositions: Array<{ positionId: string; symbol: string; volume: number }>;
  reconciledCommands: string[];
}

/** Broker is the source of truth. Flags anything in the broker unknown to the DB. */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly brokerState: BrokerStateService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async reconcileAccount(accountId: string, actor: string): Promise<ReconcileReport> {
    const brokerPositions = await this.brokerState.positions(accountId);
    const openExecutions = await this.prisma.execution.findMany({
      where: { executionStatus: "OPEN", command: { accountId } },
    });
    const known = new Set(
      openExecutions.map((e) => e.brokerPositionId).filter((v): v is string => !!v),
    );
    const unknownPositions = brokerPositions
      .filter((p) => !known.has(p.positionId))
      .map((p) => ({ positionId: p.positionId, symbol: p.symbol, volume: p.volume }));

    for (const u of unknownPositions) {
      await this.prisma.riskEvent.create({
        data: {
          checkName: "RECONCILE_UNKNOWN_POSITION",
          passed: false,
          reason: `broker position ${u.positionId} (${u.symbol}) unknown to DB`,
          configJson: { accountId } as never,
        },
      });
    }

    const stale = await this.prisma.executionCommand.findMany({
      where: { accountId, status: { in: ["TIMEOUT_UNKNOWN", "RECONCILING", "SENT"] } },
    });
    const reconciledCommands: string[] = [];
    for (const cmd of stale) {
      // Expiry without confirmation -> UNKNOWN. Confirmation itself
      // arrives via POST /bridge/commands/:id/response (EA poll topology).
      const expired = cmd.expiresAt ? Date.now() > cmd.expiresAt.getTime() : false;
      if (expired && cmd.status !== "TIMEOUT_UNKNOWN") {
        await this.prisma.executionCommand.update({
          where: { id: cmd.id },
          data: { status: "TIMEOUT_UNKNOWN" },
        });
        reconciledCommands.push(cmd.id);
      }
    }

    await this.audit.record(actor, "operations.reconcile", {
      accountId,
      unknown: unknownPositions.length,
      reconciled: reconciledCommands.length,
    });
    return { unknownPositions, reconciledCommands };
  }

  defaultAccount(): string {
    return this.config.mt5AccountId;
  }
}
