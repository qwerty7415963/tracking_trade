import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { OperatorGuard } from "../auth/operator.guard";
import { ApproveSignalDto, RejectSignalDto } from "../signals/dto/signal.dto";
import { SignalsService } from "../signals/signals.service";
import { ApprovalFlowService } from "./approval-flow.service";

interface OperatorRequest {
  operatorUsername?: string;
}

class ApproveBodyDto extends ApproveSignalDto {
  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  destinationChatId?: string;
}

class ManualSignalBodyDto {
  @IsString()
  text!: string;

  @IsOptional()
  @IsString()
  sourceUrl?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  destinationChatId?: string;
}

@Controller("v1/signals")
export class SignalApprovalsController {
  constructor(
    private readonly signals: SignalsService,
    private readonly flow: ApprovalFlowService,
  ) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  list(@Query("status") status?: string) {
    return this.signals.list(status);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.signals.get(id);
  }

  /**
   * Approve = open in this system. Approves the exact version, then opens
   * the paper position on the operator's account. If the open fails, the
   * approval stands and the error is returned (retry via /v1/positions/open).
   */
  @Post(":id/approve")
  @UseGuards(OperatorGuard)
  approve(@Param("id") id: string, @Body() dto: ApproveBodyDto, @Req() req: OperatorRequest) {
    return this.flow.approveSignal(id, dto, this.actor(req), dto.accountId, dto.destinationChatId);
  }

  @Post(":id/reject")
  @UseGuards(OperatorGuard)
  reject(@Param("id") id: string, @Body() dto: RejectSignalDto, @Req() req: OperatorRequest) {
    return this.signals.reject(id, dto, this.actor(req));
  }

  @Post(":id/expire")
  @UseGuards(OperatorGuard)
  expire(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.signals.expire(id, this.actor(req));
  }

  @Post("ingest/:messageId")
  @UseGuards(OperatorGuard)
  async ingest(@Param("messageId") messageId: string, @Req() req: OperatorRequest) {
    const outcome = await this.signals.ingestSourceMessage(messageId, this.actor(req));
    if (outcome.kind === "SIGNAL" && outcome.signalId) {
      // AUTO-mode hook: never throws (ingest must not fail because of it).
      const auto = await this.flow.processNewSignal(outcome.signalId);
      return { ...outcome, autoOpen: auto };
    }
    return outcome;
  }

  /**
   * Operator-initiated signal: parse operator text, approve, open, publish
   * — same one-shot flow as the bot /pos command.
   */
  @Post("manual")
  @UseGuards(OperatorGuard)
  async manual(@Body() dto: ManualSignalBodyDto, @Req() req: OperatorRequest) {
    const actor = this.actor(req);
    const created = await this.signals.createOperatorSignal(dto.text, actor, {
      sourceUrl: dto.sourceUrl ?? null,
    });
    const outcome = await this.flow.approveSignal(
      created.signalId,
      { signalVersionId: created.versionId },
      actor,
      dto.accountId,
      dto.destinationChatId,
    );
    return { ...created, ...outcome };
  }
}
