import { DEFAULT_CARD_KIND } from "@tracking-auto/card-renderer";
import { processRenderJob, RenderRunnerDeps } from "./render-job";

function setup(overrides: Partial<RenderRunnerDeps> = {}) {
  const deps = {
    prisma: {
      virtualPosition: { findUnique: jest.fn().mockResolvedValue({ coin: "ETH" }) },
      telegramPublication: { update: jest.fn().mockResolvedValue({}) },
    },
    marketData: { getMid: jest.fn().mockResolvedValue(2500) },
    publications: { buildSnapshot: jest.fn().mockResolvedValue({ snapshot: { id: "snap" } }) },
    renders: { writeArtifact: jest.fn().mockResolvedValue("/data/artifacts/r1.png") },
    sendQueue: { add: jest.fn().mockResolvedValue({}) },
    renderer: {
      render: jest
        .fn()
        .mockResolvedValue({ ok: true, artifact: { png: Buffer.from("png") } }),
    },
    ...overrides,
  } as unknown as RenderRunnerDeps;
  return deps;
}

describe("processRenderJob", () => {
  it("fetches the live mark, renders the card and enqueues the send", async () => {
    const deps = setup();
    const result = await processRenderJob(
      deps,
      { virtualPositionId: "pos1", publicationId: "pub1", status: "filled" },
      "job1",
    );

    expect(deps.marketData.getMid).toHaveBeenCalledWith("ETH");
    expect(deps.publications.buildSnapshot).toHaveBeenCalledWith("pos1", 2500, {
      status: "filled",
      volume: undefined,
    });
    expect(deps.renderer.render).toHaveBeenCalledWith(
      { id: "snap" },
      expect.any(Date),
      DEFAULT_CARD_KIND,
    );
    expect(deps.renders.writeArtifact).toHaveBeenCalledWith("pub1", Buffer.from("png"));
    expect(deps.sendQueue.add).toHaveBeenCalledWith(
      "send-photo",
      expect.objectContaining({
        publicationId: "pub1",
        positionId: "pos1",
        status: "filled",
        markPrice: 2500,
        artifactPath: "/data/artifacts/r1.png",
      }),
      expect.objectContaining({
        jobId: "send-pub1",
        attempts: 10,
        // Must outlive the 5-minute reply hold: 10 x 60s covers it.
        backoff: { type: "fixed", delay: 60_000 },
      }),
    );
    expect(result).toEqual({ artifactPath: "/data/artifacts/r1.png" });
  });

  it("skips the live quote when the job carries a mark price", async () => {
    const deps = setup();
    await processRenderJob(deps, {
      virtualPositionId: "pos1",
      markPrice: 2600,
      cardKind: "position-stats",
    }, "job2");

    expect(deps.marketData.getMid).not.toHaveBeenCalled();
    expect(deps.renderer.render).toHaveBeenCalledWith(
      { id: "snap" },
      expect.any(Date),
      "position-stats",
    );
    expect(deps.sendQueue.add).not.toHaveBeenCalled();
  });

  it("marks the publication failed when the position is missing", async () => {
    const deps = setup({
      prisma: {
        virtualPosition: { findUnique: jest.fn().mockResolvedValue(null) },
        telegramPublication: { update: jest.fn().mockResolvedValue({}) },
      } as unknown as RenderRunnerDeps["prisma"],
    });

    await expect(
      processRenderJob(deps, { virtualPositionId: "missing", publicationId: "pub2" }, "job3"),
    ).rejects.toThrow("POSITION_NOT_FOUND");
    expect(deps.prisma.telegramPublication.update).toHaveBeenCalledWith({
      where: { id: "pub2" },
      data: { publicationStatus: "FINAL_FAILURE", renderedText: "POSITION_NOT_FOUND" },
    });
  });

  it("marks the publication failed when rendering fails", async () => {
    const deps = setup({
      renderer: {
        render: jest.fn().mockResolvedValue({ ok: false, code: "LAYOUT_OVERFLOW" }),
      } as unknown as RenderRunnerDeps["renderer"],
    });

    await expect(
      processRenderJob(deps, { virtualPositionId: "pos1", publicationId: "pub3" }, "job4"),
    ).rejects.toThrow("RENDER_FAILED");
    expect(deps.prisma.telegramPublication.update).toHaveBeenCalledWith({
      where: { id: "pub3" },
      data: { publicationStatus: "FINAL_FAILURE", renderedText: "RENDER_FAILED" },
    });
  });

  it("renders an update card with the position's live kind (style picked after enqueue)", async () => {
    const deps = setup({
      prisma: {
        virtualPosition: {
          findUnique: jest.fn().mockResolvedValue({ coin: "ETH", cardKind: "position-stats" }),
        },
        telegramPublication: { update: jest.fn().mockResolvedValue({}) },
      } as unknown as RenderRunnerDeps["prisma"],
    });

    await processRenderJob(
      deps,
      {
        virtualPositionId: "pos1",
        publicationId: "pub5",
        status: "sl",
        markPrice: 2600,
        cardKind: "pnl-strip",
      },
      "job5",
    );
    expect(deps.renderer.render).toHaveBeenCalledWith(
      { id: "snap" },
      expect.any(Date),
      "position-stats",
    );
    // The mark is frozen, but the row is still fetched for the live kind.
    expect(deps.prisma.virtualPosition.findUnique).toHaveBeenCalledWith({
      where: { id: "pos1" },
    });
    expect(deps.marketData.getMid).not.toHaveBeenCalled();
  });

  it("keeps the dialog's kind for the open card even when the position moved on", async () => {
    const deps = setup({
      prisma: {
        virtualPosition: {
          findUnique: jest.fn().mockResolvedValue({ coin: "ETH", cardKind: "pnl-strip" }),
        },
        telegramPublication: { update: jest.fn().mockResolvedValue({}) },
      } as unknown as RenderRunnerDeps["prisma"],
    });

    await processRenderJob(
      deps,
      {
        virtualPositionId: "pos1",
        publicationId: "pub6",
        status: "filled",
        markPrice: 2600,
        cardKind: "position-stats",
      },
      "job6",
    );
    expect(deps.renderer.render).toHaveBeenCalledWith(
      { id: "snap" },
      expect.any(Date),
      "position-stats",
    );
  });

  it("falls back to the enqueued kind when the position has no kind stored", async () => {
    const deps = setup({
      prisma: {
        virtualPosition: { findUnique: jest.fn().mockResolvedValue({ coin: "ETH" }) },
        telegramPublication: { update: jest.fn().mockResolvedValue({}) },
      } as unknown as RenderRunnerDeps["prisma"],
    });

    await processRenderJob(
      deps,
      {
        virtualPositionId: "pos1",
        publicationId: "pub7",
        status: "tp",
        markPrice: 2600,
        cardKind: "position-stats",
      },
      "job7",
    );
    expect(deps.renderer.render).toHaveBeenCalledWith(
      { id: "snap" },
      expect.any(Date),
      "position-stats",
    );
  });
});
