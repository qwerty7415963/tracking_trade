import { Worker } from "bullmq";
import { PublishSendConsumer } from "./publish-send.consumer";

jest.mock("bullmq", () => ({
  Worker: jest.fn(),
}));

type FailedHandler = (job: unknown, err: Error) => void;

describe("PublishSendConsumer", () => {
  function setup() {
    const close = jest.fn();
    const handlers: Record<string, FailedHandler> = {};
    (Worker as unknown as jest.Mock).mockReturnValue({
      close,
      on: jest.fn((event: string, handler: FailedHandler) => {
        handlers[event] = handler;
      }),
    });
    const publications = {
      sendPublication: jest.fn(async () => ({ ok: true })),
      markSendFailed: jest.fn(async () => undefined),
    };
    const svc = new PublishSendConsumer({} as never, publications as never);
    return { svc, close, handlers, publications };
  }

  const sendJobData = {
    publicationId: "pub1",
    positionId: "pos1",
    status: "filled",
    markPrice: 2550,
    destinationChatId: "@chan",
    artifactPath: "/tmp/pub1.png",
    actor: "alice",
  };

  it("dispatches telegram-send jobs to sendPublication", async () => {
    const { svc, close, handlers } = setup();
    svc.onModuleInit();
    expect(Worker).toHaveBeenCalledWith(
      "telegram-send",
      expect.any(Function),
      expect.objectContaining({ connection: {} }),
    );
    const processor = (Worker as unknown as jest.Mock).mock.calls[0][1] as (
      job: unknown,
    ) => Promise<unknown>;
    await expect(processor({ data: sendJobData })).resolves.toEqual({ ok: true });
    expect(handlers.failed).toEqual(expect.any(Function));

    await svc.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });

  it("stays quiet while retries are still available", () => {
    const { svc, handlers, publications } = setup();
    svc.onModuleInit();
    handlers.failed({ data: sendJobData, attemptsMade: 3, opts: { attempts: 10 } }, new Error("TELEGRAM_500: boom"));
    expect(publications.markSendFailed).not.toHaveBeenCalled();
  });

  it("marks FINAL_FAILURE on the last attempt so the bot can sweep it", () => {
    const { svc, handlers, publications } = setup();
    svc.onModuleInit();
    handlers.failed(
      { data: sendJobData, attemptsMade: 10, opts: { attempts: 10 } },
      new Error("TELEGRAM_500: boom"),
    );
    expect(publications.markSendFailed).toHaveBeenCalledWith(
      "pub1",
      "TELEGRAM_500: boom",
      "alice",
    );
  });
});
