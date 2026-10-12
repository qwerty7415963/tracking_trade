import { XCollectorService } from "./x-collector.service";

describe("XCollectorService", () => {
  it("reports disabled by default (spike pending)", async () => {
    const x = new XCollectorService();
    expect(x.getStatus().enabled).toBe(false);
    await expect(x.checkSource()).resolves.toEqual({ ok: false, code: "CONNECTOR_DISABLED" });
  });

  it("opens the circuit after repeated failures", async () => {
    const x = new XCollectorService();
    for (let i = 0; i < 5; i += 1) x.recordFailure();
    expect(x.getStatus().circuit).toBe("open");
    await expect(x.checkSource()).resolves.toEqual({ ok: false, code: "CIRCUIT_OPEN" });
  });

  it("resets on success", async () => {
    const x = new XCollectorService();
    for (let i = 0; i < 5; i += 1) x.recordFailure();
    x.recordSuccess();
    expect(x.getStatus()).toEqual({ enabled: false, circuit: "closed", failures: 0 });
  });
});
