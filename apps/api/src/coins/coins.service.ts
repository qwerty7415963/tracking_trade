import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TradableCoin } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateCoinDto, UpdateCoinDto } from "./dto/coin.dto";

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
}

export const DEFAULT_COIN_NOTIONAL_USD = 50_000;
export const COIN_NOTIONAL_DEFAULTS: Readonly<Record<string, number>> = {
  BTC: 100_000,
  ETH: 100_000,
  SOL: 100_000,
};

/** Fixed USDC notional used when a coin has no explicit override. */
export function defaultNotionalFor(symbol: string): number {
  return COIN_NOTIONAL_DEFAULTS[normalizeSymbol(symbol)] ?? DEFAULT_COIN_NOTIONAL_USD;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class CoinsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(): Promise<TradableCoin[]> {
    return this.prisma.tradableCoin.findMany({ orderBy: { symbol: "asc" } });
  }

  async listNotionals(): Promise<
    Array<{ id: string; symbol: string; enabled: boolean; notionalUsd: number }>
  > {
    const rows = await this.list();
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      enabled: row.enabled,
      notionalUsd: Number(row.notionalUsd),
    }));
  }

  /**
   * Fixed USDC notional for a resolved Hyperliquid coin. A missing or invalid
   * row falls back to the symbol defaults so sizing never silently becomes 0.
   */
  async notionalFor(symbol: string): Promise<number> {
    const row = await this.prisma.tradableCoin
      .findUnique({
        where: { symbol: normalizeSymbol(symbol) },
        select: { notionalUsd: true },
      })
      .catch(() => null);
    const value = row ? Number(row.notionalUsd) : NaN;
    return Number.isFinite(value) && value > 0 ? value : defaultNotionalFor(symbol);
  }

  async setNotional(
    ref: string,
    amount: number,
    actor: string,
  ): Promise<{ id: string; symbol: string; notionalUsd: number }> {
    const coin = await this.resolve(ref);
    const next = this.validNotional(amount);
    const previous = Number(coin.notionalUsd);
    const updated = await this.prisma.tradableCoin.update({
      where: { id: coin.id },
      data: { notionalUsd: next, updatedBy: actor },
    });
    await this.audit.record(actor, "coin.notional", {
      coinId: coin.id,
      symbol: coin.symbol,
      from: Number.isFinite(previous) ? previous : defaultNotionalFor(coin.symbol),
      to: next,
    });
    return {
      id: updated.id,
      symbol: updated.symbol,
      notionalUsd: Number(updated.notionalUsd),
    };
  }

  async resetNotional(
    ref: string,
    actor: string,
  ): Promise<{ id: string; symbol: string; notionalUsd: number }> {
    const coin = await this.resolve(ref);
    const next = defaultNotionalFor(coin.symbol);
    const previous = Number(coin.notionalUsd);
    const updated = await this.prisma.tradableCoin.update({
      where: { id: coin.id },
      data: { notionalUsd: next, updatedBy: actor },
    });
    await this.audit.record(actor, "coin.notional.reset", {
      coinId: coin.id,
      symbol: coin.symbol,
      from: Number.isFinite(previous) ? previous : next,
      to: next,
    });
    return {
      id: updated.id,
      symbol: updated.symbol,
      notionalUsd: Number(updated.notionalUsd),
    };
  }

  private validNotional(amount: number): number {
    if (!Number.isFinite(amount) || !(amount > 0)) {
      throw new BadRequestException("notionalUsd must be > 0");
    }
    return amount;
  }

  /** Uppercase enabled symbols — the operator-managed gate for parsed coins. */
  async enabledSymbols(): Promise<string[]> {
    const rows = await this.prisma.tradableCoin.findMany({ where: { enabled: true } });
    return rows.map((r) => r.symbol.toUpperCase());
  }

  async isAllowed(symbol: string): Promise<boolean> {
    const normalized = normalizeSymbol(symbol);
    if (!normalized) return false;
    const row = await this.prisma.tradableCoin.findFirst({
      where: { symbol: normalized, enabled: true },
    });
    return row !== null;
  }

  async get(id: string): Promise<TradableCoin> {
    const coin = await this.prisma.tradableCoin.findUnique({ where: { id } });
    if (!coin) throw new NotFoundException(`coin ${id} not found`);
    return coin;
  }

  /** Resolve an id or symbol (case-insensitive) to exactly one coin. */
  async resolve(ref: string): Promise<TradableCoin> {
    const trimmed = ref.trim();
    if (!trimmed) throw new NotFoundException("empty coin ref");
    if (UUID_PATTERN.test(trimmed)) return this.get(trimmed);
    const coin = await this.prisma.tradableCoin.findFirst({
      where: { symbol: normalizeSymbol(trimmed) },
    });
    if (!coin) throw new NotFoundException(`no coin matches "${trimmed}"`);
    return coin;
  }

  async create(dto: CreateCoinDto, actor: string): Promise<TradableCoin> {
    const symbol = normalizeSymbol(dto.symbol);
    if (!symbol) throw new ConflictException("coin symbol must not be empty");
    const notionalUsd =
      dto.notionalUsd === undefined ? defaultNotionalFor(symbol) : this.validNotional(dto.notionalUsd);
    try {
      const coin = await this.prisma.tradableCoin.create({
        data: { symbol, notionalUsd, notes: dto.notes, createdBy: actor },
      });
      await this.audit.record(actor, "coin.create", { coinId: coin.id, symbol, notionalUsd });
      return coin;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`coin ${symbol} already exists`);
      }
      throw err;
    }
  }

  async update(id: string, dto: UpdateCoinDto, actor: string): Promise<TradableCoin> {
    await this.get(id);
    const symbol = dto.symbol === undefined ? undefined : normalizeSymbol(dto.symbol);
    if (symbol !== undefined && !symbol) {
      throw new ConflictException("coin symbol must not be empty");
    }
    const notionalUsd =
      dto.notionalUsd === undefined ? undefined : this.validNotional(dto.notionalUsd);
    try {
      const coin = await this.prisma.tradableCoin.update({
        where: { id },
        data: {
          symbol,
          enabled: dto.enabled,
          notionalUsd,
          notes: dto.notes,
          updatedBy: actor,
        },
      });
      await this.audit.record(actor, "coin.update", {
        coinId: id,
        ...(notionalUsd === undefined ? {} : { notionalUsd }),
      });
      return coin;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new ConflictException(`coin ${symbol} already exists`);
      }
      throw err;
    }
  }

  /** Hard delete: coins carry no history FK, and disabling is the safe off-switch. */
  async remove(id: string, actor: string): Promise<TradableCoin> {
    const coin = await this.get(id);
    await this.prisma.tradableCoin.delete({ where: { id } });
    await this.audit.record(actor, "coin.delete", { coinId: id, symbol: coin.symbol });
    return coin;
  }
}
