export type DailySheetState = "Processing" | "TP" | "SL" | "BE" | "Limit";

export interface SheetPositionInput {
  id: string;
  status: string;
  coin: string;
  direction: string;
  entryPrice: number;
  size: number;
  leverage: number;
  realizedPnl: number | null;
  openedAt: Date;
  filledAt: Date | null;
  entries: unknown;
  pendingEntries: unknown;
  sourceName: string | null;
}

export interface DailySheetRow {
  positionId: string;
  channel: string;
  symbol: string;
  direction: "Long" | "Short";
  entry: string;
  pnl: string | null;
  pnlPct: number | null;
  state: DailySheetState;
}

export interface DailySheetReport {
  rows: DailySheetRow[];
  limits: DailySheetRow[];
  total: number;
  long: number;
  short: number;
  win: number;
  lose: number;
  be: number;
  processing: number;
  pnlPct: number;
  pnlText: string;
}

interface EntryLevel {
  price: number;
}

export function readEntryLevels(value: unknown): EntryLevel[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "number" && Number.isFinite(item)) return { price: item };
      if (item && typeof item === "object" && "price" in item) {
        const price = Number((item as { price: unknown }).price);
        if (Number.isFinite(price)) return { price };
      }
      return null;
    })
    .filter((item): item is EntryLevel => item !== null);
}

function priceText(value: number): string {
  if (!Number.isFinite(value)) return "";
  return String(Number(value.toFixed(10)));
}

function entryText(levels: EntryLevel[], fallback: number): string {
  const prices = levels.map((l) => priceText(l.price)).filter(Boolean);
  return prices.length > 0 ? prices.join(" - ") : priceText(fallback);
}

function filledEntryText(position: SheetPositionInput): string {
  const all = readEntryLevels(position.entries);
  if (all.length === 0) return priceText(position.entryPrice);
  const pending = readEntryLevels(position.pendingEntries);
  const filled = all.filter(
    (level) => !pending.some((p) => Math.abs(p.price - level.price) < 1e-9),
  );
  return entryText(filled.length > 0 ? filled : all, position.entryPrice);
}

export function roiPct(position: SheetPositionInput): number {
  const margin = (position.entryPrice * position.size) / Math.max(1, position.leverage);
  if (!Number.isFinite(margin) || margin <= 0) return 0;
  const pnl = Number(position.realizedPnl ?? 0);
  if (!Number.isFinite(pnl)) return 0;
  return Number(((pnl / margin) * 100).toFixed(2));
}

export function formatPct(value: number): string {
  const rounded = Number(value.toFixed(2));
  if (rounded > 0) return `+${rounded.toFixed(2)}%`;
  if (rounded < 0) return `${rounded.toFixed(2)}%`;
  return "0.00%";
}

function stateForClosed(pnlPct: number): DailySheetState {
  if (pnlPct > 0) return "TP";
  if (pnlPct < 0) return "SL";
  return "BE";
}

export function positionRow(position: SheetPositionInput): DailySheetRow | null {
  if (position.status === "CANCELLED" || position.status === "PENDING_ENTRY") return null;
  const direction = position.direction === "SHORT" ? "Short" : "Long";
  const channel = position.sourceName?.trim() || "Operator (manual)";
  if (position.status === "OPEN" || position.status === "TP_HIT") {
    return {
      positionId: position.id,
      channel,
      symbol: position.coin,
      direction,
      entry: filledEntryText(position),
      pnl: null,
      pnlPct: null,
      state: "Processing",
    };
  }
  const pnlPct = roiPct(position);
  return {
    positionId: position.id,
    channel,
    symbol: position.coin,
    direction,
    entry: filledEntryText(position),
    pnl: formatPct(pnlPct),
    pnlPct,
    state: stateForClosed(pnlPct),
  };
}

export function limitRow(position: SheetPositionInput): DailySheetRow | null {
  if (position.status !== "PENDING_ENTRY") return null;
  return {
    positionId: position.id,
    channel: position.sourceName?.trim() || "Operator (manual)",
    symbol: position.coin,
    direction: position.direction === "SHORT" ? "Short" : "Long",
    entry: entryText(readEntryLevels(position.entries), position.entryPrice),
    pnl: null,
    pnlPct: null,
    state: "Limit",
  };
}

export function buildDailyReport(
  positions: SheetPositionInput[],
  limits: SheetPositionInput[],
): DailySheetReport {
  const rows = positions
    .map(positionRow)
    .filter((row): row is DailySheetRow => row !== null);
  const limitRows = limits
    .map(limitRow)
    .filter((row): row is DailySheetRow => row !== null);
  const pnlPct = Number(
    rows
      .reduce((sum, row) => sum + (row.pnlPct ?? 0), 0)
      .toFixed(2),
  );
  return {
    rows,
    limits: limitRows,
    total: rows.length,
    long: rows.filter((r) => r.direction === "Long").length,
    short: rows.filter((r) => r.direction === "Short").length,
    win: rows.filter((r) => r.state === "TP").length,
    lose: rows.filter((r) => r.state === "SL").length,
    be: rows.filter((r) => r.state === "BE").length,
    processing: rows.filter((r) => r.state === "Processing").length,
    pnlPct,
    pnlText: formatPct(pnlPct),
  };
}

export function summaryText(report: DailySheetReport): {
  count: string;
  win: string;
  lose: string;
  processing: string;
  pnl: string;
} {
  return {
    count: `${report.total}: ${report.long} Long / ${report.short} Short`,
    win: `WIN: ${report.win}`,
    lose: `LOSE: ${report.lose}`,
    processing: `PROCESSING: ${report.processing}`,
    pnl: report.pnlText,
  };
}
