import { Injectable } from '@nestjs/common';
import { DbService, toVector } from '../../db/db.service';
import { TenantContext } from '../../db/tenant-context';

export interface RetrievedChunk {
  id: string;
  documentId: string;
  documentTitle: string;
  content: string;
  similarity: number;
}

const INSERT_BATCH = 200;

@Injectable()
export class ChunksRepository {
  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
  ) {}

  /** Vector search, tenant-filtered inside SQL (match_chunks) and again by RLS. */
  async match(embedding: number[], opts: { topK: number; publicOnly: boolean }): Promise<RetrievedChunk[]> {
    const rows = await this.db.query(
      'select id, document_id, document_title, content, similarity from match_chunks($1, $2::vector, $3, $4)',
      [this.tenant.requireWorkspaceId(), toVector(embedding), opts.topK, opts.publicOnly],
    );
    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      documentTitle: r.document_title,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }

  /**
   * Idempotent: upsert chunk i as `${documentId}:${i}`, then drop any chunks past
   * the new count (a re-ingested, shorter document must not keep stale tails).
   * One transaction, so readers never see a half-replaced document.
   */
  async replaceForDocument(documentId: string, pieces: string[], vectors: number[][], embeddingModel: string): Promise<void> {
    const workspaceId = this.tenant.requireWorkspaceId();
    await this.db.tenant(async (q) => {
      for (let from = 0; from < pieces.length; from += INSERT_BATCH) {
        const indices = pieces.slice(from, from + INSERT_BATCH).map((_, i) => from + i);
        await q(
          `insert into chunks (id, workspace_id, document_id, chunk_index, content, embedding, embedding_model)
           select t.id, $1::uuid, $2::uuid, t.idx, t.content, t.emb::vector, $7::text
           from unnest($3::text[], $4::int[], $5::text[], $6::text[]) as t(id, idx, content, emb)
           on conflict (id) do update
             set content = excluded.content, embedding = excluded.embedding, embedding_model = excluded.embedding_model`,
          [
            workspaceId,
            documentId,
            indices.map((i) => `${documentId}:${i}`),
            indices,
            indices.map((i) => pieces[i]),
            indices.map((i) => toVector(vectors[i])),
            embeddingModel,
          ],
        );
      }
      await q('delete from chunks where document_id = $1 and chunk_index >= $2', [documentId, pieces.length]);
    });
  }
}
