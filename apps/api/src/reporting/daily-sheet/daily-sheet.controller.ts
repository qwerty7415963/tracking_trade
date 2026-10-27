import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString } from "class-validator";
import { OperatorGuard } from "../../auth/operator.guard";
import { DailySheetService } from "./daily-sheet.service";

interface OperatorRequest {
  operatorUsername?: string;
}

class SyncRangeDto {
  @IsString()
  from!: string;

  @IsString()
  to!: string;
}

class SyncBodyDto {
  @IsOptional()
  @IsString()
  date?: string;
}

@Controller("v1/reports/daily")
export class DailySheetController {
  constructor(private readonly daily: DailySheetService) {}

  private actor(req: OperatorRequest): string {
    return req.operatorUsername ?? "unknown";
  }

  @Get("status")
  status() {
    return this.daily.status();
  }

  @Post("sync")
  @UseGuards(OperatorGuard)
  sync(@Body() dto: SyncBodyDto, @Req() req: OperatorRequest) {
    return dto.date
      ? this.daily.syncDate(dto.date, this.actor(req))
      : this.daily.syncToday(this.actor(req));
  }

  @Post("range")
  @UseGuards(OperatorGuard)
  range(@Body() dto: SyncRangeDto, @Req() req: OperatorRequest) {
    return this.daily.syncRange(dto.from, dto.to, this.actor(req));
  }

  @Post(":date/sync")
  @UseGuards(OperatorGuard)
  syncDate(@Param("date") date: string, @Req() req: OperatorRequest) {
    return this.daily.syncDate(date, this.actor(req));
  }
}
