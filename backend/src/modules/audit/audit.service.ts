import { Injectable } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TenantContext } from '../../db/tenant-context';
import type { AnswerCompletedEvent, AnswerTier } from '../answer/answer.types';
import { AnswerLog, AnswerLogPage, AnswersFilterInput } from './audit.models';

const TIERS: AnswerTier[] = ['ai_answer', 'rag_snippets', 'faq_floor'];

@Injectable()
export class AuditService {
  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
  ) {}

  /** One row per question, whichever tier answered — the table is the full decision trace. */
  async record(e: AnswerCompletedEvent): Promise<void> {
    await this.db.withWorkspace(e.workspaceId, () =>
      this.db.query(
        `insert into answers
          (id, workspace_id, query, tier, channel, model, tokens_in, tokens_out, retrieved_chunk_ids, cited_chunk_ids,
           faq_match_id, confidence, top_similarity, latency_ms, decision_note, decision_trace)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb)`,
        [
          e.answerId,
          e.workspaceId,
          e.query,
          e.tier,
          e.channel,
          e.model,
          e.tokensIn,
          e.tokensOut,
          e.retrievedChunkIds,
          e.citedChunkIds,
          e.faqMatchId,
          e.confidence,
          e.topSimilarity,
          e.latencyMs,
          e.decision,
          JSON.stringify(e.trace), // explicit: pg would turn a JS array into a Postgres array, not JSON
        ],
      ),
    );
  }

  async list(filter: AnswersFilterInput): Promise<AnswerLogPage> {
    const params: unknown[] = [this.tenant.requireWorkspaceId()];
    const where = ['workspace_id = $1'];
    if (filter.channel) {
      params.push(filter.channel);
      where.push(`channel = $${params.length}`);
    }
    if (filter.search?.trim()) {
      params.push(`%${filter.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(`query ilike $${params.length}`);
    }
    const baseWhere = where.join(' and ');
    const tierWhere = filter.tier ? `${baseWhere} and tier = $${params.length + 1}` : baseWhere;
    const tierParams = filter.tier ? [...params, filter.tier] : params;

    return this.db.tenant(async (q) => {
      const n = tierParams.length;
      const items = await q(
        `select * from answers where ${tierWhere} order by created_at desc limit $${n + 1} offset $${n + 2}`,
        [...tierParams, filter.limit, filter.offset],
      );
      const [{ total, tokens }] = await q(
        `select count(*)::int as total, coalesce(sum(coalesce(tokens_in, 0) + coalesce(tokens_out, 0)), 0)::int as tokens
         from answers where ${tierWhere}`,
        tierParams,
      );
      const counts = await q<{ tier: AnswerTier; count: number }>(
        `select tier, count(*)::int as count from answers where ${baseWhere} group by tier`,
        params,
      );
      return {
        items: items.map(toLog),
        total,
        totalTokens: tokens,
        tierCounts: TIERS.map((tier) => ({ tier, count: counts.find((c) => c.tier === tier)?.count ?? 0 })),
      };
    });
  }
}

function toLog(r: any): AnswerLog {
  return {
    id: r.id,
    query: r.query,
    tier: r.tier,
    channel: r.channel,
    model: r.model,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    retrievedChunkIds: r.retrieved_chunk_ids,
    citedChunkIds: r.cited_chunk_ids,
    faqMatchId: r.faq_match_id,
    confidence: r.confidence,
    topSimilarity: r.top_similarity,
    decisionNote: r.decision_note,
    decisionTrace: r.decision_trace ?? [],
    latencyMs: r.latency_ms,
    createdAt: r.created_at,
  };
}
