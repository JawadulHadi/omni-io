import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { RateLimiter } from '../../lib/redis/rate-limiter';

/** Questions per user per minute, console and MCP together (the widget has its own per-IP limit). */
@Injectable()
export class AskLimiter {
  private readonly limit: number;

  constructor(
    private readonly limiter: RateLimiter,
    cfg: ConfigService<Env, true>,
  ) {
    this.limit = cfg.get('ASK_LIMIT_PER_USER', { infer: true });
  }

  async allow(userId: string): Promise<boolean> {
    return (await this.limiter.hit(`ask:${userId}`, this.limit, 60_000)).allowed;
  }
}
