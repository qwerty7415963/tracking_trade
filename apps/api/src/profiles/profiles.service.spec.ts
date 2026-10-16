import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { ProfilesService, normalizeAliases } from "./profiles.service";

function service(prisma: unknown) {
  return new ProfilesService(prisma as never, { record: jest.fn(async () => ({})) } as never);
}

function duplicateError(): Error {
  return new Prisma.PrismaClientKnownRequestError("taken", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("normalizeAliases", () => {
  it("uppercases both sides", () => {
    expect(normalizeAliases({ paws: "btc" })).toEqual({ PAWS: "BTC" });
  });

  it("rejects non-string values", () => {
    expect(() => normalizeAliases({ PAWS: 42 } as unknown as Record<string, string>)).toThrow(
      BadRequestException,
    );
  });
});

describe("ProfilesService", () => {
  it("lists profiles by name", async () => {
    const findMany = jest.fn(async () => []);
    await service({ parserProfile: { findMany } }).list();
    expect(findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });
  });

  it("returns parser-ready aliases or null", async () => {
    const svc = service({
      parserProfile: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === "p1" ? { id: "p1", coinAliases: { PAWS: "BTC" } } : null,
        ),
      },
    });
    await expect(svc.getProfile("p1")).resolves.toEqual({ coinAliases: { PAWS: "BTC" } });
    await expect(svc.getProfile("missing")).resolves.toBeNull();
    await expect(svc.getProfile(null)).resolves.toBeNull();
  });

  it("creates normalized profiles and audits", async () => {
    const create = jest.fn(async () => ({ id: "p1", name: "meme" }));
    const svc = service({ parserProfile: { create } });
    await svc.create({ name: "meme", coinAliases: { paws: "btc" } }, "alice");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: "meme", coinAliases: { PAWS: "BTC" } }),
      }),
    );
  });

  it("maps duplicates and empty names to clear errors", async () => {
    const svc = service({
      parserProfile: { create: jest.fn(async () => { throw duplicateError(); }) },
    });
    await expect(svc.create({ name: "meme" }, "alice")).rejects.toThrow(ConflictException);
    await expect(svc.create({ name: "  " }, "alice")).rejects.toThrow(BadRequestException);
  });

  it("updates, deletes and rejects unknown ids", async () => {
    const update = jest.fn(async () => ({ id: "p1" }));
    const remove = jest.fn(async () => ({ id: "p1", name: "meme" }));
    const svc = service({
      parserProfile: {
        findUnique: jest.fn(async () => ({ id: "p1", name: "meme" })),
        update,
        delete: remove,
      },
    });
    await svc.update("p1", { notes: "hi" }, "alice");
    expect(update).toHaveBeenCalled();
    await svc.remove("p1", "alice");
    expect(remove).toHaveBeenCalledWith({ where: { id: "p1" } });

    const missing = service({ parserProfile: { findUnique: jest.fn(async () => null) } });
    await expect(missing.get("nope")).rejects.toThrow(NotFoundException);
    await expect(missing.update("nope", {}, "alice")).rejects.toThrow(NotFoundException);
    await expect(missing.remove("nope", "alice")).rejects.toThrow(NotFoundException);
  });
});
