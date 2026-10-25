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

export interface MarketHitEvent {
  positionId: string;
  kind: "TP" | "SL";
  /** Price frozen at detection: the card and the close both use it. */
  markPrice: number;
  /** TP ordinal at detection (filledTps.length) — settle-job dedupe key. */
  tpIndex: number;
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

  async openApproved(signalId: string, accountId: string, actor: string) {
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
      where: { signalId, signalVersionId: version.id, status: { in: OPEN_STATUSES } },
    });
    if (existing) return { position: existing, created: false };

    const account = await this.accounts.get(accountId);
    const mode = this.killSwitch.getMode();
    if (mode !== "OFF") {
      throw new ForbiddenException(`kill switch ${mode} blocks new positions`);
    }

    const coin = await this.marketData.resolveCoin(version.instrument);
    if (!coin) throw new ConflictException(`NO_SYMBOL_MAP: ${version.instrument} not on Hyperliquid`);
    const mid = await this.marketData.getMid(coin);
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
    const targetNotional = await this.coins.notionalFor(coin);
    const sizing = calcPerpSizeByNotional({
      notional: targetNotional,
      entryPrice: entry,
      minSize: spec.minSize,
      sizeIncrement: spec.sizeIncrement,
    });
    if (sizing.rejected) throw new ConflictException(`sizing rejected: ${sizing.reason}`);

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
        size: sizing.size,
        entryPrice: entry,
        stopLoss,
        takeProfits: tps,
        leverage: account.leverage,
        remainingSize: sizing.size,
        filledTps: [],
        status: "OPEN",
      },
    });
    await this.audit.record(actor, "position.open", {
      positionId: position.id,
      signalId,
      coin,
      size: sizing.size,
      entry,
      targetNotional,
      notional: sizing.size * entry,
      entrySource: signalEntry === null ? "mid" : "signal",
      markPriceAtOpen: mid,
    });
    return { position, created: true };
  }

  // ------------------------------------------------------------- closing

  async closePosition(positionId: string, actor: string, reason = "MANUAL") {
    const position = await this.getOpen(positionId);
    const mid = await this.marketData.getMid(position.coin);
    if (mid === null) throw new ConflictException(`NO_QUOTE for ${position.coin}: refusing to guess close`);
    return this.closeAt(position, mid, "CLOSED", actor, reason);
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

  // ------------------------------------------------------------------ poll

  async pollMarketOnce(): Promise<MarketHitEvent[]> {
    if (this.killSwitch.getMode() === "STOP_ALL_MUTATIONS") return [];
    const positions = await this.prisma.virtualPosition.findMany({
      where: { status: { in: OPEN_STATUSES } },
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
    for (const position of positions) {
      const mark = mids[position.coin];
      if (typeof mark !== "number") continue;
      const tps = asPriceArray(position.takeProfits);
      const filled = asPriceArray(position.filledTps);
      const hit = detectTpSlHit({
        direction: position.direction as VirtualDirection,
        markPrice: mark,
        stopLoss: position.stopLoss === null ? null : asNumber(position.stopLoss),
        remainingTps: tps.slice(filled.length),
      });
      if (hit.kind === "NONE") continue;
      // Detect only. The card is rendered and replied under the original
      // post first, the position is closed afterwards (SettleService), so a
      // Telegram hiccup can never reorder the ledger. The market-watch
      // worker enqueues one settle job per event; `tpIndex` dedupes it.
      events.push({
        positionId: position.id,
        kind: hit.kind,
        markPrice: mark,
        tpIndex: filled.length,
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
