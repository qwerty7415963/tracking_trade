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

  it("escapes html and omits the link line when no url", () => {
    expect(buildOpenCaption({ ...base, sourceDisplayName: "A<B" }).split("\n")[6]).toBe("A&lt;B");
    const noUrl = buildOpenCaption({ ...base, sourceUrl: null }).split("\n");
    expect(noUrl).toHaveLength(7);
    expect(noUrl[noUrl.length - 1]).toBe("Osho");
  });
});

function service(overrides: Record<string, unknown> = {}) {
  const prisma = {
    virtualPosition: { findUnique: jest.fn(), findMany: jest.fn(async () => []) },
    signal: { findUnique: jest.fn() },
    sourceMessage: { findUnique: jest.fn(async () => null) },
    telegramPublication: {
      update: jest.fn(async (args: unknown) => args),
      create: jest.fn(async (args: unknown) => ({ id: "pub1" })),
      findFirst: jest.fn(async () => null),
      findUnique: jest.fn(async () => ({
        id: "pub1",
        publicationStatus: "PENDING",
        createdAt: new Date(),
      })),
    },
    ...(overrides.prisma as Record<string, unknown> | undefined),
  };
  return new PublicationsService(
    prisma as never,
    ((overrides.audit ?? { record: jest.fn(async () => ({})) }) as never),
    (overrides.sender ?? {}) as never,
    (overrides.config ?? {}) as never,
    (overrides.renders ??
      { readArtifact: jest.fn(async () => Buffer.from("png-bytes")), deleteArtifact: jest.fn(async () => undefined) }) as never,
    (overrides.marketData ??
      { getAllMids: jest.fn(async () => ({} as Record<string, number>)) }) as never,
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
    versions: [{ direction: "LONG", normalizedPayloadJson: { sourceMessageId: "m1" } }],
    source: { displayName: "Chan" },
  },
};
const SIGNAL = {
  sourceId: "src1",
  versions: [{ direction: "LONG", normalizedPayloadJson: { sourceMessageId: "m1" } }],
  source: { displayName: "Chan" },
};

