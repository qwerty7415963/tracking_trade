import { ConflictException } from "@nestjs/common";
import { SignalsService } from "./signals.service";

describe("SignalsService.approve (stale version)", () => {
  it("rejects approval bound to an old version", async () => {
    const tx = {
      signal: {
        findUnique: async () => ({
          id: "s1",
          status: "PENDING_APPROVAL",
          versions: [{ id: "v2", versionNumber: 2 }],
        }),
      },
      approval: { create: jest.fn() },
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const svc = new SignalsService(prisma as never, { record: jest.fn() } as never);

    await expect(svc.approve("s1", { signalVersionId: "v1" }, "alice")).rejects.toThrow(
      ConflictException,
    );
    expect(tx.approval.create).not.toHaveBeenCalled();
  });
});
