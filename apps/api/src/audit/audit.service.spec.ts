import { AuditService } from "./audit.service";
import { PrismaService } from "../database/prisma.service";

describe("AuditService", () => {
  it("persists entries with actor, action and timestamp", async () => {
    const create = jest.fn(async (args: unknown) => ({
      ...(args as { data: Record<string, unknown> }).data,
      id: "a1",
      createdAt: new Date("2026-10-12T00:00:00.000Z"),
    }));
    const prisma = { auditLog: { create } } as unknown as PrismaService;
    const audit = new AuditService(prisma);

    const entry = await audit.record("alice", "signal.approve", { signalId: "s1" });

    expect(create).toHaveBeenCalledTimes(1);
    expect(entry.actor).toBe("alice");
    expect(entry.action).toBe("signal.approve");
    expect(entry.at).toBe("2026-10-12T00:00:00.000Z");
  });
});
