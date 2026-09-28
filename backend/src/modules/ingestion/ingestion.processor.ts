import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { DbService } from '../../db/db.service';
import { AI_PROVIDER, AiProvider } from '../../lib/ai/ai.provider';
import { BlobStorage } from '../../lib/storage/blob-storage';
import { chunkText } from './chunking';
import { ChunksRepository } from './chunks.repository';
import { DeleteBlobJobData, INGESTION_QUEUE, IngestionProgressEvent, IngestJobData } from './ingestion.constants';

const EMBED_BATCH = 32;

/**
 * Runs in the separate worker process (src/worker.ts), never in the API.
 * Every DB call happens inside the job's workspace, so RLS applies to the
 * worker exactly as it does to a request.
 */
@Processor(INGESTION_QUEUE, { concurrency: 2 })
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly db: DbService,
    private readonly chunks: ChunksRepository,
    private readonly blobs: BlobStorage,
  ) {
    super();
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case 'ingest':
        return this.ingest(job as Job<IngestJobData>);
      case 'delete-blob':
        return this.blobs.delete((job.data as DeleteBlobJobData).storageKey);
      default:
        throw new UnrecoverableError(`Unknown job ${job.name}`);
    }
  }

  private ingest(job: Job<IngestJobData>) {
    const { workspaceId, documentId } = job.data;
    const report = (e: Omit<IngestionProgressEvent, 'workspaceId' | 'documentId'>) =>
      job.updateProgress({ workspaceId, documentId, ...e } satisfies IngestionProgressEvent);

    return this.db.withWorkspace(workspaceId, async () => {
      const [doc] = await this.db.query<{ content: string | null }>('select content from documents where id = $1', [documentId]);
      if (!doc) {
        this.logger.log(`Document ${documentId} was deleted before ingestion; skipping`);
        return { skipped: true };
      }

      try {
        await this.setStatus(documentId, 'processing', null);
        await report({ status: 'processing', percent: 2 });

        const pieces = chunkText(doc.content ?? '');
        if (pieces.length === 0) throw new UnrecoverableError('Document has no extractable text');

        const vectors: number[][] = [];
        for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
          vectors.push(...(await this.ai.embed(pieces.slice(i, i + EMBED_BATCH), 'document')));
          await report({ status: 'processing', percent: 2 + Math.round((88 * vectors.length) / pieces.length) });
        }

        await this.chunks.replaceForDocument(documentId, pieces, vectors, this.ai.embeddingModel);
        await this.db.query(
          `update documents set status = 'ready', chunk_count = $2, error = null, updated_at = now() where id = $1`,
          [documentId, pieces.length],
        );
        await report({ status: 'ready', percent: 100, chunkCount: pieces.length });
        this.logger.log(`Ingested ${pieces.length} chunks for document ${documentId}`);
        return { chunkCount: pieces.length };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const willRetry = !(err instanceof UnrecoverableError) && job.attemptsMade + 1 < (job.opts.attempts ?? 1);
        await this.setStatus(documentId, willRetry ? 'processing' : 'failed', message).catch(() => undefined);
        await report({ status: willRetry ? 'retrying' : 'failed', percent: 0, error: message }).catch(() => undefined);
        this.logger.warn(`${willRetry ? 'Ingestion attempt failed (will retry)' : 'Ingestion failed'} for ${documentId}: ${message}`);
        throw err;
      }
    });
  }

  private setStatus(documentId: string, status: 'processing' | 'failed', error: string | null) {
    return this.db.query('update documents set status = $2, error = $3, updated_at = now() where id = $1', [
      documentId,
      status,
      error,
    ]);
  }
}
