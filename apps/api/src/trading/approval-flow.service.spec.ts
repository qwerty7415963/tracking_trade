import { ApprovalFlowService } from "./approval-flow.service";

function flow(overrides: Record<string, unknown> = {}) {
  return new ApprovalFlowService(
    (overrides.prisma ?? {}) as never,
    (overrides.audit ?? { record: jest.fn() }) as never,
    (overrides.signals ?? {}) as never,
    (overrides.trading ?? {}) as never,
    (overrides.accounts ?? {}) as never,
    (overrides.publications ?? {}) as never,
    ((overrides.openMode ?? { getMode: jest.fn(async () => "AUTO") }) as never),
  );
}

describe("ApprovalFlowService.approveSignal", () => {
  it("approves, opens, and publishes when destination exists", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = { openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })) };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = flow({ signals, trading, accounts, publications });
    const out = await svc.approveSignal(
      "s1",
      { signalVersionId: "v1" },
      "alice",
      "acc1",
      "@chan",
    );
    expect(out.openError).toBeNull();
    expect((out.position as { id: string }).id).toBe("pos1");
    expect(out.published).toBe(true);
    expect(publications.requestPositionPublish).toHaveBeenCalledWith(
      "pos1",
      "filled",
      expect.objectContaining({ destinationChatId: "@chan" }),
      "alice",
    );
    const opts = (publications.requestPositionPublish as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
    expect(opts).not.toHaveProperty("markPrice");
  });

  it("publishes the limit text placement immediately and still waits for style", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = {
      openApproved: jest.fn(async () => ({
        position: { id: "pos1", status: "PENDING_ENTRY" },
        created: true,
        awaitingEntry: true,
      })),
    };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = {
      requestPositionPublish: jest.fn(async () => ({})),
      requestLimitTextPublish: jest.fn(async () => ({})),
    };
    const svc = flow({ signals, trading, accounts, publications });
    const out = await svc.approveSignal("s1", { signalVersionId: "v1" }, "alice", "acc1", "@chan");
    expect(out.awaitingEntry).toBe(true);
    expect(out.published).toBe(true);
    expect(publications.requestLimitTextPublish).toHaveBeenCalledWith(
      "pos1",
      { destinationChatId: "@chan" },
      "alice",
    );
    expect(publications.requestPositionPublish).not.toHaveBeenCalled();
  });

  it("publishes the limit text placement when /open creates a pending order", async () => {
    const trading = {
      openApproved: jest.fn(async () => ({
        position: { id: "pos1", status: "PENDING_ENTRY" },
        created: true,
        awaitingEntry: true,
      })),
    };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = {
      requestPositionPublish: jest.fn(async () => ({})),
      requestLimitTextPublish: jest.fn(async () => ({})),
    };
    const svc = flow({ trading, accounts, publications });
    const out = await svc.openSignal("s1", "acc1", "alice", "@chan");
    expect(out).toMatchObject({ created: true, awaitingEntry: true, published: true });
    expect(publications.requestLimitTextPublish).toHaveBeenCalledWith(
      "pos1",
      { destinationChatId: "@chan" },
      "alice",
    );
  });

  it("keeps approval but reports open failure without throwing", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = {
      openApproved: jest.fn(async () => {
        throw new Error("NO_QUOTE for ETH");
      }),
    };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const svc = flow({ signals, trading, accounts, publications: {} });
    const out = await svc.approveSignal("s1", { signalVersionId: "v1" }, "alice", "acc1", "@chan");
    expect(out.position).toBeNull();
    expect(out.openError).toContain("NO_QUOTE");
    expect(out.published).toBe(false);
  });

  it("skips publish with audit when no destination configured", async () => {
    const audit = { record: jest.fn(async () => ({})) };
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = { openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })) };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const svc = flow({ signals, trading, accounts, publications: {}, audit });
    const out = await svc.approveSignal("s1", { signalVersionId: "v1" }, "alice", "acc1");
    expect(out.published).toBe(false);
    expect(audit.record).toHaveBeenCalledWith(
      "alice",
      "publication.skipped",
      expect.objectContaining({ positionId: "pos1" }),
    );
  });

  it("passes the style-dialog delay and card kind through to publish", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = { openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })) };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = flow({ signals, trading, accounts, publications });
    const out = await svc.approveSignal(
      "s1",
      { signalVersionId: "v1" },
      "alice",
      "acc1",
      "@chan",
      { renderDelayMs: 60_000, cardKind: "position-stats" },
    );
    expect(out.published).toBe(true);
    expect(publications.requestPositionPublish).toHaveBeenCalledWith(
      "pos1",
      "filled",
      expect.objectContaining({
        destinationChatId: "@chan",
        renderDelayMs: 60_000,
        cardKind: "position-stats",
      }),
      "alice",
    );
  });

  it("passes the market-entry delay and minimum card age", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = {
      openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })),
    };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = flow({ signals, trading, accounts, publications });
    const before = Date.now();
    await svc.approveSignal(
      "s1",
      { signalVersionId: "v1" },
      "alice",
      "acc1",
      "@chan",
      { renderDelayMs: 60_000, marketEntryDelayMs: 3000, marketCardMinAgeMs: 3000 },
    );
    expect(trading.openApproved).toHaveBeenCalledWith("s1", "acc1", "alice", {
      marketEntryDelayMs: 3000,
    });
    const opts = (publications.requestPositionPublish as jest.Mock).mock.calls[0][2] as {
      minRenderAt?: number;
    };
    expect(opts.minRenderAt).toBeGreaterThanOrEqual(before + 3000);
    expect(opts.minRenderAt).toBeLessThanOrEqual(Date.now() + 3000);
  });

  it("passes a custom target notional to openApproved", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = {
      openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })),
    };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = flow({ signals, trading, accounts, publications });
    await svc.approveSignal(
      "s1",
      { signalVersionId: "v1" },
      "alice",
      "acc1",
      "@chan",
      { targetNotional: 50000 },
    );
    expect(trading.openApproved).toHaveBeenCalledWith("s1", "acc1", "alice", {
      targetNotional: 50000,
    });
  });

  it("publishes immediately with no dialog opts by default", async () => {
    const signals = { approve: jest.fn(async () => ({ id: "ap1" })) };
    const trading = { openApproved: jest.fn(async () => ({ position: { id: "pos1" }, created: true })) };
    const accounts = { get: jest.fn(async () => ({ id: "acc1" })) };
    const publications = { requestPositionPublish: jest.fn(async () => ({})) };
    const svc = flow({ signals, trading, accounts, publications });
    await svc.approveSignal("s1", { signalVersionId: "v1" }, "alice", "acc1", "@chan");
    expect(publications.requestPositionPublish).toHaveBeenCalledWith(
      "pos1",
      "filled",
      expect.objectContaining({ destinationChatId: "@chan" }),
      "alice",
    );
    const opts = (publications.requestPositionPublish as jest.Mock).mock.calls[0][2] as Record<string, unknown>;
    expect(opts.renderDelayMs).toBeUndefined();
    expect(opts.cardKind).toBeUndefined();
  });
});

