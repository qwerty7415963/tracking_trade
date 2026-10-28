import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  normalizeHandle,
  parseSourceRef,
  SourcesService,
} from "./sources.service";

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

  it("parses platform prefixes and normalizes handles", () => {
    expect(parseSourceRef("x:@Watcher")).toEqual({ platform: "X", handle: "@Watcher" });
    expect(parseSourceRef("tg:@Watcher")).toEqual({ platform: "TELEGRAM", handle: "@Watcher" });
    expect(parseSourceRef("@Watcher")).toEqual({ platform: "TELEGRAM", handle: "@Watcher" });
    expect(normalizeHandle("  @@Watcher  ")).toBe("Watcher");
  });

  it("resolves direct ids before handle matching", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const row = { ...ROW, id };
    const prisma = mockPrisma({ source: { findFirst: jest.fn(async () => row) } });
    await expect(service(prisma).resolve(id)).resolves.toEqual(row);
    expect(prisma.source.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id, deletedAt: null } }),
    );
  });

  it("does not query by id for handle-shaped refs", async () => {
    const findFirst = jest.fn(async () => null);
    const findMany = jest.fn(async () => []);
    const prisma = mockPrisma({ source: { findFirst, findMany } });
    await expect(service(prisma).resolve("@alpha")).rejects.toThrow(NotFoundException);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("resolves handles case-insensitively with or without @", async () => {
    const row = { ...ROW, externalSourceId: "@Alpha", displayName: "Alpha Signals" };
    const prisma = mockPrisma({ source: { findMany: jest.fn(async () => [row]) } });
    await expect(service(prisma).resolve("alpha")).resolves.toEqual(row);
  });

  it("rejects unknown and ambiguous refs without guessing", async () => {
    const unknown = service(mockPrisma());
    await expect(unknown.resolve("@missing")).rejects.toThrow(NotFoundException);

    const rows = [
      { ...ROW, id: "s1", externalSourceId: "alpha-one", displayName: "Alpha" },
      { ...ROW, id: "s2", externalSourceId: "alpha-two", displayName: "Alpha" },
    ];
    const ambiguous = service(mockPrisma({ source: { findMany: jest.fn(async () => rows) } }));
    await expect(ambiguous.resolve("Alpha")).rejects.toThrow(ConflictException);
  });

  it("bulk-creates canonical handles and skips handle-equivalent duplicates", async () => {
    const existing = { ...ROW, id: "existing", externalSourceId: "@Alpha", displayName: "@Alpha" };
    const created = { ...ROW, id: "created", externalSourceId: "beta", displayName: "@Beta" };
    const findMany = jest.fn(async () => [existing]);
    const create = jest.fn(async () => created);
    const prisma = mockPrisma({ source: { findMany, create } });
    const svc = service(prisma);

    await expect(
      svc.bulkCreate([{ raw: "   " }, { raw: "@ALPHA" }, { raw: "@Beta" }], "alice"),
    ).resolves.toEqual([
      { input: "   ", status: "failed", sourceId: null, reason: "empty line" },
      { input: "@ALPHA", status: "skipped-duplicate", sourceId: "existing", reason: null },
      { input: "@Beta", status: "created", sourceId: "created", reason: null },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          platform: "TELEGRAM",
          externalSourceId: "beta",
          displayName: "@Beta",
          sourceKind: "SIGNAL",
          priority: 0,
        }),
      }),
    );
  });

  it("maps a concurrent duplicate insert to skipped-duplicate", async () => {
    const existing = { ...ROW, id: "existing", externalSourceId: "gamma", displayName: "gamma" };
    const findMany = jest.fn().mockResolvedValueOnce([]).mockResolvedValue([existing]);
    const create = jest.fn(async () => {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint", {
        code: "P2002",
        clientVersion: "test",
      });
    });
    const prisma = mockPrisma({ source: { findMany, create } });

    await expect(service(prisma).bulkCreate([{ raw: "@gamma" }], "alice")).resolves.toEqual([
      { input: "@gamma", status: "skipped-duplicate", sourceId: "existing", reason: null },
    ]);
  });

  it("bulk-deletes known refs and keeps failures per line", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    const row = { ...ROW, id };
    const findFirst = jest.fn(async ({ where }: { where: { id: string } }) =>
      where.id === id ? row : null,
    );
    const update = jest.fn(async () => ({ ...row, enabled: false }));
    const prisma = mockPrisma({
      source: { findFirst, findMany: jest.fn(async () => []), update },
    });

    await expect(service(prisma).bulkRemove([id, "@missing"], "alice")).resolves.toEqual([
      { input: id, status: "deleted", sourceId: id, reason: null },
      {
        input: "@missing",
        status: "failed",
        sourceId: null,
        reason: expect.stringContaining("no source matches"),
      },
    ]);
  });
});
