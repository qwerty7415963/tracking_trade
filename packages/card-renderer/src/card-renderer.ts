import { createHash } from "crypto";
import { Browser, Page } from "playwright";
import { CardTheme, DEFAULT_CARD_THEME } from "./card-config";
import { PositionSnapshot, RenderArtifact, RenderErrorCode } from "./card-types";
import { renderCardHtml } from "./card-template";
import { buildViewModel } from "./view-model";
import { validateSnapshot } from "./snapshot-validator";

export type BrowserFactory = () => Promise<Browser>;
export type RenderFailure = { ok: false; code: RenderErrorCode; detail: string };
export type RenderSuccess = { ok: true; artifact: RenderArtifact };
export type RenderOutcome = RenderSuccess | RenderFailure;

export const TEMPLATE_VERSION = 1;

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
  ): Promise<RenderOutcome> {
    const validation = validateSnapshot(snapshot, this.theme, now);
    if (!validation.ok) return validation;
    const vm = buildViewModel(snapshot as PositionSnapshot, this.theme);
    if (!vm.ok) return vm;

    const html = renderCardHtml(vm.model, this.theme);
    let browser: Browser | null = null;
    try {
      browser = await this.withTimeout(this.browserFactory(), "browser launch");
      const page: Page = await browser.newPage({
        viewport: { width: this.theme.width, height: this.theme.height },
      });
      await this.withTimeout(page.setContent(html, { waitUntil: "load" }), "page load");
      const png = await this.withTimeout(
        page.screenshot({ type: "png", fullPage: false }),
        "screenshot",
      );
      const dims = parsePngDimensions(png);
      if (!dims || dims.width !== this.theme.width || dims.height !== this.theme.height) {
        return { ok: false, code: "RENDER_TIMEOUT", detail: "invalid png dimensions" };
      }
      const full = snapshot as PositionSnapshot;
      return {
        ok: true,
        artifact: {
          renderId: `rnd_${full.snapshotId}_v${TEMPLATE_VERSION}`,
          snapshotId: full.snapshotId,
          accountId: full.accountId,
          positionId: full.positionId,
          executionId: full.executionId,
          png,
          contentHash: createHash("sha256").update(png).digest("hex"),
          width: dims.width,
          height: dims.height,
          mimeType: "image/png",
          templateVersion: TEMPLATE_VERSION,
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
