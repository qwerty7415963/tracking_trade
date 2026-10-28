import { SettleService, settleJobId, SettleJobData } from "./settle.service";

function setup(options: {
  publicationStatus?: string;
  position?: { status: string; filledTps: number[] } | null;
  publishError?: Error;
  killSwitchMode?: string;
  settlePublishTimeoutMs?: number;
} = {}) {
  const order: string[] = [];
  const prisma = {
    telegramPublication: {
      findUnique: jest.fn(async () => ({ publicationStatus: options.publicationStatus ?? "PUBLISHED" })),
    },
    virtualPosition: {
      findUnique: jest.fn(
        async () => options.position ?? { status: "OPEN", filledTps: [] },
      ),
    },
  };
  const audit = { record: jest.fn(async () => ({})) };
  const trading = {
    applyTpHit: jest.fn(async () => {
      order.push("close");
      return {};
    }),
    applySlHit: jest.fn(async () => {
      order.push("close");
      return {};
    }),
  };
  const publications = {
    requestPositionPublish: jest.fn(async () => {
      order.push("publish");
      if (options.publishError) throw options.publishError;
      return { publicationId: "pub9", status: "PENDING", cardKind: "pnl-strip" };
    }),
  };
  const killSwitch = { getMode: jest.fn(() => options.killSwitchMode ?? "LIVE") };
  const svc = new SettleService(
    prisma as never,
    audit as never,
    trading as never,
    publications as never,
    killSwitch as never,
    { settlePublishTimeoutMs: options.settlePublishTimeoutMs ?? 60_000 } as never,
  );
  return { svc, prisma, audit, trading, publications, killSwitch, order };
}

function tpJob(overrides: Partial<SettleJobData> = {}): SettleJobData {
  return { positionId: "pos1", kind: "TP", markPrice: 3100, tpIndex: 0, ...overrides };
}

