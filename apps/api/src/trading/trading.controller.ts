import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { IsIn, IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, Min } from "class-validator";
import { KillSwitchMode } from "@tracking-auto/domain";
import { OperatorGuard } from "../auth/operator.guard";
import { CoinsService } from "../coins/coins.service";
import { PublicationsService } from "../reporting/publications.service";
import { ApprovalFlowService } from "./approval-flow.service";
import { KillSwitchService } from "./kill-switch.service";
import { OpenModeService } from "./open-mode.service";
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

class ManualTpDto {
  @IsOptional()
  @IsPositive()
  size?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.0001)
  @Max(100)
  percent?: number;
}

class UpdateStopLossDto {
  @IsNumber()
  @IsPositive()
  stopLoss!: number;
}

class KillSwitchDto {
  @IsIn(["OFF", "STOP_NEW_TRADES", "STOP_ALL_MUTATIONS"])
  mode!: KillSwitchMode;
}

class OpenModeDto {
  @IsIn(["MANUAL", "AUTO"])
  mode!: string;
}

class NotionalDto {
  @IsNumber()
  @IsPositive()
  notionalUsd!: number;
}

@Controller("v1/operations")
export class OperationsController {
  constructor(
    private readonly killSwitch: KillSwitchService,
    private readonly openMode: OpenModeService,
    private readonly coins: CoinsService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Post("kill-switch")
  @UseGuards(OperatorGuard)
  setKillSwitch(@Body() dto: KillSwitchDto, @Req() req: OperatorRequest) {
    return this.killSwitch.setMode(dto.mode, this.actor(req));
  }

  @Get("open-mode")
  @UseGuards(OperatorGuard)
  getOpenMode() {
    return this.openMode.getMode().then((mode) => ({ mode }));
  }

  @Post("open-mode")
  @UseGuards(OperatorGuard)
  setOpenMode(@Body() dto: OpenModeDto, @Req() req: OperatorRequest) {
    return this.openMode.setMode(dto.mode, this.actor(req)).then((mode) => ({ mode }));
  }

  @Get("notional")
  @UseGuards(OperatorGuard)
  listNotional() {
    return this.coins.listNotionals();
  }

  @Put("notional/:symbol")
  @UseGuards(OperatorGuard)
  setNotional(
    @Param("symbol") symbol: string,
    @Body() dto: NotionalDto,
    @Req() req: OperatorRequest,
  ) {
    return this.coins.setNotional(symbol, dto.notionalUsd, this.actor(req));
  }

  @Delete("notional/:symbol")
  @UseGuards(OperatorGuard)
  resetNotional(@Param("symbol") symbol: string, @Req() req: OperatorRequest) {
    return this.coins.resetNotional(symbol, this.actor(req));
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
    private readonly publications: PublicationsService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  private async publishManualCard(
    positionId: string,
    status: "tp" | "close",
    opts: { markPrice?: number; volume: number; open: boolean },
    req: OperatorRequest,
  ): Promise<{ publicationId?: string; cardError?: string }> {
    try {
      const publication = await this.publications.requestPositionPublish(
        positionId,
        status,
        opts,
        this.actor(req),
      );
      return { publicationId: publication.publicationId };
    } catch (err) {
      return {
        cardError:
          err instanceof Error ? err.message.split(":")[0] : "CARD_PUBLISH_FAILED",
      };
    }
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

  @Post(":id/tp")
  @UseGuards(OperatorGuard)
  async takeProfit(
    @Param("id") id: string,
    @Body() dto: ManualTpDto,
    @Req() req: OperatorRequest,
  ) {
    const result = await this.trading.takeProfitManual(
      id,
      {
        ...(dto.size !== undefined ? { size: dto.size } : {}),
        ...(dto.percent !== undefined ? { percent: dto.percent } : {}),
      },
      this.actor(req),
    );
    const card = await this.publishManualCard(
      id,
      "tp",
      {
        markPrice: result.markPrice,
        volume: result.fullyClosed ? result.closedSize : result.remainingSize,
        open: !result.fullyClosed,
      },
      req,
    );
    return { ...result, ...card };
  }

  @Patch(":id/stop-loss")
  @UseGuards(OperatorGuard)
  updateStopLoss(
    @Param("id") id: string,
    @Body() dto: UpdateStopLossDto,
    @Req() req: OperatorRequest,
  ) {
    return this.trading.updateStopLoss(id, dto.stopLoss, this.actor(req));
  }

  @Post(":id/close")
  @UseGuards(OperatorGuard)
  async close(@Param("id") id: string, @Req() req: OperatorRequest) {
    const result = await this.trading.closePosition(id, this.actor(req));
    if ("cancelled" in result && result.cancelled) {
      return result;
    }
    const raw = result.position.closePrice === null ? null : Number(result.position.closePrice);
    const card = await this.publishManualCard(
      id,
      "close",
      {
        ...(raw !== null && Number.isFinite(raw) ? { markPrice: raw } : {}),
        volume: result.closedSize,
        open: false,
      },
      req,
    );
    return { ...result, ...card };
  }
}
