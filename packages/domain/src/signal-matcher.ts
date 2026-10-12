import { NormalizedSignal } from "./signal-types";

export interface MatchCandidate {
  signalId: string;
  sourceId: string;
  authorId: string | null;
  threadId: string | null;
  instrument: string;
  direction: string;
  entryPrice: number | null;
  createdAt: Date;
  messageExternalIds: string[];
}

export type MatchResult =
  | { kind: "MATCHED"; signalId: string; confidence: number }
  | { kind: "AMBIGUOUS"; signalIds: string[] }
  | { kind: "NO_MATCH" };

// Priority tiers (docs/03-nghiep-vu/signal-parsing-matching.md).
// Semantic similarity is support-only and not implemented here.
export const MATCH_CONFIDENCE: Record<string, number> = {
  direct: 1.0,
  thread: 0.9,
  sourceAuthor: 0.75,
  instrumentDirection: 0.6,
  timePrice: 0.5,
};

const TIME_WINDOW_MS = 24 * 60 * 60 * 1000;
const PRICE_TOLERANCE_RATIO = 0.02;

function sameSourceAuthor(update: NormalizedSignal, c: MatchCandidate, sourceId: string): boolean {
  return c.sourceId === sourceId;
}

export function matchUpdate(
  update: NormalizedSignal,
  candidates: MatchCandidate[],
  context: { sourceId: string; authorId: string | null; now?: Date },
): MatchResult {
  const now = context.now ?? new Date();
  const refs = [update.replyToMessageId, update.quotedMessageId].filter(
    (v): v is string => !!v,
  );

  // Tier 1: direct reply/quote reference.
  if (refs.length > 0) {
    const direct = candidates.filter((c) => refs.some((r) => c.messageExternalIds.includes(r)));
    if (direct.length === 1) {
      return { kind: "MATCHED", signalId: direct[0].signalId, confidence: MATCH_CONFIDENCE.direct };
    }
    if (direct.length > 1) {
      return { kind: "AMBIGUOUS", signalIds: direct.map((c) => c.signalId) };
    }
  }

  // Tier 2: same thread.
  if (update.threadId) {
    const threaded = candidates.filter((c) => c.threadId === update.threadId);
    if (threaded.length === 1) {
      return { kind: "MATCHED", signalId: threaded[0].signalId, confidence: MATCH_CONFIDENCE.thread };
    }
    if (threaded.length > 1) {
      return { kind: "AMBIGUOUS", signalIds: threaded.map((c) => c.signalId) };
    }
  }

  let pool = candidates;

  // Tier 3: same source and author.
  if (context.authorId) {
    const same = pool.filter(
      (c) => sameSourceAuthor(update, c, context.sourceId) && c.authorId === context.authorId,
    );
    if (same.length > 0) pool = same;
  } else {
    const sameSource = pool.filter((c) => c.sourceId === context.sourceId);
    if (sameSource.length > 0) pool = sameSource;
  }

  // Tier 4: compatible instrument and direction.
  if (update.instrument && update.direction) {
    const compat = pool.filter(
      (c) => c.instrument === update.instrument && c.direction === update.direction,
    );
    if (compat.length > 0) pool = compat;
  }

  // Tier 5: compatible timestamp and price.
  const updatePrice = update.entry ?? update.stopLoss ?? null;
  const timed = pool.filter((c) => {
    const ageOk = now.getTime() - c.createdAt.getTime() <= TIME_WINDOW_MS;
    if (!ageOk) return false;
    if (updatePrice === null || c.entryPrice === null) return true;
    const ratio = Math.abs(updatePrice - c.entryPrice) / Math.max(Math.abs(c.entryPrice), 1e-9);
    return ratio <= PRICE_TOLERANCE_RATIO;
  });
  if (timed.length > 0) pool = timed;

  if (pool.length === 0) return { kind: "NO_MATCH" };
  if (pool.length === 1) {
    return { kind: "MATCHED", signalId: pool[0].signalId, confidence: MATCH_CONFIDENCE.timePrice };
  }
  return { kind: "AMBIGUOUS", signalIds: pool.map((c) => c.signalId) };
}
