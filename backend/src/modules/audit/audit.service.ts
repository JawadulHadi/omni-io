import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

interface LogAnswerInput {
  query: string;
  tier: "ai_answer" | "rag_snippets" | "faq_floor";
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
  confidence?: number;
  faqMatchId?: string;
  decisionNote?: string;
}

/** Every tier of the ladder writes here — this table is the full decision trace. */
@Injectable()
export class AuditService {
  constructor(private readonly pool: Pool) {}

  async logAnswer(workspaceId: string, input: LogAnswerInput): Promise<void> {
    await this.pool.query(
      `insert into answers
        (workspace_id, query, tier, model, tokens_in, tokens_out, retrieved_chunk_ids, cited_chunk_ids, confidence, faq_match_id, decision_note)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        workspaceId, input.query, input.tier, input.model ?? null, input.tokensIn ?? null, input.tokensOut ?? null,
        input.retrievedChunkIds, input.citedChunkIds, input.confidence ?? null, input.faqMatchId ?? null, input.decisionNote ?? null,
      ],
    );
  }
}
