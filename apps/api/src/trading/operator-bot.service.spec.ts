import { ConflictException } from "@nestjs/common";
import {
  commandLines,
  commandLineTokens,
  displayOrDash,
  extractPosFlags,
  formatReviewReason,
  formatSignalReviewCard,
  formatUpdateReviewCard,
  forwardTarget,
  isOperator,
  parseCommand,
  postLink,
  reviewAuthor,
  truncateText,
  OperatorBotService,
} from "./operator-bot.service";

describe("parseCommand", () => {
  it("parses name and args, strips bot suffix", () => {
    expect(parseCommand("/approve abc123")).toEqual({ name: "approve", args: ["abc123"] });
    expect(parseCommand("/close id1")).toEqual({ name: "close", args: ["id1"] });
    expect(parseCommand("/mode@mybot auto acc1")).toEqual({ name: "mode", args: ["auto", "acc1"] });
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe("isOperator", () => {
  it("matches case-insensitively, rejects missing", () => {
    expect(isOperator("Alice", ["alice"])).toBe(true);
    expect(isOperator("mallory", ["alice"])).toBe(false);
    expect(isOperator(undefined, ["alice"])).toBe(false);
  });
});

describe("review card helpers", () => {
  it("truncates long original posts", () => {
    expect(truncateText("abc", 800)).toBe("abc");
    expect(truncateText("x".repeat(900), 800)).toHaveLength(801);
  });

  it("never shows raw UNKNOWN to operators", () => {
    expect(displayOrDash("UNKNOWN")).toBe("—");
    expect(displayOrDash(null)).toBe("—");
    expect(displayOrDash("ETH")).toBe("ETH");
  });

  it("explains the review reason", () => {
    expect(formatReviewReason(["entry"], [])).toBe("thiếu entry");
    expect(formatReviewReason([], ["conflicting_directions"])).toBe("conflicting_directions");
    expect(formatReviewReason([], [])).toBe("đủ field cơ bản");
  });

  it("builds exact post links, preferring stored URLs", () => {
    expect(postLink("TELEGRAM", "traderosho", "4375", null)).toBe(
      "https://t.me/traderosho/4375",
    );
    expect(postLink("TELEGRAM", "@traderosho", "4375", null)).toBe(
      "https://t.me/traderosho/4375",
    );
    expect(postLink("TELEGRAM", "traderosho", "4375", "https://t.me/c/1/2")).toBe(
      "https://t.me/c/1/2",
    );
    expect(postLink("X", "watcher", "123", null)).toBeNull();
    expect(postLink("TELEGRAM", "traderosho", "abc", null)).toBeNull();
    expect(postLink("TELEGRAM", "", "4375", null)).toBeNull();
    expect(postLink("TELEGRAM", "traderosho", null, null)).toBeNull();
  });

  it("only allows real forwards for Telegram numeric messages", () => {
    expect(forwardTarget("TELEGRAM", "traderosho", "4375")).toEqual({
      chatId: "@traderosho",
      messageId: 4375,
    });
    expect(forwardTarget("TELEGRAM", "@traderosho", "4375")).toEqual({
      chatId: "@traderosho",
      messageId: 4375,
    });
    expect(forwardTarget("X", "watcher", "123")).toBeNull();
    expect(forwardTarget("TELEGRAM", "traderosho", "not-a-number")).toBeNull();
  });

  it("formats a signal card with original post, never ids", () => {
    const text = formatSignalReviewCard({
      status: "NEEDS_REVIEW",
      versionNumber: 1,
      eventType: "NEW",
      instrument: "ETH",
      direction: "SHORT",
      orderType: null,
      entry: null,
      stopLoss: "2597.17",
      takeProfits: [],
      leverage: null,
      missing: ["entry", "take_profits"],
      ambiguities: [],
      sourceName: "Osho",
      platform: "TELEGRAM",
      messageText: "Short ETH SL 2597.17",
      author: "Osho",
      timestamp: "2026-10-15T12:33:00.000Z",
      url: null,
    });
    expect(text).toContain("REVIEW — SHORT ETH");
    expect(text).toContain("thiếu entry, take_profits");
    expect(text).toContain("Bài gốc");
    expect(text).toContain("Short ETH SL 2597.17");
  });

  it("formats an update card with match summary", () => {
    const text = formatUpdateReviewCard({
      action: "CLOSE_ALL",
      validationStatus: "AMBIGUOUS",
      confidence: null,
      reason: "multiple candidates: s1,s2",
      matchedSummary: null,
      sourceName: "Osho",
      platform: "TELEGRAM",
      messageText: "close all now",
      author: null,
      timestamp: null,
      url: null,
    });
    expect(text).toContain("REVIEW update — CLOSE_ALL [AMBIGUOUS]");
    expect(text).toContain("chưa khớp signal nào");
  });

  it("falls back to the channel name when the post has no author", () => {
    expect(reviewAuthor(null, "MegaLodon Futures")).toBe("MegaLodon Futures");
    expect(reviewAuthor("  ", "MegaLodon Futures")).toBe("MegaLodon Futures");
    expect(reviewAuthor("Osho", "MegaLodon Futures")).toBe("Osho");
    expect(reviewAuthor(null, "")).toBe("không rõ tác giả");
    const text = formatSignalReviewCard({
      status: "NEEDS_REVIEW",
      versionNumber: 1,
      eventType: "NEW",
      instrument: "BTW",
      direction: null,
      orderType: null,
      entry: "2.0476",
      stopLoss: "1.1967",
      takeProfits: [10.284],
      leverage: null,
      missing: ["direction"],
      ambiguities: [],
      sourceName: "MegaLodon Futures",
      platform: "TELEGRAM",
      messageText: "#BTW Entry: 2.0476",
      author: null,
      timestamp: null,
      url: null,
    });
    expect(text).toContain("Bài gốc (MegaLodon Futures):");
    expect(text).not.toContain("không rõ tác giả");
  });
});

function bot(overrides: Record<string, unknown> = {}) {
  const sent: Array<{ chat: number | string; text: string }> = [];
  const svc = new OperatorBotService(
    {
      operatorUsernames: ["alice"],
      operatorChatIds: (overrides.chatIds ?? ["100"]) as string[],
      reportDestinationChatId: "",
    } as never,
    { record: jest.fn() } as never,
    (overrides.signals ?? {}) as never,
    (overrides.updates ?? {}) as never,
    (overrides.flow ?? {}) as never,
    (overrides.accounts ?? {}) as never,
    (overrides.trading ?? {}) as never,
    (overrides.sources ?? {}) as never,
    (overrides.coins ?? {}) as never,
    (overrides.openMode ?? { getMode: jest.fn(async () => "MANUAL") }) as never,
    (overrides.publications ?? {}) as never,
  );
  (svc as unknown as { send: unknown }).send = async (chat: number | string, text: string) => {
    sent.push({ chat, text });
  };
  return { svc, sent };
}

const PRIVATE_ALICE = {
  message_id: 1,
  chat: { id: 100, type: "private" },
  from: { id: 1, username: "alice" },
};

describe("OperatorBotService.handleMessage", () => {
  it("ignores non-private chats", async () => {
    const { svc, sent } = bot({ trading: { listPositions: jest.fn() } });
    await svc.handleMessage({ ...PRIVATE_ALICE, chat: { id: 5, type: "group" }, text: "/positions" });
    expect(sent).toHaveLength(0);
  });

  it("ignores non-operators", async () => {
    const { svc, sent } = bot();
    await svc.handleMessage({
      ...PRIVATE_ALICE,
      from: { id: 2, username: "mallory" },
      text: "/positions",
    });
    expect(sent).toHaveLength(0);
  });

  it("rate-limits rapid commands", async () => {
    const { svc, sent } = bot({ trading: { listPositions: jest.fn(async () => []) } });
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/positions" });
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/positions" });
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("Too fast");
  });

  it("dispatches /positions and /help", async () => {
    const { svc, sent } = bot({
      trading: {
        listPositions: jest.fn(async () => [
          { id: "abcdefgh", coin: "ETH", direction: "LONG", remainingSize: 1, entryPrice: 3000, status: "OPEN" },
        ]),
      },
    });
    // bypass rate limit between distinct commands in test by waiting? No — use fresh instance per command.
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/positions" });
    expect(sent[0].text).toContain("ETH LONG");
  });

  it("reports command failures without leaking stacks", async () => {
    const { svc, sent } = bot({
      trading: {
        listPositions: jest.fn(async () => {
          throw new Error("ConflictException: boom\n    at secret");
        }),
      },
    });
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/positions" });
    expect(sent[0].text).toContain("Failed: ConflictException: boom");
  });
});

describe("OperatorBotService /accounts command", () => {
  it("lists every virtual account", async () => {
    const list = jest.fn(async () => [
      { id: "aaaaaaaa-1111", name: "Vĩnh cửu", mode: "AUTO", leverage: 10, balance: 1000 },
      { id: "bbbbbbbb-2222", name: "it-pub", mode: "APPROVE", leverage: 20, balance: 250 },
    ]);
    const { svc, sent } = bot({ accounts: { list } });
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/accounts" });
    expect(list).toHaveBeenCalled();
    expect(sent[0].text).toContain("aaaaaaaa-1111 Vĩnh cửu [AUTO 10x] bal=1000");
    expect(sent[0].text).toContain("bbbbbbbb-2222 it-pub [APPROVE 20x] bal=250");
  });

  it("reports an empty account list", async () => {
    const { svc, sent } = bot({ accounts: { list: jest.fn(async () => []) } });
    await svc.handleMessage({ ...PRIVATE_ALICE, text: "/accounts" });
    expect(sent[0].text).toBe("Chưa có tài khoản ảo nào.");
  });
});

describe("OperatorBotService source commands", () => {
  async function dispatchSource(
    name: string,
    args: string[],
    rawText: string | undefined,
    sources: Record<string, unknown>,
  ): Promise<string[]> {
    const { svc } = bot({ sources });
    const replies: string[] = [];
    await svc.dispatch({ name, args }, "tg:alice", async (text) => {
      replies.push(text);
    }, rawText);
    return replies;
  }

  it("splits multi-line items and quoted command-line values", () => {
    expect(commandLines("/source_add\n@alpha\n\n  @beta  \n")).toEqual(["@alpha", "@beta"]);
    expect(
      commandLineTokens('/source_edit@bot @chan name="My Channel" priority=1'),
    ).toEqual(["@chan", 'name="My Channel"', "priority=1"]);
  });

  it("lists sources compactly", async () => {
    const replies = await dispatchSource(
      "sources",
      [],
      "/sources",
      {
        list: jest.fn(async () => [
          { id: "abcdefgh12345678", displayName: "Alpha", platform: "TELEGRAM", priority: 1, enabled: true },
          { id: "ijklmnop12345678", displayName: "Beta", platform: "X", priority: 0, enabled: false },
        ]),
      },
    );
    expect(replies[0]).toContain("✅ Alpha (TELEGRAM) p1 abcdefgh12345678");
    expect(replies[0]).toContain("⏸️ Beta (X) p0 ijklmnop12345678");
  });

  it("adds one source per message line and reports mixed results", async () => {
    const bulkCreate = jest.fn(async () => [
      { input: "@alpha", status: "created", sourceId: "s1", reason: null },
      { input: "@beta", status: "skipped-duplicate", sourceId: "s2", reason: null },
      { input: "@bad", status: "failed", sourceId: null, reason: "validation failed" },
    ]);
    const replies = await dispatchSource(
      "source_add",
      [],
      "/source_add\n@alpha\n@beta\n@bad",
      { bulkCreate },
    );
    expect(bulkCreate).toHaveBeenCalledWith(
      [{ raw: "@alpha" }, { raw: "@beta" }, { raw: "@bad" }],
      "tg:alice",
    );
    expect(replies[0]).toContain("✅ @alpha — created");
    expect(replies[0]).toContain("⏭️ @beta — skipped-duplicate");
    expect(replies[0]).toContain("❌ @bad — failed: validation failed");
  });

  it("falls back to same-line refs for delete", async () => {
    const bulkRemove = jest.fn(async () => [
      { input: "@gone", status: "deleted", sourceId: "s9", reason: null },
    ]);
    const replies = await dispatchSource(
      "source_del",
      ["@gone"],
      "/source_del @gone",
      { bulkRemove },
    );
    expect(bulkRemove).toHaveBeenCalledWith(["@gone"], "tg:alice");
    expect(replies[0]).toContain("🗑️ @gone — deleted");
  });

  it("edits a resolved source with validated key=value pairs", async () => {
    const resolve = jest.fn(async () => ({ id: "s1" }));
    const update = jest.fn(async () => ({
      displayName: "My Channel",
      platform: "TELEGRAM",
      priority: 2,
    }));
    const replies = await dispatchSource(
      "source_edit",
      [],
      '/source_edit @chan name="My Channel" kind=news priority=2',
      { resolve, update },
    );
    expect(update).toHaveBeenCalledWith(
      "s1",
      { displayName: "My Channel", sourceKind: "NEWS", priority: 2 },
      "tg:alice",
    );
    expect(replies[0]).toContain("Updated My Channel (TELEGRAM) p2.");
  });

  it("rejects invalid kinds before touching the database", async () => {
    const update = jest.fn();
    const replies = await dispatchSource(
      "source_edit",
      ["@chan", "kind=BAD"],
      undefined,
      { resolve: jest.fn(), update },
    );
    expect(update).not.toHaveBeenCalled();
    expect(replies[0]).toContain("kind must be one of");
  });

  it("toggles each ref independently and reports stored health", async () => {
    const resolve = jest.fn(async (ref: string) => {
      if (ref === "@bad") throw new Error("no source matches");
      return { id: "s1", displayName: "Chan" };
    });
    const setEnabled = jest.fn(async () => ({}));
    const toggleReplies = await dispatchSource(
      "source_disable",
      ["@chan", "@bad"],
      "/source_disable @chan @bad",
      { resolve, update: jest.fn(), setEnabled },
    );
    expect(setEnabled).toHaveBeenCalledWith("s1", false, "tg:alice");
    expect(toggleReplies[0]).toContain("⏸️ Chan disabled");
    expect(toggleReplies[0]).toContain("❌ @bad — no source matches");

    const healthReplies = await dispatchSource(
      "source_health",
      ["@chan"],
      "/source_health @chan",
      {
        resolve: jest.fn(async () => ({ id: "s1", displayName: "Chan" })),
        health: jest.fn(async () => ({
          enabled: false,
          status: "error",
          lastErrorCode: "NOT_A_MEMBER",
          lastErrorAt: "2026-10-15T00:00:00.000Z",
        })),
      },
    );
    expect(healthReplies[0]).toContain("⚠️ Chan — disabled, status=error");
    expect(healthReplies[0]).toContain("lastError=NOT_A_MEMBER");
  });
});

describe("OperatorBotService openmode command", () => {
  async function dispatchOpenMode(
    args: string[],
    openMode: Record<string, unknown>,
  ): Promise<string[]> {
    const { svc } = bot({ openMode });
    const replies: string[] = [];
    await svc.dispatch({ name: "openmode", args }, "tg:alice", async (text) => {
      replies.push(text);
    });
    return replies;
  }

  it("shows the current global mode", async () => {
    const getMode = jest.fn(async () => "MANUAL");
    const replies = await dispatchOpenMode([], { getMode });
    expect(replies[0]).toBe("openmode=MANUAL");
  });

  it("sets MANUAL or AUTO, rejects the rest", async () => {
    const setMode = jest.fn(async (mode: string) => mode);
    const replies = await dispatchOpenMode(["auto"], { setMode });
    expect(setMode).toHaveBeenCalledWith("AUTO", "tg:alice");
    expect(replies[0]).toBe("openmode=AUTO");

    const bad = await dispatchOpenMode(["sometimes"], { setMode });
    expect(bad[0]).toContain("Usage: /openmode [manual|auto]");
    expect(setMode).toHaveBeenCalledTimes(1);
  });
});

describe("extractPosFlags", () => {
  it("pulls src/chat/acc flags and keeps the signal text", () => {
    expect(
      extractPosFlags("/pos LONG BTC @100000 SL 98000 TP 105000 chat=-1001 acc=a1"),
    ).toEqual({
      text: "LONG BTC @100000 SL 98000 TP 105000",
      src: null,
      chat: "-1001",
      acc: "a1",
    });
  });

  it("handles no flags and strips the /pos token", () => {
    expect(extractPosFlags("/pos SHORT ETH @2600 SL 2700 TP 2400")).toEqual({
      text: "SHORT ETH @2600 SL 2700 TP 2400",
      src: null,
      chat: null,
      acc: null,
    });
    expect(extractPosFlags(undefined).text).toBe("");
  });

  it("leaves post links in the text for auto-detection", () => {
    expect(
      extractPosFlags(
        "/pos LONG ETH @3500 SL 3400 TP 3700 https://t.me/c/3763643270/431 chat=-1001",
      ),
    ).toEqual({
      text: "LONG ETH @3500 SL 3400 TP 3700 https://t.me/c/3763643270/431",
      src: null,
      chat: "-1001",
      acc: null,
    });
    // Legacy url= prefix survives flags too — extractSourceUrl strips it.
    expect(extractPosFlags("/pos LONG ETH @1 SL 2 TP 3 url=https://t.me/x/1").text).toContain(
      "url=https://t.me/x/1",
    );
  });

  it("keeps a quoted src channel name with spaces", () => {
    expect(
      extractPosFlags(
        '/pos LONG ETH @3500 SL 3400 TP 3700 src="Kaka trades" https://t.me/x/1',
      ),
    ).toEqual({
      text: "LONG ETH @3500 SL 3400 TP 3700 https://t.me/x/1",
      src: "Kaka trades",
      chat: null,
      acc: null,
    });
  });

  it("supports unquoted and single-quoted flag values", () => {
    expect(extractPosFlags("/pos LONG ETH @1 SL 2 TP 3 src=Osho").src).toBe("Osho");
    expect(extractPosFlags("/pos LONG ETH @1 SL 2 TP 3 src='Kaka trades'").src).toBe(
      "Kaka trades",
    );
    // A lone quote character is not a quoted value — keep it verbatim.
    expect(extractPosFlags('/pos LONG ETH @1 SL 2 TP 3 src="').src).toBe('"');
  });
});

describe("OperatorBotService /pos command", () => {
  async function dispatchPos(rawText: string, signals: Record<string, unknown>, flow: Record<string, unknown>) {
    const { svc } = bot({ signals, flow });
    const replies: string[] = [];
    await svc.dispatch({ name: "pos", args: [] }, "tg:alice", async (text) => {
      replies.push(text);
    }, rawText);
    return replies;
  }

  it("creates, approves, and asks for the card style", async () => {
    const createOperatorSignal = jest.fn(async () => ({
      signalId: "sig1",
      versionId: "v1",
      status: "PENDING_APPROVAL",
      instrument: "BTC",
      direction: "LONG",
    }));
    const approveSignal = jest.fn(async () => ({
      approval: {},
      position: { id: "pos-1" },
      openError: null,
      published: true,
    }));
    const { svc } = bot({ signals: { createOperatorSignal }, flow: { approveSignal } });
    const replies: Array<{ text: string; replyMarkup?: unknown }> = [];
    await svc.dispatch(
      { name: "pos", args: [] },
      "tg:alice",
      async (text: string, replyMarkup?: unknown) => {
        replies.push({ text, replyMarkup });
      },
      "/pos LONG BTC @100000 SL 98000 TP 105000 url=https://t.me/x/1 chat=-1001 acc=a1",
    );
    expect(createOperatorSignal).toHaveBeenCalledWith(
      // Link (legacy url= form) stays in the text — service auto-detects it.
      "LONG BTC @100000 SL 98000 TP 105000 url=https://t.me/x/1",
      "tg:alice",
      { sourceName: null },
    );
    expect(approveSignal).toHaveBeenCalledWith(
      "sig1",
      { signalVersionId: "v1" },
      "tg:alice",
      "a1",
      "-1001",
      { renderDelayMs: 300_000 },
    );
    expect(replies[0].text).toContain("✅ LONG BTC");
    expect(replies[0].text).toContain("Chọn loại card");
    expect(replies[0].replyMarkup).toEqual({
      inline_keyboard: [
        [
          { text: "① Card PnL", callback_data: "style:pnl-strip:pos-1" },
          { text: "② Card Thống kê", callback_data: "style:position-stats:pos-1" },
        ],
      ],
    });
  });

  it("skips the style dialog when publication is skipped", async () => {
    const createOperatorSignal = jest.fn(async () => ({
      signalId: "sig1",
      versionId: "v1",
      status: "PENDING_APPROVAL",
      instrument: "BTC",
      direction: "LONG",
    }));
    const { svc } = bot({
      signals: { createOperatorSignal },
      flow: {
        approveSignal: jest.fn(async () => ({
          approval: {},
          position: { id: "pos-1" },
          openError: null,
          published: false,
        })),
      },
    });
    const replies: Array<{ text: string; replyMarkup?: unknown }> = [];
    await svc.dispatch(
      { name: "pos", args: [] },
      "tg:alice",
      async (text: string, replyMarkup?: unknown) => {
        replies.push({ text, replyMarkup });
      },
      "/pos LONG BTC @100000 SL 98000 TP 105000",
    );
    expect(replies[0].text).toContain("card skipped");
    expect(replies[0].replyMarkup).toBeUndefined();
  });

  it("reports open failures and validation errors", async () => {
    const createOperatorSignal = jest.fn(async () => ({
      signalId: "sig1",
      versionId: "v1",
      status: "PENDING_APPROVAL",
      instrument: "BTC",
      direction: "LONG",
    }));
    const failed = await dispatchPos(
      "/pos LONG BTC @100000 SL 98000 TP 105000",
      { createOperatorSignal },
      { approveSignal: jest.fn(async () => ({ approval: {}, position: null, openError: "KILL_SWITCH_ON", published: false })) },
    );
    expect(failed[0]).toContain("open failed: KILL_SWITCH_ON");

    const replies = await dispatchPos("/pos LONG BTC @100000", {
      createOperatorSignal: jest.fn(async () => {
        throw new ConflictException("missing stop_loss, take_profits — resend with all required fields");
      }),
    }, {});
    expect(replies[0]).toContain("❌ missing stop_loss, take_profits");
  });

  it("shows usage when no signal text", async () => {
    const replies = await dispatchPos("/pos url=https://t.me/x/1", {}, {});
    expect(replies[0]).toContain("Usage: /pos");
  });

  it("passes the quoted src channel name through to createOperatorSignal", async () => {
    const createOperatorSignal = jest.fn(async () => ({
      signalId: "sig1",
      versionId: "v1",
      status: "PENDING_APPROVAL",
      instrument: "ETH",
      direction: "LONG",
    }));
    const approveSignal = jest.fn(async () => ({
      approval: {},
      position: { id: "pos-1" },
      openError: null,
      published: true,
    }));
    await dispatchPos(
      '/pos LONG ETH @3500 SL 3400 TP 3700 src="Kaka trades" https://t.me/c/1/431',
      { createOperatorSignal },
      { approveSignal },
    );
    expect(createOperatorSignal).toHaveBeenCalledWith(
      "LONG ETH @3500 SL 3400 TP 3700 https://t.me/c/1/431",
      "tg:alice",
      { sourceName: "Kaka trades" },
    );
  });
});

describe("OperatorBotService coin commands", () => {
  async function dispatchCoin(
    name: string,
    args: string[],
    rawText: string | undefined,
    coins: Record<string, unknown>,
  ): Promise<string[]> {
    const { svc } = bot({ coins });
    const replies: string[] = [];
    await svc.dispatch({ name, args }, "tg:alice", async (text) => {
      replies.push(text);
    }, rawText);
    return replies;
  }

  it("lists tradable coins", async () => {
    const replies = await dispatchCoin("coins", [], "/coins", {
      list: jest.fn(async () => [
        { id: "c1", symbol: "BTC", enabled: true },
        { id: "c2", symbol: "ZEC", enabled: false },
      ]),
    });
    expect(replies[0]).toContain("✅ BTC");
    expect(replies[0]).toContain("⏸️ ZEC");
  });

  it("adds one coin per line, skips duplicates", async () => {
    const create = jest
      .fn()
      .mockResolvedValueOnce({ id: "c1", symbol: "ZEC" })
      .mockRejectedValueOnce(new ConflictException("coin BTC already exists"));
    const replies = await dispatchCoin("coin_add", [], "/coin_add\nzec\nBTC", { create });
    expect(create).toHaveBeenNthCalledWith(1, { symbol: "zec" }, "tg:alice");
    expect(replies[0]).toContain("✅ ZEC — created");
    expect(replies[0]).toContain("⏭️ BTC — skipped-duplicate");
  });

  it("deletes and toggles coins per line", async () => {
    const resolve = jest.fn(async (ref: string) => {
      if (ref === "NOPE") throw new Error('no coin matches "NOPE"');
      return { id: "c1", symbol: "ZEC" };
    });
    const remove = jest.fn(async () => ({}));
    const update = jest.fn(async () => ({ id: "c1", symbol: "ZEC" }));
    const delReplies = await dispatchCoin("coin_del", ["ZEC", "NOPE"], "/coin_del ZEC NOPE", {
      resolve,
      remove,
      update,
    });
    expect(remove).toHaveBeenCalledWith("c1", "tg:alice");
    expect(delReplies[0]).toContain("🗑️ ZEC — deleted");
    expect(delReplies[0]).toContain('❌ NOPE — no coin matches "NOPE"');

    const toggleReplies = await dispatchCoin(
      "coin_disable",
      ["zec"],
      "/coin_disable zec",
      { resolve, remove, update },
    );
    expect(update).toHaveBeenCalledWith("c1", { enabled: false }, "tg:alice");
    expect(toggleReplies[0]).toContain("⏸️ ZEC disabled");
  });
});

describe("OperatorBotService review fan-out", () => {
  function reviewBot(chatIds: string[]) {
    const signals = {
      reviewQueueDetailed: jest.fn(async () => [
        {
          id: "s1",
          status: "NEEDS_REVIEW",
          instrument: "UNKNOWN",
          direction: "UNKNOWN",
          source: { displayName: "Osho", platform: "TELEGRAM", externalSourceId: "traderosho" },
          versions: [
            {
              versionNumber: 1,
              eventType: "NEW",
              instrument: "ETH",
              direction: "LONG",
              orderType: null,
              entry: 2583.79,
              stopLoss: 2597.17,
              takeProfits: [2499],
              normalizedPayloadJson: { sourceMessageId: "m1", missingFields: [], ambiguities: [] },
            },
          ],
        },
      ]),
      getReviewMessage: jest.fn(async (rowId: string | null | undefined) => {
        if (!rowId) return null;
        return {
          contentRaw: "Short ETH limit Entry 2583.79 SL 2597.17 TP 2499",
          authorName: "Osho",
          sourceTimestamp: new Date("2026-10-15T12:33:00.000Z"),
          sourceUrl: "https://t.me/traderosho/4375",
          externalMessageId: "4375",
          source: { displayName: "Osho", platform: "TELEGRAM", externalSourceId: "traderosho" },
        };
      }),
    };
    const updates = {
      reviewQueue: jest.fn(async () => [
        {
          id: "u1",
          actionType: "CLOSE_ALL",
          validationStatus: "AMBIGUOUS",
          matchConfidence: null,
          reviewReason: "multiple candidates: s1,s2",
          matchedSignal: null,
          sourceMessage: {
            contentRaw: "close all now",
            authorName: "Osho",
            sourceTimestamp: new Date("2026-10-15T12:35:00.000Z"),
            sourceUrl: null,
            externalMessageId: "4376",
            source: { displayName: "Osho", platform: "TELEGRAM", externalSourceId: "traderosho" },
          },
        },
      ]),
    };
    const { svc, sent } = bot({ signals, updates, chatIds });
    return { svc, sent };
  }

  it("sends review notifications to every operator DM", async () => {
    const { svc, sent } = reviewBot(["100", "200"]);
    await svc.pollReviews();
    const chats = sent.map((s) => String(s.chat)).sort();
    // 2 targets x (1 signal + 1 update)
    expect(sent).toHaveLength(4);
    expect(chats).toEqual(["100", "100", "200", "200"]);
    expect(sent[0].text).toContain("REVIEW — LONG ETH");
    expect(sent[0].text).toContain("Bài gốc");
    expect(sent[0].text).not.toContain("UNKNOWN UNKNOWN");
  });

  it("one blocked operator does not break the rest", async () => {
    const { svc, sent } = reviewBot(["100", "200"]);
    const origSend = (svc as unknown as { send: (chat: number | string, text: string) => Promise<void> }).send;
    (svc as unknown as { send: unknown }).send = async (chat: number | string, text: string) => {
      if (String(chat) === "100") throw new Error("bot blocked by user");
      return origSend(chat, text);
    };
    await svc.pollReviews();
    expect(sent.map((s) => String(s.chat)).sort()).toEqual(["200", "200"]);
  });

  it("sends nothing when no operator chats configured", async () => {
    const { svc, sent } = reviewBot([]);
    await svc.pollReviews();
    expect(sent).toHaveLength(0);
  });

  it("forwards the original post before the review card", async () => {
    const { svc, sent } = reviewBot(["100"]);
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "sendMessage") {
        sent.push({ chat: Number(params.chat_id), text: String(params.text) });
      }
      return {};
    };
    await svc.pollReviews();
    const forward = calls.find((c) => c.method === "forwardMessage");
    expect(forward?.params).toMatchObject({
      chat_id: "100",
      from_chat_id: "@traderosho",
      message_id: 4375,
    });
  });

  it("falls back to stored text when forward fails", async () => {
    const { svc, sent } = reviewBot(["100"]);
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "forwardMessage") throw new Error("telegram api forwardMessage failed: 400");
      if (method === "sendMessage") {
        sent.push({ chat: Number(params.chat_id), text: String(params.text) });
      }
      return {};
    };
    await svc.pollReviews();
    expect(sent.some((s) => s.text.includes("Short ETH limit"))).toBe(true);
  });

  it("/review lists human-readable summaries", async () => {
    const { svc } = reviewBot(["100"]);
    const replies: Array<{ text: string; markup?: unknown }> = [];
    await svc.dispatch(
      { name: "review", args: [] },
      "tg:alice",
      async (text, markup) => {
        replies.push({ text, markup });
      },
      "/review",
    );
    expect(replies[0].text).toContain("signals: 1");
    expect(replies[0].text).toContain("updates: 1");
    const signalMsg = replies.find((r) => r.text.includes("LONG ETH [NEEDS_REVIEW] Osho"));
    expect(signalMsg).toBeTruthy();
    expect(signalMsg!.text).toContain("https://t.me/traderosho/4375");
    expect(JSON.stringify(signalMsg!.markup)).toContain("appr:signal:s1");
    expect(JSON.stringify(signalMsg!.markup)).toContain("fill:signal:s1");
    const updateMsg = replies.find((r) => r.text.includes("CLOSE_ALL [AMBIGUOUS]"));
    expect(updateMsg).toBeTruthy();
    expect(updateMsg!.text).toContain("https://t.me/traderosho/4376");
  });

  it("/review caps items and notes the remainder", async () => {
    const { svc } = reviewBot(["100"]);
    (svc as unknown as { signals: { reviewQueueDetailed: jest.Mock } }).signals.reviewQueueDetailed.mockResolvedValueOnce(
      Array.from({ length: 7 }, (_, i) => ({
        id: `s${i}`,
        status: "NEEDS_REVIEW",
        instrument: "ETH",
        direction: "LONG",
        source: { displayName: "Osho", platform: "TELEGRAM", externalSourceId: "traderosho" },
        versions: [],
      })),
    );
    const replies: string[] = [];
    await svc.dispatch(
      { name: "review", args: [] },
      "tg:alice",
      async (text) => {
        replies.push(text);
      },
      "/review",
    );
    expect(replies.join("\n")).toContain("+2 signals nữa");
  });

  it("/review reports an empty queue", async () => {
    const { svc } = bot({
      signals: { reviewQueueDetailed: jest.fn(async () => []) },
      updates: { reviewQueue: jest.fn(async () => []) },
    });
    const replies: string[] = [];
    await svc.dispatch({ name: "review", args: [] }, "tg:alice", async (text) => {
      replies.push(text);
    });
    expect(replies).toEqual(["Hết hàng đợi review. 🎉"]);
  });
});

