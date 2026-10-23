import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { INGESTION_QUEUE, RETENTION_JOB } from './ingestion.constants';

const EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * Registers the retention sweep (see IngestionProcessor). An upsert, so every
 * worker can run it at boot and there is still exactly one schedule.
 */
@Injectable()
export class RetentionScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionScheduler.name);

  constructor(@InjectQueue(INGESTION_QUEUE) private readonly queue: Queue) {}

  async onApplicationBootstrap() {
    try {
      await this.queue.upsertJobScheduler(RETENTION_JOB, { every: EVERY_MS }, { name: RETENTION_JOB, opts: { removeOnComplete: true, removeOnFail: 50 } });
    } catch (err) {
      this.logger.warn(`Could not schedule the retention sweep: ${(err as Error).message}`);
    }
  }
}
