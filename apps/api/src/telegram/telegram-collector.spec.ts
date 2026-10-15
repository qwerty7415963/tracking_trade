import { Prisma } from "@prisma/client";
import { FloodWaitError, SessionRevokedError } from "teleproto/errors";
import { PrismaService } from "../database/prisma.service";
import { loadAppConfig } from "../config/app.config";
import {
  TelegramCollectorService,
  TelegramPort,
  hashContent,
  mapCollectionError,
} from "./telegram-collector.service";

function fakePort(overrides: Partial<TelegramPort> = {}): TelegramPort {
  return {
    connect: async () => {},
    disconnect: async () => {},
    fetchLatest: async () => [],
    subscribe: () => {},
    subscribeEdits: () => {},
    ...overrides,
  };
}

function asError(cls: new (...args: never[]) => Error): Error {
  return Object.create(cls.prototype) as Error;
}

describe("TelegramCollectorService", () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  function service(prisma: unknown, port: TelegramPort): TelegramCollectorService {
    return new TelegramCollectorService(
      prisma as PrismaService,
      loadAppConfig({}),
      () => port,
    );
  }

  it("hashes content deterministically", () => {
    expect(hashContent("abc")).toBe(hashContent("abc"));
    expect(hashContent("abc")).not.toBe(hashContent("abd"));
  });

  it("maps flood errors to JOIN_FLOOD_WAIT", () => {
    expect(mapCollectionError(asError(FloodWaitError))).toBe("JOIN_FLOOD_WAIT");
  });

  it("maps revoked sessions to SESSION_REVOKED", () => {
    expect(mapCollectionError(asError(SessionRevokedError))).toBe("SESSION_REVOKED");
  });

  it("maps unknown errors to UNKNOWN_COLLECTION_ERROR", () => {
    expect(mapCollectionError(new Error("boom"))).toBe("UNKNOWN_COLLECTION_ERROR");
  });

  it("checkSource succeeds when the channel is readable", async () => {
    process.env.TELEGRAM_API_ID = "123";
    process.env.TELEGRAM_API_HASH = "hash";
    process.env.TELEGRAM_SESSION_STRING = "session";
    const port = fakePort({ fetchLatest: async () => [{ id: "1", text: "hello" }] });
    const svc = service({}, port);
    await expect(
      svc.checkSource({ externalSourceId: "chan" } as never),
    ).resolves.toEqual({ ok: true, code: null });
  });

  it("checkSource reports MISSING_CREDENTIALS without env", async () => {
    delete process.env.TELEGRAM_API_ID;
    const svc = service({}, fakePort());
    await expect(svc.checkSource({ externalSourceId: "chan" } as never)).resolves.toEqual({
      ok: false,
      code: "MISSING_CREDENTIALS",
    });
  });

  it("ingestEdit bumps revision instead of overwriting", async () => {
    const findFirst = jest.fn(async () => ({ id: "m1", revision: 1 }));
    const create = jest.fn(async () => ({ id: "m2" }));
    const svc = service({ sourceMessage: { findFirst, create } }, fakePort());
    await expect(svc.ingestEdit("s1", { id: "42", text: "edited text" })).resolves.toEqual({
      deduplicated: false,
      id: "m2",
      revision: 2,
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ revision: 2 }) }),
    );
  });

  it("ingestEdit falls back to revision 1 for unseen messages", async () => {
    const create = jest.fn(async () => ({ id: "m1" }));
    const svc = service(
      { sourceMessage: { findFirst: jest.fn(async () => null), create } },
      fakePort(),
    );
    await expect(svc.ingestEdit("s1", { id: "42", text: "late original" })).resolves.toEqual({
      deduplicated: false,
      id: "m1",
      revision: 1,
    });
  });

  it("subscribeEditMessages delegates to the port", async () => {
    process.env.TELEGRAM_API_ID = "123";
    process.env.TELEGRAM_API_HASH = "hash";
    process.env.TELEGRAM_SESSION_STRING = "session";
    const subscribeEdits = jest.fn();
    const svc = service({}, fakePort({ subscribeEdits }));
    const handler = async () => {};
    await svc.subscribeEditMessages("chan", handler);
    expect(subscribeEdits).toHaveBeenCalledWith("chan", handler);
  });

  it("ingestMessage treats P2002 as deduplicated", async () => {
    const taken = new Prisma.PrismaClientKnownRequestError("taken", {
      code: "P2002",
      clientVersion: "test",
    });
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: "m1" })
      .mockRejectedValueOnce(taken);
    const svc = service({ sourceMessage: { create } }, fakePort());
    const input = { id: "42", text: "signal text" };

    await expect(svc.ingestMessage("s1", input)).resolves.toEqual({
      deduplicated: false,
      id: "m1",
    });
    await expect(svc.ingestMessage("s1", input)).resolves.toEqual({
      deduplicated: true,
      id: null,
    });
    expect(create).toHaveBeenCalledTimes(2);
  });
});