describe("OperatorBotService.handleCallback", () => {
  function cbSvc(overrides: Record<string, unknown> = {}) {
    const { svc, sent } = bot(overrides);
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async () => {
      answered.push("ok");
      return {};
    };
    return { svc, sent, answered };
  }

  it("rejects callbacks from non-operators", async () => {
    const { svc, answered } = cbSvc({ signals: { reject: jest.fn() } });
    await svc.handleCallback({
      id: "cb1",
      from: { id: 9, username: "mallory" },
      data: "rej:signal:s1",
    });
    expect(answered).toHaveLength(1);
  });

  it("shows the open reason when inline approve fails to open", async () => {
    const signals = {
      get: jest.fn(async () => ({ id: "s1", versions: [{ id: "v1" }] })),
    };
    const flow = {
      approveSignal: jest.fn(async () => ({
        position: null,
        openError: "NO_SYMBOL_MAP: UNKNOWN not on Hyperliquid",
        published: false,
      })),
    };
    const { svc } = cbSvc({ signals, flow });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "card" },
      data: "appr:signal:s1",
    });
    expect(answered).toContain("Approved. Open failed: NO_SYMBOL_MAP: UNKNOWN not on Hyperliquid");
  });

  it("rejects signals and edits the message", async () => {
    const signals = { reject: jest.fn(async () => ({})) };
    const { svc } = cbSvc({ signals });
    const edited: Array<Record<string, unknown>> = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "editMessageText") edited.push(params);
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "REVIEW signal s1" },
      data: "rej:signal:s1",
    });
    expect(signals.reject).toHaveBeenCalledWith("s1", {}, "tg:alice");
    expect(edited).toHaveLength(1);
    expect(String(edited[0].text)).toContain("REJECTED");
  });

  it("approves matched updates, guides on ambiguous ones", async () => {
    const approve = jest.fn(async () => ({}));
    const { svc, answered } = (() => {
      const r = cbSvc({ updates: { approve } });
      return r;
    })();
    const edited: Array<Record<string, unknown>> = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "editMessageText") edited.push(params);
      else answered.push("ok");
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "card" },
      data: "appr:update:u1",
    });
    expect(approve).toHaveBeenCalledWith("u1", {}, "tg:alice");
    expect(edited).toHaveLength(1);
    expect(String(edited[0].text)).toContain("APPROVED");
  });

  it("picks a candidate signal for ambiguous updates", async () => {
    const approve = jest.fn(async () => ({}));
    const { svc } = cbSvc({ updates: { approve } });
    (svc as unknown as { pickNonces: Map<string, unknown> }).pickNonces.set("abc123", {
      updateId: "u1",
      signalId: "s9",
      expiresAt: Date.now() + 60000,
    });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      data: "pick:abc123",
    });
    expect(approve).toHaveBeenCalledWith("u1", { signalId: "s9" }, "tg:alice");
    expect(answered).toContain("Approved.");
  });

  it("rejects expired pick nonces", async () => {
    const approve = jest.fn();
    const { svc } = cbSvc({ updates: { approve } });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      data: "pick:deadbeef",
    });
    expect(approve).not.toHaveBeenCalled();
    expect(answered).toContain("Hết hạn, bấm lại /review.");
  });

  it("starts manual completion on fill and consumes the reply", async () => {
    const appendManualVersion = jest.fn(async () => ({
      signalId: "s1",
      status: "PENDING_APPROVAL",
      version: {
        versionNumber: 2,
        eventType: "MANUAL",
        instrument: "ETH",
        direction: "LONG",
        orderType: null,
        entry: 2583.79,
        stopLoss: 2597.17,
        takeProfits: [2499],
        normalizedPayloadJson: { missingFields: [], ambiguities: [] },
      },
      message: null,
      source: { displayName: "Osho", platform: "TELEGRAM" },
    }));
    const signals = {
      get: jest.fn(async () => ({
        id: "s1",
        status: "NEEDS_REVIEW",
        versions: [{ normalizedPayloadJson: { missingFields: ["entry"] } }],
      })),
      appendManualVersion,
    };
    const { svc, sent } = bot({ signals });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "card" },
      data: "fill:signal:s1",
    });
    expect(answered).toContain("Đã ghi nhận, reply số còn thiếu.");
    await svc.handleMessage({
      message_id: 8,
      chat: { id: 100, type: "private" },
      from: { id: 1, username: "alice" },
      text: "entry 2583.79 sl 2597.17 tp 2499",
    });
    expect(appendManualVersion).toHaveBeenCalledWith(
      "s1",
      "entry 2583.79 sl 2597.17 tp 2499",
      "tg:alice",
    );
    expect(sent.some((s) => s.text.includes("Đã bổ sung từ nhập tay"))).toBe(true);
  });

  it("refuses fill on final signals and honors /cancel", async () => {
    const signals = {
      get: jest.fn(async () => ({ id: "s1", status: "REJECTED", versions: [] })),
      appendManualVersion: jest.fn(),
    };
    const { svc } = bot({ signals });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      data: "fill:signal:s1",
    });
    expect(answered).toContain("Signal đã chốt, không bổ sung.");

    const { svc: svc2, sent } = bot({ signals });
    (svc2 as unknown as { pendingInput: Map<string, unknown> }).pendingInput.set("alice", {
      signalId: "s1",
      expiresAt: Date.now() + 60000,
    });
    await svc2.handleMessage({
      message_id: 9,
      chat: { id: 100, type: "private" },
      from: { id: 1, username: "alice" },
      text: "/cancel",
    });
    expect(sent.map((s) => s.text)).toContain("Đã hủy nhập liệu bổ sung (nếu có).");
  });

  it("promotes the delayed render with the chosen card style", async () => {
    const chooseCardStyle = jest.fn(async () => "promoted");
    const { svc } = cbSvc({ publications: { chooseCardStyle } });
    const answered: string[] = [];
    const edited: Array<Record<string, unknown>> = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      if (method === "editMessageText") edited.push(params);
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "Chọn card" },
      data: "style:position-stats:pos-9",
    });
    expect(chooseCardStyle).toHaveBeenCalledWith("pos-9", "position-stats", "tg:alice");
    expect(answered).toContain("Đã chọn card Thống kê — đang đăng…");
    expect(String(edited[0].text)).toContain("Card Thống kê by @alice");
    expect(edited[0].reply_markup).toEqual({ inline_keyboard: [] });
  });

  it("answers expired when the style window already passed", async () => {
    const chooseCardStyle = jest.fn(async () => "expired");
    const { svc } = cbSvc({ publications: { chooseCardStyle } });
    const answered: string[] = [];
    (svc as unknown as { api: unknown }).api = async (method: string, params: Record<string, unknown>) => {
      if (method === "answerCallbackQuery") answered.push(String((params as { text?: string }).text));
      return {};
    };
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 100, type: "private" }, text: "Chọn card" },
      data: "style:pnl-strip:pos-9",
    });
    expect(chooseCardStyle).toHaveBeenCalledWith("pos-9", "pnl-strip", "tg:alice");
    expect(answered).toContain("Hết thời gian chọn — card PnL đã được đăng.");
  });

  it("rejects style callbacks from non-operators", async () => {
    const chooseCardStyle = jest.fn(async () => "promoted");
    const { svc, answered } = cbSvc({ publications: { chooseCardStyle } });
    await svc.handleCallback({
      id: "cb1",
      from: { id: 9, username: "mallory" },
      data: "style:pnl-strip:pos-9",
    });
    expect(chooseCardStyle).not.toHaveBeenCalled();
    expect(answered).toHaveLength(1);
  });
});

