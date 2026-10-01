import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { RateLimiter } from '../../lib/redis/rate-limiter';
import { FaqModule } from '../faq/faq.module';
import { ChunksRepository } from '../ingestion/chunks.repository';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnswerResolver } from './answer.resolver';
import { AnswerService, LADDER_CONFIG, LadderBreakers, LadderConfig, TIER1_BUDGET, Tier1Budget } from './answer.service';
import { AskLimiter } from './ask-limiter';

const DAY_MS = 24 * 60 * 60 * 1000;

@Module({
  imports: [FaqModule, WorkspacesModule],
  providers: [
    AnswerService,
    AnswerResolver,
    AskLimiter,
    ChunksRepository,
    LadderBreakers,
    {
      provide: LADDER_CONFIG,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>): LadderConfig => ({
        tier1TimeoutMs: cfg.get('TIER1_TIMEOUT_MS', { infer: true }),
        retrievalTimeoutMs: cfg.get('RETRIEVAL_TIMEOUT_MS', { infer: true }),
        minGrounding: cfg.get('TIER1_MIN_GROUNDING', { infer: true }),
      }),
    },
    {
      // Model calls per workspace per UTC day, across console, widget and MCP. Over it, answers come from Tier 2.
      provide: TIER1_BUDGET,
      inject: [ConfigService, RateLimiter],
      useFactory: (cfg: ConfigService<Env, true>, limiter: RateLimiter): Tier1Budget => {
        const limit = cfg.get('TIER1_DAILY_LIMIT_PER_WORKSPACE', { infer: true });
        return {
          take: async (workspaceId) => {
            const day = new Date().toISOString().slice(0, 10);
            return (await limiter.hit(`tier1:${workspaceId}:${day}`, limit, DAY_MS + 60 * 60 * 1000)).allowed;
          },
        };
      },
    },
  ],
  exports: [AnswerService, AskLimiter],
})
export class AnswerModule {}
