import { createHash } from "crypto";
import { Browser, Page } from "playwright";
import { CardTheme, DEFAULT_CARD_THEME, STATS_CARD_THEME } from "./card-config";
import { CardKind, DEFAULT_CARD_KIND, PositionSnapshot, RenderArtifact, RenderErrorCode } from "./card-types";
import { renderCardHtml } from "./card-template";
import { renderStatsHtml } from "./stats-card-template";
import { buildStatsViewModel } from "./stats-view-model";
import { buildViewModel } from "./view-model";
import { validateSnapshot } from "./snapshot-validator";

export type BrowserFactory = () => Promise<Browser>;
export type RenderFailure = { ok: false; code: RenderErrorCode; detail: string };
export type RenderSuccess = { ok: true; artifact: RenderArtifact };
export type RenderOutcome = RenderSuccess | RenderFailure;

/** Bump a kind's number when its template changes markup. */
export const TEMPLATE_VERSIONS: Record<CardKind, number> = {
  "pnl-strip": 1,
  "position-stats": 6,
};
/** Original strip version — kept for existing imports/tests. */
export const TEMPLATE_VERSION = TEMPLATE_VERSIONS["pnl-strip"];

export function parsePngDimensions(png: Buffer): { width: number; height: number } | null {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (png.length < 24 || !png.subarray(0, 8).equals(signature)) return null;
  if (png.subarray(12, 16).toString("ascii") !== "IHDR") return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Renders floating-P&L cards from verified snapshots. Never touches trading. */
export class FloatingPnLCardRenderer {
  constructor(
    private readonly browserFactory: BrowserFactory,
    private readonly theme: CardTheme = DEFAULT_CARD_THEME,
    private readonly timeoutMs: number = 15000,
  ) {}

  async render(
    snapshot: Partial<PositionSnapshot> | null,
    now: Date = new Date(),
    kind: CardKind = DEFAULT_CARD_KIND,
  ): Promise<RenderOutcome> {
    const theme = kind === "position-stats" ? STATS_CARD_THEME : this.theme;
    const validation = validateSnapshot(snapshot, theme, now);
    if (!validation.ok) return validation;
    const full = snapshot as PositionSnapshot;

    let html: string;
    if (kind === "position-stats") {
      const vm = buildStatsViewModel(full, theme);
      if (!vm.ok) return vm;
      html = renderStatsHtml(vm.model, theme);
    } else {
      const vm = buildViewModel(full, theme);
      if (!vm.ok) return vm;
      html = renderCardHtml(vm.model, theme);
    }
    let browser: Browser | null = null;
    try {
      browser = await this.withTimeout(this.browserFactory(), "browser launch");
      const page: Page = await browser.newPage({
        viewport: { width: theme.width, height: theme.height },
      });
      await this.withTimeout(page.setContent(html, { waitUntil: "load" }), "page load");
      const png = await this.withTimeout(
        page.screenshot({ type: "png", fullPage: false }),
        "screenshot",
      );
      const dims = parsePngDimensions(png);
      if (!dims || dims.width !== theme.width || dims.height !== theme.height) {
        return { ok: false, code: "RENDER_TIMEOUT", detail: "invalid png dimensions" };
      }
      return {
        ok: true,
        artifact: {
          renderId: `rnd_${full.snapshotId}_v${TEMPLATE_VERSIONS[kind]}`,
          snapshotId: full.snapshotId,
          accountId: full.accountId,
          positionId: full.positionId,
          executionId: full.executionId,
          png,
          contentHash: createHash("sha256").update(png).digest("hex"),
          width: dims.width,
          height: dims.height,
          mimeType: "image/png",
          templateVersion: TEMPLATE_VERSIONS[kind],
        },
      };
    } catch (err) {
      return {
        ok: false,
        code: "RENDER_TIMEOUT",
        detail: err instanceof Error ? err.message : "render failed",
      };
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  private async withTimeout<T>(promise: Promise<T>, step: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout at ${step}`)), this.timeoutMs);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

export { DEFAULT_CARD_THEME };
