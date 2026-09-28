import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { AiService } from "../../lib/ai.service";

export interface MatchedChunk { id: string; content: string; similarity: number }

@Injectable()
export class ChunksRepository {
  constructor(private readonly pool: Pool, private readonly ai: AiService) {}

  async matchChunks(workspaceId: string, query: string, opts: { topK: number }): Promise<MatchedChunk[]> {
    const embedding = await this.ai.embed(query);
    const { rows } = await this.pool.query(
      "select * from match_chunks($1, $2, $3)",
      [workspaceId, JSON.stringify(embedding), opts.topK],
    );
    return rows;
  }

  async upsertChunk(workspaceId: string, documentId: string, chunkIndex: number, content: string, embedding: number[]): Promise<void> {
    const id = `${documentId}:${chunkIndex}`;
    await this.pool.query(
      `insert into chunks (id, workspace_id, document_id, chunk_index, content, embedding)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (id) do update set content = excluded.content, embedding = excluded.embedding`,
      [id, workspaceId, documentId, chunkIndex, content, JSON.stringify(embedding)],
    );
  }
}