describe("PublicationsService.sendPublication", () => {
  function okSetup() {
    const prisma = {
      virtualPosition: { findUnique: jest.fn(async () => POSITION) },
      signal: { findUnique: jest.fn(async () => SIGNAL) },
      sourceMessage: { findUnique: jest.fn(async () => ({ sourceUrl: "https://t.me/c/1" })) },
      telegramPublication: {
        update: jest.fn(async (args: { data: Record<string, unknown> }) => ({ id: "pub1", ...args.data })),
        create: jest.fn(async () => ({ id: "pub1" })),
        findFirst: jest.fn(async () => null),
        findUnique: jest.fn(async () => ({
          id: "pub1",
          publicationStatus: "PENDING",
          createdAt: new Date(),
        })),
      },
    };
    const sender = {
      sendPhoto: jest.fn(async () => ({ ok: true, telegramMessageId: "777", unknown: false })),
    };
    const renders = {
      readArtifact: jest.fn(async () => Buffer.from("png-bytes")),
      deleteArtifact: jest.fn(async () => undefined),
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
    expect(setup.renders.deleteArtifact).toHaveBeenCalledWith("pub1");
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
      sendInput({ status: "tp", markPrice: 2600, replyToMessageId: "111" }),
    )) as {
      status: string;
    };
    expect(result.status).toBe("UNKNOWN");
    expect(setup.renders.deleteArtifact).not.toHaveBeenCalled();
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
    expect(setup.renders.deleteArtifact).toHaveBeenCalledWith("pub1");
  });

  it("requires a destination chat", async () => {
    const setup = okSetup();
    const svc = service({ ...setup, config: {} });
    await expect(
      svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice"),
    ).rejects.toThrow(/no destination chat/);
  });
  it("holds an update while the original is fresh and records the wait", async () => {
    const setup = okSetup();
    const svc = service(setup);
    await expect(
      svc.sendPublication("pub1", sendInput({ status: "tp", replyToMessageId: undefined })),
    ).rejects.toThrow(/ORIGINAL_NOT_PUBLISHED_YET/);
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
    // PENDING means "not rendered yet" and would shadow the /pos dialog.
    expect(setup.prisma.telegramPublication.update).toHaveBeenCalledWith({
      where: { id: "pub1" },
      data: { publicationStatus: "RETRY_PENDING" },
    });
    expect(setup.renders.deleteArtifact).not.toHaveBeenCalled();
  });

  it("keeps an already-held row at RETRY_PENDING", async () => {
    const setup = okSetup();
    (setup.prisma.telegramPublication.findUnique as jest.Mock).mockResolvedValue({
      id: "pub1",
      publicationStatus: "RETRY_PENDING",
      createdAt: new Date(),
    });
    const svc = service(setup);
    await expect(
      svc.sendPublication("pub1", sendInput({ status: "tp", replyToMessageId: undefined })),
    ).rejects.toThrow(/ORIGINAL_NOT_PUBLISHED_YET/);
    expect(setup.prisma.telegramPublication.update).not.toHaveBeenCalled();
  });

  it("self-heals the reply target when the original published late", async () => {
    const setup = okSetup();
    (setup.prisma.telegramPublication.findFirst as jest.Mock).mockResolvedValueOnce({
      telegramMessageId: "555",
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "tp", replyToMessageId: undefined }));
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(sendArgs.replyToMessageId).toBe("555");
  });

  it("posts orphaned past the hold timeout with audit", async () => {
    const audit = { record: jest.fn(async () => ({})) };
    const setup = okSetup();
    (setup.prisma.telegramPublication.findUnique as jest.Mock).mockResolvedValueOnce({
      id: "pub1",
      publicationStatus: "PENDING",
      createdAt: new Date(Date.now() - 10 * 60 * 1000),
    });
    const svc = service({ ...setup, audit });
    await svc.sendPublication("pub1", sendInput({ status: "sl", replyToMessageId: undefined }));
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(sendArgs.replyToMessageId).toBeUndefined();
    expect(audit.record).toHaveBeenCalledWith(
      "alice",
      "publication.orphaned",
      expect.objectContaining({ publicationId: "pub1" }),
    );
  });

  it("uses BullMQ-safe job ids without colons", async () => {
    const { RENDER_JOB_ID_PREFIX, SEND_JOB_ID_PREFIX } = await import("./renders.service");
    for (const prefix of [RENDER_JOB_ID_PREFIX, SEND_JOB_ID_PREFIX]) {
      expect(prefix).not.toContain(":");
      expect(`${prefix}pub1`).not.toContain(":");
    }
  });

  it("falls back to the t.me link when Telegram stores no URL", async () => {
    const setup = okSetup();
    (setup.prisma.sourceMessage.findUnique as jest.Mock).mockResolvedValueOnce({
      sourceUrl: null,
      externalMessageId: "4375",
      source: { platform: "TELEGRAM", externalSourceId: "traderosho" },
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput());
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(String(sendArgs.caption)).toContain("https://t.me/traderosho/4375");
  });

  it("still rejects X posts without any URL", async () => {
    const setup = okSetup();
    (setup.prisma.sourceMessage.findUnique as jest.Mock).mockResolvedValueOnce({
      sourceUrl: null,
      externalMessageId: "abc",
      source: { platform: "X", externalSourceId: "watcher" },
    });
    const svc = service(setup);
    await expect(svc.sendPublication("pub1", sendInput())).rejects.toThrow(/missing required source_url/);
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
    expect(setup.renders.deleteArtifact).not.toHaveBeenCalled();
  });

  it("allows operator MANUAL signals without any URL", async () => {
    const setup = okSetup();
    (setup.prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValueOnce({
      ...POSITION,
      signal: {
        sourceId: "src-op",
        versions: [{ direction: "LONG", normalizedPayloadJson: { sourceMessageId: "m-op" } }],
        source: { displayName: "Operator (manual)" },
      },
    });
    (setup.prisma.sourceMessage.findUnique as jest.Mock).mockResolvedValueOnce({
      sourceUrl: null,
      externalMessageId: "op-1",
      source: { platform: "MANUAL", externalSourceId: "operator", sourceKind: "MANUAL", displayName: "Operator (manual)" },
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput());
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(String(sendArgs.caption)).not.toContain("http");
    expect(String(sendArgs.caption)).toContain("Operator (manual)");
  });

  it("shows a custom channel name and the post link for /pos signals", async () => {
    const setup = okSetup();
    (setup.prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValueOnce({
      ...POSITION,
      signal: {
        sourceId: "src-kaka",
        versions: [{ direction: "LONG", normalizedPayloadJson: { sourceMessageId: "m-op" } }],
        source: { displayName: "Kaka trades" },
      },
    });
    (setup.prisma.sourceMessage.findUnique as jest.Mock).mockResolvedValueOnce({
      sourceUrl: "https://t.me/c/3763643270/431",
      externalMessageId: "op-1",
      source: { platform: "MANUAL", externalSourceId: "kaka trades", sourceKind: "MANUAL", displayName: "Kaka trades" },
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput());
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const caption = String(sendArgs.caption);
    expect(caption).toContain("Kaka trades");
    expect(caption).toContain("https://t.me/c/3763643270/431");
    // Name line comes before the link line, like the reference format.
    expect(caption.indexOf("Kaka trades")).toBeLessThan(caption.indexOf("https://"));
  });

  it("lets the worker resolve the live mark when the open card omits markPrice", async () => {
    const setup = okSetup();
    const requestRender = jest.fn(async () => ({ id: "render-pub1" }));
    const svc = service({
      ...setup,
      config: { reportDestinationChatId: "@chan" },
      renders: { ...setup.renders, requestRender },
    });
    await svc.requestPositionPublish("pos1", "filled", {}, "alice");
    const data = (requestRender as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(data).not.toHaveProperty("markPrice");
  });

  it("notes the entry ladder on a DCA fill card and reads the status as filled", async () => {
    const setup = okSetup();
    (setup.prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue({
      ...POSITION,
      entries: [
        { price: 2500, notional: 100000 },
        { price: 2450, notional: 50000 },
      ],
      pendingEntries: [{ price: 2450, notional: 50000 }],
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "entry" }));
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const caption = String(sendArgs.caption);
    expect(caption).toContain("- Entry: 2500 (đã khớp 1/2 lệnh)");
    // Template vocabulary stays limit/filled/tp/sl/close.
    expect(caption).toContain("Long ETH - filled");
    expect(caption).not.toContain("Long ETH - entry");
  });

  it("keeps a single-entry caption clean", async () => {
    const setup = okSetup();
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput());
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(String(sendArgs.caption)).toContain("- Entry: 2500\n");
    expect(String(sendArgs.caption)).not.toContain("đã khớp");
  });

  it("renders an entry-fill snapshot as open", async () => {
    const setup = okSetup();
    const svc = service(setup);
    const { snapshot } = await svc.buildSnapshot("pos1", 2550, { status: "entry" });
    expect(snapshot.status).toBe("OPEN");
  });

  function tpSetup(filledTps: number[]) {
    const setup = okSetup();
    (setup.prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue({
      ...POSITION,
      filledTps,
      signal: {
        ...POSITION.signal,
        versions: [
          {
            direction: "LONG",
            takeProfits: [2600, 2700],
            normalizedPayloadJson: { sourceMessageId: "m1" },
          },
        ],
      },
    });
    return setup;
  }

  function captionOf(setup: ReturnType<typeof okSetup>): string {
    const sendArgs = (setup.sender.sendPhoto as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    return String(sendArgs.caption);
  }

  it("lists every TP on a card where nothing hit yet", async () => {
    const setup = tpSetup([]);
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput());
    const caption = captionOf(setup);
    expect(caption).toContain("- TP: 2600, 2700");
    expect(caption).not.toContain("đã khớp TP");
  });

  it("marks the TP that already hit inside the list", async () => {
    const setup = tpSetup([2600]);
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "tp" }));
    expect(captionOf(setup)).toContain("- TP: 2600 (đã khớp TP1), 2700");
  });

  it("marks every TP that hit when several are filled", async () => {
    const setup = tpSetup([2600, 2700]);
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "tp" }));
    expect(captionOf(setup)).toContain("- TP: 2600 (đã khớp TP1), 2700 (đã khớp TP2)");
  });

  it("marks the TP a tp card is about even though the slice closes after the send", async () => {
    // Settle publishes before it closes the slice: filledTps is still empty
    // at send time, the ordinal comes from the job instead.
    const setup = tpSetup([]);
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "tp", tpIndex: 0 }));
    expect(captionOf(setup)).toContain("- TP: 2600 (đã khớp TP1), 2700");
  });

  it("marks by ordinal so duplicate TP prices never cross-annotate", async () => {
    const setup = okSetup();
    (setup.prisma.virtualPosition.findUnique as jest.Mock).mockResolvedValue({
      ...POSITION,
      filledTps: [2600],
      signal: {
        ...POSITION.signal,
        versions: [
          {
            direction: "LONG",
            takeProfits: [2600, 2600],
            normalizedPayloadJson: { sourceMessageId: "m1" },
          },
        ],
      },
    });
    const svc = service(setup);
    await svc.sendPublication("pub1", sendInput({ status: "entry" }));
    // Only the first level is annotated — a value match would tag both.
    expect(captionOf(setup)).toContain("- TP: 2600 (đã khớp TP1), 2600");
    expect(captionOf(setup)).not.toContain("2600 (đã khớp TP2)");
  });

  it("forwards volume/open overrides for manual exit cards", async () => {
    const setup = okSetup();
    const requestRender = jest.fn(async () => ({ id: "render-pub1" }));
    const svc = service({
      ...setup,
      config: { reportDestinationChatId: "@chan" },
      renders: { ...setup.renders, requestRender },
    });
    await svc.requestPositionPublish(
      "pos1",
      "tp",
      { markPrice: 2600, volume: 12.5, open: true },
      "alice",
    );
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 12.5, open: true, status: "tp" }),
      "alice",
      "render-pub1",
    );
  });

  it("enqueues a render job instead of publishing inline", async () => {
    const setup = okSetup();
    const requestRender = jest.fn(async () => ({ id: "render-pub1" }));
    const svc = service({
      ...setup,
      config: { reportDestinationChatId: "@chan" },
      renders: { ...setup.renders, requestRender },
    });
    const result = await svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice");
    expect(result).toEqual({ publicationId: "pub1", status: "PENDING", cardKind: "pnl-strip" });
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({
        virtualPositionId: "pos1",
        markPrice: 2550,
        publicationId: "pub1",
        status: "filled",
        destinationChatId: "@chan",
        actor: "alice",
        cardKind: "pnl-strip",
      }),
      "alice",
      "render-pub1",
    );
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
  });
});

