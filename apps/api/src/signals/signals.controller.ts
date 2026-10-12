import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ApproveSignalDto, RejectSignalDto } from "./dto/signal.dto";
import { SignalsService } from "./signals.service";

interface OperatorRequest {
  operatorUsername?: string;
}

@Controller("v1/signals")
export class SignalsController {
  constructor(private readonly signals: SignalsService) {}

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

  @Post(":id/approve")
  @UseGuards(OperatorGuard)
  approve(@Param("id") id: string, @Body() dto: ApproveSignalDto, @Req() req: OperatorRequest) {
    return this.signals.approve(id, dto, this.actor(req));
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
  ingest(@Param("messageId") messageId: string, @Req() req: OperatorRequest) {
    return this.signals.ingestSourceMessage(messageId, this.actor(req));
  }
}
