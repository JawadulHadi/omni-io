import { Controller, Get, Inject, Module, Res } from '@nestjs/common';
import { Field, ObjectType, Query, Resolver } from '@nestjs/graphql';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { Public, Roles } from '../../common/decorators/auth.decorators';
import { withTimeout } from '../../common/with-timeout';
import { DbService } from '../../db/db.service';
import { AI_PROVIDER, AiProvider } from '../../lib/ai/ai.provider';
import { REDIS } from '../../lib/redis/redis.constants';
import { AuthModule } from '../auth/auth.module';
import { GoogleOAuthService } from '../auth/google-oauth.service';

const CHECK_TIMEOUT_MS = 2_000;

/**
 * 200 while Postgres answers — the API can serve every answer tier without
 * Redis (rate limits fall back to per-process counters) — with `degraded` when
 * Redis is down, because uploads can't be queued then. 503 only without Postgres.
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const [database, redis] = await Promise.all([
      probe(() => this.db.global('select 1')),
      probe(() => this.redis.ping()),
    ]);
    if (database !== 'ok') res.status(503);
    return { status: database !== 'ok' ? 'down' : redis !== 'ok' ? 'degraded' : 'ok', checks: { database, redis } };
  }
}

async function probe(fn: () => Promise<unknown>): Promise<'ok' | 'down'> {
  try {
    await withTimeout(fn(), CHECK_TIMEOUT_MS);
    return 'ok';
  } catch {
    return 'down';
  }
}

@ObjectType()
export class SystemInfo {
  @Field() aiProvider: string;
  @Field() chatModel: string;
  @Field() embeddingModel: string;
  @Field() googleOAuth: boolean;
}

@Resolver()
export class SystemResolver {
  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly google: GoogleOAuthService,
  ) {}

  @Query(() => SystemInfo)
  @Roles('viewer')
  systemInfo(): SystemInfo {
    return {
      aiProvider: this.ai.name,
      chatModel: this.ai.chatModel,
      embeddingModel: this.ai.embeddingModel,
      googleOAuth: this.google.enabled,
    };
  }
}

@Module({
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [SystemResolver],
})
export class HealthModule {}
