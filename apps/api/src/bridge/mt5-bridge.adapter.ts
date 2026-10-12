import { Injectable } from "@nestjs/common";
import {
  BridgeCommand,
  BridgeResponse,
  BrokerPosition,
  BrokerSymbolInfo,
  BridgeHeartbeat,
} from "@tracking-auto/mt5-bridge-contract";

export interface BridgePort {
  sendCommand(command: BridgeCommand): Promise<BridgeResponse>;
  commandStatus(commandId: string): Promise<BridgeResponse>;
  positions(accountId: string): Promise<BrokerPosition[]>;
  orders(accountId: string): Promise<Array<Record<string, unknown>>>;
  deals(accountId: string): Promise<Array<Record<string, unknown>>>;
  symbolInfo(accountId: string, symbol: string): Promise<BrokerSymbolInfo | null>;
  account(accountId: string): Promise<Record<string, number>>;
  heartbeat(accountId: string): Promise<BridgeHeartbeat | null>;
}

/** HTTP bridge adapter. The EA/bridge is reached over outbound-authenticated HTTP. */
@Injectable()
export class MT5BridgeAdapter implements BridgePort {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`bridge http ${res.status}`);
    return (await res.json()) as T;
  }

  sendCommand(command: BridgeCommand): Promise<BridgeResponse> {
    return this.call<BridgeResponse>("/commands", {
      method: "POST",
      body: JSON.stringify(command),
    });
  }

  commandStatus(commandId: string): Promise<BridgeResponse> {
    return this.call<BridgeResponse>(`/commands/${encodeURIComponent(commandId)}`);
  }

  positions(accountId: string): Promise<BrokerPosition[]> {
    return this.call<BrokerPosition[]>(`/accounts/${encodeURIComponent(accountId)}/positions`);
  }

  orders(accountId: string): Promise<Array<Record<string, unknown>>> {
    return this.call(`/accounts/${encodeURIComponent(accountId)}/orders`);
  }

  deals(accountId: string): Promise<Array<Record<string, unknown>>> {
    return this.call(`/accounts/${encodeURIComponent(accountId)}/deals`);
  }

  symbolInfo(accountId: string, symbol: string): Promise<BrokerSymbolInfo | null> {
    return this.call(`/accounts/${encodeURIComponent(accountId)}/symbols/${encodeURIComponent(symbol)}`);
  }

  account(accountId: string): Promise<Record<string, number>> {
    return this.call(`/accounts/${encodeURIComponent(accountId)}`);
  }

  heartbeat(accountId: string): Promise<BridgeHeartbeat | null> {
    return this.call(`/accounts/${encodeURIComponent(accountId)}/heartbeat`);
  }
}

export const BRIDGE_PORT = "BRIDGE_PORT";
