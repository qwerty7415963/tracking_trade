import { missingRequiredFields, parseSignal } from "./signal-parser";

const FULL = `BUY XAUUSD limit
Entry: 2345.67
SL: 2340.00
TP1: 2350.00
TP2: 2360.00`;

describe("parseSignal", () => {
  const base = {
    sourceMessageId: "m1",
    sourcePlatform: "TELEGRAM",
  };

  it("parses a full new signal", () => {
    const parsed = parseSignal({ ...base, text: FULL });
    expect(parsed.eventType).toBe("NEW");
    expect(parsed.direction).toBe("LONG");
    expect(parsed.instrument).toBe("XAU");
    expect(parsed.orderType).toBe("LIMIT");
    expect(parsed.entry).toBe(2345.67);
    expect(parsed.stopLoss).toBe(2340);
    expect(parsed.takeProfits).toEqual([2350, 2360]);
    expect(parsed.missingFields).toEqual([]);
    expect(missingRequiredFields(parsed)).toEqual([]);
  });

  it("maps GOLD via explicit map, never fuzzy", () => {
    const parsed = parseSignal({ ...base, text: "Short GOLD\nEntry: 100\nSL: 101\nTP: 99" });
    expect(parsed.instrument).toBe("XAU");
    expect(parsed.direction).toBe("SHORT");
  });

  it("flags missing SL/TP without autofill", () => {
    const parsed = parseSignal({ ...base, text: "BUY EURUSD\nEntry: 1.0850" });
    expect(parsed.stopLoss).toBeNull();
    expect(parsed.takeProfits).toEqual([]);
    expect(missingRequiredFields(parsed)).toEqual(
      expect.arrayContaining(["stop_loss", "take_profits"]),
    );
  });

  it("flags conflicting directions as ambiguity", () => {
    const parsed = parseSignal({ ...base, text: "BUY or SELL EURUSD Entry 1.0 SL 0.9 TP 1.1" });
    expect(parsed.direction).toBeNull();
    expect(parsed.ambiguities).toContain("conflicting_directions");
  });

  it("detects update actions", () => {
    const parsed = parseSignal({ ...base, text: "Move SL to breakeven for XAUUSD buy" });
    expect(parsed.eventType).toBe("UPDATE");
    expect(parsed.updateAction).toBe("MODIFY_SL");
  });

  it("detects close-all updates", () => {
    const parsed = parseSignal({ ...base, text: "Close all ETH shorts now" });
    expect(parsed.updateAction).toBe("CLOSE_ALL");
  });

  it("matches 6-letter codes as forex pairs without fuzzy logic", () => {
    const parsed = parseSignal({ ...base, text: "BUY XYZABC Entry 1 SL 0.9 TP 1.1" });
    expect(parsed.instrument).toBe("XYZABC");
  });

  it("leaves instrument empty when nothing matches", () => {
    const parsed = parseSignal({ ...base, text: "BUY !!! Entry 1 SL 0.9 TP 1.1" });
    expect(parsed.instrument).toBeNull();
    expect(parsed.missingFields).toContain("instrument");
  });
});
