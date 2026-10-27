import { Inject, Injectable } from "@nestjs/common";
import type { sheets_v4 } from "googleapis";
import { APP_CONFIG, AppConfig } from "../../config/app.config";
import { DailySheetReport, summaryText } from "./daily-sheet.mapper";
import { DailySheetClient } from "./daily-sheet.client";

const HEADERS = ["Channel", "Symbol", "Long/Short", "Entry", "P/L (coin x10)", "State"];

function quoteTab(tab: string): string {
  return `'${tab.replace(/'/g, "''")}'`;
}

function color(red: number, green: number, blue: number) {
  return { red, green, blue };
}

@Injectable()
export class GoogleSheetsClient implements DailySheetClient {
  private api: sheets_v4.Sheets | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private sheets(): sheets_v4.Sheets {
    if (this.api) return this.api;
    const { google } = require("googleapis") as typeof import("googleapis");
    const auth = new google.auth.GoogleAuth({
      keyFile: this.config.googleServiceAccountJson,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.api = google.sheets({ version: "v4", auth });
    return this.api;
  }

  private async sheetMap(): Promise<Map<string, number>> {
    const result = await this.sheets().spreadsheets.get({
      spreadsheetId: this.config.dailySheetSpreadsheetId,
      fields: "sheets(properties(sheetId,title))",
    });
    const map = new Map<string, number>();
    for (const sheet of result.data.sheets ?? []) {
      const title = sheet.properties?.title;
      const id = sheet.properties?.sheetId;
      if (typeof title === "string" && typeof id === "number") map.set(title, id);
    }
    return map;
  }

  async ensureTemplate(): Promise<void> {
    const sheets = this.sheets();
    const id = this.config.dailySheetSpreadsheetId;
    const map = await this.sheetMap();
    if (map.has(this.config.dailySheetTemplateTab)) return;

    const added = await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ addSheet: { properties: { title: this.config.dailySheetTemplateTab } } }],
      },
    });
    const templateId = added.data.replies?.[0]?.addSheet?.properties?.sheetId;
    if (typeof templateId !== "number") throw new Error("SHEET_TEMPLATE_CREATE_FAILED");

    await sheets.spreadsheets.values.update({
      spreadsheetId: id,
      range: `${quoteTab(this.config.dailySheetTemplateTab)}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: [["NHẬT KÝ TRADING TOPCOIN"], HEADERS] },
    });

    const requests: sheets_v4.Schema$Request[] = [
      {
        updateSheetProperties: {
          properties: { sheetId: templateId, gridProperties: { frozenRowCount: 2 } },
          fields: "gridProperties.frozenRowCount",
        },
      },
      {
        mergeCells: {
          range: { sheetId: templateId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 6 },
          mergeType: "MERGE_ALL",
        },
      },
      {
        repeatCell: {
          range: { sheetId: templateId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
          cell: {
            userEnteredFormat: {
              backgroundColor: color(1, 0.92, 0.23),
              textFormat: { bold: true },
              horizontalAlignment: "CENTER",
              verticalAlignment: "MIDDLE",
            },
          },
          fields: "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment)",
        },
      },
      {
        updateBorders: {
          range: { sheetId: templateId, startRowIndex: 0, endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 6 },
          top: { style: "SOLID" },
          bottom: { style: "SOLID" },
          left: { style: "SOLID" },
          right: { style: "SOLID" },
          innerHorizontal: { style: "SOLID" },
          innerVertical: { style: "SOLID" },
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: templateId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
          properties: { pixelSize: 160 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: templateId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
          properties: { pixelSize: 100 },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: { sheetId: templateId, dimension: "COLUMNS", startIndex: 3, endIndex: 4 },
          properties: { pixelSize: 180 },
          fields: "pixelSize",
        },
      },
      {
        setDataValidation: {
          range: { sheetId: templateId, startRowIndex: 2, endRowIndex: 1000, startColumnIndex: 5, endColumnIndex: 6 },
          rule: {
            condition: {
              type: "ONE_OF_LIST",
              values: ["Processing", "TP", "SL", "BE", "Limit"].map((userEnteredValue) => ({
                userEnteredValue,
              })),
            },
            showCustomUi: true,
            strict: false,
          },
        },
      },
      ...this.stateConditionalFormats(templateId),
    ];
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: id, requestBody: { requests } });
  }

  private stateConditionalFormats(sheetId: number): sheets_v4.Schema$Request[] {
    const stateColors: Record<string, { bg: ReturnType<typeof color>; fg: ReturnType<typeof color> }> = {
      Processing: { bg: color(1, 0.94, 0.7), fg: color(0.55, 0.42, 0.0) },
      TP: { bg: color(0.84, 0.95, 0.84), fg: color(0.0, 0.42, 0.13) },
      SL: { bg: color(0.85, 0.08, 0.08), fg: color(1, 1, 1) },
      BE: { bg: color(0.88, 0.88, 0.88), fg: color(0.25, 0.25, 0.25) },
      Limit: { bg: color(0.98, 0.84, 0.84), fg: color(0.45, 0.08, 0.08) },
    };
    return Object.entries(stateColors).map(([state, colors]) => ({
      addConditionalFormatRule: {
        rule: {
          ranges: [
            {
              sheetId,
              startRowIndex: 2,
              endRowIndex: 1000,
              startColumnIndex: 5,
              endColumnIndex: 6,
            },
          ],
          booleanRule: {
            condition: { type: "TEXT_EQ", values: [{ userEnteredValue: state }] },
            format: {
              backgroundColor: colors.bg,
              textFormat: { foregroundColor: colors.fg },
            },
          },
        },
        index: 0,
      },
    }));
  }

  async ensureTab(tabName: string): Promise<void> {
    const sheets = this.sheets();
    const id = this.config.dailySheetSpreadsheetId;
    let map = await this.sheetMap();
    if (map.has(tabName)) return;
    await this.ensureTemplate();
    map = await this.sheetMap();
    const templateId = map.get(this.config.dailySheetTemplateTab);
    if (templateId === undefined) throw new Error("SHEET_TEMPLATE_MISSING");
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: {
        requests: [{ duplicateSheet: { sourceSheetId: templateId, newSheetName: tabName } }],
      },
    });
  }

  async writeTab(tabName: string, title: string, report: DailySheetReport): Promise<void> {
    await this.ensureTab(tabName);
    const summary = summaryText(report);
    const values: string[][] = [
      [title],
      [...HEADERS],
      ...report.rows.map((row) => [
        row.channel,
        row.symbol,
        row.direction,
        row.entry,
        row.pnl ?? "",
        row.state,
      ]),
      [],
      ["TỔNG SỐ LỆNH", "", "", summary.count, "", ""],
      ["", "", "", summary.win, summary.lose, summary.processing],
      ["TỔNG PNL (%)", "", "", summary.pnl, "", ""],
      [],
      ...report.limits.map((row) => [
        row.channel,
        row.symbol,
        row.direction,
        row.entry,
        "",
        "Limit",
      ]),
    ];
    const range = `${quoteTab(tabName)}!A1:F1000`;
    await this.sheets().spreadsheets.values.clear({
      spreadsheetId: this.config.dailySheetSpreadsheetId,
      range,
    });
    await this.sheets().spreadsheets.values.update({
      spreadsheetId: this.config.dailySheetSpreadsheetId,
      range: `${quoteTab(tabName)}!A1`,
      valueInputOption: "RAW",
      requestBody: { values },
    });
  }
}
