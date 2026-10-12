import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Execution, ExecutionCommand } from "@prisma/client";
import { randomUUID } from "crypto";
import {
  BRIDGE_SCHEMA_VERSION,
  BridgeCommand,
  BridgeCommandType,
  BridgeResponse,
} from "@tracking-auto/mt5-bridge-contract";
import {
  DEFAULT_RISK_LIMITS,
  calcPositionSize,
  evaluateRisk,
  isVolumeStepAligned,
} from "@tracking-auto/domain";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { Inject } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { BRIDGE_PORT, BridgePort } from "../bridge/mt5-bridge.adapter";
import { KillSwitchService } from "./kill-switch.service";

const OPEN_STATUSES = ["SENT", "TIMEOUT_UNKNOWN", "RECONCILING", "ACKNOWLEDGED"];

function openKey(signalId: string, versionId: string): string {
  return `open:${signalId}:${versionId}`;
}

@Injectable()
export class ExecutionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(BRIDGE_PORT) private readonly bridge: BridgePort,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly killSwitch: KillSwitchService,
  ) {}

  list(status?: string) {
    return this.prisma.execution.findMany({
      where: status ? { executionStatus: status } : undefined,
      orderBy: { id: "desc" },
      include: { command: true },
    });
  }

  async get(id: string) {
    const execution = await this.prisma.execution.findUnique({
      where: { id },
      include: { command: true },
    });
    if (!execution) throw new NotFoundException(`execution ${id} not found`);
    return execution;
  }

  async openFromApproval(
    signalId: string,
    actor: string,
  ): Promise<ExecutionCommand & { executions: Execution[] }> {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        approvals: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!signal) throw new NotFoundException(`signal ${signalId} not found`);
    if (signal.status !== "APPROVED") {
      throw new ConflictException(`signal ${signalId} is ${signal.status}: approval required`);
    }
    const version = signal.versions[0];
    const approval = signal.approvals[0];
    if (!version || !approval || approval.decision !== "APPROVED" || approval.signalVersionId !== version.id) {
      throw new ConflictException("approval stale or missing for current version");
    }
    const ageHours = (Date.now() - signal.createdAt.getTime()) / 3_600_000;
    if (ageHours > this.config.signalMaxAgeHours) {
      throw new ConflictException("signal expired");
    }

    // Never open twice: same idempotency key returns the existing command.
    const key = openKey(signalId, version.id);
    const existing = await this.prisma.executionCommand.findUnique({
      where: { idempotencyKey: key },
      include: { executions: true },
    });
    if (existing) return existing;

    // Never open while a previous OPEN is unresolved.
    const pending = await this.prisma.executionCommand.findFirst({
      where: { signalId, commandType: "OPEN", status: { in: OPEN_STATUSES } },
    });
    if (pending) {
      throw new ConflictException(`unresolved OPEN command ${pending.id}: reconcile first`);
    }

    const accountId = this.config.mt5AccountId;
    if (!accountId) throw new ConflictException("MT5 account not configured");
    const symbol = version.instrument;
    const [info, account, heartbeat] = await Promise.all([
      this.bridge.symbolInfo(accountId, symbol),
      this.bridge.account(accountId),
      this.bridge.heartbeat(accountId),
    ]);
    if (!info) throw new ConflictException(`no symbol map for ${symbol}`);

    const entry = version.entry ? Number(version.entry) : NaN;
    const sl = version.stopLoss ? Number(version.stopLoss) : null;
    if (!Number.isFinite(entry) || sl === null) {
      throw new ConflictException("signal version lacks entry/SL for sizing");
    }
    const sizing = calcPositionSize({
      riskBudget: DEFAULT_RISK_LIMITS.maxRiskPerTrade,
      stopDistance: Math.abs(entry - sl),
      tickValue: info.tickValue,
      tickSize: info.tickSize,
      volumeStep: info.volumeStep,
      minVolume: info.minVolume,
      maxVolume: info.maxVolume,
    });
    if (sizing.rejected) throw new ConflictException(`sizing rejected: ${sizing.reason}`);

    const openPositions = await this.prisma.execution.count({
      where: { executionStatus: "OPEN", command: { accountId } },
    });
    const openForSymbol = await this.prisma.execution.count({
      where: {
        executionStatus: "OPEN",
        command: { accountId },
        brokerPositionId: { not: null },
      },
    });

    const risk = evaluateRisk(
      {
        accountId,
        expectedAccountId: accountId,
        bridgeAlive: heartbeat?.status === "ok",
        killSwitch: this.killSwitch.getMode(),
        isNewOrder: true,
        signalExpired: false,
        approvalValid: true,
        spec: {
          symbol,
          mapped: true,
          spread: info.spread,
          maxSpread: info.spread,
          minVolume: info.minVolume,
          maxVolume: info.maxVolume,
          volumeStep: info.volumeStep,
          stopDistance: info.stopDistance,
          tickValue: info.tickValue,
          tickSize: info.tickSize,
          contractSize: info.contractSize,
        },
        priceDeviation: 0,
        volume: sizing.volume,
        marginFree: account.marginFree ?? account.equity ?? 0,
        marginRequired: account.marginRequired ?? 0,
        stopLossPrice: sl,
        takeProfitPrice: (version.takeProfits as unknown as number[])?.[0] ?? null,
        entryPrice: entry,
        direction: version.direction === "SHORT" ? "SHORT" : "LONG",
        openRisk: 0,
        dailyLoss: 0,
        openPositions,
        openPositionsForSymbol: openForSymbol,
        unknownOpenCommand: false,
        estimatedTradeRisk: sizing.recomputedRisk,
      },
      DEFAULT_RISK_LIMITS,
    );
    await this.prisma.riskEvent.create({
      data: {
        checkName: "OPEN",
        passed: risk.passed,
        reason: risk.passed ? null : risk.failures.join(","),
        configJson: { signalId, versionId: version.id } as never,
      },
    });
    if (!risk.passed) {
      throw new ForbiddenException(`risk rejected: ${risk.failures.join(",")}`);
    }

    const now = new Date();
    const command = await this.prisma.executionCommand.create({
      data: {
        idempotencyKey: key,
        accountId,
        signalId,
        signalVersionId: version.id,
        commandType: "OPEN",
        payloadJson: {
          symbol,
          direction: version.direction,
          volume: sizing.volume,
          entry,
          stopLoss: sl,
        } as never,
        status: "RISK_CHECKED",
        correlationId: randomUUID(),
        expiresAt: new Date(now.getTime() + this.config.bridgeTimeoutMs * 4),
      },
    });
    return this.sendCommand(command.id, actor);
  }

  private buildBridgeCommand(
    command: {
      id: string;
      idempotencyKey: string;
      accountId: string;
      signalId: string | null;
      signalVersionId: string | null;
      commandType: string;
      payloadJson: unknown;
      correlationId: string | null;
      createdAt: Date;
      expiresAt: Date | null;
    },
    executionId: string | null,
  ): BridgeCommand {
    return {
      commandId: command.id,
      idempotencyKey: command.idempotencyKey,
      accountId: command.accountId,
      signalId: command.signalId,
      signalVersionId: command.signalVersionId,
      executionId,
      commandType: command.commandType as BridgeCommandType,
      createdAt: command.createdAt.toISOString(),
      expiresAt: (command.expiresAt ?? new Date()).toISOString(),
      payload: (command.payloadJson ?? {}) as Record<string, unknown>,
      correlationId: command.correlationId,
      schemaVersion: BRIDGE_SCHEMA_VERSION,
    };
  }

  private async sendCommand(
    commandId: string,
    actor: string,
  ): Promise<ExecutionCommand & { executions: Execution[] }> {
    const command = await this.prisma.executionCommand.findUniqueOrThrow({
      where: { id: commandId },
    });
    const execution = await this.prisma.execution.create({
      data: { executionCommandId: command.id, executionStatus: "PENDING" },
    });
    const payload = (command.payloadJson ?? {}) as { volume?: number };
    await this.prisma.execution.update({
      where: { id: execution.id },
      data: { requestedVolume: payload.volume ?? null },
    });

    let response: BridgeResponse;
    try {
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: "SENT" },
      });
      response = await this.withTimeout(
        this.bridge.sendCommand(this.buildBridgeCommand(command, execution.id)),
      );
    } catch (err) {
      // Timeout or transport failure: UNKNOWN, reconcile before any retry.
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: "TIMEOUT_UNKNOWN" },
      });
      await this.audit.record(actor, "execution.timeout-unknown", { commandId: command.id });
      await this.reconcileCommand(command.id, actor).catch(() => {});
      return this.prisma.executionCommand.findUniqueOrThrow({
        where: { id: command.id },
        include: { executions: true },
      });
    }
    return this.applyBridgeResponse(command.id, execution.id, response, actor);
  }

  private async applyBridgeResponse(
    commandId: string,
    executionId: string,
    response: BridgeResponse,
    actor: string,
  ) {
    if (response.result === "CONFIRMED") {
      await this.prisma.executionCommand.update({
        where: { id: commandId },
        data: { status: "CONFIRMED" },
      });
      await this.prisma.execution.update({
        where: { id: executionId },
        data: {
          brokerOrderId: response.brokerOrderId,
          brokerDealId: response.brokerDealId,
          brokerPositionId: response.brokerPositionId,
          filledVolume: response.filledVolume,
          fillPrice: response.fillPrice,
          actualSl: response.actualSl,
          actualTp: response.actualTp,
          executionStatus: "OPEN",
          openedAt: new Date(),
        },
      });
    } else if (response.result === "REJECTED") {
      await this.prisma.executionCommand.update({
        where: { id: commandId },
        data: { status: "REJECTED" },
      });
      await this.prisma.execution.update({
        where: { id: executionId },
        data: { executionStatus: "REJECTED" },
      });
    } else {
      await this.prisma.executionCommand.update({
        where: { id: commandId },
        data: { status: "ACKNOWLEDGED" },
      });
    }
    await this.audit.record(actor, "execution.response", {
      commandId,
      result: response.result,
    });
    return this.prisma.executionCommand.findUniqueOrThrow({
      where: { id: commandId },
      include: { executions: true },
    });
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    const timeout = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("bridge timeout")), this.config.bridgeTimeoutMs);
    });
    return Promise.race([promise, timeout]);
  }

  async reconcileCommand(
    commandId: string,
    actor: string,
  ): Promise<ExecutionCommand & { executions: Execution[] }> {
    const command = await this.prisma.executionCommand.findUniqueOrThrow({
      where: { id: commandId },
      include: { executions: true },
    });
    if (!["TIMEOUT_UNKNOWN", "RECONCILING", "SENT", "ACKNOWLEDGED"].includes(command.status)) {
      return command;
    }
    await this.prisma.executionCommand.update({
      where: { id: commandId },
      data: { status: "RECONCILING" },
    });
    try {
      const status = await this.withTimeout(this.bridge.commandStatus(command.id));
      const execution = command.executions[0];
      if (status.result === "CONFIRMED" && execution) {
        return this.applyBridgeResponse(commandId, execution.id, status, actor);
      }
      if (status.result === "REJECTED" && execution) {
        return this.applyBridgeResponse(commandId, execution.id, status, actor);
      }
      return this.prisma.executionCommand.findUniqueOrThrow({ where: { id: commandId }, include: { executions: true } });
    } catch {
      await this.prisma.executionCommand.update({
        where: { id: commandId },
        data: { status: "TIMEOUT_UNKNOWN" },
      });
      return this.prisma.executionCommand.findUniqueOrThrow({ where: { id: commandId }, include: { executions: true } });
    }
  }

  async modifySltp(executionId: string, stopLoss: number | null, takeProfit: number | null, actor: string) {
    const execution = await this.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { command: true },
    });
    if (execution.executionStatus !== "OPEN") {
      throw new ConflictException("only OPEN executions can be modified");
    }
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") {
      throw new ForbiddenException("kill switch blocks automated mutations");
    }
    const positionId = execution.brokerPositionId;
    if (!positionId) throw new ConflictException("no broker position to modify");
    const command = await this.prisma.executionCommand.create({
      data: {
        idempotencyKey: `modify:${executionId}:${stopLoss}:${takeProfit}:${Date.now()}`,
        accountId: execution.command.accountId,
        signalId: execution.command.signalId,
        signalVersionId: execution.command.signalVersionId,
        commandType: "MODIFY_SLTP",
        payloadJson: { positionId, stopLoss, takeProfit } as never,
        status: "RISK_CHECKED",
        expiresAt: new Date(Date.now() + this.config.bridgeTimeoutMs * 4),
      },
    });
    const response = await this.withTimeout(
      this.bridge.sendCommand(this.buildBridgeCommand(command, execution.id)),
    );
    if (response.result === "CONFIRMED") {
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: "CONFIRMED" },
      });
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          actualSl: response.actualSl ?? stopLoss,
          actualTp: response.actualTp ?? takeProfit,
        },
      });
    } else {
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: response.result === "REJECTED" ? "REJECTED" : "ACKNOWLEDGED" },
      });
    }
    await this.audit.record(actor, "execution.modify", { commandId: command.id });
    return this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
  }

  async partialClose(executionId: string, closeVolume: number, actor: string) {
    const execution = await this.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { command: true },
    });
    if (execution.executionStatus !== "OPEN") throw new ConflictException("only OPEN executions");
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") {
      throw new ForbiddenException("kill switch blocks automated mutations");
    }
    const filled = execution.filledVolume ? Number(execution.filledVolume) : 0;
    const info = await this.bridge.symbolInfo(
      execution.command.accountId,
      (execution.command.payloadJson as { symbol?: string } | null)?.symbol ?? "",
    );
    if (!info) throw new ConflictException("no symbol map");
    if (closeVolume <= 0 || closeVolume > filled) throw new ConflictException("invalid close volume");
    if (!isVolumeStepAligned(closeVolume, info.minVolume, info.volumeStep)) {
      throw new ConflictException("close volume violates broker step");
    }
    const command = await this.prisma.executionCommand.create({
      data: {
        idempotencyKey: `partial:${executionId}:${closeVolume}:${Date.now()}`,
        accountId: execution.command.accountId,
        signalId: execution.command.signalId,
        signalVersionId: execution.command.signalVersionId,
        commandType: "PARTIAL_CLOSE",
        payloadJson: { positionId: execution.brokerPositionId, closeVolume } as never,
        status: "RISK_CHECKED",
        expiresAt: new Date(Date.now() + this.config.bridgeTimeoutMs * 4),
      },
    });
    const response = await this.withTimeout(
      this.bridge.sendCommand(this.buildBridgeCommand(command, execution.id)),
    );
    if (response.result === "CONFIRMED") {
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: "CONFIRMED" },
      });
      const remaining = filled - (response.filledVolume ?? closeVolume);
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: {
          filledVolume: remaining,
          executionStatus: remaining <= 0 ? "CLOSED" : "OPEN",
          closedAt: remaining <= 0 ? new Date() : null,
        },
      });
    }
    await this.audit.record(actor, "execution.partial-close", { commandId: command.id });
    return this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
  }

  async closePosition(executionId: string, actor: string) {
    const execution = await this.prisma.execution.findUniqueOrThrow({
      where: { id: executionId },
      include: { command: true },
    });
    if (execution.executionStatus !== "OPEN") throw new ConflictException("only OPEN executions");
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") {
      throw new ForbiddenException("kill switch blocks automated mutations");
    }
    const command = await this.prisma.executionCommand.create({
      data: {
        idempotencyKey: `close:${executionId}:${Date.now()}`,
        accountId: execution.command.accountId,
        signalId: execution.command.signalId,
        signalVersionId: execution.command.signalVersionId,
        commandType: "CLOSE_POSITION",
        payloadJson: { positionId: execution.brokerPositionId } as never,
        status: "RISK_CHECKED",
        expiresAt: new Date(Date.now() + this.config.bridgeTimeoutMs * 4),
      },
    });
    const response = await this.withTimeout(
      this.bridge.sendCommand(this.buildBridgeCommand(command, execution.id)),
    );
    if (response.result === "CONFIRMED") {
      await this.prisma.executionCommand.update({
        where: { id: command.id },
        data: { status: "CONFIRMED" },
      });
      await this.prisma.execution.update({
        where: { id: execution.id },
        data: { executionStatus: "CLOSED", closedAt: new Date() },
      });
    }
    await this.audit.record(actor, "execution.close", { commandId: command.id });
    return this.prisma.execution.findUniqueOrThrow({ where: { id: execution.id } });
  }
}

