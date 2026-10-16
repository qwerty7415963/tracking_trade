import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, TradableCoin } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../database/prisma.service";
import { CreateCoinDto, UpdateCoinDto } from "./dto/coin.dto";

export function normalizeSymbol(raw: string): string {
  return raw.trim().toUpperCase();
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
    try {
      const coin = await this.prisma.tradableCoin.create({
        data: { symbol, notes: dto.notes, createdBy: actor },
      });
      await this.audit.record(actor, "coin.create", { coinId: coin.id, symbol });
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
    try {
      const coin = await this.prisma.tradableCoin.update({
        where: { id },
        data: {
          symbol,
          enabled: dto.enabled,
          notes: dto.notes,
          updatedBy: actor,
        },
      });
      await this.audit.record(actor, "coin.update", { coinId: id });
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
