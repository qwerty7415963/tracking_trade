import { DailySheetReport } from "./daily-sheet.mapper";

export const DAILY_SHEET_CLIENT = "DAILY_SHEET_CLIENT";

export interface DailySheetClient {
  ensureTemplate(): Promise<void>;
  ensureTab(tabName: string): Promise<void>;
  writeTab(tabName: string, title: string, report: DailySheetReport): Promise<void>;
}
