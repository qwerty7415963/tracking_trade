import { Queue, Worker } from "bullmq";
import { MarketWatchService } from "./market-watch.service";

jest.mock("bullmq", () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
}));

type QueueMock = {
  upsertJobScheduler: jest.Mock;
  getJob: jest.Mock;
  add: jest.Mock;
  close: jest.Mock;
};

function queueMock(overrides: Partial<QueueMock> = {}): QueueMock {
  return {
    upsertJobScheduler: jest.fn(),
    getJob: jest.fn(async () => undefined),
    add: jest.fn(async () => ({})),
    close: jest.fn(),
    ...overrides,
  };
}

const HITS = [
  { positionId: "tp1", kind: "TP", markPrice: 2600, tpIndex: 0 },
  { positionId: "sl1", kind: "SL", markPrice: 2400, tpIndex: 1 },
];

type Processor = () => Promise<unknown>;

/** Boot the service and hand back the market-watch processor (last Worker). */
async function start(trading: Record<string, unknown>) {
  const workerClose = jest.fn();
  (Worker as unknown as jest.Mock).mockReturnValue({ close: workerClose });
  const svc = new MarketWatchService(
    {} as never,
    { marketPollMs: 5000 } as never,
    trading as never,
  );
  await svc.onModuleInit();
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  const processor = calls[calls.length - 1][1] as Processor;
  return { svc, workerClose, processor };
}

describe("MarketWatchService", () => {
  it("schedules the poll and enqueues one settle job per hit", async () => {
    const queues: QueueMock[] = [];
    (Queue as unknown as jest.Mock).mockImplementation(() => {
      const q = queueMock();
      queues.push(q);
      return q;
    });
    const trading = { pollMarketOnce: jest.fn(async () => HITS) };
    const { svc, workerClose, processor } = await start(trading);

    expect(Queue).toHaveBeenCalledWith("market-watch", expect.objectContaining({ connection: {} }));
    expect(Queue).toHaveBeenCalledWith("position-settle", expect.objectContaining({ connection: {} }));
    expect(queues[0].upsertJobScheduler).toHaveBeenCalledWith(
      "market-watch",
      { every: 5000 },
      { name: "watch", data: {} },
    );

    await expect(processor()).resolves.toEqual({ hits: 2 });

    const settle = queues[1];
    expect(settle.add).toHaveBeenCalledTimes(2);
    expect(settle.add.mock.calls[0]).toEqual([
      "settle-position",
      { positionId: "tp1", kind: "TP", markPrice: 2600, tpIndex: 0 },
      expect.objectContaining({ jobId: "settle-tp1-TP-0", attempts: 5 }),
    ]);
    expect(settle.add.mock.calls[1][2]).toEqual(
      expect.objectContaining({ jobId: "settle-sl1-SL" }),
    );

    await svc.onModuleDestroy();
    expect(workerClose).toHaveBeenCalled();
    expect(queues[1].close).toHaveBeenCalled();
  });

  it("skips a hit whose settle job is still in flight", async () => {
    const queues: QueueMock[] = [];
    (Queue as unknown as jest.Mock).mockImplementation(() => {
      const q = queueMock({ getJob: jest.fn(async () => ({ getState: async () => "active" })) });
      queues.push(q);
      return q;
    });
    const { processor } = await start({ pollMarketOnce: jest.fn(async () => [HITS[0]]) });
    await processor();
    expect(queues[1].add).not.toHaveBeenCalled();
  });

  it("re-queues a settle job that exhausted its attempts", async () => {
    const remove = jest.fn(async () => undefined);
    const queues: QueueMock[] = [];
    (Queue as unknown as jest.Mock).mockImplementation(() => {
      const q = queueMock({
        getJob: jest.fn(async () => ({ getState: async () => "failed", remove })),
      });
      queues.push(q);
      return q;
    });
    const { processor } = await start({ pollMarketOnce: jest.fn(async () => [HITS[0]]) });
    await processor();
    expect(remove).toHaveBeenCalled();
    expect(queues[1].add).toHaveBeenCalledTimes(1);
  });
});
