import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { OperatorGuard } from "../auth/operator.guard";
import { CoinsService } from "./coins.service";
import { CreateCoinDto, UpdateCoinDto } from "./dto/coin.dto";

interface OperatorRequest {
  operatorUsername?: string;
}

@Controller("v1/coins")
export class CoinsController {
  constructor(private readonly coins: CoinsService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  list() {
    return this.coins.list();
  }

  @Post()
  @UseGuards(OperatorGuard)
  create(@Body() dto: CreateCoinDto, @Req() req: OperatorRequest) {
    return this.coins.create(dto, this.actor(req));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.coins.get(id);
  }

  @Patch(":id")
  @UseGuards(OperatorGuard)
  update(@Param("id") id: string, @Body() dto: UpdateCoinDto, @Req() req: OperatorRequest) {
    return this.coins.update(id, dto, this.actor(req));
  }

  @Delete(":id")
  @UseGuards(OperatorGuard)
  remove(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.coins.remove(id, this.actor(req));
  }
}
