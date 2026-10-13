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
    execution: { findUnique: jest.fn() },
    executionCommand: { findUnique: jest.fn() },
    signal: { findUnique: jest.fn() },
    sourceMessage: { findFirst: jest.fn() },
    telegramPublication: { update: jest.fn(async (args: unknown) => args) },
    ...(overrides.prisma as Record<string, unknown> | undefined),
  };
  return new PublicationsService(
    prisma as never,
    { record: jest.fn() } as never,
    (overrides.brokerState ?? {}) as never,
    (overrides.renderer ?? {}) as never,
    (overrides.sender ?? {}) as never,
    (overrides.config ?? { mt5AccountId: "acc1" }) as never,
    (overrides.redis ?? {}) as never,
    (overrides.renders ?? { saveArtifact: jest.fn(async () => ({})) }) as never,
  );
}

const EXECUTION = { id: "e1", executionCommandId: "c1", brokerPositionId: "p1", fillPrice: 100, actualSl: 99, actualTp: 102 };
const COMMAND = { id: "c1", accountId: "acc1", signalId: "s1" };
const SIGNAL = {
  sourceId: "src1",
  versions: [{ direction: "LONG", entry: 100, normalizedPayloadJson: { source_message_id: "m1" } }],
  source: { displayName: "Chan" },
};
const POSITION = {
  positionId: "p1",
  orderId: "o1",
  symbol: "XAUUSD.a",
  direction: "LONG" as const,
  volume: 0.05,
  openPrice: 100,
  stopLoss: 99,
  takeProfit: 102,
  profit: 5,
  currentPrice: 101,
};

describe("PublicationsService.publishNow", () => {
  function okSetup() {
    const prisma = {
      execution: { findUnique: jest.fn(async () => EXECUTION) },
      executionCommand: { findUnique: jest.fn(async () => COMMAND) },
      signal: { findUnique: jest.fn(async () => SIGNAL) },
      sourceMessage: { findFirst: jest.fn(async () => ({ sourceUrl: "https://t.me/c/1" })) },
      telegramPublication: {
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pub1", ...args.data })),
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
    const brokerState = { positions: jest.fn(async () => [POSITION]), symbolInfo: jest.fn(), account: jest.fn(), isAlive: jest.fn() };
    return { prisma, renderer, sender, brokerState };
  }

  it("publishes photo with caption and records message id", async () => {
    const setup = okSetup();
    const svc = service(setup);
    const result = (await svc.publishNow("pub1", {
      executionId: "e1",
      destinationChatId: "@chan",
      replyToMessageId: "111",
    }, "alice")) as { publicationStatus: string; telegramMessageId: string };
    expect(result.publicationStatus).toBe("PUBLISHED");
    expect(result.telegramMessageId).toBe("777");
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(sendArgs.replyToMessageId).toBe("111");
    expect(String(sendArgs.caption)).toContain("Long XAUUSD");
  });

  it("refuses closed positions without sending", async () => {
    const setup = okSetup();
    setup.brokerState.positions = jest.fn(async () => []);
    const svc = service(setup);
    await expect(
      svc.publishNow("pub1", { executionId: "e1", destinationChatId: "@chan" }, "alice"),
    ).rejects.toThrow(/POSITION_NOT_OPEN/);
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
    const result = (await svc.publishNow("pub1", { executionId: "e1", destinationChatId: "@chan" }, "alice")) as {
      status: string;
    };
    expect(result.status).toBe("UNKNOWN");
  });
});

