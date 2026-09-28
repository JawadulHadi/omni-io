import { Injectable, Logger } from '@nestjs/common';
import { AiService } from '../../lib/ai.service';
import { AuditService } from '../audit/audit.service';
import { ChunksRepository } from '../ingestion/chunks.repository';
import { FaqService } from '../faq/faq.service';

export type AnswerTier = 'ai_answer' | 'rag_snippets' | 'faq_floor';

export interface AnswerResult {
  tier: AnswerTier;
  answer: string;
  citations: { chunkId: string; snippet: string }[];
  confidence?: number;
}

const SIMILARITY_FLOOR = 0.6;

/**
 * The resilience ladder is ONE method, not three branches bolted on later.
 * Every query returns *something* — the tier used and the reasoning are
 * always written to the audit log so a support team can see exactly why
 * an answer looked the way it did.
 */
@Injectable()
export class AnswerService {
  private readonly logger = new Logger(AnswerService.name);

  constructor(
    private readonly ai: AiService,
    private readonly chunks: ChunksRepository,
    private readonly faq: FaqService,
    private readonly audit: AuditService,
  ) {}

  async askQuestion(workspaceId: string, query: string): Promise<AnswerResult> {
    const retrieved = await this.chunks.matchChunks(workspaceId, query, { topK: 5 });

    // Nothing relevant at all — skip straight past Tier 1/2, no point
    // burning a model call on context that can't support an answer.
    const bestSimilarity = retrieved[0]?.similarity ?? 0;
    if (bestSimilarity < SIMILARITY_FLOOR) {
      return this.tier3FaqFloor(workspaceId, query, 'no_relevant_context');
    }

    // Tier 1: ask the model for a structured, cited answer.
    try {
      const workspaceThreshold = await this.getConfidenceThreshold(workspaceId);
      const result = await this.ai.answerWithCitations(query, retrieved);

      const validShape =
        result &&
        typeof result.answer === 'string' &&
        Array.isArray(result.citedChunkIds) &&
        result.citedChunkIds.length > 0;

      if (validShape && (result.confidence ?? 0) >= workspaceThreshold) {
        const citations = retrieved
          .filter((c) => result.citedChunkIds.includes(c.id))
          .map((c) => ({ chunkId: c.id, snippet: c.content }));

        await this.audit.logAnswer(workspaceId, {
          query,
          tier: 'ai_answer',
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          retrievedChunkIds: retrieved.map((c) => c.id),
          citedChunkIds: result.citedChunkIds,
          confidence: result.confidence,
        });

        return { tier: 'ai_answer', answer: result.answer, citations, confidence: result.confidence };
      }

      this.logger.warn(`Tier 1 rejected for workspace ${workspaceId}: low confidence or invalid shape`);
    } catch (err) {
      // Model timeout, rate limit, malformed JSON — anything at all — falls through.
      this.logger.warn(`Tier 1 failed for workspace ${workspaceId}: ${(err as Error).message}`);
    }

    // Tier 2: return the raw retrieved snippets, no model call needed.
    return this.tier2RagSnippets(workspaceId, query, retrieved);
  }

  private async tier2RagSnippets(
    workspaceId: string,
    query: string,
    retrieved: Awaited<ReturnType<ChunksRepository['matchChunks']>>,
  ): Promise<AnswerResult> {
    const top3 = retrieved.slice(0, 3);

    await this.audit.logAnswer(workspaceId, {
      query,
      tier: 'rag_snippets',
      retrievedChunkIds: retrieved.map((c) => c.id),
      citedChunkIds: top3.map((c) => c.id),
    });

    return {
      tier: 'rag_snippets',
      answer: 'Here are the most relevant excerpts from the knowledge base:',
      citations: top3.map((c) => ({ chunkId: c.id, snippet: c.content })),
    };
  }

  private async tier3FaqFloor(workspaceId: string, query: string, reason: string): Promise<AnswerResult> {
    const match = await this.faq.findBestMatch(workspaceId, query);

    await this.audit.logAnswer(workspaceId, {
      query,
      tier: 'faq_floor',
      retrievedChunkIds: [],
      citedChunkIds: [],
      decisionNote: reason,
      faqMatchId: match?.id,
    });

    return {
      tier: 'faq_floor',
      answer: match?.answer ?? "I couldn't find a confident answer — a team member will follow up shortly.",
      citations: [],
    };
  }

  private async getConfidenceThreshold(_workspaceId: string): Promise<number> {
    // TODO: read per-workspace threshold from the workspaces table; 0.75 default.
    return 0.75;
  }
}
