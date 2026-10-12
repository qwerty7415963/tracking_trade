import { CardTheme } from "./card-config";
import { PositionSnapshot, RenderErrorCode } from "./card-types";

export type ValidationResult = { ok: true } | { ok: false; code: RenderErrorCode; detail: string };

function required(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

export function validateSnapshot(
  snapshot: Partial<PositionSnapshot> | null,
  theme: CardTheme,
  now: Date = new Date(),
): ValidationResult {
  if (!snapshot) return { ok: false, code: "POSITION_NOT_FOUND", detail: "snapshot is null" };
  const requiredFields: Array<keyof PositionSnapshot> = [
    "accountId",
    "positionId",
    "symbol",
    "displaySymbol",
    "direction",
    "volume",
    "entryPrice",
    "currentPrice",
    "floatingProfit",
    "profitCurrency",
    "brokerSnapshotAt",
    "snapshotId",
    "status",
  ];
  for (const field of requiredFields) {
    if (!required(snapshot[field])) {
      return { ok: false, code: "MISSING_REQUIRED_FIELD", detail: String(field) };
    }
  }
  if (snapshot.status !== "OPEN") {
    return { ok: false, code: "POSITION_NOT_OPEN", detail: String(snapshot.status) };
  }
  for (const field of ["entryPrice", "currentPrice", "volume"] as const) {
    const value = snapshot[field];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ok: false, code: "INVALID_PRICE_FORMAT", detail: String(field) };
    }
  }
  if (typeof snapshot.floatingProfit !== "number" || !Number.isFinite(snapshot.floatingProfit)) {
    return { ok: false, code: "INVALID_PNL", detail: "floatingProfit" };
  }
  const takenAt = new Date(snapshot.brokerSnapshotAt as string).getTime();
  if (!Number.isFinite(takenAt)) {
    return { ok: false, code: "MISSING_REQUIRED_FIELD", detail: "brokerSnapshotAt" };
  }
  if (now.getTime() - takenAt > theme.maxSnapshotAgeMs) {
    return { ok: false, code: "STALE_POSITION_SNAPSHOT", detail: `age over ${theme.maxSnapshotAgeMs}ms` };
  }
  return { ok: true };
}
