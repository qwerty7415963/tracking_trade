import { PublicationsService, buildOpenCaption } from "./publications.service";

describe("buildOpenCaption (template #11)", () => {
  const base = {
    direction: "SHORT" as const,
    instrument: "ETH",
    status: "limit",
    entry: "2583.79",
    stopLoss: "2597.17",
    takeProfit: "2499",
    sourceDisplayName: "Osho",
    sourceUrl: "https://t.me/traderosho/4375",
  };

  it("renders the exact agreed layout", () => {
    expect(buildOpenCaption(base)).toBe(
      ["Short ETH - limit", "", "- Entry: 2583.79", "- SL: 2597.17", "- TP: 2499", "", "Osho", "", "https://t.me/traderosho/4375"].join("\n"),
    );
  });

  it("maps LONG to Long", () => {
    expect(buildOpenCaption({ ...base, direction: "LONG" }).split("\n")[0]).toBe("Long ETH - limit");
  });

  it("escapes html and refuses missing source url", () => {
    expect(buildOpenCaption({ ...base, sourceDisplayName: "A<B" }).split("\n")[6]).toBe("A&lt;B");
    expect(() => buildOpenCaption({ ...base, sourceUrl: null })).toThrow(
      /missing required source_url/,
    );
  });
});

function service(overrides: Record<string, unknown> = {}) {
  const prisma = {
    virtualPosition: { findUnique: jest.fn() },
    signal: { findUnique: jest.fn() },
    sourceMessage: { findFirst: jest.fn() },
    telegramPublication: {
      update: jest.fn(async (args: unknown) => args),
      create: jest.fn(async (args: unknown) => ({ id: "pub1" })),
      findFirst: jest.fn(async () => null),
    },
    ...(overrides.prisma as Record<string, unknown> | undefined),
  };
  return new PublicationsService(
    prisma as never,
    { record: jest.fn() } as never,
    (overrides.renderer ?? {}) as never,
    (overrides.sender ?? {}) as never,
    (overrides.config ?? {}) as never,
    (overrides.redis ?? {}) as never,
    (overrides.renders ?? { saveArtifact: jest.fn(async () => ({})) }) as never,
  );
}

const POSITION = {
  id: "pos1",
  accountId: "acc1",
  signalId: "s1",
  coin: "ETH",
  direction: "LONG",
  size: 0.5,
  entryPrice: 2500,
  stopLoss: 2400,
  takeProfits: [2600, 2700],
  leverage: 10,
  remainingSize: 0.5,
  filledTps: [],
  status: "OPEN",
  realizedPnl: 0,
  signal: {
    sourceId: "src1",
    versions: [{ direction: "LONG", normalizedPayloadJson: { source_message_id: "m1" } }],
    source: { displayName: "Chan" },
  },
};
const SIGNAL = {
  sourceId: "src1",
  versions: [{ direction: "LONG", normalizedPayloadJson: { source_message_id: "m1" } }],
  source: { displayName: "Chan" },
};

describe("PublicationsService.publishPositionCardNow", () => {
  function okSetup() {
    const prisma = {
      virtualPosition: { findUnique: jest.fn(async () => POSITION) },
      signal: { findUnique: jest.fn(async () => SIGNAL) },
      sourceMessage: { findFirst: jest.fn(async () => ({ sourceUrl: "https://t.me/c/1" })) },
      telegramPublication: {
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pub1", ...args.data })),
        create: jest.fn(async () => ({ id: "pub1" })),
        findFirst: jest.fn(async () => null),
      },
    };
    const renderer = {
      render: jest.fn(async () => ({
        ok: true,
        artifact: { png: Buffer.from("png"), contentHash: "h", width: 1280, height: 180, templateVersion: 1 },
      })),
    };
    const sender = {
      sendPhoto: jest.fn(async () => ({ ok: true, telegramMessageId: "777", unknown: false })),
    };
    return { prisma, renderer, sender };
  }

  it("publishes photo with caption and records message id", async () => {
    const setup = okSetup();
    const svc = service(setup);
    const result = (await svc.publishPositionCardNow("pub1", {
      positionId: "pos1",
      status: "filled",
      markPrice: 2550,
      destinationChatId: "@chan",
      replyToMessageId: "111",
    }, "alice")) as { publicationStatus: string; telegramMessageId: string };
    expect(result.publicationStatus).toBe("PUBLISHED");
    expect(result.telegramMessageId).toBe("777");
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(sendArgs.replyToMessageId).toBe("111");
    expect(String(sendArgs.caption)).toContain("Long ETH");
    expect(String(sendArgs.caption)).toContain("filled");
  });

  it("refuses invalid mark price without sending", async () => {
    const setup = okSetup();
    const svc = service(setup);
    await expect(
      svc.publishPositionCardNow("pub1", {
        positionId: "pos1",
        status: "filled",
        markPrice: NaN,
        destinationChatId: "@chan",
      }, "alice"),
    ).rejects.toThrow(/INVALID/);
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
  });

  it("marks UNKNOWN on ambiguous telegram timeout without retrading", async () => {
    const setup = okSetup();
    setup.sender.sendPhoto = jest.fn(async () => ({
      ok: false,
      telegramMessageId: null,
      unknown: true,
    })) as never;
    const svc = service(setup);
    const result = (await svc.publishPositionCardNow("pub1", {
      positionId: "pos1",
      status: "tp",
      markPrice: 2600,
      destinationChatId: "@chan",
    }, "alice")) as {
      status: string;
    };
    expect(result.status).toBe("UNKNOWN");
  });

  it("requires a destination chat", async () => {
    const setup = okSetup();
    const svc = service({ ...setup, config: {} });
    await expect(
      svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice"),
    ).rejects.toThrow(/no destination chat/);
  });
});
