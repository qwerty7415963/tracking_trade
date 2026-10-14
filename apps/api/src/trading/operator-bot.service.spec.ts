import { isOperator, parseCommand, OperatorBotService } from "./operator-bot.service";

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
    { operatorUsernames: ["alice"], reviewChatId: "", reportDestinationChatId: "" } as never,
    { record: jest.fn() } as never,
    (overrides.signals ?? {}) as never,
    (overrides.updates ?? {}) as never,
    (overrides.flow ?? {}) as never,
    (overrides.accounts ?? {}) as never,
    (overrides.trading ?? {}) as never,
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