describe("ApprovalFlowService.processNewSignal", () => {
  it("auto-opens clean signals in AUTO mode as system", async () => {
    const prisma = {
      signal: {
        findUnique: jest.fn(async () => ({
          id: "s1",
          status: "PENDING_APPROVAL",
          versions: [{ id: "v1" }],
        })),
      },
    };
    const accounts = { defaultAccount: jest.fn(async () => ({ id: "acc1", mode: "AUTO" })) };
    const flowSvc = flow({ prisma, accounts });
    const approveSignal = jest.fn(async () => ({ position: { id: "pos1" } }));
    (flowSvc as unknown as { approveSignal: unknown }).approveSignal = approveSignal;
    const out = await flowSvc.processNewSignal("s1");
    expect(out).toEqual({ action: "opened", positionId: "pos1" });
    expect(approveSignal).toHaveBeenCalledWith("s1", { signalVersionId: "v1" }, "system:auto", "acc1");
  });

  it("forces wait in global MANUAL mode even on AUTO accounts", async () => {
    const approveSignal = jest.fn();
    const svc = flow({
      openMode: { getMode: jest.fn(async () => "MANUAL") },
      accounts: { defaultAccount: jest.fn(async () => ({ id: "acc1", mode: "AUTO" })) },
    });
    (svc as unknown as { approveSignal: unknown }).approveSignal = approveSignal;
    await expect(svc.processNewSignal("s1")).resolves.toEqual({
      action: "wait",
      reason: "manual-mode",
    });
    expect(approveSignal).not.toHaveBeenCalled();
  });

  it("waits in APPROVE mode", async () => {
    const prisma = {
      signal: {
        findUnique: jest.fn(async () => ({
          id: "s1",
          status: "PENDING_APPROVAL",
          versions: [{ id: "v1" }],
        })),
      },
    };
    const accounts = { defaultAccount: jest.fn(async () => ({ id: "acc1", mode: "APPROVE" })) };
    const svc = flow({ prisma, accounts });
    await expect(svc.processNewSignal("s1")).resolves.toEqual({ action: "wait" });
  });

  it("skips review/non-clean signals without throwing", async () => {
    const prisma = {
      signal: { findUnique: jest.fn(async () => ({ id: "s1", status: "NEEDS_REVIEW", versions: [] })) },
    };
    const accounts = { defaultAccount: jest.fn(async () => ({ id: "acc1", mode: "AUTO" })) };
    const svc = flow({ prisma, accounts });
    await expect(svc.processNewSignal("s1")).resolves.toEqual({ action: "skip", reason: "not-clean" });
  });
});
