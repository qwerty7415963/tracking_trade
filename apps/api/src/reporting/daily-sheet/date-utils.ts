const DATE_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const SHEET_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/;

function parts(date: Date, timeZone: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date)) {
    if (part.type !== "literal") out[part.type] = part.value;
  }
  return out;
}

/** Local calendar date in the configured timezone, as YYYY-MM-DD. */
export function localDateKey(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

export function isDateKey(value: string): boolean {
  return DATE_KEY.test(value);
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find((p) => p.type === "timeZoneName")?.value;
  const match = name?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? "0")) * 60_000;
}

/** Midnight of a local calendar date, expressed as a UTC Date. */
export function zonedDayStart(dateKey: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, 0, 0, 0, 0);
  const offset = tzOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

export function zonedDayBounds(
  dateKey: string,
  timeZone: string,
): { start: Date; end: Date } {
  return {
    start: zonedDayStart(dateKey, timeZone),
    end: zonedDayStart(addDays(dateKey, 1), timeZone),
  };
}

/** Prisma @db.Date comes back as UTC midnight; keep only the date part. */
export function dateKeyFromDb(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function dateKeyToDbDate(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function sheetTabName(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y.slice(2)}`;
}

export function sheetTitleDate(dateKey: string): string {
  const [y, m, d] = dateKey.split("-");
  return `${d}/${m}/${y}`;
}

/** Accept YYYY-MM-DD, DD/MM/YY or DD/MM/YYYY. */
export function parseSheetDateInput(input: string): string | null {
  const raw = input.trim();
  if (isDateKey(raw)) return raw;
  const match = raw.match(SHEET_DATE);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const key = `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  const check = new Date(`${key}T00:00:00.000Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== key
    ? null
    : key;
}

export function isMorningWindow(date: Date, timeZone: string, hhmm: string): boolean {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;
  const formatted = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  const [hour, minute] = formatted.split(":").map(Number);
  return hour === Number(match[1]) && minute < Number(match[2]) + 5;
}
