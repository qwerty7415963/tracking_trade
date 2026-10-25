import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RendersService } from "./renders.service";

jest.mock("bullmq", () => {
  const mock: {
    job: { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown } | null;
    jobs: Record<string, { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown }>;
    added: { data: Record<string, unknown>; opts: Record<string, unknown> } | null;
  } = { job: null, jobs: {}, added: null };
  class MockQueue {
    async add(_name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
      mock.added = { data, opts };
      return { id: (opts.jobId as string) ?? "job1" };
    }
    async getJob(id: string) {
      return mock.jobs[id] ?? mock.job;
    }
    async close() {}
  }
  return { Queue: MockQueue, __mock: mock };
});

const bullmqMock = jest.requireMock("bullmq") as {
  __mock: {
    job: { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown } | null;
    jobs: Record<string, { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown }>;
    added: { data: Record<string, unknown>; opts: Record<string, unknown> } | null;
  };
};

type JobMock = {
  getState: () => Promise<string>;
  remove: () => Promise<void>;
  data: unknown;
  opts?: { delay?: number };
  timestamp?: number;
};

describe("RendersService", () => {
  function service(audit: { record: jest.Mock } = { record: jest.fn() }) {
    return new RendersService(
      audit as never,
      {} as never,
      {} as never,
    );
  }

  async function tempDir(): Promise<string> {
    return fs.mkdtemp(join(tmpdir(), "renders-"));
  }

  function useArtifactsDir(dir: string): () => void {
    const prev = process.env.ARTIFACTS_DIR;
    process.env.ARTIFACTS_DIR = dir;
    return () => {
      if (prev === undefined) delete process.env.ARTIFACTS_DIR;
      else process.env.ARTIFACTS_DIR = prev;
    };
  }

  it("writes and reads artifacts by render id", async () => {
    const dir = await tempDir();
    const restore = useArtifactsDir(dir);
    try {
      const svc = service();
      const artifactPath = await svc.writeArtifact("pub1", Buffer.from("png-bytes"));
      expect(artifactPath).toBe(join(dir, "pub1.png"));
      await expect(svc.readArtifact("pub1")).resolves.toEqual(Buffer.from("png-bytes"));
    } finally {
      restore();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("purges png files older than retention without a database", async () => {
    const dir = await tempDir();
    const oldPath = join(dir, "old.png");
    const freshPath = join(dir, "fresh.png");
    await fs.writeFile(oldPath, "old");
    await fs.writeFile(freshPath, "fresh");
    await fs.writeFile(join(dir, "notes.txt"), "keep");
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await fs.utimes(oldPath, eightDaysAgo, eightDaysAgo);

    const svc = service();
    await expect(svc.purgeOldArtifacts(7, dir)).resolves.toBe(1);
    await expect(fs.stat(oldPath)).rejects.toThrow();
    await expect(fs.stat(freshPath)).resolves.toBeTruthy();
  });

  describe("promoteRender", () => {
    beforeEach(() => {
      bullmqMock.__mock.job = null;
      bullmqMock.__mock.jobs = {};
      bullmqMock.__mock.added = null;
    });

    it("re-adds a delayed job with the chosen card kind and runs it now", async () => {
      const remove = jest.fn(async () => undefined);
      bullmqMock.__mock.job = {
        getState: async () => "delayed",
        remove,
        data: { virtualPositionId: "pos1", publicationId: "pub1", status: "filled" },
      };
      const svc = service();
      await expect(svc.promoteRender("pub1", "position-stats", "alice")).resolves.toBe("promoted");
      expect(remove).toHaveBeenCalled();
      expect(bullmqMock.__mock.added?.data).toEqual({
        virtualPositionId: "pos1",
        publicationId: "pub1",
        status: "filled",
        cardKind: "position-stats",
      });
      expect(bullmqMock.__mock.added?.opts.jobId).toBe("render-pub1");
    });

    it("expires when no job exists (already rendered or failed over)", async () => {
      const svc = service();
      await expect(svc.promoteRender("pub9", "position-stats", "alice")).resolves.toBe("expired");
      expect(bullmqMock.__mock.added).toBeNull();
    });

    it("expires when the job already ran (timeout rendered the default card)", async () => {
      bullmqMock.__mock.job = {
        getState: async () => "completed",
        remove: jest.fn(),
        data: { virtualPositionId: "pos1" },
      };
      const svc = service();
      await expect(svc.promoteRender("pub1", "position-stats", "alice")).resolves.toBe("expired");
      expect(bullmqMock.__mock.added).toBeNull();
    });

    it("allows re-promotion while the dialog job is still waiting", async () => {
      bullmqMock.__mock.job = {
        getState: async () => "waiting",
        remove: jest.fn(async () => undefined),
        data: { virtualPositionId: "pos1", publicationId: "pub1", delayMs: 300_000 },
      };
      const svc = service();
      await expect(svc.promoteRender("pub1", "pnl-strip", "alice")).resolves.toBe("promoted");
    });
  });

  describe("promoteFirstDelayed", () => {
    beforeEach(() => {
      bullmqMock.__mock.job = null;
      bullmqMock.__mock.jobs = {};
      bullmqMock.__mock.added = null;
    });

    function job(state: string, data: Record<string, unknown>): JobMock {
      return { getState: async () => state, remove: jest.fn(async () => undefined), data };
    }

    it("picks the delayed dialog job even when a newer TP card already finished", async () => {
      // The bug: a TP card enqueued mid-dialog is the newest PENDING row and
      // its job is already completed, so promoting it answered "Hết giờ".
      bullmqMock.__mock.jobs = {
        "render-tp-pub": job("completed", { publicationId: "tp-pub" }),
        "render-dialog-pub": job("delayed", {
          publicationId: "dialog-pub",
          virtualPositionId: "pos1",
          status: "filled",
          delayMs: 300_000,
        }),
      };
      const audit = { record: jest.fn() };
      const svc = service(audit);
      await expect(
        svc.promoteFirstDelayed(["tp-pub", "dialog-pub"], "position-stats", "alice"),
      ).resolves.toEqual({ publicationId: "dialog-pub", outcome: "promoted" });
      expect(bullmqMock.__mock.added?.data).toMatchObject({
        publicationId: "dialog-pub",
        cardKind: "position-stats",
      });
      expect(bullmqMock.__mock.added?.opts.jobId).toBe("render-dialog-pub");
      expect(audit.record).toHaveBeenCalledWith(
        "alice",
        "render.promoted",
        expect.objectContaining({ publicationId: "dialog-pub", dialogJob: true }),
      );
      expect(audit.record).not.toHaveBeenCalledWith("alice", "render.promotion_miss", expect.anything());
    });

    it("ignores an in-flight TP card whose job is waiting but undelayed", async () => {
      bullmqMock.__mock.jobs = {
        "render-tp-pub": job("waiting", { publicationId: "tp-pub" }),
        "render-dialog-pub": job("delayed", { publicationId: "dialog-pub", delayMs: 300_000 }),
      };
      const svc = service();
      await expect(
        svc.promoteFirstDelayed(["tp-pub", "dialog-pub"], "pnl-strip", "alice"),
      ).resolves.toEqual({ publicationId: "dialog-pub", outcome: "promoted" });
    });

    it("falls back to a delayed job without the dialog marker", async () => {
      bullmqMock.__mock.jobs = { "render-legacy": job("delayed", { publicationId: "legacy" }) };
      const svc = service();
      await expect(
        svc.promoteFirstDelayed(["legacy"], "pnl-strip", "alice"),
      ).resolves.toEqual({ publicationId: "legacy", outcome: "promoted" });
    });

    it("audits a miss with every job state when nothing is still waiting", async () => {
      bullmqMock.__mock.jobs = {
        "render-tp-pub": job("completed", { publicationId: "tp-pub" }),
      };
      const audit = { record: jest.fn() };
      const svc = service(audit);
      await expect(
        svc.promoteFirstDelayed(["tp-pub", "gone-pub"], "position-stats", "alice"),
      ).resolves.toEqual({ publicationId: null, outcome: "expired" });
      expect(bullmqMock.__mock.added).toBeNull();
      expect(audit.record).toHaveBeenCalledWith("alice", "render.promotion_miss", {
        publicationIds: ["tp-pub", "gone-pub"],
        states: { "tp-pub": "completed", "gone-pub": "missing" },
      });
    });
  });

  describe("dialogRemainingMs", () => {
    beforeEach(() => {
      bullmqMock.__mock.job = null;
      bullmqMock.__mock.jobs = {};
      bullmqMock.__mock.added = null;
    });

    function dialogJob(state: string, overrides: Partial<JobMock> = {}): JobMock {
      return {
        getState: async () => state,
        remove: jest.fn(async () => undefined),
        data: { delayMs: 300_000 },
        opts: { delay: 300_000 },
        timestamp: Date.now() - 60_000,
        ...overrides,
      };
    }

    it("reports the time left on a still-delayed dialog job", async () => {
      bullmqMock.__mock.jobs = { "render-pub1": dialogJob("delayed") };
      const left = await service().dialogRemainingMs(["pub1"]);
      // 300s window, 60s already elapsed → ~240s left.
      expect(left).toBeGreaterThan(200_000);
      expect(left).toBeLessThanOrEqual(240_000);
    });

    it("returns 0 when the dialog already ran, is absent, or lacks the marker", async () => {
      bullmqMock.__mock.jobs = {
        "render-done": dialogJob("completed"),
        "render-plain": dialogJob("delayed", { data: { publicationId: "p" } }),
      };
      await expect(service().dialogRemainingMs(["done", "plain", "gone"])).resolves.toBe(0);
    });

    it("returns 0 for an empty publication list", async () => {
      await expect(service().dialogRemainingMs([])).resolves.toBe(0);
    });
  });
});
