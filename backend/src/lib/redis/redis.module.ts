import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import type { Env } from '../../config/env';
import { RateLimiter } from './rate-limiter';
import { REDIS } from './redis.constants';

export { REDIS };

/**
 * The API's own Redis client for rate limits, budgets and health checks (BullMQ
 * keeps separate connections). It fails fast instead of queueing: with the
 * offline queue disabled, a command during an outage rejects immediately, and
 * every caller falls back to per-process state rather than hanging a request.
 */
export function createRedisClient(url: string, logger: Logger): Redis {
  const client = new Redis(url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    // Keep reconnecting in the background, at most every 5 s.
    retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
  });
  let down = false;
  client.on('error', (err) => {
    if (!down) logger.warn(`Redis unavailable: ${err.message} — rate limits fall back to per-process counters`);
    down = true;
  });
  client.on('ready', () => {
    if (down) logger.log('Redis reconnected');
    down = false;
  });
  return client;
}

@Injectable()
class RedisLifecycle implements OnModuleDestroy {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onModuleDestroy() {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => createRedisClient(cfg.get('REDIS_URL', { infer: true }), new Logger('Redis')),
    },
    RedisLifecycle,
    RateLimiter,
  ],
  exports: [REDIS, RateLimiter],
})
export class RedisModule {}
