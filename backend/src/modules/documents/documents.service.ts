import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Visibility } from '../../common/graphql-enums';
import { withTimeout } from '../../common/with-timeout';
import type { Env } from '../../config/env';
import { DbService } from '../../db/db.service';
import { TenantContext } from '../../db/tenant-context';
import { RateLimiter } from '../../lib/redis/rate-limiter';
import { BlobStorage } from '../../lib/storage/blob-storage';
import { IngestionService } from '../ingestion/ingestion.service';
import { CreateDocumentFromTextInput, DocumentModel } from './documents.models';
import { detectMimeType, extractText } from './text-extraction';

const COLUMNS = 'id, title, source_type, status, visibility, chunk_count, error, mime_type, byte_size, created_at, updated_at';
const QUEUE_DOWN = 'Could not queue ingestion (the job queue is unavailable). Use Retry once it is back.';
const ENQUEUE_TIMEOUT_MS = 5_000;

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
    private readonly ingestion: IngestionService,
    private readonly blobs: BlobStorage,
    private readonly limiter: RateLimiter,
    private readonly cfg: ConfigService<Env, true>,
  ) {}

  async list(): Promise<DocumentModel[]> {
    const rows = await this.db.query(`select ${COLUMNS} from documents where workspace_id = $1 order by created_at desc`, [
      this.tenant.requireWorkspaceId(),
    ]);
    return rows.map(toDocument);
  }

  async createFromText(input: CreateDocumentFromTextInput): Promise<DocumentModel> {
    await this.assertIngestAllowed();
    return this.insertAndEnqueue({
      id: randomUUID(),
      sourceType: 'paste',
      title: input.title,
      content: input.content,
      visibility: input.visibility,
      mimeType: 'text/plain',
      byteSize: Buffer.byteLength(input.content),
      storageKey: null,
    });
  }

  async createFromUpload(
    file: { originalname: string; buffer: Buffer; size: number },
    opts: { title?: string; visibility?: Visibility },
  ): Promise<DocumentModel> {
    const mimeType = detectMimeType(file.originalname, file.buffer);
    await this.assertIngestAllowed(); // before extraction: parsing a PDF is the expensive part
    const content = await extractText(file.buffer, mimeType);
    if (!content.trim()) throw new BadRequestException('No extractable text found (scanned PDFs need OCR first)');

    const id = randomUUID();
    const storageKey = this.blobs.enabled ? `${this.tenant.requireWorkspaceId()}/${id}` : null;
    if (storageKey) await this.blobs.put(storageKey, file.buffer);
    try {
      return await this.insertAndEnqueue({
        id,
        sourceType: 'upload',
        title: opts.title?.trim() || file.originalname,
        content,
        visibility: opts.visibility ?? 'internal',
        mimeType,
        byteSize: file.size,
        storageKey,
      });
    } catch (err) {
      if (storageKey) await this.blobs.delete(storageKey).catch(() => undefined);
      throw err;
    }
  }

  async setVisibility(id: string, visibility: Visibility): Promise<DocumentModel> {
    const [row] = await this.db.query(`update documents set visibility = $2, updated_at = now() where id = $1 returning ${COLUMNS}`, [
      id,
      visibility,
    ]);
    if (!row) throw new NotFoundException('Document not found');
    return toDocument(row);
  }

  async retry(id: string): Promise<DocumentModel> {
    await this.assertIngestAllowed();
    const [row] = await this.db.query(
      `update documents set status = 'pending', error = null, updated_at = now() where id = $1 returning ${COLUMNS}`,
      [id],
    );
    if (!row) throw new NotFoundException('Document not found');
    if (!(await this.enqueue(id))) throw new ServiceUnavailableException(QUEUE_DOWN);
    return toDocument(row);
  }

  /**
   * GDPR erasure. One transaction removes the document, its chunks and vectors
   * (FK cascade) and scrubs its chunk ids from the answer audit log. The original
   * file is deleted after commit — a file store can't join a Postgres
   * transaction — and a failed delete is re-queued until it succeeds.
   */
  async erase(id: string): Promise<boolean> {
    const workspaceId = this.tenant.requireWorkspaceId();
    const storageKey = await this.db.tenant(async (q) => {
      const [doc] = await q<{ storage_key: string | null }>('select storage_key from documents where id = $1 for update', [id]);
      if (!doc) throw new NotFoundException('Document not found');
      const pattern = `${id}:%`;
      await q(
        `update answers
           set retrieved_chunk_ids = array(select x from unnest(retrieved_chunk_ids) x where x not like $1),
               cited_chunk_ids     = array(select x from unnest(cited_chunk_ids) x where x not like $1)
         where workspace_id = $2
           and exists (select 1 from unnest(retrieved_chunk_ids || cited_chunk_ids) x where x like $1)`,
        [pattern, workspaceId],
      );
      await q('delete from documents where id = $1', [id]);
      return doc.storage_key;
    });

    if (storageKey) {
      try {
        await this.blobs.delete(storageKey);
      } catch (err) {
        this.logger.warn(`Blob delete failed for ${storageKey}, re-queuing: ${(err as Error).message}`);
        await this.ingestion.enqueueBlobDelete({ storageKey });
      }
    }
    return true;
  }

  private async insertAndEnqueue(d: {
    id: string;
    sourceType: 'paste' | 'upload';
    title: string;
    content: string;
    visibility: Visibility;
    mimeType: string;
    byteSize: number;
    storageKey: string | null;
  }): Promise<DocumentModel> {
    const workspaceId = this.tenant.requireWorkspaceId();
    const [row] = await this.db.query(
      `insert into documents (id, workspace_id, source_type, title, status, content, visibility, mime_type, byte_size, storage_key)
       values ($1, $2, $3, $4, 'pending', $5, $6, $7, $8, $9)
       returning ${COLUMNS}`,
      [d.id, workspaceId, d.sourceType, d.title, d.content, d.visibility, d.mimeType, d.byteSize, d.storageKey],
    );
    // The document is saved either way; if the queue is down it shows as failed with a Retry button.
    if (!(await this.enqueue(d.id))) return toDocument({ ...row, status: 'failed', error: QUEUE_DOWN });
    return toDocument(row);
  }

  /**
   * False (and the document marked failed) when Redis doesn't take the job in
   * time — BullMQ would otherwise wait for Redis indefinitely and hang the request.
   */
  private async enqueue(documentId: string): Promise<boolean> {
    const workspaceId = this.tenant.requireWorkspaceId();
    try {
      await withTimeout(this.ingestion.enqueueIngest({ workspaceId, documentId }), ENQUEUE_TIMEOUT_MS);
      return true;
    } catch (err) {
      this.logger.warn(`Could not enqueue ingestion of ${documentId}: ${(err as Error).message}`);
      await this.db
        .query(`update documents set status = 'failed', error = $2, updated_at = now() where id = $1`, [documentId, QUEUE_DOWN])
        .catch(() => undefined);
      return false;
    }
  }

  /** Documents per workspace per hour — each one costs embedding calls. */
  private async assertIngestAllowed(): Promise<void> {
    const limit = this.cfg.get('INGEST_LIMIT_PER_WORKSPACE', { infer: true });
    const { allowed } = await this.limiter.hit(`ingest:${this.tenant.requireWorkspaceId()}`, limit, 60 * 60 * 1000);
    if (!allowed) {
      throw new HttpException(`This workspace has added ${limit} documents in the past hour — try again later`, HttpStatus.TOO_MANY_REQUESTS);
    }
  }
}

function toDocument(r: any): DocumentModel {
  return {
    id: r.id,
    title: r.title,
    sourceType: r.source_type,
    status: r.status,
    visibility: r.visibility,
    chunkCount: r.chunk_count,
    error: r.error,
    mimeType: r.mime_type,
    byteSize: r.byte_size,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
