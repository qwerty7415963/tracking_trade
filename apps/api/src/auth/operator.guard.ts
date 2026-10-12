import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/app.config";

export const OPERATOR_HEADER = "x-operator-username";

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest() as {
      headers: Record<string, unknown>;
      operatorUsername?: string;
    };
    const raw = req.headers[OPERATOR_HEADER];
    const name = (Array.isArray(raw) ? raw[0] : raw) as unknown;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new UnauthorizedException("missing operator identity");
    }
    // Empty operator list denies everyone (fail-safe).
    if (!this.config.operatorUsernames.includes(name.trim().toLowerCase())) {
      throw new ForbiddenException("not an operator");
    }
    req.operatorUsername = name.trim();
    return true;
  }
}