describe("PublicationsService card styles", () => {
  function styleSetup(position: Record<string, unknown> = {}) {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({ cardKind: "pnl-strip", size: 1, ...position })),
        update: jest.fn(async (args: unknown) => args),
      },
      telegramPublication: {
        create: jest.fn(async () => ({ id: "pub1" })),
        findFirst: jest.fn(async () => null),
      },
    };
    const requestRender = jest.fn(async () => ({ id: "render-pub1" }));
    const promoteRender = jest.fn(async () => "promoted");
    const audit = { record: jest.fn(async () => ({})) };
    const svc = service({
      prisma,
      audit,
      config: { reportDestinationChatId: "@chan" },
      renders: { requestRender, promoteRender, readArtifact: jest.fn() },
    });
    return { svc, prisma, requestRender, promoteRender, audit };
  }

  it("persists the chosen card kind on the position and renders it", async () => {
    const { svc, prisma, requestRender } = styleSetup();
    const result = await svc.requestPositionPublish(
      "pos1",
      "filled",
      { markPrice: 2550, cardKind: "position-stats" },
      "alice",
    );
    expect(result.cardKind).toBe("position-stats");
    expect(prisma.virtualPosition.update).toHaveBeenCalledWith({
      where: { id: "pos1" },
      data: { cardKind: "position-stats" },
    });
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ cardKind: "position-stats" }),
      "alice",
      "render-pub1",
    );
  });

  it("inherits the position's stored kind for update cards (TP/SL)", async () => {
    const { svc, prisma, requestRender } = styleSetup({ cardKind: "position-stats" });
    await svc.requestPositionPublish("pos1", "tp", { markPrice: 2600 }, "alice");
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ cardKind: "position-stats", status: "tp" }),
      "alice",
      "render-pub1",
    );
  });

  it("falls back to the pnl-strip default for legacy rows", async () => {
    const { svc, requestRender } = styleSetup({ cardKind: undefined });
    await svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice");
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ cardKind: "pnl-strip" }),
      "alice",
      "render-pub1",
    );
  });

  it("delays the render job for the /pos style dialog", async () => {
    const { svc, requestRender } = styleSetup();
    await svc.requestPositionPublish(
      "pos1",
      "filled",
      { markPrice: 2550, renderDelayMs: 300_000 },
      "alice",
    );
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ delayMs: 300_000 }),
      "alice",
      "render-pub1",
    );
  });

  it("freezes the position size onto the render job", async () => {
    const { svc, requestRender } = styleSetup({ size: 3 });
    await svc.requestPositionPublish("pos1", "filled", { markPrice: 2550 }, "alice");
    expect(requestRender).toHaveBeenCalledWith(
      expect.objectContaining({ volume: 3 }),
      "alice",
      "render-pub1",
    );
  });
});

