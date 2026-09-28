/**
 * Skips Tier 1 entirely after `threshold` consecutive model failures, for
 * `cooldownMs`, so a provider outage costs customers nothing — they get Tier 2
 * immediately instead of each waiting out the full timeout. After the cooldown
 * one request is let through (half-open); one more failure re-opens it.
 *
 * In-process state: each API instance trips independently. That's fine for
 * protecting latency; a shared (Redis) breaker would be the next step at scale.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  isOpen(): boolean {
    if (this.openedAt === null) return false;
    if (this.now() - this.openedAt < this.cooldownMs) return true;
    this.openedAt = null;
    this.failures = this.threshold - 1; // half-open
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.failures >= this.threshold) this.openedAt = this.now();
  }
}
