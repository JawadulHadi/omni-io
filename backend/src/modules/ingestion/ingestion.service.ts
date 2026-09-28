import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { DeleteBlobJobData, INGESTION_QUEUE, IngestJobData } from './ingestion.constants';

/** Producer side: the API only enqueues; the separate worker process does the chunk/embed work. */
@Injectable()
export class IngestionService {
  constructor(@InjectQueue(INGESTION_QUEUE) private readonly queue: Queue) {}

  async enqueueIngest(data: IngestJobData): Promise<void> {
    await this.queue.add('ingest', data);
  }

  /** Post-commit cleanup of an erased document's original file, retried until it succeeds. */
  async enqueueBlobDelete(data: DeleteBlobJobData): Promise<void> {
    await this.queue.add('delete-blob', data, { attempts: 10 });
  }
}