describe("PublicationsService.buildSnapshot stats extras", () => {
  it("computes leverage, margin type, account name and liquidation price", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({
          ...POSITION,
          account: { name: "Vinh cuu", marginType: "CROSS", balance: 125 },
        })),
        findMany: jest.fn(async () => [{ ...POSITION, remainingSize: 0.5 }]),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({
      prisma,
      marketData: { getAllMids: jest.fn(async () => ({ ETH: 2550 })) },
    });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550);
    expect(snapshot.leverage).toBe(10);
    expect(snapshot.marginType).toBe("CROSS");
    expect(snapshot.accountName).toBe("Vinh cuu");
    expect(snapshot.maintenanceMarginRate).toBeCloseTo(0.005, 9);
    // Maintenance 0.5 x 2550 x 0.5% / equity (125 + 25).
    expect(snapshot.accountMarginRatio).toBeCloseTo(0.0425, 9);
    // PnL is anchored to entry × size, never a broker-reported float.
    expect(snapshot.floatingProfit).toBeCloseTo((2550 - 2500) * 0.5, 6);
    // Cross LONG: (125 − 0.5×2500) / (0.5×(0.005 − 1)).
    expect(snapshot.liquidationPrice).toBeCloseTo(2261.3065, 4);
  });

  it("leaves stats extras null without an account", async () => {
    const prisma = {
      virtualPosition: { findUnique: jest.fn(async () => ({ ...POSITION, account: undefined })) },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({ prisma });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550);
    expect(snapshot.marginType).toBeNull();
    expect(snapshot.accountName).toBeNull();
    expect(snapshot.accountMarginRatio).toBeNull();
    expect(snapshot.liquidationPrice).toBeNull();
  });

  it("sets the account ratio to null when a coin mark is missing", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({
          ...POSITION,
          account: { name: "Vinh cuu", marginType: "CROSS", balance: 10000 },
        })),
        findMany: jest.fn(async () => [{ ...POSITION, coin: "BTC" }]),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({
      prisma,
      marketData: { getAllMids: jest.fn(async () => ({})) },
    });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550);
    expect(snapshot.accountMarginRatio).toBeNull();
  });

  it("keeps the ratio self-consistent when the card's position already closed", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({
          ...POSITION,
          remainingSize: 0,
          status: "CLOSED",
          account: { name: "Vinh cuu", marginType: "CROSS", balance: 10000 },
        })),
        // No open positions left in the account.
        findMany: jest.fn(async () => []),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({
      prisma,
      marketData: { getAllMids: jest.fn(async () => ({ ETH: 2550 })) },
    });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550, { status: "sl" });
    // Frozen size 0.5 is still counted: 0.5 × 2550 × 0.5% / (10000 + 25).
    expect(snapshot.accountMarginRatio).toBeCloseTo(0.0006359, 6);
  });

  it("sums tiered maintenance across all open positions", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({
          ...POSITION,
          account: { name: "Vinh cuu", marginType: "CROSS", balance: 10000 },
        })),
        findMany: jest.fn(async () => [
          {
            ...POSITION,
            id: "pos2",
            coin: "BTC",
            size: 1,
            remainingSize: 1,
            entryPrice: 50000,
          },
        ]),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({
      prisma,
      marketData: { getAllMids: jest.fn(async () => ({ ETH: 2550, BTC: 51000 })) },
    });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550);
    // ETH MM 6.375 + BTC MM 255 = 261.375; equity = 10000 + 25 + 1000.
    expect(snapshot.accountMarginRatio).toBeCloseTo(261.375 / 11025, 9);
  });

  it("renders the open card from the frozen size, not live remaining size", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({ ...POSITION, size: 5, remainingSize: 0 })),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({ prisma });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550, { status: "filled", volume: 5 });
    expect(snapshot.volume).toBe(5);
    expect(snapshot.status).toBe("OPEN");
  });

  it("renders tp/sl/close cards as CLOSED", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({ ...POSITION, size: 5, remainingSize: 0 })),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({ prisma });
    const { snapshot } = await svc.buildSnapshot("pos1", 2600, { status: "sl" });
    expect(snapshot.status).toBe("CLOSED");
    expect(snapshot.volume).toBe(5);
  });

  it("keeps a partial manual exit snapshot OPEN when asked", async () => {
    const prisma = {
      virtualPosition: {
        findUnique: jest.fn(async () => ({ ...POSITION, size: 5, remainingSize: 3 })),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({ prisma });
    const { snapshot } = await svc.buildSnapshot("pos1", 2600, {
      status: "tp",
      volume: 3,
      open: true,
    });
    expect(snapshot.status).toBe("OPEN");
    expect(snapshot.volume).toBe(3);
  });
});

