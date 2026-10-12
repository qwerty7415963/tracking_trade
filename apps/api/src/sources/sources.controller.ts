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
import { CreateSourceDto, UpdateSourceDto } from "./dto/source.dto";
import { SourcesService } from "./sources.service";

interface OperatorRequest {
  operatorUsername?: string;
}

@Controller("v1/sources")
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  list() {
    return this.sources.list();
  }

  @Post()
  @UseGuards(OperatorGuard)
  create(@Body() dto: CreateSourceDto, @Req() req: OperatorRequest) {
    return this.sources.create(dto, this.actor(req));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.sources.get(id);
  }

  @Patch(":id")
  @UseGuards(OperatorGuard)
  update(@Param("id") id: string, @Body() dto: UpdateSourceDto, @Req() req: OperatorRequest) {
    return this.sources.update(id, dto, this.actor(req));
  }

  @Delete(":id")
  @UseGuards(OperatorGuard)
  remove(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.sources.remove(id, this.actor(req));
  }

  @Post(":id/test-connection")
  @UseGuards(OperatorGuard)
  testConnection(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.sources.testConnection(id, this.actor(req));
  }

  @Post(":id/enable")
  @UseGuards(OperatorGuard)
  enable(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.sources.setEnabled(id, true, this.actor(req));
  }

  @Post(":id/disable")
  @UseGuards(OperatorGuard)
  disable(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.sources.setEnabled(id, false, this.actor(req));
  }

  @Get(":id/health")
  health(@Param("id") id: string) {
    return this.sources.health(id);
  }
}
