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
import { CreateProfileDto, UpdateProfileDto } from "./dto/profile.dto";
import { ProfilesService } from "./profiles.service";

interface OperatorRequest {
  operatorUsername?: string;
}

@Controller("v1/parser-profiles")
export class ProfilesController {
  constructor(private readonly profiles: ProfilesService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get()
  list() {
    return this.profiles.list();
  }

  @Post()
  @UseGuards(OperatorGuard)
  create(@Body() dto: CreateProfileDto, @Req() req: OperatorRequest) {
    return this.profiles.create(dto, this.actor(req));
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.profiles.get(id);
  }

  @Patch(":id")
  @UseGuards(OperatorGuard)
  update(@Param("id") id: string, @Body() dto: UpdateProfileDto, @Req() req: OperatorRequest) {
    return this.profiles.update(id, dto, this.actor(req));
  }

  @Delete(":id")
  @UseGuards(OperatorGuard)
  remove(@Param("id") id: string, @Req() req: OperatorRequest) {
    return this.profiles.remove(id, this.actor(req));
  }
}