describe("PublicationsService.listRecentFailures", () => {
  it("maps recent FINAL_FAILURE publications for operator notices", async () => {
    const findMany = jest.fn(async () => [
      {
        id: "pub1",
        virtualPositionId: "pos1",
        renderedText: "POSITION_NOT_OPEN",
        position: { coin: "ETH" },
      },
    ]);
    const svc = service({ prisma: { telegramPublication: { findMany } } });
    await expect(svc.listRecentFailures(600_000)).resolves.toEqual([
      { publicationId: "pub1", positionId: "pos1", coin: "ETH", reason: "POSITION_NOT_OPEN" },
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ publicationStatus: "FINAL_FAILURE" }),
      }),
    );
  });
});

describe("PublicationsService.chooseCardStyle", () => {
  function dialogSetup(promoteOutcome: "promoted" | "expired", publications: Array<{ id: string }>) {
    const prisma = {
      virtualPosition: { update: jest.fn(async (args: unknown) => args) },
      telegramPublication: {
        findFirst: jest.fn(async () => null),
        findMany: jest.fn(async () => publications),
      },
    };
    const promoteFirstDelayed = jest.fn(async () => ({
      publicationId: promoteOutcome === "promoted" ? (publications[0]?.id ?? null) : null,
      outcome: promoteOutcome,
    }));
    const svc = service({
      prisma,
      config: { reportDestinationChatId: "@chan" },
      renders: { promoteFirstDelayed, readArtifact: jest.fn(), deleteArtifact: jest.fn(async () => undefined) },
    });
    return { svc, prisma, promoteFirstDelayed };
  }

  it("offers every pending publication, newest first (TP card shadows the dialog)", async () => {
    const { svc, prisma, promoteFirstDelayed } = dialogSetup("promoted", [
      { id: "tp-pub" },
      { id: "dialog-pub" },
    ]);
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("promoted");
    expect(prisma.telegramPublication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          virtualPositionId: "pos1",
          publicationStatus: { in: ["PENDING", "RETRY_PENDING"] },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
    expect(promoteFirstDelayed).toHaveBeenCalledWith(
      ["tp-pub", "dialog-pub"],
      "position-stats",
      "alice",
    );
    expect(prisma.virtualPosition.update).toHaveBeenCalledWith({
      where: { id: "pos1" },
      data: { cardKind: "position-stats" },
    });
  });

  it("reports expired when no pending publication is waiting", async () => {
    const { svc, prisma, promoteFirstDelayed } = dialogSetup("promoted", []);
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("expired");
    expect(promoteFirstDelayed).not.toHaveBeenCalled();
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
  });

  it("does not persist the kind when promotion is refused", async () => {
    const { svc, prisma } = dialogSetup("expired", [{ id: "tp-pub" }]);
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("expired");
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
  });
});

describe("PublicationsService.markSendFailed", () => {
  function failedSetup(status: string) {
    const prisma = {
      telegramPublication: {
        findUnique: jest.fn(async () => ({ id: "pub1", publicationStatus: status })),
        update: jest.fn(async (args: unknown) => args),
      },
    };
    const audit = { record: jest.fn(async () => ({})) };
    const svc = service({ prisma, audit });
    return { svc, prisma, audit };
  }

  it("turns exhausted send retries into a FINAL_FAILURE the bot can sweep", async () => {
    const { svc, prisma, audit } = failedSetup("RETRY_PENDING");
    await svc.markSendFailed("pub1", "ORIGINAL_NOT_PUBLISHED_YET: retryable", "worker");
    expect(prisma.telegramPublication.update).toHaveBeenCalledWith({
      where: { id: "pub1" },
      data: { publicationStatus: "FINAL_FAILURE", renderedText: "ORIGINAL_NOT_PUBLISHED_YET" },
    });
    expect(audit.record).toHaveBeenCalledWith("worker", "publication.failed", {
      publicationId: "pub1",
      reason: "ORIGINAL_NOT_PUBLISHED_YET",
    });
  });

  it("never downgrades an already published card", async () => {
    const { svc, prisma, audit } = failedSetup("PUBLISHED");
    await svc.markSendFailed("pub1", "TELEGRAM_429: slow down", "worker");
    expect(prisma.telegramPublication.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe("PublicationsService.styleDialogRemainingMs", () => {
  function holdSetup(rows: Array<{ id: string }>, remaining: number) {
    const prisma = {
      telegramPublication: { findMany: jest.fn(async () => rows) },
    };
    const dialogRemainingMs = jest.fn(async () => remaining);
    const svc = service({ prisma, renders: { dialogRemainingMs, readArtifact: jest.fn(), deleteArtifact: jest.fn(async () => undefined) } });
    return { svc, prisma, dialogRemainingMs };
  }

  it("returns 0 when the position has no pending publication", async () => {
    const { svc, dialogRemainingMs } = holdSetup([], 99_999);
    await expect(svc.styleDialogRemainingMs("pos1")).resolves.toBe(0);
    expect(dialogRemainingMs).not.toHaveBeenCalled();
  });

  it("asks the renderer how long the dialog still has left", async () => {
    const { svc, prisma, dialogRemainingMs } = holdSetup([{ id: "pub1" }, { id: "pub2" }], 12_345);
    await expect(svc.styleDialogRemainingMs("pos1")).resolves.toBe(12_345);
    expect(prisma.telegramPublication.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { virtualPositionId: "pos1", publicationStatus: "PENDING" },
      }),
    );
    expect(dialogRemainingMs).toHaveBeenCalledWith(["pub1", "pub2"]);
  });
});
