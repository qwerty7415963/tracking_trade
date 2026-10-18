import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RendersService } from "./renders.service";

jest.mock("bullmq", () => {
  const mock: {
    job: { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown } | null;
    added: { data: Record<string, unknown>; opts: Record<string, unknown> } | null;
  } = { job: null, added: null };
  class MockQueue {
    async add(_name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
      mock.added = { data, opts };
      return { id: (opts.jobId as string) ?? "job1" };
    }
    async getJob(_id: string) {
      return mock.job;
    }
    async close() {}
  }
  return { Queue: MockQueue, __mock: mock };
});

const bullmqMock = jest.requireMock("bullmq") as {
  __mock: {
    job: { getState: () => Promise<string>; remove: () => Promise<void>; data: unknown } | null;
    added: { data: Record<string, unknown>; opts: Record<string, unknown> } | null;
  };
};

describe("RendersService", () => {
  function service() {
    return new RendersService(
      { record: jest.fn() } as never,
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

    it("allows promotion while the job is still waiting", async () => {
      bullmqMock.__mock.job = {
        getState: async () => "waiting",
        remove: jest.fn(async () => undefined),
        data: { virtualPositionId: "pos1", publicationId: "pub1" },
      };
      const svc = service();
      await expect(svc.promoteRender("pub1", "pnl-strip", "alice")).resolves.toBe("promoted");
    });
  });
});
