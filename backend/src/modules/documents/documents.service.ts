import { Injectable } from "@nestjs/common";
import { Pool } from "pg";
import { Queue } from "bullmq";
import { InjectQueue } from "@nestjs/bullmq";

@Injectable()
export class DocumentsService {
  constructor(private readonly pool: Pool, @InjectQueue("ingestion") private readonly ingestQueue: Queue) {}

  async createFromText(workspaceId: string, title: string, rawText: string) {
    const { rows } = await this.pool.query(
      `insert into documents (workspace_id, source_type, title, status) values ($1,'paste',$2,'processing') returning id`,
      [workspaceId, title],
    );
    const documentId = rows[0].id;
    await this.ingestQueue.add("ingest", { workspaceId, documentId, rawText });
    return { documentId, status: "processing" };
  }

  async listDocuments(workspaceId: string) {
    const { rows } = await this.pool.query(
      "select id, title, status, source_type, created_at from documents where workspace_id = $1 order by created_at desc",
      [workspaceId],
    );
    return rows;
  }
}
