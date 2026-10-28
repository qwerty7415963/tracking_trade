import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsNumber, IsOptional, IsString } from "class-validator";
import { OperatorGuard } from "../auth/operator.guard";
import { CardStatus } from "./publications.service";
import { RendersService } from "./renders.service";
import { PublicationsService } from "./publications.service";

interface OperatorRequest {
  operatorUsername?: string;
}

class RenderCardDto {
  @IsOptional()
  @IsNumber()
  markPrice?: number;
}

class PublishDto {
  @IsString()
  positionId!: string;

  @IsString()
  status!: CardStatus;

  @IsNumber()
  markPrice!: number;

  @IsOptional()
  @IsString()
  destinationChatId?: string;

  @IsOptional()
  @IsString()
  replyToMessageId?: string;
}

@Controller("v1/positions")
export class PositionRendersController {
  constructor(private readonly renders: RendersService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Post(":positionId/render-card")
  @UseGuards(OperatorGuard)
  renderCard(
    @Param("positionId") positionId: string,
    @Body() dto: RenderCardDto,
    @Req() req: OperatorRequest,
  ) {
    return this.renders.requestRender({ virtualPositionId: positionId }, this.actor(req));
  }
}

@Controller("v1/renders")
export class RendersController {
  constructor(private readonly renders: RendersService) {}

  @Get(":renderId")
  getRender(@Param("renderId") renderId: string) {
    return this.renders.getRender(renderId);
  }
}

@Controller("v1/publications")
export class PublicationsController {
  constructor(private readonly publications: PublicationsService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Post("position")
  @UseGuards(OperatorGuard)
  publish(@Body() dto: PublishDto, @Req() req: OperatorRequest) {
    return this.publications.requestPositionPublish(
      dto.positionId,
      dto.status,
      {
        markPrice: dto.markPrice,
        destinationChatId: dto.destinationChatId,
        replyToMessageId: dto.replyToMessageId,
      },
      this.actor(req),
    );
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.publications.getPublication(id);
  }
}
