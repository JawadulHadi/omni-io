import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Env, validateEnv } from './config/env';
import { DbModule } from './db/db.module';
import { AiModule } from './lib/ai/ai.module';
import { StorageModule } from './lib/storage/blob-storage';
import { ChunksRepository } from './modules/ingestion/chunks.repository';
import { INGESTION_JOB_OPTIONS, INGESTION_QUEUE } from './modules/ingestion/ingestion.constants';
import { IngestionProcessor } from './modules/ingestion/ingestion.processor';

/** The ingestion worker: no HTTP server, no GraphQL — just the queue consumer and what it needs. */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    DbModule,
    AiModule,
    StorageModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService<Env, true>) => ({ connection: { url: cfg.get('REDIS_URL', { infer: true }) } }),
    }),
    BullModule.registerQueue({ name: INGESTION_QUEUE, defaultJobOptions: INGESTION_JOB_OPTIONS }),
  ],
  providers: [IngestionProcessor, ChunksRepository],
})
export class WorkerModule {}
