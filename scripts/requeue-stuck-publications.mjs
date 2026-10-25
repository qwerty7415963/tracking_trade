// Requeue publications stuck in PENDING (their send job died on
// ORIGINAL_NOT_PUBLISHED_YET before the reply hold expired).
//
//   node scripts/requeue-stuck-publications.mjs [--dry-run] [--minutes=10]
//
// Path per row:
//   artifact on disk + send job data      -> requeue the send (frozen data)
//   artifact on disk + render job data    -> requeue the send (rebuilt from render data)
//   no artifact, render job data present  -> requeue the render (it re-enqueues the send)
//   nothing left in Redis                 -> FINAL_FAILURE = BACKFILL_NO_DATA
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "@prisma/client";
import { Queue } from "bullmq";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const minutesArg = args.find((a) => a.startsWith("--minutes="));
const MINUTES = minutesArg ? Number(minutesArg.split("=")[1]) : 10;

loadDotEnv();
const prisma = new PrismaClient();
const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379) };
const artifactsDir = (process.env.ARTIFACTS_DIR ?? "").trim() || "./artifacts";
const SEND_QUEUE = "telegram-send";
const RENDER_QUEUE = "card-render";

function loadDotEnv() {
  if (process.env.DATABASE_URL) return;
  let raw;
  try {
    raw = readFileSync(join(process.cwd(), ".env"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!match) continue;
    if (process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

function sendPayloadFromRender(data) {
  if (!data?.publicationId || !data?.virtualPositionId || typeof data.markPrice !== "number") {
    return null;
  }
  return {
    publicationId: data.publicationId,
    positionId: data.virtualPositionId,
    status: data.status ?? "filled",
    markPrice: data.markPrice,
    destinationChatId: data.destinationChatId ?? "",
    replyToMessageId: data.replyToMessageId,
    artifactPath: join(artifactsDir, `${data.publicationId}.png`),
    actor: data.actor ?? "worker",
  };
}

async function main() {
  const sendQueue = new Queue(SEND_QUEUE, { connection });
  const renderQueue = new Queue(RENDER_QUEUE, { connection });
  const cutoff = new Date(Date.now() - MINUTES * 60_000);
  const rows = await prisma.telegramPublication.findMany({
    where: { publicationStatus: "PENDING", createdAt: { lt: cutoff } },
    orderBy: { createdAt: "asc" },
    select: { id: true, virtualPositionId: true, createdAt: true },
  });
  console.log(`${rows.length} PENDING publication(s) older than ${MINUTES}min${DRY_RUN ? " (dry run)" : ""}`);

  const report = [];
  for (const row of rows) {
    const id = row.id;
    const artifact = join(artifactsDir, `${id}.png`);
    const hasArtifact = existsSync(artifact);
    const sendJob = await sendQueue.getJob(`send-${id}`);
    const renderJob = await renderQueue.getJob(`render-${id}`);
    const renderData = renderJob?.data ?? null;
    const sendData = sendJob?.data ?? sendPayloadFromRender(renderData);
    let action;

    if (hasArtifact && sendData) {
      action = "requeue-send";
      if (!DRY_RUN) {
        const old = await sendQueue.getJob(`send-${id}`);
        await old?.remove().catch(() => undefined);
        await sendQueue.add("send-photo", sendData, {
          jobId: `send-backfill-${id}`,
          attempts: 10,
          backoff: { type: "fixed", delay: 60_000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        });
      }
    } else if (renderData) {
      action = "requeue-render";
      if (!DRY_RUN) {
        // The render re-adds `send-<id>`; a leftover failed job would eat it.
        const oldSend = await sendQueue.getJob(`send-${id}`);
        await oldSend?.remove().catch(() => undefined);
        const oldRender = await renderQueue.getJob(`render-${id}`);
        await oldRender?.remove().catch(() => undefined);
        await renderQueue.add("render-card", renderData, {
          jobId: `render-backfill-${id}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: 100,
          removeOnFail: 200,
        });
      }
    } else {
      action = "final-failure";
      if (!DRY_RUN) {
        await prisma.telegramPublication.update({
          where: { id },
          data: { publicationStatus: "FINAL_FAILURE", renderedText: "BACKFILL_NO_DATA" },
        });
      }
    }
    report.push({
      publication: id,
      position: row.virtualPositionId,
      created: row.createdAt.toISOString(),
      artifact: hasArtifact ? "yes" : "no",
      sendJob: sendJob ? "yes" : "no",
      renderJob: renderJob ? "yes" : "no",
      action,
    });
  }

  console.table(report);
  const counts = report.reduce((acc, r) => {
    acc[r.action] = (acc[r.action] ?? 0) + 1;
    return acc;
  }, {});
  console.log(DRY_RUN ? "dry run: nothing changed" : `done: ${JSON.stringify(counts)}`);
  await sendQueue.close();
  await renderQueue.close();
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
