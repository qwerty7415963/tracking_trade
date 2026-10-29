import { BadRequestException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuditService } from "../../audit/audit.service";
import { APP_CONFIG, AppConfig } from "../../config/app.config";
import { PrismaService } from "../../database/prisma.service";
import { MarketDataService } from "../../market-data/market-data.service";
import {
  dateKeyFromDb,
  dateKeyToDbDate,
  isMorningWindow,
  localDateKey,
  parseSheetDateInput,
  sheetTabName,
  sheetTitleDate,
  zonedDayBounds,
} from "./date-utils";
import { buildDailyReport, DailySheetReport, SheetPositionInput } from "./daily-sheet.mapper";
import { DAILY_SHEET_CLIENT, DailySheetClient } from "./daily-sheet.client";

const SETTINGS_ID = "singleton";

type PositionRecord = Prisma.VirtualPositionGetPayload<{
  include: { signal: { include: { source: true } } };
}>;

export interface DailySheetSyncResult {
  dateKey: string;
  tab: string;
  rows: number;
  limits: number;
  skipped: boolean;
}

@Injectable()
export class DailySheetService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DailySheetService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastSweepAt = new Date();
  private readonly inFlight = new Map<string, Promise<DailySheetSyncResult>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DAILY_SHEET_CLIENT) private readonly client: DailySheetClient,
    private readonly marketData: MarketDataService,
  ) {}

  private get enabled(): boolean {
    return Boolean(
      this.config.dailySheetSpreadsheetId &&
        this.config.googleServiceAccountJson &&
        this.config.dailySheetAccountId,
    );
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.warn(
        "daily sheet disabled: DAILY_SHEET_SPREADSHEET_ID / GOOGLE_SERVICE_ACCOUNT_JSON / DAILY_SHEET_ACCOUNT_ID not configured",
      );
      return;
    }
    this.lastSweepAt = new Date();
    void this.bootstrap().catch((err) => this.markError(err));
    this.timer = setInterval(() => {
      void this.tick().catch((err) => this.markError(err));
    }, this.config.dailySheetSyncMs);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async bootstrap(): Promise<void> {
    await this.ensureSettings();
    await this.client.ensureTemplate();
    await this.syncAllSinceStart();
  }

  private async ensureSettings() {
    const current = await this.prisma.dailySheetSetting.findUnique({ where: { id: SETTINGS_ID } });
    if (current) return current;
    const configured = this.config.dailySheetStartDate.trim();
    const startKey = configured
      ? parseSheetDateInput(configured)
      : localDateKey(new Date(), this.config.dailySheetTimezone);
    if (!startKey) throw new BadRequestException("invalid DAILY_SHEET_START_DATE");
    return this.prisma.dailySheetSetting.create({
      data: { id: SETTINGS_ID, startDate: dateKeyToDbDate(startKey) },
    });
  }

  private startDateKey(setting: { startDate: Date }): string {
    return dateKeyFromDb(setting.startDate);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const since = this.lastSweepAt;
    this.lastSweepAt = new Date();
    try {
      const setting = await this.ensureSettings();
      const today = localDateKey(new Date(), this.config.dailySheetTimezone);
      if (isMorningWindow(new Date(), this.config.dailySheetTimezone, this.config.dailySheetMorningAt)) {
        await this.syncAllSinceStart();
        return;
      }
      const dates = new Set<string>([today]);
      const changed = await this.prisma.virtualPosition.findMany({
        where: {
          accountId: this.config.dailySheetAccountId,
          updatedAt: { gte: since },
        },
        select: { openedAt: true, filledAt: true },
      });
      for (const row of changed) {
        dates.add(localDateKey(row.openedAt, this.config.dailySheetTimezone));
        if (row.filledAt) dates.add(localDateKey(row.filledAt, this.config.dailySheetTimezone));
      }
      const start = this.startDateKey(setting);
      for (const dateKey of [...dates].sort()) {
        if (dateKey >= start) await this.syncDate(dateKey, "daily-sheet");
      }
    } catch (err) {
      this.lastSweepAt = since;
      throw err;
    } finally {
      this.running = false;
    }
  }

  private async syncAllSinceStart(): Promise<void> {
    const setting = await this.ensureSettings();
    const today = localDateKey(new Date(), this.config.dailySheetTimezone);
    let dateKey = this.startDateKey(setting);
    while (dateKey <= today) {
      await this.syncDate(dateKey, "daily-sheet");
      const [y, m, d] = dateKey.split("-").map(Number);
      const next = new Date(Date.UTC(y, m - 1, d + 1));
      dateKey = next.toISOString().slice(0, 10);
    }
  }

  syncDate(dateKey: string, actor = "daily-sheet"): Promise<DailySheetSyncResult> {
    const normalized = parseSheetDateInput(dateKey);
    if (!normalized) return Promise.reject(new BadRequestException(`invalid date: ${dateKey}`));
    const existing = this.inFlight.get(normalized);
    if (existing) return existing;
    const job = this.doSyncDate(normalized, actor).finally(() => this.inFlight.delete(normalized));
    this.inFlight.set(normalized, job);
    return job;
  }

  private async doSyncDate(dateKey: string, actor: string): Promise<DailySheetSyncResult> {
    if (!this.enabled) throw new BadRequestException("daily sheet is not configured");
    const setting = await this.ensureSettings();
    if (dateKey < this.startDateKey(setting)) {
      return { dateKey, tab: sheetTabName(dateKey), rows: 0, limits: 0, skipped: true };
    }
    const { start, end } = zonedDayBounds(dateKey, this.config.dailySheetTimezone);
    const records = await this.prisma.virtualPosition.findMany({
      where: {
        accountId: this.config.dailySheetAccountId,
        OR: [
          { filledAt: { gte: start, lt: end } },
          { status: "PENDING_ENTRY", openedAt: { gte: start, lt: end } },
        ],
      },
      include: { signal: { include: { source: true } } },
      orderBy: [{ filledAt: "asc" }, { openedAt: "asc" }],
    });

    const mids = await this.marketData
      .getAllMids()
      .catch(() => ({} as Record<string, number>));
    const filled = records
      .filter((row) => row.filledAt && row.filledAt >= start && row.filledAt < end)
      .map((row) => toInput(row, mids[row.coin] ?? null));
    const limits = records
      .filter(
        (row) =>
          row.status === "PENDING_ENTRY" &&
          row.openedAt >= start &&
          row.openedAt < end,
      )
      .map((row) => toInput(row));
    const report = buildDailyReport(filled, limits);
    const tab = sheetTabName(dateKey);
    await this.client.writeTab(tab, `NHẬT KÝ TRADING TOPCOIN - ${sheetTitleDate(dateKey)}`, report);
    await this.prisma.dailySheetSetting.update({
      where: { id: SETTINGS_ID },
      data: { lastSyncAt: new Date(), lastError: null },
    });
    await this.audit.record(actor, "daily_sheet.sync", {
      dateKey,
      tab,
      rows: report.rows.length,
      limits: report.limits.length,
    });
    return { dateKey, tab, rows: report.rows.length, limits: report.limits.length, skipped: false };
  }

  async status() {
    const setting = this.enabled ? await this.ensureSettings() : null;
    return {
      enabled: this.enabled,
      spreadsheetId: this.config.dailySheetSpreadsheetId,
      accountId: this.config.dailySheetAccountId,
      startDate: setting ? this.startDateKey(setting) : null,
      lastSyncAt: setting?.lastSyncAt?.toISOString() ?? null,
      lastError: setting?.lastError ?? null,
    };
  }

  async syncToday(actor: string): Promise<DailySheetSyncResult> {
    return this.syncDate(localDateKey(new Date(), this.config.dailySheetTimezone), actor);
  }

  async syncRange(from: string, to: string, actor: string): Promise<DailySheetSyncResult[]> {
    const startKey = parseSheetDateInput(from);
    const endKey = parseSheetDateInput(to);
    if (!startKey || !endKey || startKey > endKey) {
      throw new BadRequestException("invalid date range");
    }
    const out: DailySheetSyncResult[] = [];
    let dateKey = startKey;
    while (dateKey <= endKey) {
      out.push(await this.syncDate(dateKey, actor));
      const [y, m, d] = dateKey.split("-").map(Number);
      dateKey = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    }
    return out;
  }

  private async markError(err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`daily sheet sync failed: ${message}`);
    await this.prisma.dailySheetSetting
      .upsert({
        where: { id: SETTINGS_ID },
        create: {
          id: SETTINGS_ID,
          startDate: dateKeyToDbDate(localDateKey(new Date(), this.config.dailySheetTimezone)),
          lastError: message,
        },
        update: { lastError: message },
      })
      .catch(() => undefined);
  }
}

function toInput(row: PositionRecord, currentPrice: number | null = null): SheetPositionInput {
  return {
    id: row.id,
    status: row.status,
    coin: row.coin,
    direction: row.direction,
    entryPrice: Number(row.entryPrice),
    size: Number(row.size),
    leverage: row.leverage,
    realizedPnl: row.realizedPnl === null ? null : Number(row.realizedPnl),
    openedAt: row.openedAt,
    filledAt: row.filledAt,
    entries: row.entries,
    pendingEntries: row.pendingEntries,
    sourceName: row.signal?.source?.displayName ?? null,
    currentPrice,
  };
}
