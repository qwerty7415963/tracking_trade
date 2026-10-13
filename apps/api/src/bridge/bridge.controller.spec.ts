import { BridgeController } from "./bridge.controller";

describe("BridgeController", () => {
  function controller(overrides: Record<string, unknown> = {}) {
    const brokerState = {
      recordHeartbeat: jest.fn(async () => ({ ok: true })),
      ...(overrides.brokerState as Record<string, unknown> | undefined),
    };
    const executions = {
      listPendingCommands: jest.fn(async () => [{ id: "c1" }]),
      getCommandWithExecutions: jest.fn(async () => ({ id: "c1", executions: [{ id: "e1" }] })),
      toBridgeCommand: jest.fn((row: unknown) => ({ commandId: (row as { id: string }).id })),
      applyExternalResponse: jest.fn(async () => ({ status: "CONFIRMED" })),
      ...(overrides.executions as Record<string, unknown> | undefined),
    };
    return { ctl: new BridgeController(brokerState as never, executions as never), brokerState, executions };
  }

  it("records heartbeats", async () => {
    const { ctl, brokerState } = controller();
    await expect(ctl.heartbeat({ accountId: "acc1", status: "ok" })).resolves.toEqual({ ok: true });
    expect(brokerState.recordHeartbeat).toHaveBeenCalled();
  });

  it("maps pending rows to the EA contract", async () => {
    const { ctl, executions } = controller();
    const rows = await ctl.pendingCommands("acc1");
    expect(executions.toBridgeCommand).toHaveBeenCalled();
    expect(rows).toEqual([{ commandId: "c1" }]);
  });

  it("forwards EA responses", async () => {
    const { ctl, executions } = controller();
    await ctl.respond("c1", { result: "CONFIRMED" } as never);
    expect(executions.applyExternalResponse).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ result: "CONFIRMED" }),
      "bridge",
    );
  });
});
