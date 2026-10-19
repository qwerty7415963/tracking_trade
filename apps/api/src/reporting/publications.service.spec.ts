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
    virtualPosition: { findUnique: jest.fn() },
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
      sendInput({ status: "tp", markPrice: 2600, replyToMessageId: "111" }),
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

  it("holds an update while the original is fresh", async () => {
    const setup = okSetup();
    const svc = service(setup);
    await expect(
      svc.sendPublication("pub1", sendInput({ status: "tp", replyToMessageId: undefined })),
    ).rejects.toThrow(/ORIGINAL_NOT_PUBLISHED_YET/);
    expect(setup.sender.sendPhoto).not.toHaveBeenCalled();
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
          account: { name: "Vinh cưu", marginType: "CROSS" },
        })),
      },
      sourceMessage: { findUnique: jest.fn(async () => null) },
    };
    const svc = service({ prisma });
    const { snapshot } = await svc.buildSnapshot("pos1", 2550);
    expect(snapshot.leverage).toBe(10);
    expect(snapshot.marginType).toBe("CROSS");
    expect(snapshot.accountName).toBe("Vinh cưu");
    // LONG entry 2500 lev 10 mmr 0.01 → 2500 × (1 − (0.1 − 0.01)).
    expect(snapshot.liquidationPrice).toBeCloseTo(2275, 6);
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
    expect(snapshot.liquidationPrice).toBeCloseTo(2275, 6);
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
  function dialogSetup(promoteResult: string, publication: unknown) {
    const prisma = {
      virtualPosition: { update: jest.fn(async (args: unknown) => args) },
      telegramPublication: { findFirst: jest.fn(async () => publication) },
    };
    const promoteRender = jest.fn(async () => promoteResult);
    const svc = service({
      prisma,
      config: { reportDestinationChatId: "@chan" },
      renders: { promoteRender, readArtifact: jest.fn() },
    });
    return { svc, prisma, promoteRender };
  }

  it("promotes the delayed render and persists the choice", async () => {
    const { svc, prisma, promoteRender } = dialogSetup("promoted", { id: "pub9" });
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("promoted");
    expect(promoteRender).toHaveBeenCalledWith("pub9", "position-stats", "alice");
    expect(prisma.virtualPosition.update).toHaveBeenCalledWith({
      where: { id: "pos1" },
      data: { cardKind: "position-stats" },
    });
  });

  it("reports expired when no pending publication is waiting", async () => {
    const { svc, prisma, promoteRender } = dialogSetup("promoted", null);
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("expired");
    expect(promoteRender).not.toHaveBeenCalled();
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
  });

  it("does not persist the kind when promotion is refused", async () => {
    const { svc, prisma } = dialogSetup("expired", { id: "pub9" });
    await expect(svc.chooseCardStyle("pos1", "position-stats", "alice")).resolves.toBe("expired");
    expect(prisma.virtualPosition.update).not.toHaveBeenCalled();
  });
});
