import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { IsIn, IsOptional, IsString } from "class-validator";
import { BridgeResponse } from "@tracking-auto/mt5-bridge-contract";
import { BrokerStateService, HeartbeatPayload } from "./broker-state.service";
import { BridgeAuthGuard } from "./bridge-auth.guard";
import { ExecutionService } from "../execution/execution.service";

class HeartbeatDto implements HeartbeatPayload {
  @IsString()
  accountId!: string;

  @IsOptional()
  @IsString()
  terminal?: string;

  @IsOptional()
  @IsString()
  build?: string;

  @IsString()
  status!: string;

  @IsOptional()
  balance?: number;

  @IsOptional()
  equity?: number;

  @IsOptional()
  margin?: number;

  @IsOptional()
  marginFree?: number;

  @IsOptional()
  marginRequired?: number;

  @IsOptional()
  positions?: HeartbeatPayload["positions"];

  @IsOptional()
  symbols?: HeartbeatPayload["symbols"];
}

class CommandResponseDto {
  @IsIn(["ACCEPTED", "REJECTED", "IN_PROGRESS", "CONFIRMED", "UNKNOWN"])
  result!: BridgeResponse["result"];

  @IsOptional()
  brokerRetcode?: number | null;

  @IsOptional()
  brokerOrderId?: string | null;

  @IsOptional()
  brokerDealId?: string | null;

  @IsOptional()
  brokerPositionId?: string | null;

  @IsOptional()
  requestedVolume?: number | null;

  @IsOptional()
  filledVolume?: number | null;

  @IsOptional()
  fillPrice?: number | null;

  @IsOptional()
  actualSl?: number | null;

  @IsOptional()
  actualTp?: number | null;
}

@Controller("v1/bridge")
@UseGuards(BridgeAuthGuard)
export class BridgeController {
  constructor(
    private readonly brokerState: BrokerStateService,
    private readonly executions: ExecutionService,
  ) {}

  @Post("heartbeat")
  heartbeat(@Body() dto: HeartbeatDto) {
    return this.brokerState.recordHeartbeat(dto);
  }

  @Get("commands")
  async pendingCommands(@Query("accountId") accountId: string) {
    const rows = await this.executions.listPendingCommands(accountId);
    const mapped = await Promise.all(
      rows.map(async (row) => {
        const full = await this.executions.getCommandWithExecutions(row.id);
        return this.executions.toBridgeCommand(full, full.executions[0]?.id ?? null);
      }),
    );
    return mapped;
  }

  @Post("commands/:id/response")
  respond(@Param("id") id: string, @Body() dto: CommandResponseDto) {
    const response: BridgeResponse = {
      ...dto,
      brokerRetcode: dto.brokerRetcode ?? null,
      brokerOrderId: dto.brokerOrderId ?? null,
      brokerDealId: dto.brokerDealId ?? null,
      brokerPositionId: dto.brokerPositionId ?? null,
      requestedVolume: dto.requestedVolume ?? null,
      filledVolume: dto.filledVolume ?? null,
      fillPrice: dto.fillPrice ?? null,
      actualSl: dto.actualSl ?? null,
      actualTp: dto.actualTp ?? null,
      timestamps: {},
      accountSnapshot: null,
      error: null,
    };
    return this.executions.applyExternalResponse(id, response, "bridge");
  }
}
