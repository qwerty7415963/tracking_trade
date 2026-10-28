import { BadRequestException } from "@nestjs/common";
import { OpenModeService } from "./open-mode.service";

function service(prisma: unknown) {
  return new OpenModeService(prisma as never, { record: jest.fn(async () => ({})) } as never);
}

describe("OpenModeService", () => {
  it("fails safe to MANUAL when the row is missing or unreadable", async () => {
    await expect(
      service({ systemSetting: { findUnique: jest.fn(async () => null) } }).getMode(),
    ).resolves.toBe("MANUAL");
    await expect(
      service({
        systemSetting: {
          findUnique: jest.fn(async () => {
            throw new Error("db down");
          }),
        },
      }).getMode(),
    ).resolves.toBe("MANUAL");
  });

  it("reads AUTO verbatim", async () => {
    const svc = service({
      systemSetting: { findUnique: jest.fn(async () => ({ key: "open_mode", value: "AUTO" })) },
    });
    await expect(svc.getMode()).resolves.toBe("AUTO");
  });

  it("sets and audits valid modes, rejects the rest", async () => {
    const upsert = jest.fn(async () => ({}));
    const svc = service({ systemSetting: { upsert } });
    await expect(svc.setMode("auto", "alice")).resolves.toBe("AUTO");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "open_mode" },
        create: expect.objectContaining({ value: "AUTO" }),
        update: expect.objectContaining({ value: "AUTO" }),
      }),
    );
    await expect(svc.setMode("sometimes", "alice")).rejects.toThrow(BadRequestException);
  });
});