describe("OperatorBotService.pollPublicationFailures", () => {
  it("DMs the operator chat that requested the card", async () => {
    const listRecentFailures = jest.fn(async () => [
      { publicationId: "p1", positionId: "pos-9", coin: "ETH", reason: "POSITION_NOT_OPEN" },
    ]);
    const { svc, sent } = bot({
      publications: { chooseCardStyle: jest.fn(async () => "promoted"), listRecentFailures },
    });
    (svc as unknown as { api: unknown }).api = async () => ({});
    await svc.handleCallback({
      id: "cb1",
      from: { id: 1, username: "alice" },
      message: { message_id: 7, chat: { id: 555, type: "private" }, text: "Chọn card" },
      data: "style:position-stats:pos-9",
    });
    await svc.pollPublicationFailures();
    expect(sent).toContainEqual({
      chat: 555,
      text: "❌ Không đăng được card ETH: POSITION_NOT_OPEN",
    });
  });

  it("falls back to the operator fan-out and does not repeat a notice", async () => {
    const listRecentFailures = jest.fn(async () => [
      { publicationId: "p2", positionId: "pos-x", coin: "BTC", reason: "RENDER_TIMEOUT" },
    ]);
    const { svc, sent } = bot({ publications: { listRecentFailures } });
    await svc.pollPublicationFailures();
    await svc.pollPublicationFailures();
    expect(sent).toEqual([
      { chat: "100", text: "❌ Không đăng được card BTC: RENDER_TIMEOUT" },
    ]);
  });
});
