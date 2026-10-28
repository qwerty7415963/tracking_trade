import { ConflictException } from "@nestjs/common";
import {
  SignalsService,
  extractSourceUrl,
  payloadRowId,
  telegramChatTarget,
} from "./signals.service";

describe("extractSourceUrl", () => {
  it("strips a full https link out of the text", () => {
    expect(
      extractSourceUrl("LONG ETH @3500 SL 3400 TP 3700 https://t.me/traderosho/4375"),
    ).toEqual({
      text: "LONG ETH @3500 SL 3400 TP 3700",
      url: "https://t.me/traderosho/4375",
    });
  });

  it("normalizes bare t.me links with https://", () => {
    expect(extractSourceUrl("LONG ETH @1 SL 2 TP 3 t.me/x/1")).toEqual({
      text: "LONG ETH @1 SL 2 TP 3",
      url: "https://t.me/x/1",
    });
  });

  it("strips the legacy url= prefix", () => {
    expect(extractSourceUrl("LONG ETH @1 SL 2 TP 3 url=https://t.me/x/1")).toEqual({
      text: "LONG ETH @1 SL 2 TP 3",
      url: "https://t.me/x/1",
    });
  });

  it("returns the first link when several are pasted", () => {
    expect(
      extractSourceUrl("LONG ETH @1 SL 2 TP 3 https://t.me/a/1 https://t.me/b/2"),
    ).toEqual({ text: "LONG ETH @1 SL 2 TP 3", url: "https://t.me/a/1" });
  });

  it("trims trailing punctuation from the link", () => {
    expect(extractSourceUrl("LONG ETH @1 SL 2 TP 3 https://t.me/x/1).")).toEqual({
      text: "LONG ETH @1 SL 2 TP 3",
      url: "https://t.me/x/1",
    });
  });

  it("leaves link-free text untouched", () => {
    expect(extractSourceUrl("LONG BTC @100000 SL 98000 TP 105000")).toEqual({
      text: "LONG BTC @100000 SL 98000 TP 105000",
      url: null,
    });
    expect(extractSourceUrl("").url).toBeNull();
  });
});

describe("telegramChatTarget", () => {
  it("maps public post links to @username", () => {
    expect(telegramChatTarget("https://t.me/traderosho/4375")).toBe("@traderosho");
    expect(telegramChatTarget("https://t.me/s/traderosho/4375")).toBe("@traderosho");
    expect(telegramChatTarget("https://t.me/traderosho")).toBe("@traderosho");
  });

  it("maps private /c/ links to -100<id>", () => {
    expect(telegramChatTarget("https://t.me/c/3763643270/431")).toBe("-1003763643270");
    expect(telegramChatTarget("https://t.me/c/3763643270")).toBe("-1003763643270");
  });

  it("rejects invite links and non-Telegram urls", () => {
    expect(telegramChatTarget("https://t.me/+AbCdEf")).toBeNull();
    expect(telegramChatTarget("https://t.me/joinchat/AAAA")).toBeNull();
    expect(telegramChatTarget("https://x.com/user/status/1")).toBeNull();
    expect(telegramChatTarget("not a url")).toBeNull();
  });
});

