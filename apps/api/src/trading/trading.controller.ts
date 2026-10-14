import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsIn, IsInt, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { KillSwitchMode } from "@tracking-auto/domain";
import { OperatorGuard } from "../auth/operator.guard";
import { ApprovalFlowService } from "./approval-flow.service";
import { KillSwitchService } from "./kill-switch.service";
import { VirtualAccountsService } from "./virtual-accounts.service";
import { VirtualTradingService } from "./virtual-trading.service";

interface OperatorRequest {
  operatorUsername?: string;
}

class CreateAccountDto {
  @IsString()
  name!: string;

  @IsNumber()
  @Min(0)
  balance!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  leverage?: number;

  @IsOptional()
  @IsIn(["APPROVE", "AUTO"])
  mode?: string;
}

class AmountDto {
  @IsNumber()
  @Min(0)
  amount!: number;
}

class ResetDto {
  @IsNumber()
  @Min(0)
  balance!: number;
}

class PatchAccountDto {
  @IsOptional()
  @IsIn(["APPROVE", "AUTO"])
  mode?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  leverage?: number;
}

class OpenPositionDto {
  @IsString()
  signalId!: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  destinationChatId?: string;
}

class KillSwitchDto {
  @IsIn(["OFF", "STOP_NEW_TRADES", "STOP_ALL_MUTATIONS"])
  mode!: KillSwitchMode;
}

@Controller("v1/operations")
export class OperationsController {
  constructor(private readonly killSwitch: KillSwitchService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Post("kill-switch")
  @UseGuards(OperatorGuard)
  setKillSwitch(@Body() dto: KillSwitchDto, @Req() req: OperatorRequest) {
    return this.killSwitch.setMode(dto.mode, this.actor(req));
  }
}

@Controller("v1/accounts")
export class AccountsController {
  constructor(
    private readonly accounts: VirtualAccountsService,
    private readonly trading: VirtualTradingService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  @UseGuards(OperatorGuard)
  list() {
    return this.accounts.list();
  }

  @Post()
  @UseGuards(OperatorGuard)
  create(@Body() dto: CreateAccountDto, @Req() req: OperatorRequest) {
    return this.accounts.create(dto, this.actor(req));
  }

  @Get(":id")
  @UseGuards(OperatorGuard)
  view(@Param("id") id: string) {
    return this.accounts.view(id);
  }

  @Post(":id/deposit")
  @UseGuards(OperatorGuard)
  deposit(@Param("id") id: string, @Body() dto: AmountDto, @Req() req: OperatorRequest) {
    return this.accounts.deposit(id, dto.amount, this.actor(req));
  }

  @Post(":id/withdraw")
  @UseGuards(OperatorGuard)
  withdraw(@Param("id") id: string, @Body() dto: AmountDto, @Req() req: OperatorRequest) {
    return this.accounts.withdraw(id, dto.amount, this.actor(req));
  }

  @Post(":id/reset")
  @UseGuards(OperatorGuard)
  reset(@Param("id") id: string, @Body() dto: ResetDto, @Req() req: OperatorRequest) {
    const actor = this.actor(req);
    return this.accounts.reset(id, dto.balance, actor, (positionId) =>
      this.trading.closePosition(positionId, actor).then(() => undefined),
    );
  }

  @Patch(":id")
  @UseGuards(OperatorGuard)
  async patch(@Param("id") id: string, @Body() dto: PatchAccountDto, @Req() req: OperatorRequest) {
    if (dto.mode !== undefined) return this.accounts.setMode(id, dto.mode, this.actor(req));
    if (dto.leverage !== undefined) return this.accounts.setLeverage(id, dto.leverage, this.actor(req));
    return this.accounts.get(id);
  }
}

@Controller("v1/positions")
export class PositionsController {
  constructor(
    private readonly trading: VirtualTradingService,
    private readonly flow: ApprovalFlowService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  @UseGuards(OperatorGuard)
  list(@Query("status") status?: string) {
    return this.trading.listPositions(status);
  }

  @Get(":id")
  @UseGuards(OperatorGuard)
  get(@Param("id") id: string) {
    return this.trading.getPosition(id);
  }

  @Post("open")
  @UseGuards(OperatorGuard)
  open(@Body() dto: OpenPositionDto, @Req() req: OperatorRequest) {
    return this.flow.openSignal(dto.signalId, dto.accountId, this.actor(req), dto.destinationChatId);
  }

  @Post(":id/close")
  @UseGuards(OperatorGuard)
  close(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.trading.closePosition(id, this.actor(req));
  }
}
