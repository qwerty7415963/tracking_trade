import { Queue, Worker } from "bullmq";
import { RenderConsumer } from "./render.consumer";
import { processRenderJob } from "./render-job";

jest.mock("bullmq", () => {
  const actual = jest.requireActual("bullmq");
  return { ...actual, Queue: jest.fn(), Worker: jest.fn() };
});

jest.mock("./render-job", () => ({
  createCardRenderer: jest.fn(() => ({ render: jest.fn() })),
  processRenderJob: jest.fn(async () => ({ artifactPath: "/data/artifacts/x.png" })),
  isUpdateCardStatus: jest.requireActual("./render-job").isUpdateCardStatus,
}));

type Processor = (job: unknown, token?: string) => Promise<unknown>;

function setup(styleDialogRemainingMs: jest.Mock) {
  const close = jest.fn();
  const queueClose = jest.fn();
  (Worker as unknown as jest.Mock).mockReturnValue({ close, on: jest.fn() });
  (Queue as unknown as jest.Mock).mockReturnValue({ close: queueClose, add: jest.fn() });
  const svc = new RenderConsumer(
    {} as never,
    { renderWorkerEnabled: true } as never,
    {} as never,
    {} as never,
    { styleDialogRemainingMs } as never,
    {} as never,
  );
  svc.onModuleInit();
  const calls = (Worker as unknown as jest.Mock).mock.calls;
  const processor = calls[calls.length - 1][1] as Processor;
  return { svc, close, queueClose, processor };
}

function job(status?: string) {
  return {
    id: "render-pub1",
    data: { virtualPositionId: "pos1", publicationId: "pub1", ...(status ? { status } : {}) },
    moveToDelayed: jest.fn(async (_timestamp: number, _token?: string) => undefined),
  };
}

describe("RenderConsumer", () => {
  const mockProcess = processRenderJob as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockProcess.mockResolvedValue({ artifactPath: "/data/artifacts/x.png" });
  });

  it("renders straight away when no style dialog is pending", async () => {
    const hold = jest.fn(async () => 0);
    const { processor } = setup(hold);
    await expect(processor(job("sl"), "tok")).resolves.toEqual({
      artifactPath: "/data/artifacts/x.png",
    });
    expect(hold).toHaveBeenCalledWith("pos1");
    expect(mockProcess).toHaveBeenCalled();
  });

  it("never asks about the dialog for the open card", async () => {
    const hold = jest.fn(async () => 0);
    const { processor } = setup(hold);
    await processor(job("filled"), "tok");
    expect(hold).not.toHaveBeenCalled();
  });

  it("holds an update card while the dialog is still pending", async () => {
    const hold = jest.fn(async () => 12_000);
    const { processor } = setup(hold);
    const j = job("sl");
    await expect(processor(j, "tok-1")).rejects.toMatchObject({ name: "DelayedError" });
    // Re-check cadence, not the full remaining dialog window.
    expect(j.moveToDelayed).toHaveBeenCalledWith(expect.any(Number), "tok-1");
    const [, ts] = j.moveToDelayed.mock.calls[0];
    expect(ts).toBe("tok-1");
    expect(mockProcess).not.toHaveBeenCalled();
  });

  it("caps a long hold at the poll interval", async () => {
    const hold = jest.fn(async () => 290_000);
    const { processor } = setup(hold);
    const j = job("tp");
    const before = Date.now();
    await expect(processor(j, "tok-2")).rejects.toMatchObject({ name: "DelayedError" });
    const [ts] = j.moveToDelayed.mock.calls[0];
    expect(ts).toBeGreaterThanOrEqual(before + 5000);
    expect(ts).toBeLessThanOrEqual(Date.now() + 5000);
  });

  it("keeps the render consumer concurrency at 1", () => {
    setup(jest.fn(async () => 0));
    expect(Worker).toHaveBeenCalledWith(
      "card-render",
      expect.any(Function),
      expect.objectContaining({ concurrency: 1 }),
    );
  });

  it("shuts the worker and send queue down", async () => {
    const { svc, close, queueClose } = setup(jest.fn(async () => 0));
    await svc.onModuleDestroy();
    expect(close).toHaveBeenCalled();
    expect(queueClose).toHaveBeenCalled();
  });
});
