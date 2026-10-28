import { VirtualAccountsService } from "./virtual-accounts.service";

function service(prisma: unknown) {
  return new VirtualAccountsService(prisma as never, { record: jest.fn() } as never, {} as never);
}

describe("VirtualAccountsService", () => {
  it("creates an account with genesis deposit ledger entry", async () => {
    const create = jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "a1", ...args.data }));
    const txCreate = jest.fn(async () => ({}));
    const virtualAccount = {
      create,
      findUnique: jest.fn(),
      update: jest.fn(),
    };
    const virtualTransaction = { create: txCreate, findMany: jest.fn(async () => []) };
    const prisma = {
      virtualAccount,
      virtualTransaction,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ virtualAccount, virtualTransaction }),
      ),
    };
    const svc = service(prisma);
    const acc = (await svc.create({ name: "demo", balance: 1000 }, "alice")) as { id: string };
    expect(acc.id).toBe("a1");
    expect(txCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: "DEPOSIT", amount: 1000 }) }),
    );
  });

  it("rejects bad input", async () => {
    const svc = service({});
    await expect(svc.create({ name: "", balance: 10 }, "a")).rejects.toThrow();
    await expect(svc.create({ name: "x", balance: -1 }, "a")).rejects.toThrow();
    await expect(svc.create({ name: "x", balance: 10, leverage: 99 }, "a")).rejects.toThrow();
    await expect(svc.create({ name: "x", balance: 10, mode: "YOLO" }, "a")).rejects.toThrow();
  });

  it("withdraw refuses more than balance", async () => {
    const prisma = {
      virtualAccount: {
        findUnique: jest.fn(async () => ({ id: "a1", balance: 100 })),
        update: jest.fn(),
      },
      virtualTransaction: { create: jest.fn() },
      $transaction: jest.fn(),
    };
    const svc = service(prisma);
    await expect(svc.withdraw("a1", 500, "alice")).rejects.toThrow(/exceeds balance/);
  });

  it("setLeverage refuses with open positions", async () => {
    const prisma = {
      virtualAccount: { findUnique: jest.fn(async () => ({ id: "a1" })), update: jest.fn() },
      virtualPosition: { count: jest.fn(async () => 2) },
    };
    const svc = service(prisma);
    await expect(svc.setLeverage("a1", 20, "alice")).rejects.toThrow(/close all positions/);
  });

  it("defaultAccount falls back to first account", async () => {
    const first = { id: "first", name: "f" };
    const prisma = { virtualAccount: { findFirst: jest.fn(async () => first) } };
    const svc = service(prisma);
    await expect(svc.defaultAccount()).resolves.toEqual(first);
  });
});
