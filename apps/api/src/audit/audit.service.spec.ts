import { AuditService } from "./audit.service";

describe("AuditService", () => {
  it("records entries with actor, action and timestamp", () => {
    const audit = new AuditService();
    const entry = audit.record("alice", "signal.approve", { signalId: "s1" });
    expect(entry.actor).toBe("alice");
    expect(entry.action).toBe("signal.approve");
    expect(typeof entry.at).toBe("string");
    expect(audit.entries()).toHaveLength(1);
  });
});
