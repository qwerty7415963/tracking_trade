import { parseSignal } from "./signal-parser";
import { MatchCandidate, matchUpdate } from "./signal-matcher";

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    signalId: "s1",
    sourceId: "src1",
    authorId: "auth1",
    threadId: null,
    instrument: "XAUUSD.a",
    direction: "LONG",
    entryPrice: 2345,
    createdAt: new Date("2026-10-12T10:00:00Z"),
    messageExternalIds: ["m1"],
    ...overrides,
  };
}

const CTX = { sourceId: "src1", authorId: "auth1", now: new Date("2026-10-12T12:00:00Z") };

describe("matchUpdate", () => {
  it("matches by direct reply reference first", () => {
    const update = parseSignal({
      text: "Move SL to 2340",
      sourceMessageId: "m9",
      sourcePlatform: "TELEGRAM",
      replyToMessageId: "m1",
    });
    const result = matchUpdate(
      update,
      [candidate(), candidate({ signalId: "s2", messageExternalIds: ["m2"] })],
      CTX,
    );
    expect(result).toEqual({ kind: "MATCHED", signalId: "s1", confidence: 1.0 });
  });

  it("matches by thread when no reply reference", () => {
    const update = parseSignal({
      text: "Close half now",
      sourceMessageId: "m9",
      sourcePlatform: "TELEGRAM",
      threadId: "t1",
    });
    const result = matchUpdate(
      update,
      [candidate({ signalId: "s1", threadId: "t1" }), candidate({ signalId: "s2" })],
      CTX,
    );
    expect(result).toEqual({ kind: "MATCHED", signalId: "s1", confidence: 0.9 });
  });

  it("returns ambiguous when several signals fit", () => {
    const update = parseSignal({
      text: "Close all XAUUSD buys",
      sourceMessageId: "m9",
      sourcePlatform: "TELEGRAM",
    });
    const result = matchUpdate(
      update,
      [candidate({ signalId: "s1" }), candidate({ signalId: "s2" })],
      CTX,
    );
    expect(result.kind).toBe("AMBIGUOUS");
  });

  it("returns no match when nothing fits", () => {
    const update = parseSignal({
      text: "Close all",
      sourceMessageId: "m9",
      sourcePlatform: "TELEGRAM",
    });
    const result = matchUpdate(update, [], CTX);
    expect(result).toEqual({ kind: "NO_MATCH" });
  });

  it("filters out stale signals by time window", () => {
    const update = parseSignal({
      text: "Move SL to breakeven",
      sourceMessageId: "m9",
      sourcePlatform: "TELEGRAM",
    });
    const stale = candidate({ signalId: "old", createdAt: new Date("2026-10-01T00:00:00Z") });
    const fresh = candidate({ signalId: "s1" });
    const result = matchUpdate(update, [stale, fresh], CTX);
    expect(result).toEqual({ kind: "MATCHED", signalId: "s1", confidence: 0.5 });
  });
});
