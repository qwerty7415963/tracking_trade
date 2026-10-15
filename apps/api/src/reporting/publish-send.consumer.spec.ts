import { Worker } from "bullmq";
import { PublishSendConsumer } from "./publish-send.consumer";

jest.mock("bullmq", () => ({
  Worker: jest.fn(),
}));

describe("PublishSendConsumer", () => {
  it("dispatches telegram-send jobs to sendPublication", async () => {
    const close = jest.fn();
    (Worker as unknown as jest.Mock).mockReturnValue({ close });
    const publications = { sendPublication: jest.fn(async () => ({ ok: true })) };
    const svc = new PublishSendConsumer({} as never, publications as never);

    svc.onModuleInit();
    expect(Worker).toHaveBeenCalledWith(
      "telegram-send",
      expect.any(Function),
      expect.objectContaining({ connection: {} }),
    );
    const processor = (Worker as unknown as jest.Mock).mock.calls[0][1] as (
      job: unknown,
    ) => Promise<unknown>;
    const job = {
      data: {
        publicationId: "pub1",
        positionId: "pos1",
        status: "filled",
        markPrice: 2550,
        destinationChatId: "@chan",
        artifactPath: "/tmp/pub1.png",
        actor: "alice",
      },
    };
    await expect(processor(job)).resolves.toEqual({ ok: true });
    expect(publications.sendPublication).toHaveBeenCalledWith("pub1", job.data);

    await svc.onModuleDestroy();
    expect(close).toHaveBeenCalled();
  });
});
