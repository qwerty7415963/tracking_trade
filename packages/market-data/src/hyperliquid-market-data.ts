// Hyperliquid public market-data adapter (perps). No API key needed for
// info endpoints. Mapping is data-driven from `meta` — never hardcoded.

export interface HyperliquidAssetMeta {
  name: string;
  szDecimals: number;
  maxLeverage?: number;
  // other meta fields are ignored
}

export interface HyperliquidMeta {
  universe: HyperliquidAssetMeta[];
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

// Canonical commodity codes mapped to listed coins.
// Hyperliquid lists PAX Gold as PAXG (verified live); there is no XAU coin.
const ALIASES: Record<string, string> = {
  GOLD: "PAXG",
  XAU: "PAXG",
  SILVER: "XAG",
};

function stripBrokerSuffix(raw: string): string {
  return raw.replace(/\.\w+$/, "");
}

export class HyperliquidMarketData {
  private metaCache: { at: number; meta: HyperliquidMeta } | null = null;

  constructor(
    private readonly baseUrl = "https://api.hyperliquid.xyz",
    private readonly fetchFn: FetchFn = fetch,
    private readonly metaTtlMs = 5 * 60 * 1000,
  ) {}

  private async post<T>(type: string, extra?: Record<string, unknown>): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl}/info`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, ...extra }),
    });
    if (!res.ok) {
      throw new Error(`HYPERLIQUID_HTTP_FAILED: ${res.status}`);
    }
    return (await res.json()) as T;
  }

  /** Coin -> mid price, as numbers. */
  async getAllMids(): Promise<Record<string, number>> {
    const raw = await this.post<Record<string, string>>("allMids");
    const out: Record<string, number> = {};
    for (const [coin, px] of Object.entries(raw)) {
      const n = Number(px);
      if (Number.isFinite(n)) out[coin] = n;
    }
    return out;
  }

  async getMeta(force = false): Promise<HyperliquidMeta> {
    const now = Date.now();
    if (!force && this.metaCache && now - this.metaCache.at < this.metaTtlMs) {
      return this.metaCache.meta;
    }
    const meta = await this.post<HyperliquidMeta>("meta");
    if (!meta || !Array.isArray(meta.universe)) {
      throw new Error("HYPERLIQUID_BAD_META");
    }
    this.metaCache = { at: now, meta };
    return meta;
  }

  /**
   * Resolve a canonical signal instrument (e.g. "XAU", "ETH", "XAUUSD")
   * to a Hyperliquid coin name, using the live universe. Returns null
   * when unsupported — callers must send those to review, never guess.
   */
  resolveCoin(canonical: string, meta: HyperliquidMeta): string | null {
    const byName = new Map<string, string>();
    const byBase = new Map<string, string>();
    for (const asset of meta.universe) {
      byName.set(asset.name.toUpperCase(), asset.name);
      const base = asset.name.includes(":")
        ? asset.name.split(":").slice(-1)[0].toUpperCase()
        : asset.name.toUpperCase();
      if (!byBase.has(base)) byBase.set(base, asset.name);
    }

    const upper = canonical.toUpperCase().trim();
    const stripped = stripBrokerSuffix(upper);
    const base = stripped.replace(/(USD|USDT|USDC)$/, "");
    const candidates = [
      upper,
      stripped,
      base,
      ALIASES[upper] ?? ALIASES[stripped] ?? ALIASES[base] ?? "",
    ].filter((c) => c.length > 0);

    for (const c of candidates) {
      if (byName.has(c)) return byName.get(c) as string;
      if (byBase.has(c)) return byBase.get(c) as string;
    }
    return null;
  }

  async getMid(coin: string): Promise<number | null> {
    const mids = await this.getAllMids();
    const px = mids[coin];
    return typeof px === "number" ? px : null;
  }
}
