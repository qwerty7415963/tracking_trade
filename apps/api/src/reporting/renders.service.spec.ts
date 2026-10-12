import { promises as fsPromises } from "fs";
import { RendersService } from "./renders.service";

describe("RendersService", () => {
  function service(prisma: unknown) {
    return new RendersService(
      prisma as never,
      { record: jest.fn() } as never,
      {} as never,
      {} as never,
    );
  }

  it("purges artifacts older than 7 days", async () => {
    const prisma = {
      renderArtifact: {
        findMany: jest.fn(async () => [{ id: "a1", artifactPath: "/tmp/a1.png" }]),
        delete: jest.fn(async () => ({})),
      },
    };
    const unlink = jest.spyOn(fsPromises, "unlink").mockResolvedValue(undefined);
    try {
      const svc = service(prisma);
      await expect(svc.purgeOldArtifacts()).resolves.toBe(1);
      expect(prisma.renderArtifact.delete).toHaveBeenCalledWith({ where: { id: "a1" } });
    } finally {
      unlink.mockRestore();
    }
  });
});
