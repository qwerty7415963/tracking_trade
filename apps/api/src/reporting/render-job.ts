import { DEFAULT_CARD_KIND, FloatingPnLCardRenderer, isCardKind } from "@tracking-auto/card-renderer";
import { VirtualPosition } from "@prisma/client";
import { Queue } from "bullmq";
import { chromium } from "playwright";
import { PrismaService } from "../database/prisma.service";
import { MarketDataService } from "../market-data/market-data.service";
import { PublicationsService } from "./publications.service";
import {
  PUBLISH_SEND_QUEUE_NAME,
  RendersService,
  RenderJobData,
  SEND_JOB_ID_PREFIX,
} from "./renders.service";

export interface RenderRunnerDeps {
  prisma: Pick<PrismaService, "virtualPosition" | "telegramPublication">;
  marketData: Pick<MarketDataService, "getMid">;
  publications: Pick<PublicationsService, "buildSnapshot">;
  renders: Pick<RendersService, "writeArtifact">;
  sendQueue: Pick<Queue, "add">;
  renderer: Pick<FloatingPnLCardRenderer, "render">;
}

/** Lazy Chromium: the browser only launches when the first card renders. */
export function createCardRenderer(): FloatingPnLCardRenderer {
  return new FloatingPnLCardRenderer(() => chromium.launch());
}

/** TP/SL/close cards update an existing position; `filled`/undefined is the open card. */
export function isUpdateCardStatus(status: RenderJobData["status"]): boolean {
  return status !== undefined && status !== "filled";
}

/** Render one `card-render` job; shared by the API consumer and tests. */
export async function processRenderJob(
  deps: RenderRunnerDeps,
  data: RenderJobData,
  jobId?: string | number,
): Promise<{ artifactPath: string }> {
  const renderId = data.publicationId ?? String(jobId);
  try {
    // Update cards also need the row: their kind is read LIVE (the operator
    // may pick a style after this job was enqueued with the old default).
    const updateCard = isUpdateCardStatus(data.status);
    let position: VirtualPosition | null = null;
    if (data.markPrice === undefined || updateCard) {
      position = await deps.prisma.virtualPosition.findUnique({
        where: { id: data.virtualPositionId },
      });
      if (!position) throw new Error(`POSITION_NOT_FOUND: ${data.virtualPositionId}`);
    }
    let markPrice = data.markPrice;
    if (markPrice === undefined) {
      if (!position) throw new Error(`POSITION_NOT_FOUND: ${data.virtualPositionId}`);
      const mid = await deps.marketData.getMid(position.coin);
      if (mid === null) throw new Error(`NO_QUOTE for ${position.coin}`);
      markPrice = mid;
    }
    const card = await deps.publications.buildSnapshot(data.virtualPositionId, markPrice, {
      status: data.status,
      volume: data.volume,
    });
    // Open card: the kind the /pos dialog froze into the job. Update card:
    // whatever the position holds right now (chosen style wins over the
    // stale default captured at enqueue time).
    const cardKind = updateCard
      ? isCardKind(position?.cardKind)
        ? position.cardKind
        : (data.cardKind ?? DEFAULT_CARD_KIND)
      : (data.cardKind ?? DEFAULT_CARD_KIND);
    const rendered = await deps.renderer.render(card.snapshot, new Date(), cardKind);
    if (!rendered.ok) throw new Error(`RENDER_FAILED: ${rendered.code}`);
    const artifactPath = await deps.renders.writeArtifact(renderId, rendered.artifact.png);
    if (data.publicationId) {
      await deps.sendQueue.add(
        "send-photo",
        {
          publicationId: data.publicationId,
          positionId: data.virtualPositionId,
          status: data.status ?? "filled",
          markPrice,
          destinationChatId: data.destinationChatId ?? "",
          replyToMessageId: data.replyToMessageId,
          artifactPath,
          actor: data.actor ?? "worker",
        },
        {
          jobId: `${SEND_JOB_ID_PREFIX}${data.publicationId}`,
          attempts: 10,
          // Must outlive ORIGINAL_HOLD_MS (5 min): a TP/SL card rendered
          // while the original card is still delayed retries until the
          // original is published (60s x 10 = 10 min of coverage).
          backoff: { type: "fixed", delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        },
      );
    }
    return { artifactPath };
  } catch (err) {
    if (data.publicationId) {
      const code = err instanceof Error ? err.message.split(":")[0] : "UNKNOWN";
      await deps.prisma.telegramPublication
        .update({
          where: { id: data.publicationId },
          data: { publicationStatus: "FINAL_FAILURE", renderedText: code },
        })
        .catch(() => {});
    }
    throw err;
  }
}

export { PUBLISH_SEND_QUEUE_NAME };
