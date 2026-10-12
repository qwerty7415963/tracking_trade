import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { OperatorGuard } from "./operator.guard";

function mockContext(headers: Record<string, unknown>): Parameters<OperatorGuard["canActivate"]>[0] {
  const req: { headers: Record<string, unknown>; operatorUsername?: string } = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

describe("OperatorGuard", () => {
  const guard = new OperatorGuard({ operatorUsernames: ["alice"], tradingEnabled: false });

  it("rejects missing identity", () => {
    expect(() => guard.canActivate(mockContext({}))).toThrow(UnauthorizedException);
  });

  it("rejects unknown operator", () => {
    expect(() => guard.canActivate(mockContext({ "x-operator-username": "mallory" }))).toThrow(
      ForbiddenException,
    );
  });

  it("accepts listed operator case-insensitively and attaches username", () => {
    const ctx = mockContext({ "x-operator-username": "ALICE" });
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it("rejects everyone when operator list is empty (fail-safe)", () => {
    const denyAll = new OperatorGuard({ operatorUsernames: [], tradingEnabled: false });
    expect(() => denyAll.canActivate(mockContext({ "x-operator-username": "alice" }))).toThrow(
      ForbiddenException,
    );
  });
});