describe("payloadRowId", () => {
  it("reads the camelCase key stored by ingest", () => {
    expect(payloadRowId({ sourceMessageId: "m1" })).toBe("m1");
  });

  it("falls back to legacy snake_case rows", () => {
    expect(payloadRowId({ source_message_id: "m1" })).toBe("m1");
  });

  it("rejects missing and non-string values", () => {
    expect(payloadRowId(null)).toBeNull();
    expect(payloadRowId({})).toBeNull();
    expect(payloadRowId({ sourceMessageId: 42 })).toBeNull();
  });
});

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
      // Same-row lookup (references "m2") finds nothing yet; prior rows link sig1.
      signalVersion: {
        findMany: jest.fn(async ({ where }: { where: unknown }) =>
          JSON.stringify(where).includes('"m2"') ? [] : [{ signalId: "sig1" }],
        ),
      },
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
    const coins = { enabledSymbols: jest.fn(async () => ["XAU", "ETH", "BTC"]) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
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

describe("SignalsService.ingestSourceMessage (coin gate)", () => {
  function gateService(allowed: string[]) {
    const tx = {
      signal: {
        create: jest.fn(async () => ({ id: "sig-new" })),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "sig-new",
          ...args.data,
        })),
      },
      signalVersion: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      sourceMessage: {
        findUnique: jest.fn(async () => ({
          id: "m1",
          sourceId: "s1",
          externalMessageId: "42",
          revision: 1,
          contentRaw: "#$ZEC LONG Entry 1 SL 0.9 TP 1.1",
          authorId: "a1",
          source: { platform: "TELEGRAM", deletedAt: null, parserProfileId: null },
        })),
      },
      signalVersion: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const coins = { enabledSymbols: jest.fn(async () => allowed) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
    return { svc, tx };
  }

  it("sends unlisted coins to review with a visible reason", async () => {
    const { svc, tx } = gateService([]);
    await expect(svc.ingestSourceMessage("m1", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig-new",
      status: "NEEDS_REVIEW",
    });
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          instrument: "ZEC",
          normalizedPayloadJson: expect.objectContaining({
            ambiguities: expect.arrayContaining(["unmapped_symbol_ZEC"]),
          }),
        }),
      }),
    );
  });

  it("approves the queue for listed coins", async () => {
    const { svc } = gateService(["ZEC"]);
    await expect(svc.ingestSourceMessage("m1", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig-new",
      status: "PENDING_APPROVAL",
    });
  });

  it("applies the source channel profile aliases", async () => {
    const tx = {
      signal: {
        create: jest.fn(async () => ({ id: "sig-new" })),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "sig-new",
          ...args.data,
        })),
      },
      signalVersion: { create: jest.fn(async () => ({})) },
    };
    const prisma = {
      sourceMessage: {
        findUnique: jest.fn(async () => ({
          id: "m1",
          sourceId: "s1",
          externalMessageId: "42",
          revision: 1,
          contentRaw: "BUY PAWS Entry 1 SL 0.9 TP 1.1",
          authorId: "a1",
          source: { platform: "TELEGRAM", deletedAt: null, parserProfileId: "p1" },
        })),
      },
      signalVersion: { findMany: jest.fn(async () => []) },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const coins = { enabledSymbols: jest.fn(async () => ["BTC"]) };
    const profiles = { getProfile: jest.fn(async () => ({ coinAliases: { PAWS: "BTC" } })) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
    await expect(svc.ingestSourceMessage("m1", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig-new",
      status: "PENDING_APPROVAL",
    });
    expect(profiles.getProfile).toHaveBeenCalledWith("p1");
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ instrument: "BTC" }) }),
    );
  });
});

describe("SignalsService.ingestSourceMessage (idempotent re-ingest)", () => {
  it("returns the existing signal when the same row is ingested twice", async () => {
    const tx = {
      signalVersion: { create: jest.fn() },
      signal: { create: jest.fn(), update: jest.fn() },
    };
    const prisma = {
      sourceMessage: {
        findUnique: jest.fn(async () => ({
          id: "m1",
          sourceId: "s1",
          externalMessageId: "42",
          revision: 1,
          contentRaw: "BUY XAUUSD @2600 SL 2590 TP 2620",
          authorId: "a1",
          source: { platform: "TELEGRAM", deletedAt: null, parserProfileId: null },
        })),
      },
      signalVersion: { findMany: jest.fn(async () => [{ signalId: "sig1" }]) },
      signal: {
        findUnique: jest.fn(async () => ({ id: "sig1", status: "PENDING_APPROVAL" })),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const coins = { enabledSymbols: jest.fn(async () => ["XAU"]) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
    await expect(svc.ingestSourceMessage("m1", "ingestion")).resolves.toEqual({
      kind: "SIGNAL",
      signalId: "sig1",
      status: "PENDING_APPROVAL",
    });
    expect(tx.signal.create).not.toHaveBeenCalled();
    expect(tx.signalVersion.create).not.toHaveBeenCalled();
  });
});

describe("SignalsService.appendManualVersion", () => {
  const ORIGIN_TEXT = "#BTW Entry: 2.0476 SL: 1.1967 Tp: 10.284";

  function manualService() {
    const tx = {
      signalVersion: { create: jest.fn(async () => ({})) },
      signal: {
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "sig1",
          ...args.data,
        })),
      },
    };
    const prisma = {
      signal: {
        findUnique: jest.fn(async () => ({
          id: "sig1",
          status: "NEEDS_REVIEW",
          source: { platform: "TELEGRAM", parserProfileId: null },
          versions: [
            {
              versionNumber: 1,
              instrument: "BTW",
              direction: "UNKNOWN",
              orderType: null,
              entry: 2.0476,
              stopLoss: 1.1967,
              takeProfits: [10.284],
              normalizedPayloadJson: { sourceMessageId: "m1" },
            },
          ],
        })),
      },
      sourceMessage: {
        findUnique: jest.fn(async () => ({
          id: "m1",
          contentRaw: ORIGIN_TEXT,
          sourceUrl: null,
          sourceTimestamp: null,
          threadId: null,
          replyToMessageId: null,
          quotedMessageId: null,
        })),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    };
    const coins = { enabledSymbols: jest.fn(async () => ["BTW"]) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
    return { svc, tx };
  }

  it("fills a missing direction from a one-word reply", async () => {
    const { svc, tx } = manualService();
    const out = await svc.appendManualVersion("sig1", "long", "tg:alice");
    expect(out.status).toBe("PENDING_APPROVAL");
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signalId: "sig1",
          versionNumber: 2,
          eventType: "MANUAL",
          direction: "LONG",
        }),
      }),
    );
  });

  it("refuses replies that add nothing new", async () => {
    const { svc, tx } = manualService();
    await expect(svc.appendManualVersion("sig1", "ok", "tg:alice")).rejects.toThrow(
      /nothing new parsed/,
    );
    expect(tx.signalVersion.create).not.toHaveBeenCalled();
  });
});

