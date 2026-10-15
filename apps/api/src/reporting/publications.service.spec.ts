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
      findUnique: jest.fn(async () => ({ id: "pub1", publicationStatus: "PENDING" })),
    },
    ...(overrides.prisma as Record<string, unknown> | undefined),
  };
  return new PublicationsService(
    prisma as never,
    { record: jest.fn() } as never,
    (overrides.sender ?? {}) as never,
    (overrides.config ?? {}) as never,
    (overrides.renders ??
      { readArtifact: jest.fn(async () => Buffer.from("png-bytes")) }) as never,
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

describe("PublicationsService.sendPublication", () => {
  function okSetup() {
    const prisma = {
      virtualPosition: { findUnique: jest.fn(async () => POSITION) },
      signal: { findUnique: jest.fn(async () => SIGNAL) },
      sourceMessage: { findFirst: jest.fn(async () => ({ sourceUrl: "https://t.me/c/1" })) },
      telegramPublication: {
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pub1", ...args.data })),
        create: jest.fn(async () => ({ id: "pub1" })),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({ id: "pub1", publicationStatus: "PENDING" })),
      },
    };
    const sender = {
      sendPhoto: jest.fn(async () => ({ ok: true, telegramMessageId: "777", unknown: false })),
    };
    const renders = {
      readArtifact: jest.fn(async () => Buffer.from("png-bytes")),
    };
    return { prisma, sender, renders };
  }

  function sendInput(overrides: Record<string, unknown> = {}) {
    return {
      publicationId: "pub1",
      positionId: "pos1",
      status: "filled" as const,
      markPrice: 2550,
      destinationChatId: "@chan",
      replyToMessageId: "111",
      artifactPath: "/tmp/pub1.png",
      actor: "alice",
      ...overrides,
    };
  }

  it("sends a worker-rendered photo with caption and records message id", async () => {
    const setup = okSetup();
    const svc = service(setup);
    const result = (await svc.sendPublication("pub1", sendInput())) as {
      publicationStatus: string;
      telegramMessageId: string;
    };
    expect(setup.renders.readArtifact).toHaveBeenCalledWith("pub1");
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
    await expect(svc.sendPublication("pub1", sendInput({ markPrice: NaN }))).rejects.toThrow(
      /INVALID/,
    );
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
    const result = (await svc.sendPublication(
      "pub1",
      sendInput({ status: "tp", markPrice: 2600, replyToMessageId: undefined }),
    )) as {
      status: string;
    };
    expect(result.status).toBe("UNKNOWN");
  });

  it("skips already-published publications without resending", async () => {
    const setup = okSetup();
    (setup.prisma.telegramPublication.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "pub1",
      publicationStatus: "PUBLISHED",
    });
    const svc = service(setup);
    await expect(svc.sendPublication("pub1", sendInput())).resolves.toEqual({
      id: "pub1",
      publicationStatus: "PUBLISHED",
    });
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
  });

  it("requires a destination chat", async () => {
    const setup = okSetup();
    const svc = service({ ...setup, config: {} });
    await expect(
      svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice"),
    ).rejects.toThrow(/no destination chat/);
  });

  it("enqueues a render job instead of publishing inline", async () => {
    const setup = okSetup();
    const requestRender = jest.fn(async () => ({ id: "render:pub1" }));
    const svc = service({
      ...setup,
      config: { reportDestinationChatId: "@chan" },
      renders: { ...setup.renders, requestRender },
    });
    const result = await svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice");
    expect(result).toEqual({ publicationId: "pub1", status: "PENDING" });
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({
        virtualPositionId: "pos1",
        markPrice: 2550,
        publicationId: "pub1",
        status: "filled",
        destinationChatId: "@chan",
        actor: "alice",
      }),
      "alice",
      "render:pub1",
    );
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
  });
});
