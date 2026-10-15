import { promises as fs } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { RendersService } from "./renders.service";

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
});
