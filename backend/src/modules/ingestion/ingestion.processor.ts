import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { AiService } from "../../lib/ai.service";
import { ChunksRepository } from "./chunks.repository";
import { chunkText } from "./chunking";

interface IngestJobData { workspaceId: string; documentId: string; rawText: string }

@Processor("ingestion")
export class IngestionProcessor extends WorkerHost {
  private readonly logger = new Logger(IngestionProcessor.name);

  constructor(private readonly ai: AiService, private readonly chunks: ChunksRepository) {
    super();
  }

  async process(job: Job<IngestJobData>): Promise<void> {
    const { workspaceId, documentId, rawText } = job.data;
    const pieces = chunkText(rawText);

    for (let i = 0; i < pieces.length; i++) {
      await job.updateProgress(Math.round(((i + 1) / pieces.length) * 100));
      const embedding = await this.ai.embed(pieces[i]);
      await this.chunks.upsertChunk(workspaceId, documentId, i, pieces[i], embedding);
    }

    this.logger.log(`Ingested ${pieces.length} chunks for document ${documentId}`);
  }
}
