import { Queue, Worker } from "bullmq";
import { MarketWatchService } from "./market-watch.service";

jest.mock("bullmq", () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

describe("MarketWatchService", () => {
  it("schedules market-watch and publishes TP/SL hits", async () => {
    const upsertJobScheduler = jest.fn();
    (Queue as unknown as jest.Mock).mockReturnValue({
      upsertJobScheduler,
      close: jest.fn(),
    });
    const workerClose = jest.fn();
    (Worker as unknown as jest.Mock).mockReturnValue({ close: workerClose });

    const trading = {
      pollMarketOnce: jest.fn(async () => [
        { positionId: "tp1", kind: "TP", closePrice: 2600 },
        { positionId: "sl1", kind: "SL", closePrice: 2400 },
      ]),
    };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = new MarketWatchService(
      {} as never,
      { marketPollMs: 5000 } as never,
      trading as never,
      publications as never,
    );

    await svc.onModuleInit();
    expect(Queue).toHaveBeenCalledWith("market-watch", expect.objectContaining({ connection: {} }));
    expect(upsertJobScheduler).toHaveBeenCalledWith(
      "market-watch",
      { every: 5000 },
      { name: "watch", data: {} },
    );
    expect(Worker).toHaveBeenCalledWith(
      "market-watch",
      expect.any(Function),
      expect.objectContaining({ connection: {} }),
    );

    const processor = (Worker as unknown as jest.Mock).mock.calls[0][1] as () => Promise<unknown>;
    await expect(processor()).resolves.toEqual({ hits: 2 });
    expect(publications.requestPositionPublish).toHaveBeenNthCalledWith(
      1,
      "tp1",
      "tp",
      { markPrice: 2600 },
      "api",
    );
    expect(publications.requestPositionPublish).toHaveBeenNthCalledWith(
      2,
      "sl1",
      "sl",
      { markPrice: 2400 },
      "api",
    );

    await svc.onModuleDestroy();
    expect(workerClose).toHaveBeenCalled();
  });
});
