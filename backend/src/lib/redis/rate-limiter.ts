import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { withTimeout } from '../../common/with-timeout';
import { REDIS } from './redis.constants';

export interface Hit {
  allowed: boolean;
  count: number;
  /** Milliseconds until the window resets. */
  resetMs: number;
}

// Fixed window: the first hit starts the window, later hits only count.
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {n, ttl}`;

const REDIS_TIMEOUT_MS = 500;
const MAX_LOCAL_KEYS = 50_000;

/**
 * Fixed-window counters shared through Redis, so limits hold across API
 * instances. It never throws and never waits on a sick Redis for more than
 * 500 ms: on any Redis error it counts in process memory instead, so a Redis
 * outage loosens limits to per-instance rather than taking the API down.
 */
@Injectable()
export class RateLimiter implements ThrottlerStorage {
  private readonly local = new Map<string, { count: number; resetAt: number }>();

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async hit(key: string, limit: number, windowMs: number): Promise<Hit> {
    let count: number;
    let resetMs: number;
    try {
      [count, resetMs] = await withTimeout(this.redis.eval(SCRIPT, 1, `rl:${key}`, windowMs) as Promise<[number, number]>, REDIS_TIMEOUT_MS);
    } catch {
      [count, resetMs] = this.hitLocal(key, windowMs);
    }
    return { allowed: count <= limit, count, resetMs };
  }

  /** ThrottlerStorage for @nestjs/throttler: the rest of the window is the block. */
  async increment(key: string, ttl: number, limit: number, _blockDuration: number, throttlerName: string) {
    const { allowed, count, resetMs } = await this.hit(`throttle:${throttlerName}:${key}`, limit, ttl);
    const seconds = Math.max(1, Math.ceil(resetMs / 1000));
    return { totalHits: count, timeToExpire: seconds, isBlocked: !allowed, timeToBlockExpire: allowed ? 0 : seconds };
  }

  private hitLocal(key: string, windowMs: number): [number, number] {
    const now = Date.now();
    let entry = this.local.get(key);
    if (!entry || entry.resetAt <= now) {
      if (this.local.size >= MAX_LOCAL_KEYS) this.sweep(now);
      entry = { count: 0, resetAt: now + windowMs };
      this.local.set(key, entry);
    }
    entry.count += 1;
    return [entry.count, entry.resetAt - now];
  }

  private sweep(now: number) {
    for (const [key, entry] of this.local) if (entry.resetAt <= now) this.local.delete(key);
    // Still full of live windows: drop the oldest rather than grow without bound.
    for (const key of this.local.keys()) {
      if (this.local.size < MAX_LOCAL_KEYS) break;
      this.local.delete(key);
    }
  }
}
