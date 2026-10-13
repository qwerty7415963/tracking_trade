// Enqueue E2E jobs to the real Redis. Usage: node scripts/e2e-enqueue.mjs <render|publish|status|drain>
import { Queue } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };
const mode = process.argv[2];

if (mode === "render") {
  const q = new Queue("card-render", { connection });
  const job = await q.add("render-card", {
    accountId: "test-acc-e2e",
    positionId: "pE2E",
    executionId: "44444444-4444-4444-4444-444444444444",
  });
  console.log("render job:", job.id);
  await q.close();
} else if (mode === "publish") {
  const q = new Queue("telegram-publish", { connection });
  const job = await q.add("publish", {
    publicationId: "66666666-6666-6666-6666-666666666666",
    executionId: "44444444-4444-4444-4444-444444444444",
    destinationChatId: "@e2e-test",
  });
  console.log("publish job:", job.id);
  await q.close();
} else if (mode === "status") {
  for (const name of ["card-render", "telegram-publish"]) {
    const q = new Queue(name, { connection });
    const [w, a, c, f] = await Promise.all([
      q.getWaiting(), q.getActive(), q.getCompleted(), q.getFailed(),
    ]);
    console.log(name, JSON.stringify({ waiting: w.length, active: a.length, completed: c.length, failed: f.length }));
    for (const job of [...c, ...f]) {
      console.log(" ", job.id, job.finishedOn ? "done" : "pending", String(job.failedReason ?? "").slice(0, 120));
    }
    await q.close();
  }
} else if (mode === "drain") {
  for (const name of ["card-render", "telegram-publish"]) {
    const q = new Queue(name, { connection });
    await q.drain(true);
    await q.clean(0, 1000, "completed");
    await q.clean(0, 1000, "failed");
    console.log("drained", name);
    await q.close();
  }
} else {
  console.error("usage: render|publish|status|drain");
  process.exit(1);
}
process.exit(0);
