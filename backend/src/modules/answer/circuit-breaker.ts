/**
 * Skips a dependency entirely after `threshold` consecutive failures, for
 * `cooldownMs`, so an outage costs customers nothing — they get the next rung
 * immediately instead of each waiting out the full timeout. After the cooldown
 * exactly one request is let through (half-open) while the rest keep skipping;
 * its success closes the breaker, its failure re-opens it. A probe that never
 * reports back is replaced after another cooldown.
 *
 * In-process state: each API instance trips independently. That's fine for
 * protecting latency; a shared (Redis) breaker would be the next step at scale.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private probeStartedAt: number | null = null;

  constructor(
    private readonly threshold = 5,
    private readonly cooldownMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** False means "go ahead" — and, when half-open, makes the caller the probe. */
  isOpen(): boolean {
    if (this.openedAt === null) return false;
    const now = this.now();
    if (now - this.openedAt < this.cooldownMs) return true;
    if (this.probeStartedAt !== null && now - this.probeStartedAt < this.cooldownMs) return true;
    this.probeStartedAt = now;
    return false;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
    this.probeStartedAt = null;
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.probeStartedAt !== null || this.failures >= this.threshold) {
      this.openedAt = this.now();
      this.probeStartedAt = null;
    }
  }

  /** The caller let through didn't call the dependency after all: free the probe slot. */
  release(): void {
    this.probeStartedAt = null;
  }
}
