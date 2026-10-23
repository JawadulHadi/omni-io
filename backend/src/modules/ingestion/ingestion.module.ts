import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { PubSub } from 'graphql-subscriptions';
import { INGESTION_JOB_OPTIONS, INGESTION_QUEUE } from './ingestion.constants';
import { IngestionEventsService, PUB_SUB } from './ingestion-events.service';
import { IngestionResolver } from './ingestion.resolver';
import { IngestionService } from './ingestion.service';

/** API-side ingestion: enqueue jobs and stream their progress. The consumer lives in WorkerModule. */
@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE, defaultJobOptions: INGESTION_JOB_OPTIONS })],
  providers: [{ provide: PUB_SUB, useValue: new PubSub() }, IngestionService, IngestionEventsService, IngestionResolver],
  exports: [IngestionService],
})
export class IngestionModule {}
