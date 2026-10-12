import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { ApproveUpdateDto, RejectSignalDto } from "./dto/signal.dto";
import { SignalUpdatesService } from "./signal-updates.service";

interface OperatorRequest {
  operatorUsername?: string;
}

@Controller("v1/updates")
export class SignalUpdatesController {
  constructor(private readonly updates: SignalUpdatesService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get("review-queue")
  reviewQueue() {
    return this.updates.reviewQueue();
  }

  @Post(":id/approve")
  @UseGuards(OperatorGuard)
  approve(@Param("id") id: string, @Body() dto: ApproveUpdateDto, @Req() req: OperatorRequest) {
    return this.updates.approve(id, dto, this.actor(req));
  }

  @Post(":id/reject")
  @UseGuards(OperatorGuard)
  reject(@Param("id") id: string, @Body() dto: RejectSignalDto, @Req() req: OperatorRequest) {
    return this.updates.reject(id, dto, this.actor(req));
  }
}
