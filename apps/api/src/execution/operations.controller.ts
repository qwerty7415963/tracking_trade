import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import { KillSwitchMode } from "@tracking-auto/domain";
import { OperatorGuard } from "../auth/operator.guard";
import { ExecutionService } from "./execution.service";
import { KillSwitchService } from "./kill-switch.service";
import { ReconciliationService } from "./reconciliation.service";

interface OperatorRequest {
  operatorUsername?: string;
}

class KillSwitchDto {
  @IsIn(["OFF", "STOP_NEW_TRADES", "STOP_ALL_MUTATIONS"])
  mode!: KillSwitchMode;
}

class ReconcileDto {
  @IsOptional()
  @IsString()
  accountId?: string;
}

class ModifyDto {
  @IsOptional()
  stopLoss?: number | null;

  @IsOptional()
  takeProfit?: number | null;
}

class PartialCloseDto {
  closeVolume!: number;
}

@Controller("v1/operations")
export class OperationsController {
  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly reconcile: ReconciliationService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Post("kill-switch")
  @UseGuards(OperatorGuard)
  setKillSwitch(@Body() dto: KillSwitchDto, @Req() req: OperatorRequest) {
    return this.killSwitch.setMode(dto.mode, this.actor(req));
  }

  @Post("reconcile")
  @UseGuards(OperatorGuard)
  reconcileNow(@Body() dto: ReconcileDto, @Req() req: OperatorRequest) {
    const accountId = dto.accountId ?? this.reconcile.defaultAccount();
    return this.reconcile.reconcileAccount(accountId, this.actor(req));
  }
}

@Controller("v1/executions")
export class ExecutionsController {
  constructor(private readonly executions: ExecutionService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.executions.list(status);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.executions.get(id);
  }

  @Post("open/:signalId")
  @UseGuards(OperatorGuard)
  open(@Param("signalId") signalId: string, @Req() req: OperatorRequest) {
    return this.executions.openFromApproval(signalId, this.actor(req));
  }

  @Post(":id/modify")
  @UseGuards(OperatorGuard)
  modify(@Param("id") id: string, @Body() dto: ModifyDto, @Req() req: OperatorRequest) {
    return this.executions.modifySltp(id, dto.stopLoss ?? null, dto.takeProfit ?? null, this.actor(req));
  }

  @Post(":id/partial-close")
  @UseGuards(OperatorGuard)
  partialClose(@Param("id") id: string, @Body() dto: PartialCloseDto, @Req() req: OperatorRequest) {
    return this.executions.partialClose(id, dto.closeVolume, this.actor(req));
  }

  @Post(":id/close")
  @UseGuards(OperatorGuard)
  close(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.executions.closePosition(id, this.actor(req));
  }

  @Post("reconcile/:commandId")
  @UseGuards(OperatorGuard)
  reconcileCommand(@Param("commandId") commandId: string, @Req() req: OperatorRequest) {
    return this.executions.reconcileCommand(commandId, this.actor(req));
  }
}
