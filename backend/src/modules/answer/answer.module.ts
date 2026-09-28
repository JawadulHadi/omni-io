import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { FaqModule } from '../faq/faq.module';
import { ChunksRepository } from '../ingestion/chunks.repository';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AnswerResolver } from './answer.resolver';
import { AnswerService, TIER1_TIMEOUT_MS } from './answer.service';
import { CircuitBreaker } from './circuit-breaker';

@Module({
  imports: [FaqModule, WorkspacesModule],
  providers: [
    AnswerService,
    AnswerResolver,
    ChunksRepository,
    { provide: CircuitBreaker, useFactory: () => new CircuitBreaker(5, 30_000) },
    {
      provide: TIER1_TIMEOUT_MS,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => cfg.get('TIER1_TIMEOUT_MS', { infer: true }),
    },
  ],
  exports: [AnswerService],
})
export class AnswerModule {}