describe("SettleService.settle", () => {
  it("publishes the card first and closes the position afterwards", async () => {
    const { svc, trading, publications, order } = setup();
    const job = { updateData: jest.fn(async () => undefined) };
    const result = await svc.settle(tpJob(), job);

    expect(order).toEqual(["publish", "close"]);
    expect(publications.requestPositionPublish).toHaveBeenCalledWith(
      "pos1",
      "tp",
      { markPrice: 3100, tpIndex: 0 },
      "worker",
    );
    expect(trading.applyTpHit).toHaveBeenCalledWith("pos1", 3100, "worker");
    expect(result).toEqual({
      publicationId: "pub9",
      publishState: "PUBLISHED",
      closeState: "CLOSED",
    });
    expect(job.updateData).toHaveBeenCalledWith({
      ...tpJob(),
      publicationId: "pub9",
    });
  });

  it("closes anyway after the bounded wait and audits the timeout", async () => {
    const { svc, audit, trading } = setup({
      publicationStatus: "PENDING",
      settlePublishTimeoutMs: 0,
    });
    const result = await svc.settle(tpJob());
    expect(result.closeState).toBe("CLOSED");
    expect(audit.record).toHaveBeenCalledWith(
      "worker",
      "settle.publish_timeout",
      expect.objectContaining({ positionId: "pos1", publicationId: "pub9" }),
    );
    expect(trading.applyTpHit).toHaveBeenCalled();
  });

  it("keeps retrying once the card finally publishes", async () => {
    const { svc, trading } = setup({
      publicationStatus: "PUBLISHED",
      position: { status: "OPEN", filledTps: [] },
    });
    const result = await svc.settle(tpJob({ publicationId: "pub9" }));
    expect(result.publishState).toBe("PUBLISHED");
    expect(trading.applyTpHit).toHaveBeenCalled();
  });

  it("never re-posts the card on a retry (publicationId is persisted)", async () => {
    const { svc, publications } = setup();
    const job = { updateData: jest.fn(async () => undefined) };
    await svc.settle(tpJob(), job);
    expect(job.updateData).toHaveBeenCalledTimes(1);

    await svc.settle(tpJob({ publicationId: "pub9" }), job);
    expect(publications.requestPositionPublish).toHaveBeenCalledTimes(1);
  });

  it("skips a TP slice that a previous attempt already closed", async () => {
    const { svc, audit, trading } = setup({ position: { status: "TP_HIT", filledTps: [3100] } });
    const result = await svc.settle(tpJob({ tpIndex: 0 }));
    expect(result.closeState).toBe("ALREADY_CLOSED");
    expect(trading.applyTpHit).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith("worker", "settle.already_settled", expect.anything());
  });

  it("skips an SL whose position is already closed", async () => {
    const { svc, trading, publications } = setup({
      position: { status: "CLOSED", filledTps: [3100] },
    });
    const result = await svc.settle({
      positionId: "pos1",
      kind: "SL",
      markPrice: 2900,
      tpIndex: 1,
    });
    expect(result.closeState).toBe("ALREADY_CLOSED");
    expect(trading.applySlHit).not.toHaveBeenCalled();
    // An SL card never carries a TP ordinal, even if the job data has one.
    expect(publications.requestPositionPublish).toHaveBeenCalledWith(
      "pos1",
      "sl",
      { markPrice: 2900 },
      "worker",
    );
  });

  it("still settles the position when the card cannot be published", async () => {
    const { svc, audit, trading, order } = setup({
      publishError: new Error("PUBLICATION_VALIDATION_FAILED: no destination chat configured"),
    });
    const job = { updateData: jest.fn(async () => undefined) };
    const result = await svc.settle(tpJob(), job);
    expect(result.publishState).toBe("SKIPPED");
    expect(order).toEqual(["publish", "close"]);
    expect(trading.applyTpHit).toHaveBeenCalled();
    expect(job.updateData).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      "worker",
      "settle.publish_skipped",
      expect.objectContaining({ positionId: "pos1", reason: "PUBLICATION_VALIDATION_FAILED" }),
    );
  });

  it("defers the close while the kill switch stops mutations", async () => {
    const { svc, trading } = setup({ killSwitchMode: "STOP_ALL_MUTATIONS" });
    await expect(svc.settle(tpJob())).rejects.toThrow(/KILL_SWITCH/);
    expect(trading.applyTpHit).not.toHaveBeenCalled();
  });

  it("propagates a real close failure so the consumer retries", async () => {
    const { svc, trading } = setup();
    (trading.applyTpHit as jest.Mock).mockRejectedValueOnce(new Error("connection refused"));
    await expect(svc.settle(tpJob())).rejects.toThrow(/connection refused/);
  });

  it("treats a position closed elsewhere as settled", async () => {
    const { svc, trading } = setup();
    (trading.applyTpHit as jest.Mock).mockRejectedValueOnce(
      new Error("position pos1 is CLOSED, not open"),
    );
    const result = await svc.settle(tpJob());
    expect(result.closeState).toBe("ALREADY_CLOSED");
  });
});

describe("SettleService.markFailed", () => {
  it("audits the reason once the consumer runs out of attempts", async () => {
    const { svc, audit } = setup();
    await svc.markFailed(tpJob(), "KILL_SWITCH: settle deferred");
    expect(audit.record).toHaveBeenCalledWith(
      "worker",
      "settle.failed",
      expect.objectContaining({ positionId: "pos1", reason: "KILL_SWITCH" }),
    );
  });
});

describe("settleJobId", () => {
  it("keys one job per TP ordinal and one per SL", () => {
    expect(settleJobId({ positionId: "pos1", kind: "TP", tpIndex: 0 })).toBe("settle-pos1-TP-0");
    expect(settleJobId({ positionId: "pos1", kind: "TP", tpIndex: 1 })).toBe("settle-pos1-TP-1");
    expect(settleJobId({ positionId: "pos1", kind: "SL", tpIndex: 1 })).toBe("settle-pos1-SL");
  });
});
