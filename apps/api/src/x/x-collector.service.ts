import { Injectable } from "@nestjs/common";

export interface XConnectionTestResult {
  ok: boolean;
  code: string | null;
}

const FAILURE_THRESHOLD = 5;
const CIRCUIT_COOLDOWN_MS = 60_000;

/**
 * Phase 2 skeleton: Playwright scraping lands after the access spike.
 * The connector reports disabled + a circuit breaker so an X failure
 * can never take down the Telegram pipeline (failure isolation).
 */
@Injectable()
export class XCollectorService {
  private failures = 0;
  private openedUntil = 0;

  getStatus(): { enabled: boolean; circuit: "open" | "closed"; failures: number } {
    return {
      enabled: false,
      circuit: Date.now() < this.openedUntil ? "open" : "closed",
      failures: this.failures,
    };
  }

  // Source param reserved for the Playwright implementation.
  async checkSource(_source?: unknown): Promise<XConnectionTestResult> {
    if (Date.now() < this.openedUntil) return { ok: false, code: "CIRCUIT_OPEN" };
    return { ok: false, code: "CONNECTOR_DISABLED" };
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= FAILURE_THRESHOLD) {
      this.openedUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedUntil = 0;
  }
}
