import { NotFoundException } from "@nestjs/common";
import { SourcesService } from "./sources.service";

function mockPrisma(overrides: Record<string, unknown> = {}) {
  return {
    source: {
      findMany: jest.fn(async () => []),
      findFirst: jest.fn(async () => null),
      create: jest.fn(),
      update: jest.fn(),
      ...((overrides.source ?? {}) as Record<string, unknown>),
    },
  };
}

function service(prisma: unknown, telegram?: unknown, x?: unknown) {
  return new SourcesService(
    prisma as never,
    { record: jest.fn(async () => ({})) } as never,
    (telegram ?? { checkSource: jest.fn() }) as never,
    (x ?? { checkSource: jest.fn() }) as never,
  );
}

const ROW = { id: "s1", platform: "TELEGRAM", enabled: true, lastErrorCode: null, lastErrorAt: null };

describe("SourcesService", () => {
  it("lists non-deleted sources", async () => {
    const prisma = mockPrisma({ source: { findMany: jest.fn(async () => [ROW]) } });
    const svc = service(prisma);
    await expect(svc.list()).resolves.toEqual([ROW]);
    expect(prisma.source.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deletedAt: null } }),
    );
  });

  it("throws NotFound for missing source", async () => {
    const svc = service(mockPrisma());
    await expect(svc.get("nope")).rejects.toThrow(NotFoundException);
  });

  it("creates and audits", async () => {
    const prisma = mockPrisma({ source: { create: jest.fn(async () => ROW) } });
    const audit = { record: jest.fn(async () => ({})) };
    const svc = new SourcesService(prisma as never, audit as never, {} as never, {} as never);
    const created = await svc.create(
      { platform: "TELEGRAM", externalSourceId: "c1", displayName: "C1", sourceKind: "SIGNAL" },
      "alice",
    );
    expect(created).toEqual(ROW);
    expect(audit.record).toHaveBeenCalledWith("alice", "source.create", { sourceId: "s1" });
  });

  it("soft-deletes instead of removing", async () => {
    const update = jest.fn(async () => ({ ...ROW, enabled: false }));
    const prisma = mockPrisma({
      source: { findFirst: jest.fn(async () => ROW), update },
    });
    const svc = service(prisma);
    await svc.remove("s1", "alice");
    const args = (update.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(args.data.enabled).toBe(false);
    expect(args.data.deletedAt).toBeInstanceOf(Date);
  });

  it("testConnection delegates telegram sources and records error code", async () => {
    const update = jest.fn(async () => ROW);
    const prisma = mockPrisma({
      source: { findFirst: jest.fn(async () => ROW), update },
    });
    const telegram = { checkSource: jest.fn(async () => ({ ok: false, code: "NOT_A_MEMBER" })) };
    const svc = service(prisma, telegram, {});
    await expect(svc.testConnection("s1", "alice")).resolves.toEqual({
      ok: false,
      code: "NOT_A_MEMBER",
    });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ lastErrorCode: "NOT_A_MEMBER" }) }),
    );
  });

  it("testConnection delegates X sources to the X collector (isolation)", async () => {
    const xRow = { ...ROW, platform: "X" };
    const prisma = mockPrisma({
      source: { findFirst: jest.fn(async () => xRow), update: jest.fn(async () => xRow) },
    });
    const telegram = { checkSource: jest.fn() };
    const x = { checkSource: jest.fn(async () => ({ ok: false, code: "CONNECTOR_DISABLED" })) };
    const svc = service(prisma, telegram, x);
    await expect(svc.testConnection("s1", "alice")).resolves.toEqual({
      ok: false,
      code: "CONNECTOR_DISABLED",
    });
    expect(telegram.checkSource).not.toHaveBeenCalled();
    expect(x.checkSource).toHaveBeenCalled();
  });
});
