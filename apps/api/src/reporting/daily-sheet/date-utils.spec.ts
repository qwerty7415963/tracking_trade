import {
  addDays,
  isMorningWindow,
  localDateKey,
  parseSheetDateInput,
  sheetTabName,
  sheetTitleDate,
  zonedDayBounds,
} from "./date-utils";

describe("daily sheet date utils", () => {
  it("uses the configured timezone for the local day", () => {
    expect(localDateKey(new Date("2026-10-27T16:59:59Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-27");
    expect(localDateKey(new Date("2026-10-27T17:00:00Z"), "Asia/Ho_Chi_Minh")).toBe("2026-10-28");
  });

  it("builds tab names and full title dates", () => {
    expect(sheetTabName("2026-10-27")).toBe("27/10/26");
    expect(sheetTitleDate("2026-10-27")).toBe("27/10/2026");
  });

  it("parses sheet date inputs", () => {
    expect(parseSheetDateInput("27/10/26")).toBe("2026-10-27");
    expect(parseSheetDateInput("27/10/2026")).toBe("2026-10-27");
    expect(parseSheetDateInput("2026-10-27")).toBe("2026-10-27");
    expect(parseSheetDateInput("31/02/26")).toBeNull();
    expect(parseSheetDateInput("nope")).toBeNull();
  });

  it("returns Vietnam-local day bounds as UTC", () => {
    const bounds = zonedDayBounds("2026-10-27", "Asia/Ho_Chi_Minh");
    expect(bounds.start.toISOString()).toBe("2026-10-26T17:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-10-27T17:00:00.000Z");
  });

  it("adds days and detects the morning window", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(isMorningWindow(new Date("2026-10-27T01:00:00Z"), "Asia/Ho_Chi_Minh", "08:00")).toBe(
      true,
    );
    expect(isMorningWindow(new Date("2026-10-27T02:00:00Z"), "Asia/Ho_Chi_Minh", "08:00")).toBe(
      false,
    );
  });
});
