import { UnauthorizedException } from "@nestjs/common";
import { loadAppConfig } from "../config/app.config";
import { BridgeAuthGuard } from "./bridge-auth.guard";

function ctx(headers: Record<string, unknown>, query: Record<string, unknown> = {}, body?: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers, query, body }),
    }),
  } as never;
}

const CONFIG = {
  ...loadAppConfig({}),
  mt5BridgeApiKey: "secret",
  mt5AccountId: "acc1",
};

describe("BridgeAuthGuard", () => {
  const guard = new BridgeAuthGuard(CONFIG);

  it("rejects when bridge auth is not configured", () => {
    const open = new BridgeAuthGuard(loadAppConfig({}));
    expect(() =>
      open.canActivate(ctx({ authorization: "Bearer x" }, { accountId: "acc1" })),
    ).toThrow(UnauthorizedException);
  });

  it("rejects wrong credentials", () => {
    expect(() =>
      guard.canActivate(ctx({ authorization: "Bearer wrong" }, { accountId: "acc1" })),
    ).toThrow(UnauthorizedException);
  });

  it("rejects non-allowlisted accounts", () => {
    expect(() =>
      guard.canActivate(ctx({ authorization: "Bearer secret" }, { accountId: "other" })),
    ).toThrow(UnauthorizedException);
  });

  it("accepts correct key + allowlisted account", () => {
    expect(
      guard.canActivate(ctx({ authorization: "Bearer secret" }, { accountId: "acc1" })),
    ).toBe(true);
  });
});
