export type AnswerTier = 'ai_answer' | 'rag_snippets' | 'faq_floor';
export type AnswerChannel = 'console' | 'widget' | 'mcp';
export type TraceOutcome = 'ok' | 'skipped' | 'rejected' | 'failed';

/** One rung-by-rung record of what the ladder did and why. Never contains document text. */
export interface TraceStep {
  step: string;
  outcome: TraceOutcome;
  detail?: string;
  /** Milliseconds since the previous step. */
  ms: number;
}

export interface Citation {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  snippet: string;
  similarity: number;
}

export interface AnswerOutcome {
  answerId: string;
  tier: AnswerTier;
  answer: string;
  citations: Citation[];
  confidence: number | null;
  topSimilarity: number | null;
  faqMatchId: string | null;
  trace: TraceStep[];
  latencyMs: number;
}

export const ANSWER_COMPLETED = 'answer.completed';

/** Emitted once per question; AuditListener persists it. */
export interface AnswerCompletedEvent extends AnswerOutcome {
  workspaceId: string;
  query: string;
  channel: AnswerChannel;
  /** Why the final tier was chosen, e.g. tier1_low_confidence, retrieval_failed. */
  decision: string;
  model: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  retrievedChunkIds: string[];
  citedChunkIds: string[];
}
