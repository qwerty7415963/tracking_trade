import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CoinsService, normalizeSymbol } from "./coins.service";

function service(prisma: unknown) {
  return new CoinsService(prisma as never, { record: jest.fn(async () => ({})) } as never);
}

function duplicateError(): Error {
  return new Prisma.PrismaClientKnownRequestError("taken", {
    code: "P2002",
    clientVersion: "test",
  });
}

describe("normalizeSymbol", () => {
  it("uppercases and trims", () => {
    expect(normalizeSymbol("  zec ")).toBe("ZEC");
  });
});

describe("CoinsService", () => {
  it("lists coins alphabetically", async () => {
    const findMany = jest.fn(async () => []);
    await service({ tradableCoin: { findMany } }).list();
    expect(findMany).toHaveBeenCalledWith({ orderBy: { symbol: "asc" } });
  });

  it("gates membership on enabled symbols", async () => {
    const prisma = {
      tradableCoin: {
        findMany: jest.fn(async () => [{ symbol: "zec" }, { symbol: "BTC" }]),
        findFirst: jest.fn(async ({ where }: { where: { symbol: string } }) =>
          where.symbol === "ZEC" ? { symbol: "ZEC", enabled: true } : null,
        ),
      },
    };
    const svc = service(prisma);
    await expect(svc.enabledSymbols()).resolves.toEqual(["ZEC", "BTC"]);
    await expect(svc.isAllowed("zec")).resolves.toBe(true);
    await expect(svc.isAllowed("HYPE")).resolves.toBe(false);
    await expect(svc.isAllowed("  ")).resolves.toBe(false);
  });

  it("creates normalized symbols and audits", async () => {
    const create = jest.fn(async () => ({ id: "c1", symbol: "ZEC" }));
    const svc = service({ tradableCoin: { create } });
    await expect(svc.create({ symbol: "zec" }, "alice")).resolves.toEqual({
      id: "c1",
      symbol: "ZEC",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ symbol: "ZEC" }) }),
    );
  });

  it("maps duplicates and empty symbols to clear errors", async () => {
    const svc = service({ tradableCoin: { create: jest.fn(async () => { throw duplicateError(); }) } });
    await expect(svc.create({ symbol: "ZEC" }, "alice")).rejects.toThrow(ConflictException);
    await expect(svc.create({ symbol: "  " }, "alice")).rejects.toThrow(ConflictException);
  });

  it("updates and audits, rejects unknown ids", async () => {
    const update = jest.fn(async () => ({ id: "c1", enabled: false }));
    const svc = service({
      tradableCoin: {
        findUnique: jest.fn(async () => ({ id: "c1", symbol: "ZEC" })),
        update,
      },
    });
    await svc.update("c1", { enabled: false }, "alice");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1" }, data: expect.objectContaining({ enabled: false }) }),
    );

    const missing = service({ tradableCoin: { findUnique: jest.fn(async () => null) } });
    await expect(missing.update("nope", {}, "alice")).rejects.toThrow(NotFoundException);
    await expect(missing.remove("nope", "alice")).rejects.toThrow(NotFoundException);
  });

  it("hard-deletes known coins", async () => {
    const row = { id: "c1", symbol: "ZEC" };
    const prisma = {
      tradableCoin: {
        findUnique: jest.fn(async () => row),
        delete: jest.fn(async () => row),
      },
    };
    await expect(service(prisma).remove("c1", "alice")).resolves.toEqual(row);
    expect(prisma.tradableCoin.delete).toHaveBeenCalledWith({ where: { id: "c1" } });
  });
});
