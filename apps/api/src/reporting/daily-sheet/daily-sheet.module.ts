import { Module } from "@nestjs/common";
import { AppConfigModule } from "../../config/config.module";
import { DailySheetController } from "./daily-sheet.controller";
import { DailySheetService } from "./daily-sheet.service";
import { DAILY_SHEET_CLIENT } from "./daily-sheet.client";
import { GoogleSheetsClient } from "./google-sheets.client";

@Module({
  imports: [AppConfigModule],
  controllers: [DailySheetController],
  providers: [
    DailySheetService,
    GoogleSheetsClient,
    { provide: DAILY_SHEET_CLIENT, useExisting: GoogleSheetsClient },
  ],
  exports: [DailySheetService],
})
export class DailySheetModule {}
