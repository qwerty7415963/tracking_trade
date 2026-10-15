import { ConflictException } from "@nestjs/common";
import { SignalsService } from "./signals.service";

describe("SignalsService.ingestSourceMessage (edits)", () => {
  const EDIT_ROW = {
    id: "m2",
    sourceId: "s1",
    externalMessageId: "42",
    revision: 2,
    contentRaw: "BUY XAUUSD @2600 SL 2590 TP 2620",
    authorId: "a1",
    source: { platform: "TELEGRAM", deletedAt: null },
  };

  function editService(overrides: Record<string, unknown> = {}) {
    const tx = {
      signalVersion: { create: jest.fn(async () => ({})) },
      signal: {
        create: jest.fn(async () => ({ id: "sig-new" })),
        update: jest.fn(async () => ({ id: "sig1", status: "PENDING_APPROVAL" })),
      },
    };
    const prisma = {
      sourceMessage: {
        findUnique: jest.fn(async () => EDIT_ROW),
        findMany: jest.fn(async () => [{ id: "m1" }]),
      },
      signalVersion: { findMany: jest.fn(async () => [{ signalId: "sig1" }]) },
      signal: {
        findUnique: jest.fn(async () => ({
          id: "sig1",
          status: "PENDING_APPROVAL",
          versions: [{ versionNumber: 1 }],
        })),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      ...(overrides as Record<string, unknown>),
    };
    const svc = new SignalsService(prisma as never, { record: jest.fn() } as never);
    return { svc, prisma, tx };
  }

  it("appends version 2 instead of creating a duplicate signal", async () => {
    const { svc, tx } = editService();
    await expect(svc.ingestSourceMessage("m2", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig1",
      status: "PENDING_APPROVAL",
    });
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signalId: "sig1",
          versionNumber: 2,
          eventType: "EDIT",
        }),
      }),
    );
    expect(tx.signal.create).not.toHaveBeenCalled();
  });

  it("falls back to a new signal when no originating signal exists", async () => {
    const { svc, tx } = editService({
      signalVersion: { findMany: jest.fn(async () => []) },
    });
    const out = await svc.ingestSourceMessage("m2", "ingestion");
    expect(out.kind).toBe("SIGNAL");
    expect(tx.signal.create).toHaveBeenCalled();
  });

  it("keeps FINAL status on edit but still records the version", async () => {
    const { svc, tx } = editService({
      signal: {
        findUnique: jest.fn(async () => ({
          id: "sig1",
          status: "REJECTED",
          versions: [{ versionNumber: 3 }],
        })),
      },
    });
    (tx.signal.update as jest.Mock).mockResolvedValueOnce({ id: "sig1", status: "REJECTED" });
    await expect(svc.ingestSourceMessage("m2", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig1",
      status: "REJECTED",
    });
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ versionNumber: 4 }) }),
    );
  });
});

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
