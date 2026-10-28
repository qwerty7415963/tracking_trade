import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, VirtualPosition } from "@prisma/client";
import {
  calcPerpSizeByNotional,
  detectTpSlHit,
  evaluateVirtualRisk,
  realizedPnl,
  roundDownToStep,
  splitTps,
  unrealizedPnl,
} from "@tracking-auto/domain";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { AuditService } from "../audit/audit.service";
import { CoinsService } from "../coins/coins.service";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";
import { KillSwitchService } from "./kill-switch.service";
import { VirtualAccountsService } from "./virtual-accounts.service";

export type VirtualDirection = "LONG" | "SHORT";
export type PositionStatus = "OPEN" | "TP_HIT" | "SL_HIT" | "CLOSED" | "CANCELLED";

export const MARKET_WATCH_QUEUE_NAME = "market-watch";

const OPEN_STATUSES = ["OPEN", "TP_HIT"];
// Pending-entry orders still need the price watch (to fill entries) but carry
// no size/margin until the first fill.
const ACTIVE_STATUSES = ["PENDING_ENTRY", ...OPEN_STATUSES];
const MAX_POSITIONS = Number.POSITIVE_INFINITY;

function asNumber(value: unknown): number {
  return value instanceof Object && "toNumber" in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value);
}

function asPriceArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "number" && Number.isFinite(v));
}

interface EntryLevel {
  price: number;
  notional: number;
}

/** `virtual_positions.entries` / `pending_entries` rows, validated. */
function readEntryLevels(value: unknown): EntryLevel[] {
  if (!Array.isArray(value)) return [];
  const out: EntryLevel[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const price = Number((raw as { price?: unknown }).price);
    const notional = Number((raw as { notional?: unknown }).notional);
    if (Number.isFinite(price) && price > 0 && Number.isFinite(notional) && notional > 0) {
      out.push({ price, notional });
    }
  }
  return out;
}

/** Plain `entries` array from the parsed signal payload. */
function readPayloadEntries(payload: unknown): number[] {
  const raw = (payload as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0);
}

/** `entry market ...` marker from the parsed signal payload. */
function readEntryMarket(payload: unknown): boolean {
  return (payload as { entryMarket?: unknown } | null)?.entryMarket === true;
}

/** DCA ladder must point away from the entry: LONG falls, SHORT climbs. */
function ladderOrdered(direction: string, levels: number[]): boolean {
  if (levels.length < 2) return true;
  return direction === "LONG"
    ? levels.every((v, i) => i === 0 || v <= levels[i - 1])
    : levels.every((v, i) => i === 0 || v >= levels[i - 1]);
}

function decimalsOf(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 ? 0 : text.length - dot - 1;
}

export interface MarketHitEvent {
  positionId: string;
  kind: "TP" | "SL" | "ENTRY";
  /** Price frozen at detection: the card and the close both use it. */
  markPrice: number;
  /** TP ordinal at detection (filledTps.length) — settle-job dedupe key. */
  tpIndex?: number;
  /** ENTRY only: the DCA level that just filled. */
  entryPrice?: number;
  /** ENTRY only: this fill flipped PENDING_ENTRY to OPEN (first card). */
  firstFill?: boolean;
}