describe("SignalsService.createOperatorSignal", () => {
  // Resolution must never depend on the developer's shell env.
  let savedToken: string | undefined;
  const realFetch = global.fetch;
  beforeAll(() => {
    savedToken = process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_BOT_TOKEN;
  });
  afterAll(() => {
    if (savedToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN;
    else process.env.TELEGRAM_BOT_TOKEN = savedToken;
    global.fetch = realFetch;
  });

  function opService(overrides: Record<string, unknown> = {}) {
    const tx = {
      signal: {
        create: jest.fn(async () => ({ id: "sig-op" })),
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({
          id: "sig-op",
          ...args.data,
        })),
      },
      signalVersion: {
        create: jest.fn(async () => ({ id: "v-op", instrument: "BTC", direction: "LONG" })),
      },
    };
    const prisma = {
      source: {
        upsert: jest.fn(async () => ({ id: "src-op" })),
      },
      sourceMessage: {
        create: jest.fn(async () => ({ id: "m-op" })),
        findFirst: jest.fn(async () => null),
      },
      $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      ...(overrides as Record<string, unknown>),
    };
    const coins = { enabledSymbols: jest.fn(async () => ["BTC", "ETH"]) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );
    return { svc, prisma, tx };
  }

  it("creates a MANUAL signal with a synthetic source post", async () => {
    const { svc, prisma, tx } = opService();
    const out = await svc.createOperatorSignal(
      "LONG BTC @100000 SL 98000 TP 105000",
      "tg:alice",
      { sourceUrl: "https://t.me/x/1" },
    );
    expect(out).toEqual({
      signalId: "sig-op",
      versionId: "v-op",
      status: "PENDING_APPROVAL",
      instrument: "BTC",
      direction: "LONG",
      entryMarket: false,
    });
    expect(prisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_externalSourceId: { platform: "MANUAL", externalSourceId: "operator" },
        },
      }),
    );
    expect(prisma.sourceMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceId: "src-op",
          authorName: "tg:alice",
          sourceUrl: "https://t.me/x/1",
        }),
      }),
    );
    expect(tx.signalVersion.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          signalId: "sig-op",
          versionNumber: 1,
          eventType: "MANUAL",
          normalizedPayloadJson: expect.objectContaining({ sourceMessageId: "m-op" }),
        }),
      }),
    );
  });

  it("refuses incomplete or unknown-coin input before persisting", async () => {
    const { svc, prisma } = opService();
    await expect(svc.createOperatorSignal("LONG BTC @100000", "tg:alice")).rejects.toThrow(
      /missing stop_loss, take_profits/,
    );
    await expect(
      svc.createOperatorSignal("LONG $XYZ @1 SL 0.9 TP 1.1", "tg:alice"),
    ).rejects.toThrow(/unknown coin XYZ/);
    await expect(svc.createOperatorSignal("close everything", "tg:alice")).rejects.toThrow(
      /reads as an update/,
    );
    await expect(svc.createOperatorSignal("   ", "tg:alice")).rejects.toThrow(/empty signal text/);
    expect(prisma.sourceMessage.create).not.toHaveBeenCalled();
    expect(prisma.source.upsert).not.toHaveBeenCalled();
  });

  it("marks an operator market entry so /pos can delay it", async () => {
    const { svc } = opService();
    const out = await svc.createOperatorSignal(
      "LONG BTC entry market SL 98000 TP 105000",
      "tg:alice",
    );
    expect(out.entryMarket).toBe(true);
  });

  it("auto-detects a pasted link in the text", async () => {
    const { svc, prisma } = opService();
    await svc.createOperatorSignal(
      "LONG BTC @100000 SL 98000 TP 105000 https://t.me/traderosho/4375",
      "tg:alice",
    );
    expect(prisma.sourceMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          // The link is stripped from the stored signal text…
          contentRaw: "LONG BTC @100000 SL 98000 TP 105000",
          // …and kept as the source post link.
          sourceUrl: "https://t.me/traderosho/4375",
        }),
      }),
    );
    expect(prisma.sourceMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceUrl: "https://t.me/traderosho/4375" } }),
    );
  });

  it("treats link-only input as empty", async () => {
    const { svc, prisma } = opService();
    await expect(
      svc.createOperatorSignal("https://t.me/x/1", "tg:alice"),
    ).rejects.toThrow(/empty signal text/);
    expect(prisma.sourceMessage.create).not.toHaveBeenCalled();
  });

  it("explicit sourceUrl (REST) wins over a link pasted in the text", async () => {
    const { svc, prisma } = opService();
    await svc.createOperatorSignal("LONG BTC @100000 SL 98000 TP 105000 https://t.me/a/1", "tg:alice", {
      sourceUrl: "https://override.example/x",
    });
    expect(prisma.sourceMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ sourceUrl: "https://override.example/x" }),
      }),
    );
  });

  it("creates a per-channel MANUAL source from an explicit src name", async () => {
    const { svc, prisma } = opService();
    await svc.createOperatorSignal("LONG BTC @100000 SL 98000 TP 105000", "tg:alice", {
      sourceName: "Kaka trades",
      sourceUrl: "https://t.me/c/1/431",
    });
    expect(prisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_externalSourceId: { platform: "MANUAL", externalSourceId: "kaka trades" },
        },
        create: expect.objectContaining({
          displayName: "Kaka trades",
          sourceKind: "MANUAL",
        }),
      }),
    );
    expect(process.env.TELEGRAM_BOT_TOKEN).toBeUndefined();
  });

  it("reuses the tracked channel name when the url is already ingested", async () => {
    const { svc, prisma } = opService({
      sourceMessage: {
        create: jest.fn(async () => ({ id: "m-op" })),
        findFirst: jest.fn(async () => ({ source: { displayName: "Osho" } })),
      },
    });
    await svc.createOperatorSignal("LONG BTC @100000 SL 98000 TP 105000", "tg:alice", {
      sourceUrl: "https://t.me/traderosho/4375",
    });
    expect(prisma.sourceMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { sourceUrl: "https://t.me/traderosho/4375" } }),
    );
    expect(prisma.source.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { platform_externalSourceId: { platform: "MANUAL", externalSourceId: "osho" } },
        create: expect.objectContaining({ displayName: "Osho" }),
      }),
    );
  });

  it("resolves the channel title via getChat for a pasted private link", async () => {
    const fetchMock = jest.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { title: "Kaka trades" } }),
    }));
    global.fetch = fetchMock as never;
    process.env.TELEGRAM_BOT_TOKEN = "tok-123";
    try {
      const { svc, prisma } = opService();
      await svc.createOperatorSignal(
        "LONG BTC @100000 SL 98000 TP 105000 https://t.me/c/3763643270/431",
        "tg:alice",
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.telegram.org/bottok-123/getChat",
        expect.objectContaining({ body: '{"chat_id":"-1003763643270"}' }),
      );
      expect(prisma.source.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            platform_externalSourceId: { platform: "MANUAL", externalSourceId: "kaka trades" },
          },
          create: expect.objectContaining({ displayName: "Kaka trades" }),
        }),
      );
      expect(prisma.sourceMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            contentRaw: "LONG BTC @100000 SL 98000 TP 105000",
            sourceUrl: "https://t.me/c/3763643270/431",
          }),
        }),
      );
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      global.fetch = realFetch;
    }
  });

  it("falls back to the operator name when getChat fails", async () => {
    global.fetch = jest.fn(async () => {
      throw new Error("network down");
    }) as never;
    process.env.TELEGRAM_BOT_TOKEN = "tok-123";
    try {
      const { svc, prisma } = opService();
      await svc.createOperatorSignal("LONG BTC @100000 SL 98000 TP 105000", "tg:alice", {
        sourceUrl: "https://t.me/privateonly/9",
      });
      expect(prisma.source.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            platform_externalSourceId: { platform: "MANUAL", externalSourceId: "operator" },
          },
        }),
      );
    } finally {
      delete process.env.TELEGRAM_BOT_TOKEN;
      global.fetch = realFetch;
    }
  });

  it("skips getChat entirely without a token", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as never;
    try {
      const { svc, prisma } = opService();
      await svc.createOperatorSignal("LONG BTC @100000 SL 98000 TP 105000", "tg:alice", {
        sourceUrl: "https://t.me/anyone/1",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(prisma.source.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            platform_externalSourceId: { platform: "MANUAL", externalSourceId: "operator" },
          },
        }),
      );
    } finally {
      global.fetch = realFetch;
    }
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
    const coins = { enabledSymbols: jest.fn(async () => [] as string[]) };
    const profiles = { getProfile: jest.fn(async () => null) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      coins as never,
      profiles as never,
    );

    await expect(svc.approve("s1", { signalVersionId: "v1" }, "alice")).rejects.toThrow(
      ConflictException,
    );
    expect(tx.approval.create).not.toHaveBeenCalled();
  });

  it("refuses to approve versions missing open-required fields", async () => {
    const tx = {
      signal: {
        findUnique: async () => ({
          id: "s1",
          status: "NEEDS_REVIEW",
          versions: [
            {
              id: "v1",
              instrument: "UNKNOWN",
              direction: "UNKNOWN",
              entry: null,
              stopLoss: null,
              takeProfits: [],
            },
          ],
        }),
      },
      approval: { create: jest.fn() },
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      { enabledSymbols: jest.fn(async () => [] as string[]) } as never,
      { getProfile: jest.fn(async () => null) } as never,
    );
    await expect(svc.approve("s1", { signalVersionId: "v1" }, "alice")).rejects.toThrow(
      /missing instrument, direction, entry, stop_loss, take_profits/,
    );
    expect(tx.approval.create).not.toHaveBeenCalled();
  });

  it("allows a market entry to be approved without a fixed entry price", async () => {
    const tx = {
      signal: {
        findUnique: async () => ({
          id: "s1",
          status: "NEEDS_REVIEW",
          versions: [
            {
              id: "v1",
              instrument: "ETH",
              direction: "LONG",
              entry: null,
              stopLoss: 2200,
              takeProfits: [2400],
              normalizedPayloadJson: { entryMarket: true, entries: [] },
            },
          ],
        }),
        update: jest.fn(async (args: unknown) => args),
      },
      approval: { create: jest.fn(async () => ({ id: "ap1" })) },
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      { enabledSymbols: jest.fn(async () => [] as string[]) } as never,
      { getProfile: jest.fn(async () => null) } as never,
    );
    await expect(
      svc.approve("s1", { signalVersionId: "v1" }, "alice"),
    ).resolves.toBeTruthy();
    expect(tx.approval.create).toHaveBeenCalled();
  });

  it("still allows approving complete versions with unlisted coins", async () => {
    const tx = {
      signal: {
        findUnique: async () => ({
          id: "s1",
          status: "NEEDS_REVIEW",
          versions: [
            {
              id: "v1",
              instrument: "ZEC",
              direction: "LONG",
              entry: 1,
              stopLoss: 0.9,
              takeProfits: [1.1],
            },
          ],
        }),
        update: jest.fn(async (args: unknown) => args),
      },
      approval: { create: jest.fn(async () => ({ id: "ap1" })) },
    };
    const prisma = { $transaction: async (fn: (t: unknown) => unknown) => fn(tx) };
    const svc = new SignalsService(
      prisma as never,
      { record: jest.fn() } as never,
      { enabledSymbols: jest.fn(async () => [] as string[]) } as never,
      { getProfile: jest.fn(async () => null) } as never,
    );
    await expect(
      svc.approve("s1", { signalVersionId: "v1" }, "alice"),
    ).resolves.toBeTruthy();
    expect(tx.approval.create).toHaveBeenCalled();
  });
});
