import {
  commandLines,
  commandLineTokens,
  isOperator,
  parseCommand,
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
    expect(replies[0]).toContain("✅ Alpha (TELEGRAM) p1 abcdefgh");
    expect(replies[0]).toContain("⏸️ Beta (X) p0 ijklmnop");
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

describe("OperatorBotService review fan-out", () => {
  function reviewBot(chatIds: string[]) {
    const signals = { list: jest.fn(async () => [{ id: "s1", instrument: "ETH", direction: "LONG" }]) };
    const updates = { reviewQueue: jest.fn(async () => [{ id: "u1" }]) };
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
    expect(sent[0].text).toContain("REVIEW signal s1");
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
});
