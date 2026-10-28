import { ConflictException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CoinsService, defaultNotionalFor, normalizeSymbol } from "./coins.service";

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

describe("defaultNotionalFor", () => {
  it("defaults BTC/ETH/SOL to 100k and everything else to 50k", () => {
    expect(defaultNotionalFor("btc")).toBe(100_000);
    expect(defaultNotionalFor("ETH")).toBe(100_000);
    expect(defaultNotionalFor("sol")).toBe(100_000);
    expect(defaultNotionalFor("XRP")).toBe(50_000);
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

  it("reads the fixed notional for a symbol with safe defaults", async () => {
    const findUnique = jest.fn(async ({ where }: { where: { symbol: string } }) =>
      where.symbol === "BTC" ? { notionalUsd: "120000" } : null,
    );
    const svc = service({ tradableCoin: { findUnique } });
    await expect(svc.notionalFor("btc")).resolves.toBe(120000);
    await expect(svc.notionalFor("ETH")).resolves.toBe(100000);
    await expect(svc.notionalFor("XRP")).resolves.toBe(50000);
  });

  it("falls back to symbol defaults when the notional row is invalid", async () => {
    const svc = service({
      tradableCoin: { findUnique: jest.fn(async () => ({ notionalUsd: "0" })) },
    });
    await expect(svc.notionalFor("XRP")).resolves.toBe(50000);
  });

  it("lists per-coin notionals as numbers", async () => {
    const findMany = jest.fn(async () => [
      { id: "c1", symbol: "BTC", enabled: true, notionalUsd: "100000" },
      { id: "c2", symbol: "XRP", enabled: false, notionalUsd: "50000" },
    ]);
    const rows = await service({ tradableCoin: { findMany } }).listNotionals();
    expect(rows).toEqual([
      { id: "c1", symbol: "BTC", enabled: true, notionalUsd: 100000 },
      { id: "c2", symbol: "XRP", enabled: false, notionalUsd: 50000 },
    ]);
  });

  it("sets and resets notional with audit", async () => {
    const record = jest.fn(async () => ({}));
    const update = jest.fn(async (args: { data: { notionalUsd: number } }) => ({
      id: "c1",
      symbol: "BTC",
      notionalUsd: String(args.data.notionalUsd),
    }));
    const prisma = {
      tradableCoin: {
        findFirst: jest.fn(async () => ({ id: "c1", symbol: "BTC", notionalUsd: "100000" })),
        update,
      },
    };
    const svc = new CoinsService(prisma as never, { record } as never);

    await expect(svc.setNotional("btc", 120000, "alice")).resolves.toEqual({
      id: "c1",
      symbol: "BTC",
      notionalUsd: 120000,
    });
    expect(record).toHaveBeenCalledWith(
      "alice",
      "coin.notional",
      expect.objectContaining({ symbol: "BTC", from: 100000, to: 120000 }),
    );

    await expect(svc.resetNotional("btc", "alice")).resolves.toEqual({
      id: "c1",
      symbol: "BTC",
      notionalUsd: 100000,
    });
    expect(record).toHaveBeenCalledWith(
      "alice",
      "coin.notional.reset",
      expect.objectContaining({ symbol: "BTC", to: 100000 }),
    );
  });

  it("rejects non-positive notionals without writing", async () => {
    const update = jest.fn();
    const svc = service({
      tradableCoin: {
        findFirst: jest.fn(async () => ({ id: "c1", symbol: "BTC", notionalUsd: "100000" })),
        update,
      },
    });
    await expect(svc.setNotional("BTC", 0, "alice")).rejects.toThrow(/notionalUsd/);
    expect(update).not.toHaveBeenCalled();
  });

  it("creates normalized symbols with the ticker default and audits", async () => {
    const create = jest.fn(async () => ({ id: "c1", symbol: "ZEC", notionalUsd: "50000" }));
    const svc = service({ tradableCoin: { create } });
    await expect(svc.create({ symbol: "zec" }, "alice")).resolves.toEqual({
      id: "c1",
      symbol: "ZEC",
      notionalUsd: "50000",
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ symbol: "ZEC", notionalUsd: 50000 }),
      }),
    );
  });

  it("uses 100k when creating BTC without an explicit notional", async () => {
    const create = jest.fn(async () => ({ id: "c1", symbol: "BTC", notionalUsd: "100000" }));
    await service({ tradableCoin: { create } }).create({ symbol: "btc" }, "alice");
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ notionalUsd: 100000 }) }),
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
    await svc.update("c1", { enabled: false, notionalUsd: 60000 }, "alice");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1" },
        data: expect.objectContaining({ enabled: false, notionalUsd: 60000 }),
      }),
    );

    const invalid = service({
      tradableCoin: {
        findUnique: jest.fn(async () => ({ id: "c1", symbol: "ZEC" })),
        update,
      },
    });
    await expect(invalid.update("c1", { notionalUsd: 0 }, "alice")).rejects.toThrow(/notionalUsd/);

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
