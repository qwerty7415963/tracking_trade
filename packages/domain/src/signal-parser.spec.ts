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

  it("parses hashtag pair without entry (CoinCodeCap style)", () => {
    const parsed = parseSignal({ ...base, text: "#BTC/USDT LONG" });
    expect(parsed.eventType).toBe("NEW");
    expect(parsed.direction).toBe("LONG");
    expect(parsed.instrument).toBe("BTC");
    expect(parsed.entry).toBeNull();
    expect(parsed.missingFields).toEqual(
      expect.arrayContaining(["entry", "stop_loss", "take_profits"]),
    );
  });

  it("parses $ handle, leverage and numbered TPs (Alwayswin style)", () => {
    const parsed = parseSignal({
      ...base,
      text: "SHORT $ETH 30x\nEntry 2540\nsl 2580\nTp 2500\nTp2 2400",
    });
    expect(parsed.eventType).toBe("NEW");
    expect(parsed.direction).toBe("SHORT");
    expect(parsed.instrument).toBe("ETH");
    expect(parsed.entry).toBe(2540);
    expect(parsed.stopLoss).toBe(2580);
    expect(parsed.takeProfits).toEqual([2500, 2400]);
    expect(parsed.leverage).toBe(30);
    expect(missingRequiredFields(parsed)).toEqual([]);
  });

  it("handles commas, zones and percent TPs (MegaLodon style)", () => {
    const parsed = parseSignal({
      ...base,
      text: "#$ZEC LONG\nEntry: 1,223 - 1,154\nSL: 1,068\nTp: 20% 40% 60% X2",
    });
    expect(parsed.eventType).toBe("NEW");
    expect(parsed.direction).toBe("LONG");
    expect(parsed.instrument).toBe("ZEC");
    expect(parsed.entry).toBe(1223);
    expect(parsed.entryZoneHigh).toBe(1154);
    expect(parsed.stopLoss).toBe(1068);
    expect(parsed.takeProfits).toEqual([1468, 1712, 1957]);
    expect(parsed.ambiguities).toContain("tp_percent_converted");
    expect(missingRequiredFields(parsed)).toEqual([]);
  });

  it("applies channel profile aliases over the built-in map", () => {
    const parsed = parseSignal(
      { ...base, text: "BUY PAWS Entry 1 SL 0.9 TP 1.1" },
      { profile: { coinAliases: { PAWS: "BTC" } } },
    );
    expect(parsed.instrument).toBe("BTC");
    const withoutProfile = parseSignal({ ...base, text: "BUY PAWS Entry 1 SL 0.9 TP 1.1" });
    expect(withoutProfile.instrument).toBeNull();
  });

  it("confirms plain-word tickers against the coin universe", () => {
    const withUniverse = parseSignal(
      { ...base, text: "ZEC LONG Entry 1 SL 0.9 TP 1.1" },
      { coinUniverse: ["ZEC"] },
    );
    expect(withUniverse.instrument).toBe("ZEC");
    const withoutUniverse = parseSignal({ ...base, text: "ZEC LONG Entry 1 SL 0.9 TP 1.1" });
    expect(withoutUniverse.instrument).toBeNull();
  });
});
