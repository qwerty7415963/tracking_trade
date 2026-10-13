import { Inject, Injectable } from "@nestjs/common";
import {
  BrokerPosition,
  BrokerSymbolInfo,
} from "@tracking-auto/mt5-bridge-contract";
import { APP_CONFIG, AppConfig } from "../config/app.config";
import { PrismaService } from "../database/prisma.service";

export interface HeartbeatPayload {
  accountId: string;
  terminal?: string;
  build?: string;
  status: string;
  balance?: number;
  equity?: number;
  margin?: number;
  marginFree?: number;
  marginRequired?: number;
  positions?: BrokerPosition[];
  symbols?: Record<string, BrokerSymbolInfo>;
}

/** Broker truth as pushed by the EA (poll topology). Stale data fails safe. */
export const BRIDGE_STALE_MS = 120_000;

@Injectable()
export class BrokerStateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async recordHeartbeat(payload: HeartbeatPayload): Promise<{ ok: true }> {
    await this.prisma.bridgeHeartbeat.create({
      data: {
        accountId: payload.accountId,
        terminal: payload.terminal ?? null,
        status: payload.status,
        details: {
          build: payload.build ?? null,
          balance: payload.balance ?? null,
          equity: payload.equity ?? null,
          margin: payload.margin ?? null,
          marginFree: payload.marginFree ?? null,
          marginRequired: payload.marginRequired ?? null,
          positions: payload.positions ?? [],
          symbols: payload.symbols ?? {},
        } as never,
      },
    });
    return { ok: true };
  }

  private async latestDetails(accountId: string): Promise<Record<string, unknown> | null> {
    const row = await this.prisma.bridgeHeartbeat.findFirst({
      where: { accountId },
      orderBy: { receivedAt: "desc" },
    });
    if (!row) return null;
    if (Date.now() - row.receivedAt.getTime() > BRIDGE_STALE_MS) return null;
    return (row.details ?? {}) as Record<string, unknown>;
  }

  async positions(accountId: string): Promise<BrokerPosition[]> {
    const details = await this.latestDetails(accountId);
    const positions = details?.["positions"];
    return Array.isArray(positions) ? (positions as BrokerPosition[]) : [];
  }

  async account(accountId: string): Promise<Record<string, number>> {
    const details = await this.latestDetails(accountId);
    if (!details) return {};
    const out: Record<string, number> = {};
    for (const key of ["balance", "equity", "margin", "marginFree", "marginRequired"]) {
      const value = details[key];
      if (typeof value === "number") out[key] = value;
    }
    return out;
  }

  async symbolInfo(accountId: string, symbol: string): Promise<BrokerSymbolInfo | null> {
    const details = await this.latestDetails(accountId);
    const symbols = details?.["symbols"] as Record<string, BrokerSymbolInfo> | undefined;
    return symbols?.[symbol] ?? null;
  }

  async isAlive(accountId: string): Promise<boolean> {
    return (await this.latestDetails(accountId)) !== null;
  }

  defaultAccount(): string {
    return this.config.mt5AccountId;
  }
}
