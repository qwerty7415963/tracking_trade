import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";

/**
 * Machine-to-machine auth for the MT5 bridge (EA).
 * Bearer MT5_BRIDGE_API_KEY + accountId allowlist. No operator usernames here.
 */
@Injectable()
export class BridgeAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, unknown>;
      query: Record<string, unknown>;
      body: Record<string, unknown> | undefined;
    };
    const key = this.config.mt5BridgeApiKey;
    if (!key) throw new UnauthorizedException("bridge auth not configured");
    const header = req.headers["authorization"];
    const token = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || token !== key) throw new UnauthorizedException("bad bridge credentials");

    const allowlisted = this.config.mt5AccountId;
    if (allowlisted) {
      const accountId =
        (typeof req.query["accountId"] === "string" && req.query["accountId"]) ||
        (typeof req.body?.["accountId"] === "string" && req.body["accountId"]) ||
        "";
      if (accountId !== allowlisted) throw new UnauthorizedException("account not allowlisted");
    }
    return true;
  }
}
