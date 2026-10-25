import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { accountEquity, crossMarginRatio } from "@tracking-auto/domain";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";

export const ACCOUNT_MODES = ["APPROVE", "AUTO"] as const;

export interface CreateAccountDto {
  name: string;
  balance: number;
  leverage?: number;
  mode?: string;
}

function asNumber(value: unknown): number {
  return value instanceof Object && "toNumber" in value
    ? (value as { toNumber(): number }).toNumber()
    : Number(value);
}

@Injectable()
export class VirtualAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly marketData: MarketDataService,
  ) {}

  private validateLeverage(leverage: number): void {
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 50) {
      throw new BadRequestException("leverage must be an integer 1..50");
    }
  }

  async create(dto: CreateAccountDto, actor: string) {
    if (!dto.name?.trim()) throw new BadRequestException("name required");
    if (!(dto.balance >= 0)) throw new BadRequestException("balance must be >= 0");
    const leverage = dto.leverage ?? 10;
    this.validateLeverage(leverage);
    const mode = (dto.mode ?? "APPROVE").toUpperCase();
    if (!ACCOUNT_MODES.includes(mode as (typeof ACCOUNT_MODES)[number])) {
      throw new BadRequestException("mode must be APPROVE or AUTO");
    }
    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.virtualAccount.create({
        data: { name: dto.name.trim(), balance: dto.balance, leverage, mode },
      });
      if (dto.balance > 0) {
        await tx.virtualTransaction.create({
          data: { accountId: created.id, type: "DEPOSIT", amount: dto.balance, reference: "genesis" },
        });
      }
      return created;
    });
    await this.audit.record(actor, "account.create", { accountId: account.id });
    return account;
  }

  list() {
    return this.prisma.virtualAccount.findMany({ orderBy: { createdAt: "asc" } });
  }

  /** Env default → first account. Throws when no account exists. */
  async defaultAccount() {
    const envId = process.env.VIRTUAL_DEFAULT_ACCOUNT_ID ?? "";
    if (envId) return this.get(envId);
    const first = await this.prisma.virtualAccount.findFirst({ orderBy: { createdAt: "asc" } });
    if (!first) throw new NotFoundException("no virtual account exists");
    return first;
  }

  async get(id: string) {
    const account = await this.prisma.virtualAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`account ${id} not found`);
    return account;
  }

  /** Full computed view: equity, unrealized, margin ratio, open positions. */
  async view(id: string) {
    const account = await this.get(id);
    const positions = await this.prisma.virtualPosition.findMany({
      where: { accountId: id, status: { in: ["OPEN", "TP_HIT"] } },
    });
    const mids = await this.marketData.getAllMids().catch(() => ({} as Record<string, number>));
    const priced = positions.map((p) => ({
      coin: p.coin,
      direction: p.direction as "LONG" | "SHORT",
      size: asNumber(p.remainingSize),
      entryPrice: asNumber(p.entryPrice),
      leverage: p.leverage,
    }));
    const equity = accountEquity(asNumber(account.balance), priced, mids);
    const ratio = crossMarginRatio(asNumber(account.balance), priced, mids);
    const rows = positions.map((p) => {
      const mark = mids[p.coin];
      const unrealized =
        typeof mark === "number"
          ? (p.direction === "LONG" ? 1 : -1) * (mark - asNumber(p.entryPrice)) *
            asNumber(p.remainingSize)
          : null;
      return { ...p, markPrice: mark ?? null, unrealizedPnl: unrealized };
    });
    return {
      account,
      equity,
      marginRatio: ratio,
      openPositions: rows,
      realizedPnl: await this.realizedPnl(id),
    };
  }

  async realizedPnl(accountId: string): Promise<number> {
    const rows = await this.prisma.virtualTransaction.findMany({
      where: { accountId, type: "REALIZED_PNL" },
      select: { amount: true },
    });
    return rows.reduce((sum, r) => sum + asNumber(r.amount), 0);
  }

  async deposit(id: string, amount: number, actor: string) {
    if (!(amount > 0)) throw new BadRequestException("amount must be > 0");
    await this.get(id);
    const updated = await this.prisma.$transaction(async (tx) => {
      const acc = await tx.virtualAccount.findUniqueOrThrow({ where: { id } });
      const next = await tx.virtualAccount.update({
        where: { id },
        data: { balance: Number(asNumber(acc.balance)) + amount },
      });
      await tx.virtualTransaction.create({
        data: { accountId: id, type: "DEPOSIT", amount },
      });
      return next;
    });
    await this.audit.record(actor, "account.deposit", { accountId: id, amount });
    return updated;
  }

  async withdraw(id: string, amount: number, actor: string) {
    if (!(amount > 0)) throw new BadRequestException("amount must be > 0");
    const account = await this.get(id);
    if (amount > asNumber(account.balance)) {
      throw new ConflictException("withdraw exceeds balance");
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.virtualAccount.update({
        where: { id },
        data: { balance: Number(asNumber(account.balance)) - amount },
      });
      await tx.virtualTransaction.create({
        data: { accountId: id, type: "WITHDRAW", amount: -amount },
      });
      return next;
    });
    await this.audit.record(actor, "account.withdraw", { accountId: id, amount });
    return updated;
  }

  async setMode(id: string, mode: string, actor: string) {
    const upper = mode.toUpperCase();
    if (!ACCOUNT_MODES.includes(upper as (typeof ACCOUNT_MODES)[number])) {
      throw new BadRequestException("mode must be APPROVE or AUTO");
    }
    await this.get(id);
    const updated = await this.prisma.virtualAccount.update({ where: { id }, data: { mode: upper } });
    await this.audit.record(actor, "account.mode", { accountId: id, mode: upper });
    return updated;
  }

  async setLeverage(id: string, leverage: number, actor: string) {
    this.validateLeverage(leverage);
    await this.get(id);
    const open = await this.prisma.virtualPosition.count({
      where: { accountId: id, status: { in: ["OPEN", "TP_HIT"] } },
    });
    if (open > 0) throw new ConflictException("close all positions before changing leverage");
    const updated = await this.prisma.virtualAccount.update({ where: { id }, data: { leverage } });
    await this.audit.record(actor, "account.leverage", { accountId: id, leverage });
    return updated;
  }

  /**
   * Reset: close every open position at current mid (realized to ledger),
   * then set balance. Fails loudly if any mark is missing — never guesses.
   */
  async reset(
    id: string,
    balance: number,
    actor: string,
    closeFn: (positionId: string) => Promise<unknown>,
  ) {
    if (!(balance >= 0)) throw new BadRequestException("balance must be >= 0");
    await this.get(id);
    const open = await this.prisma.virtualPosition.findMany({
      where: { accountId: id, status: { in: ["OPEN", "TP_HIT"] } },
      select: { id: true },
    });
    for (const p of open) {
      await closeFn(p.id);
    }
    const updated = await this.prisma.virtualAccount.update({ where: { id }, data: { balance } });
    await this.audit.record(actor, "account.reset", { accountId: id, balance });
    return updated;
  }

  /** Balance arithmetic helper shared with trading service. */
  async applyRealizedPnl(
    tx: Prisma.TransactionClient,
    accountId: string,
    amount: number,
    reference: string,
  ): Promise<void> {
    const acc = await tx.virtualAccount.findUniqueOrThrow({ where: { id: accountId } });
    await tx.virtualAccount.update({
      where: { id: accountId },
      data: { balance: Number(asNumber(acc.balance)) + amount },
    });
    await tx.virtualTransaction.create({
      data: { accountId, type: "REALIZED_PNL", amount, reference },
    });
  }
}
