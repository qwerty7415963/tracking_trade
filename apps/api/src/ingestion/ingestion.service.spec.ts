import { IngestionService } from "./ingestion.service";

const ROWS = [
  { id: "s1", platform: "TELEGRAM", enabled: true, externalSourceId: "chan1" },
  { id: "s2", platform: "TELEGRAM", enabled: false, externalSourceId: "chan2" },
  { id: "x1", platform: "X", enabled: true, externalSourceId: "xuser" },
];

function harness(overrides: Record<string, unknown> = {}) {
  const handlers = { new: [] as Array<(msg: unknown) => Promise<void>>, edit: [] as Array<(msg: unknown) => Promise<void>> };
  const telegram = {
    subscribeNewMessages: jest.fn(async (_channel: string, h: (msg: unknown) => Promise<void>) => {
      handlers.new.push(h);
    }),
    subscribeEditMessages: jest.fn(async (_channel: string, h: (msg: unknown) => Promise<void>) => {
      handlers.edit.push(h);
    }),
    ingestMessage: jest.fn(async () => ({ deduplicated: false, id: "m1" })),
    ingestEdit: jest.fn(async () => ({ deduplicated: false, id: "m2", revision: 2 })),
    ...(overrides.telegram as Record<string, unknown> | undefined),
  };
  const svc = new IngestionService(
    ((overrides.sources ?? { list: jest.fn(async () => ROWS) }) as never),
    telegram as never,
    ((overrides.signals ?? { ingestSourceMessage: jest.fn(async () => ({})) }) as never),
  );
  return { svc, handlers, telegram };
}

describe("IngestionService", () => {
  it("subscribes enabled Telegram sources only", async () => {
    const { svc, telegram } = harness();
    await svc.resync();
    expect(telegram.subscribeNewMessages).toHaveBeenCalledTimes(1);
    expect(telegram.subscribeNewMessages).toHaveBeenCalledWith("chan1", expect.any(Function));
    expect(telegram.subscribeEditMessages).toHaveBeenCalledTimes(1);
  });

  it("subscribes once across resyncs", async () => {
    const { svc, telegram } = harness();
    await svc.resync();
    await svc.resync();
    expect(telegram.subscribeNewMessages).toHaveBeenCalledTimes(1);
  });

  it("one failing source does not break the rest", async () => {
    const rows = [
      { id: "bad", platform: "TELEGRAM", enabled: true, externalSourceId: "badchan" },
      { id: "s1", platform: "TELEGRAM", enabled: true, externalSourceId: "chan1" },
    ];
    const { svc, telegram } = harness({
      sources: { list: jest.fn(async () => rows) },
      telegram: {
        subscribeNewMessages: jest.fn(async (channel: string) => {
          if (channel === "badchan") throw new Error("NOT_A_MEMBER");
        }),
        subscribeEditMessages: jest.fn(),
        ingestMessage: jest.fn(),
        ingestEdit: jest.fn(),
      },
    });
    await expect(svc.resync()).resolves.toBeUndefined();
    expect(telegram.subscribeEditMessages).toHaveBeenCalledWith("chan1", expect.any(Function));
  });

  it("survives a down database", async () => {
    const { svc } = harness({ sources: { list: jest.fn(async () => { throw new Error("db down"); }) } });
    await expect(svc.resync()).resolves.toBeUndefined();
  });

  it("parses new messages, skips duplicates and disabled sources", async () => {
    const ingestSourceMessage = jest.fn(async () => ({}));
    const ingestMessage = jest.fn(async () => ({ deduplicated: false, id: "m1" }));
    const { svc, handlers } = harness({
      signals: { ingestSourceMessage },
      telegram: {
        subscribeNewMessages: jest.fn(async (_c: string, h: (m: unknown) => Promise<void>) => {
          handlers.new.push(h);
        }),
        subscribeEditMessages: jest.fn(),
        ingestMessage,
        ingestEdit: jest.fn(),
      },
    });
    await svc.resync();
    await handlers.new[0]({ id: "42", text: "BUY XAUUSD @1 SL 2 TP 3" });
    expect(ingestMessage).toHaveBeenCalledWith("s1", { id: "42", text: "BUY XAUUSD @1 SL 2 TP 3" });
    expect(ingestSourceMessage).toHaveBeenCalledWith("m1", "ingestion");

    ingestMessage.mockResolvedValueOnce({ deduplicated: true, id: null } as never);
    await handlers.new[0]({ id: "42", text: "BUY XAUUSD @1 SL 2 TP 3" });
    expect(ingestSourceMessage).toHaveBeenCalledTimes(1);
  });

  it("routes edits through ingestEdit", async () => {
    const ingestSourceMessage = jest.fn(async () => ({}));
    const ingestEdit = jest.fn(async () => ({ deduplicated: false, id: "m2", revision: 2 }));
    const { svc, handlers } = harness({
      signals: { ingestSourceMessage },
      telegram: {
        subscribeNewMessages: jest.fn(),
        subscribeEditMessages: jest.fn(async (_c: string, h: (m: unknown) => Promise<void>) => {
          handlers.edit.push(h);
        }),
        ingestMessage: jest.fn(),
        ingestEdit,
      },
    });
    await svc.resync();
    await handlers.edit[0]({ id: "42", text: "BUY XAUUSD @1 SL 2 TP 4" });
    expect(ingestEdit).toHaveBeenCalledWith("s1", { id: "42", text: "BUY XAUUSD @1 SL 2 TP 4" });
    expect(ingestSourceMessage).toHaveBeenCalledWith("m2", "ingestion");
  });
});