@Injectable()
export class VirtualTradingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly marketData: MarketDataService,
    private readonly accounts: VirtualAccountsService,
    private readonly coins: CoinsService,
    private readonly killSwitch: KillSwitchService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------------ open

  async openApproved(
    signalId: string,
    accountId: string,
    actor: string,
    opts: { marketEntryDelayMs?: number; marketEntryMaxWaitMs?: number; targetNotional?: number } = {},
  ) {
    const signal = await this.prisma.signal.findUnique({
      where: { id: signalId },
      include: {
        versions: { orderBy: { versionNumber: "desc" }, take: 1 },
        approvals: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!signal) throw new NotFoundException(`signal ${signalId} not found`);
    if (signal.status !== "APPROVED") {
      throw new ConflictException(`signal ${signalId} is ${signal.status}: approval required`);
    }
    const version = signal.versions[0];
    const approval = signal.approvals[0];
    if (
      !version ||
      !approval ||
      approval.decision !== "APPROVED" ||
      approval.signalVersionId !== version.id
    ) {
      throw new ConflictException("approval stale or missing for current version");
    }
    const approvalAgeHours = (Date.now() - approval.createdAt.getTime()) / 3_600_000;
    if (approvalAgeHours > this.config.signalMaxAgeHours) {
      throw new ConflictException("approval expired: re-approve required");
    }

    // Idempotency: same signal+version already open → return it, never duplicate.
    const existing = await this.prisma.virtualPosition.findFirst({
      where: { signalId, signalVersionId: version.id, status: { in: ACTIVE_STATUSES } },
    });
    if (existing) {
      return {
        position: existing,
        created: false,
        awaitingEntry: existing.status === "PENDING_ENTRY",
      };
    }

    const account = await this.accounts.get(accountId);
    const mode = this.killSwitch.getMode();
    if (mode !== "OFF") {
      throw new ForbiddenException(`kill switch ${mode} blocks new positions`);
    }

    const entryMarket = readEntryMarket(version.normalizedPayloadJson);
    const payloadLevels = readPayloadEntries(version.normalizedPayloadJson);
    const coin = await this.marketData.resolveCoin(version.instrument);
    if (!coin) throw new ConflictException(`NO_SYMBOL_MAP: ${version.instrument} not on Hyperliquid`);
    const initialMid = await this.marketData.getMid(coin);
    if (initialMid === null) throw new ConflictException(`NO_QUOTE for ${coin}: refusing to open without a mark`);
    const requestedDelay = Number(opts.marketEntryDelayMs ?? 0);
    const marketEntryDelayMs =
      entryMarket && Number.isFinite(requestedDelay) && requestedDelay > 0
        ? Math.min(30_000, Math.floor(requestedDelay))
        : 0;
    const maxWaitMs =
      entryMarket && marketEntryDelayMs > 0
        ? Math.min(30_000, Math.max(0, Math.floor(opts.marketEntryMaxWaitMs ?? this.config.posMarketEntryMaxWaitMs)))
        : 0;
    let openedMid = initialMid;
    const entryWaitStartedAt = Date.now();
    if (entryMarket && marketEntryDelayMs > 0 && maxWaitMs > 0) {
      const started = Date.now();
      while (openedMid === initialMid && Date.now() - started < maxWaitMs) {
        await new Promise((resolve) => setTimeout(resolve, marketEntryDelayMs));
        const afterMode = this.killSwitch.getMode();
        if (afterMode !== "OFF") {
          throw new ForbiddenException(`kill switch ${afterMode} blocks new positions`);
        }
        const nextMid = await this.marketData.getMid(coin);
        if (nextMid !== null) {
          openedMid = nextMid;
          if (openedMid !== initialMid) break;
        }
      }
    }

    const mid = openedMid;
    if (mid === null) throw new ConflictException(`NO_QUOTE for ${coin}: refusing to open without a mark`);

    const signalEntry = version.entry == null ? null : asNumber(version.entry);
    if (signalEntry !== null && (!Number.isFinite(signalEntry) || signalEntry <= 0)) {
      throw new ConflictException(`INVALID_ENTRY: ${String(version.entry)}`);
    }
    const entry = signalEntry ?? mid;
    const stopLoss = version.stopLoss === null ? null : asNumber(version.stopLoss);
    const tps = asPriceArray(version.takeProfits);
    if (stopLoss === null) throw new ConflictException("STOP_LOSS_REQUIRED");
    if (tps.length === 0) throw new ConflictException("NO_TAKE_PROFITS");

    const spec = await this.marketData.assetSpec(coin);
    if (!spec) throw new ConflictException(`NO_SYMBOL_MAP: no spec for ${coin}`);
    const requestedNotional = Number(opts.targetNotional);
    const hasCustomNotional = Number.isFinite(requestedNotional) && requestedNotional > 0;
    const targetNotional = hasCustomNotional
      ? requestedNotional
      : await this.coins.notionalFor(coin);
    const sizing = calcPerpSizeByNotional({
      notional: targetNotional,
      entryPrice: entry,
      minSize: spec.minSize,
      sizeIncrement: spec.sizeIncrement,
    });
    if (sizing.rejected) throw new ConflictException(`sizing rejected: ${sizing.reason}`);

    // Multi-entry (DCA): entry[0] takes the full target notional, every later
    // level keeps 1/N of it frozen. Limit orders now WAIT for the price to
    // reach every level (including entry[0]) before the position gets size;
    // `entry market` fills the first level immediately at the current mid and
    // only leaves the numeric levels pending.
    const numericLevels = ladderOrdered(version.direction, payloadLevels)
      ? payloadLevels
      : payloadLevels.slice(0, 1);
    const awaitingEntry = !entryMarket;
    const orderedLevels = entryMarket
      ? [entry, ...numericLevels]
      : payloadLevels.length > 0
        ? payloadLevels
        : [entry];
    const effectiveLevels = entryMarket
      ? orderedLevels
      : ladderOrdered(version.direction, orderedLevels)
        ? orderedLevels
        : [orderedLevels[0]];
    const sliceNotional = hasCustomNotional ? targetNotional : targetNotional / effectiveLevels.length;
    const entriesJson = effectiveLevels.map((price, i) => ({
      price,
      notional: hasCustomNotional ? targetNotional : i === 0 ? targetNotional : sliceNotional,
    }));
    const pendingJson = awaitingEntry
      ? effectiveLevels.map((price, i) => ({
          price,
          notional: hasCustomNotional ? targetNotional : i === 0 ? targetNotional : sliceNotional,
        }))
      : effectiveLevels.slice(1).map((price) => ({
          price,
          notional: hasCustomNotional ? targetNotional : sliceNotional,
        }));

    const mids = await this.marketData.getAllMids().catch(() => ({} as Record<string, number>));
    const opens = await this.prisma.virtualPosition.findMany({
      where: { accountId, status: { in: OPEN_STATUSES } },
    });
    const priced = opens.map((p) => ({
      coin: p.coin,
      direction: p.direction as VirtualDirection,
      size: asNumber(p.remainingSize),
      entryPrice: asNumber(p.entryPrice),
      leverage: p.leverage,
    }));
    const equity =
      asNumber(account.balance) +
      priced.reduce(
        (sum, p) =>
          sum + (mids[p.coin] !== undefined ? unrealizedPnl(p.direction, p.size, p.entryPrice, mids[p.coin]) : 0),
        0,
      );
    const risk = evaluateVirtualRisk({
      killSwitch: "OFF",
      approvalValid: true,
      coinMapped: true,
      size: sizing.size,
      minSize: spec.minSize,
      sizeIncrement: spec.sizeIncrement,
      notional: sizing.size * entry,
      leverage: account.leverage,
      equity,
      openPositions: opens.length,
      maxPositions: MAX_POSITIONS,
      isMutation: false,
    });
    await this.prisma.riskEvent.create({
      data: {
        checkName: "VIRTUAL_OPEN",
        passed: risk.passed,
        reason: risk.passed ? null : risk.failures.join(","),
        configJson: {
          signalId,
          versionId: version.id,
          accountId,
          coin,
          targetNotional,
          size: sizing.size,
          notional: sizing.size * entry,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    if (!risk.passed) {
      throw new ForbiddenException(`risk rejected: ${risk.failures.join(",")}`);
    }

    const position = await this.prisma.virtualPosition.create({
      data: {
        accountId,
        signalId,
        signalVersionId: version.id,
        coin,
        direction: version.direction,
        size: awaitingEntry ? 0 : sizing.size,
        entryPrice: entry,
        stopLoss,
        takeProfits: tps,
        leverage: account.leverage,
        remainingSize: awaitingEntry ? 0 : sizing.size,
        filledTps: [],
        entries: entriesJson as unknown as Prisma.InputJsonValue,
        pendingEntries: pendingJson as unknown as Prisma.InputJsonValue,
        status: awaitingEntry ? "PENDING_ENTRY" : "OPEN",
        styleChosen: !awaitingEntry,
        ...(awaitingEntry ? {} : { filledAt: new Date() }),
      },
    });
    await this.audit.record(actor, "position.open", {
      positionId: position.id,
      signalId,
      coin,
      size: awaitingEntry ? 0 : sizing.size,
      entry,
      targetNotional,
      notional: awaitingEntry ? 0 : sizing.size * entry,
      entrySource: signalEntry === null ? "mid" : "signal",
      markPriceAtOpen: mid,
      awaitingEntry,
      entryMarket,
      marketEntryDelayMs,
      initialMid,
      openedMid: mid,
      priceChangedBeforeOpen: openedMid !== initialMid,
      entryWaitMs: Math.max(0, Date.now() - entryWaitStartedAt),
    });
    return { position, created: true, awaitingEntry };
  }

  // ------------------------------------------------------------- closing

  async closePosition(positionId: string, actor: string, reason = "MANUAL") {
    const raw = await this.prisma.virtualPosition.findUnique({ where: { id: positionId } });
    if (!raw) throw new NotFoundException(`position ${positionId} not found`);
    if (raw.status === "PENDING_ENTRY") {
      const cancelled = await this.prisma.virtualPosition.update({
        where: { id: positionId },
        data: { status: "CANCELLED", closedAt: new Date() },
      });
      await this.audit.record(actor, "position.cancel", {
        positionId,
        reason: "ENTRY_CANCELLED",
      });
      return { position: cancelled, closedSize: 0, realized: 0, cancelled: true };
    }
    const position = await this.getOpen(positionId);
    const mid = await this.marketData.getMid(position.coin);
    if (mid === null) throw new ConflictException(`NO_QUOTE for ${position.coin}: refusing to guess close`);
    return this.closeAt(position, mid, "CLOSED", actor, reason);
  }

  /**
   * Operator take-profit at the live mark. `percent` (0..100) or `size`
   * (coin units); neither = close everything. `filled_tps` is intentionally
   * left untouched — the pre-defined TP levels are price targets, not a
   * bookkeeping slot for a manual exit.
   */
  async takeProfitManual(
    positionId: string,
    opts: { size?: number; percent?: number },
    actor: string,
  ): Promise<{
    markPrice: number;
    closedSize: number;
    realized: number;
    remainingSize: number;
    fullyClosed: boolean;
  }> {
    const position = await this.getOpen(positionId);
    const mid = await this.marketData.getMid(position.coin);
    if (mid === null) throw new ConflictException(`NO_QUOTE for ${position.coin}: refusing to guess close`);
    if (opts.size !== undefined && opts.percent !== undefined) {
      throw new ConflictException("SIZE_OR_PERCENT_ONLY");
    }
    const remaining = asNumber(position.remainingSize);
    if (!(remaining > 0)) throw new ConflictException("nothing left to close");

    let closeSize = remaining;
    if (opts.percent !== undefined) {
      if (!Number.isFinite(opts.percent) || opts.percent <= 0 || opts.percent > 100) {
        throw new ConflictException("INVALID_PERCENT");
      }
      closeSize = opts.percent >= 100 ? remaining : remaining * (opts.percent / 100);
    } else if (opts.size !== undefined) {
      if (!Number.isFinite(opts.size) || opts.size <= 0) {
        throw new ConflictException("INVALID_SIZE");
      }
      closeSize = Math.min(opts.size, remaining);
    }
    if (closeSize < remaining) {
      const spec = await this.marketData.assetSpec(position.coin);
      if (spec) closeSize = Math.min(roundDownToStep(closeSize, spec.sizeIncrement), remaining);
    }
    if (!(closeSize > 0)) throw new ConflictException("SIZE_TOO_SMALL");

    const realized = realizedPnl(
      position.direction as VirtualDirection,
      closeSize,
      asNumber(position.entryPrice),
      mid,
    );
    const newRemaining = Math.max(0, remaining - closeSize);
    const dust = newRemaining <= 1e-8;
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.virtualPosition.updateMany({
        where: {
          id: position.id,
          status: { in: OPEN_STATUSES },
          remainingSize: position.remainingSize,
        },
        data: {
          remainingSize: dust ? 0 : newRemaining,
          realizedPnl: asNumber(position.realizedPnl ?? 0) + realized,
          ...(dust
            ? { status: "CLOSED", closedAt: new Date(), closePrice: mid }
            : {}),
        },
      });
      if (changed.count !== 1) {
        throw new ConflictException("POSITION_CHANGED: retry");
      }
      await this.accounts.applyRealizedPnl(
        tx,
        position.accountId,
        realized,
        `TP_MANUAL:${position.id}`,
      );
    });
    await this.audit.record(actor, "position.tp_manual", {
      positionId: position.id,
      closePrice: mid,
      closedSize: closeSize,
      realized,
      remainingSize: dust ? 0 : newRemaining,
      fullyClosed: dust,
    });
    return {
      markPrice: mid,
      closedSize: closeSize,
      realized,
      remainingSize: dust ? 0 : newRemaining,
      fullyClosed: dust,
    };
  }

  /** Move the stop loss of an open position. A level that is already through
   *  the mark is rejected (the operator should close instead). */
  async updateStopLoss(
    positionId: string,
    stopLoss: number,
    actor: string,
  ): Promise<{ old: number | null; new: number }> {
    const position = await this.getOpen(positionId);
    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
      throw new ConflictException("INVALID_STOP_LOSS");
    }
    const mid = await this.marketData.getMid(position.coin);
    if (mid === null) throw new ConflictException(`NO_QUOTE for ${position.coin}: refusing to guess stop`);
    const triggered =
      position.direction === "LONG" ? stopLoss >= mid : stopLoss <= mid;
    if (triggered) throw new ConflictException("SL_ALREADY_TRIGGERED");
    const old = position.stopLoss === null ? null : asNumber(position.stopLoss);
    const changed = await this.prisma.virtualPosition.updateMany({
      where: { id: position.id, status: { in: OPEN_STATUSES } },
      data: { stopLoss },
    });
    if (changed.count !== 1) throw new ConflictException("POSITION_CHANGED: retry");
    await this.audit.record(actor, "position.sl_update", {
      positionId: position.id,
      old,
      new: stopLoss,
      markPrice: mid,
    });
    return { old, new: stopLoss };
  }

  private async closeAt(
    position: VirtualPosition,
    closePrice: number,
    status: "CLOSED" | "SL_HIT",
    actor: string,
    reason: string,
  ) {
    const remaining = asNumber(position.remainingSize);
    const realized = realizedPnl(
      position.direction as VirtualDirection,
      remaining,
      asNumber(position.entryPrice),
      closePrice,
    );
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.virtualPosition.update({
        where: { id: position.id },
        data: {
          remainingSize: 0,
          status,
          closedAt: new Date(),
          closePrice,
          realizedPnl: asNumber(position.realizedPnl ?? 0) + realized,
        },
      });
      await this.accounts.applyRealizedPnl(tx, position.accountId, realized, `${reason}:${position.id}`);
      return next;
    });
    await this.audit.record(actor, "position.close", {
      positionId: position.id,
      reason,
      closePrice,
      realized,
    });
    return { position: updated, closedSize: remaining, realized };
  }

  async applyTpHit(positionId: string, markPrice: number, actor: string) {
    const position = await this.getOpen(positionId);
    const tps = asPriceArray(position.takeProfits);
    const filled = asPriceArray(position.filledTps);
    const hit = detectTpSlHit({
      direction: position.direction as VirtualDirection,
      markPrice,
      stopLoss: position.stopLoss === null ? null : asNumber(position.stopLoss),
      remainingTps: tps.slice(filled.length),
    });
    if (hit.kind !== "TP") {
      throw new ConflictException(`no TP hit at ${markPrice} for position ${positionId}`);
    }
    const slices = splitTps(asNumber(position.size), tps.length);
    const remaining = asNumber(position.remainingSize);
    const isLast = filled.length >= tps.length - 1;
    const closeSize = isLast ? remaining : Math.min(slices[filled.length] ?? 0, remaining);
    if (!(closeSize > 0)) throw new ConflictException("nothing left to close");
    const realized = realizedPnl(
      position.direction as VirtualDirection,
      closeSize,
      asNumber(position.entryPrice),
      markPrice,
    );
    const newRemaining = remaining - closeSize;
    const dust = newRemaining <= 1e-8;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.virtualPosition.update({
        where: { id: position.id },
        data: {
          remainingSize: dust ? 0 : newRemaining,
          filledTps: [...filled, hit.tpPrice],
          status: dust ? "CLOSED" : "TP_HIT",
          closedAt: dust ? new Date() : null,
          closePrice: dust ? markPrice : null,
          realizedPnl: asNumber(position.realizedPnl ?? 0) + realized,
        },
      });
      await this.accounts.applyRealizedPnl(tx, position.accountId, realized, `TP:${position.id}`);
      return next;
    });
    await this.audit.record(actor, "position.tp_hit", {
      positionId: position.id,
      tpPrice: hit.tpPrice,
      closedSize: closeSize,
      realized,
    });
    return { position: updated, closedSize: closeSize, realized, fullyClosed: dust };
  }

  async applySlHit(positionId: string, markPrice: number, actor: string) {
    const position = await this.getOpen(positionId);
    const sl = position.stopLoss === null ? null : asNumber(position.stopLoss);
    const hit = detectTpSlHit({
      direction: position.direction as VirtualDirection,
      markPrice,
      stopLoss: sl,
      remainingTps: asPriceArray(position.takeProfits).slice(asPriceArray(position.filledTps).length),
    });
    if (hit.kind !== "SL") {
      throw new ConflictException(`no SL hit at ${markPrice} for position ${positionId}`);
    }
    return this.closeAt(position, markPrice, "SL_HIT", actor, "SL");
  }

  // ----------------------------------------------------------------- DCA

  /**
   * One DCA level filled: grow size by the level's frozen notional and move
   * `entryPrice` to the weighted average of the levels that actually filled.
   * Idempotent — a level already out of `pending_entries` is a no-op, so a
   * retried poll never fills the same level twice.
   */
  async applyEntryFill(
    positionId: string,
    entryPrice: number,
    markPrice: number,
    actor: string,
  ): Promise<{
    applied: boolean;
    reason?: string;
    size?: number;
    entryPrice?: number;
    filled?: number;
    total?: number;
    firstFill?: boolean;
  }> {
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id: positionId },
      include: { account: { select: { balance: true } } },
    });
    if (!position) return { applied: false, reason: "not_found" };
    if (!ACTIVE_STATUSES.includes(position.status)) return { applied: false, reason: "not_open" };
    const wasPending = position.status === "PENDING_ENTRY";
    const pending = readEntryLevels(position.pendingEntries);
    const total = readEntryLevels(position.entries).length;
    const idx = pending.findIndex((l) => Math.abs(l.price - entryPrice) < 1e-9);
    if (idx < 0) return { applied: false, reason: "already_filled" };
    const level = pending[idx];
    const remaining = pending.filter((_, i) => i !== idx);
    const spec = await this.marketData.assetSpec(position.coin);
    const sizing = spec
      ? calcPerpSizeByNotional({
          notional: level.notional,
          entryPrice: level.price,
          minSize: spec.minSize,
          sizeIncrement: spec.sizeIncrement,
        })
      : null;
    if (!sizing || sizing.rejected || !(sizing.size > 0)) {
      // Level is dust against min size: drop it so the queue keeps moving.
      await this.prisma.virtualPosition.update({
        where: { id: positionId },
        data: { pendingEntries: remaining as unknown as Prisma.InputJsonValue },
      });
      const reason = sizing && sizing.rejected ? String(sizing.reason) : "no_spec";
      await this.audit.record(actor, "position.entry_fill_skipped", {
        positionId,
        entryPrice: level.price,
        reason,
      });
      return { applied: false, reason };
    }
    const sizeBefore = asNumber(position.size);
    const entryBefore = asNumber(position.entryPrice);
    const sizeAfter = sizeBefore + sizing.size;
    const decimals = Math.max(2, decimalsOf(entryBefore), decimalsOf(level.price));
    const entryAfter = Number(
      ((sizeBefore * entryBefore + sizing.size * level.price) / sizeAfter).toFixed(decimals),
    );
    const firstFillAt = wasPending || !position.filledAt ? new Date() : undefined;
    await this.prisma.virtualPosition.update({
      where: { id: positionId },
      data: {
        size: sizeAfter,
        remainingSize: asNumber(position.remainingSize) + sizing.size,
        entryPrice: entryAfter,
        pendingEntries: remaining as unknown as Prisma.InputJsonValue,
        ...(wasPending ? { status: "OPEN" } : {}),
        ...(firstFillAt ? { filledAt: firstFillAt } : {}),
      },
    });
    const filledCount = total - remaining.length;
    const balance = asNumber(position.account?.balance);
    const newNotional = sizeAfter * markPrice;
    if (
      Number.isFinite(balance) &&
      position.leverage > 0 &&
      newNotional / position.leverage > balance
    ) {
      // Paper margin is never reserved, so this only warns: the ladder was
      // accepted at open and the levels stay on the book.
      await this.audit.record(actor, "position.entry_over_margin", {
        positionId,
        notional: newNotional,
        leverage: position.leverage,
        balance,
      });
    }
    await this.audit.record(actor, "position.entry_fill", {
      positionId,
      entryPrice: level.price,
      sliceSize: sizing.size,
      sliceNotional: level.notional,
      sizeBefore,
      sizeAfter,
      entryBefore,
      entryAfter,
      filled: filledCount,
      total,
      firstFill: wasPending,
    });
    return {
      applied: true,
      size: sizeAfter,
      entryPrice: entryAfter,
      filled: filledCount,
      total,
      firstFill: wasPending,
    };
  }

  // ------------------------------------------------------------------ poll

  async pollMarketOnce(): Promise<MarketHitEvent[]> {
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") return [];
    const positions = await this.prisma.virtualPosition.findMany({
      where: { status: { in: ACTIVE_STATUSES } },
      orderBy: { openedAt: "asc" },
    });
    if (positions.length === 0) return [];
    let mids: Record<string, number>;
    try {
      mids = await this.marketData.getAllMids();
    } catch {
      return [];
    }
    const events: MarketHitEvent[] = [];
    for (const seeded of positions) {
      const mark = mids[seeded.coin];
      if (typeof mark !== "number") continue;
      let position = seeded;

      // 1) DCA fills first: they change size and the average entry, which the
      //    TP/SL check below must see. Applied inline (not deferred) because
      //    the fill card renders numbers read from this very row.
      const pending = readEntryLevels(position.pendingEntries);
      for (const level of pending) {
        const reached =
          position.direction === "LONG" ? mark <= level.price : mark >= level.price;
        if (!reached) continue;
        const fill = await this.applyEntryFill(position.id, level.price, mark, "worker");
        if (!fill.applied) continue;
        events.push({
          positionId: position.id,
          kind: "ENTRY",
          markPrice: mark,
          entryPrice: level.price,
          firstFill: fill.firstFill === true,
        });
        position =
          (await this.prisma.virtualPosition.findUnique({ where: { id: position.id } })) ??
          position;
      }

      // 2) TP/SL against the refreshed row. A pending-entry order has no size
      //    yet, so it is skipped until the first entry fills.
      if (!OPEN_STATUSES.includes(position.status) || !(asNumber(position.remainingSize) > 0)) {
        continue;
      }
      // 2) TP/SL against the refreshed row. Detection only: the card renders
      //    and replies under the original post first, SettleService closes
      //    the slice afterwards, so a Telegram hiccup cannot reorder the
      //    ledger. The market-watch worker enqueues one settle job per event;
      //    `tpIndex` dedupes it.
      const tps = asPriceArray(position.takeProfits);
      const filledTps = asPriceArray(position.filledTps);
      const hit = detectTpSlHit({
        direction: position.direction as VirtualDirection,
        markPrice: mark,
        stopLoss: position.stopLoss === null ? null : asNumber(position.stopLoss),
        remainingTps: tps.slice(filledTps.length),
      });
      if (hit.kind === "NONE") continue;
      events.push({
        positionId: position.id,
        kind: hit.kind,
        markPrice: mark,
        tpIndex: filledTps.length,
      });
    }
    return events;
  }

  // ------------------------------------------------------------------ read

  async getPosition(id: string) {
    const position = await this.prisma.virtualPosition.findUnique({
      where: { id },
      include: { account: true },
    });
    if (!position) throw new NotFoundException(`position ${id} not found`);
    return position;
  }

  listPositions(status?: string) {
    return this.prisma.virtualPosition.findMany({
      where: status ? { status } : undefined,
      orderBy: { openedAt: "desc" },
    });
  }

  private async getOpen(id: string): Promise<VirtualPosition> {
    const position = await this.prisma.virtualPosition.findUnique({ where: { id } });
    if (!position) throw new NotFoundException(`position ${id} not found`);
    if (!OPEN_STATUSES.includes(position.status)) {
      throw new ConflictException(`position ${id} is ${position.status}, not open`);
    }
    return position;
  }
}
