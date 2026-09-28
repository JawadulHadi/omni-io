import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { randomUUID } from 'node:crypto';
import { TenantContext } from '../../db/tenant-context';
import { AI_PROVIDER, AiProvider, GenerateOutput } from '../../lib/ai/ai.provider';
import { FaqMatch, FaqService } from '../faq/faq.service';
import { ChunksRepository, RetrievedChunk } from '../ingestion/chunks.repository';
import { LadderSettings, WorkspacesService } from '../workspaces/workspaces.service';
import {
  ANSWER_COMPLETED,
  AnswerChannel,
  AnswerCompletedEvent,
  AnswerOutcome,
  AnswerTier,
  Citation,
  TraceOutcome,
  TraceStep,
} from './answer.types';
import { CircuitBreaker } from './circuit-breaker';
import { parseModelAnswer } from './model-output';

export const TIER1_TIMEOUT_MS = Symbol('TIER1_TIMEOUT_MS');
export const DEFAULT_LADDER: LadderSettings = { confidenceThreshold: 0.75, similarityFloor: 0.6 };
export const TOP_K = 5;
export const MAX_SNIPPETS = 3;
export const HANDOFF_MESSAGE = "I couldn't find a confident answer to that — a member of our team will follow up shortly.";
export const SNIPPETS_PREFACE = 'Here are the most relevant excerpts from our knowledge base:';

interface Rung {
  tier: AnswerTier;
  answer: string;
  citations: Citation[];
  confidence: number | null;
  faqMatchId: string | null;
  decision: string;
}

/** Per-question state threaded through the ladder. */
class Run {
  readonly started = Date.now();
  private mark = this.started;
  readonly steps: TraceStep[] = [];
  retrieved: RetrievedChunk[] = [];
  usage: Pick<GenerateOutput, 'model' | 'tokensIn' | 'tokensOut'> | null = null;
  tier1Decision = 'tier1_rejected';

  constructor(
    readonly workspaceId: string,
    readonly query: string,
    readonly channel: AnswerChannel,
  ) {}

  trace(step: string, outcome: TraceOutcome, detail?: string) {
    const now = Date.now();
    this.steps.push({ step, outcome, detail, ms: now - this.mark });
    this.mark = now;
  }
}

/**
 * The resilience ladder — ONE method, three rungs, and it never throws:
 *
 *   Tier 1  ai_answer     model answer, accepted only if it parses, every citation
 *                         is a chunk we actually retrieved, and confidence clears
 *                         the workspace threshold
 *   Tier 2  rag_snippets  the top retrieved excerpts, verbatim — no model involved
 *   Tier 3  faq_floor     deterministic keyword FAQ, or a human hand-off message
 *
 * Retrieval failure or nothing above the similarity floor skips straight to
 * Tier 3. Every step is recorded in a decision trace that goes to the audit log
 * and back to the console playground.
 *
 * No DB transaction is held open across a model call: each read/write below is
 * its own short unit of work.
 */
@Injectable()
export class AnswerService {
  private readonly logger = new Logger(AnswerService.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    private readonly chunks: ChunksRepository,
    private readonly faq: FaqService,
    private readonly workspaces: WorkspacesService,
    private readonly events: EventEmitter2,
    private readonly breaker: CircuitBreaker,
    private readonly tenant: TenantContext,
    @Inject(TIER1_TIMEOUT_MS) private readonly tier1TimeoutMs: number,
  ) {}

  async askQuestion(query: string, opts: { channel: AnswerChannel }): Promise<AnswerOutcome> {
    const run = new Run(this.tenant.requireWorkspaceId(), query, opts.channel);

    // A settings read failing must not cost the customer an answer.
    let settings = DEFAULT_LADDER;
    try {
      settings = await this.workspaces.ladderSettings();
      run.trace('load_settings', 'ok', `threshold ${fmt(settings.confidenceThreshold)}, floor ${fmt(settings.similarityFloor)}`);
    } catch (err) {
      run.trace('load_settings', 'failed', `${errorMessage(err)} — using defaults`);
    }

    // Retrieval. An embedding outage or DB error goes straight to the FAQ floor.
    try {
      const [embedding] = await this.ai.embed([query], 'query');
      run.retrieved = await this.chunks.match(embedding, { topK: TOP_K, publicOnly: opts.channel === 'widget' });
      run.trace(
        'retrieve',
        'ok',
        run.retrieved.length ? `${run.retrieved.length} chunks, top similarity ${fmt(run.retrieved[0].similarity)}` : 'no chunks indexed',
      );
    } catch (err) {
      run.trace('retrieve', 'failed', errorMessage(err));
      return this.finish(run, await this.faqFloor(run, 'retrieval_failed'));
    }

    // Nothing relevant: don't spend a model call on context that can't support an answer.
    const relevant = run.retrieved.filter((c) => c.similarity >= settings.similarityFloor);
    if (relevant.length === 0) {
      const top = run.retrieved[0]?.similarity;
      run.trace('similarity_floor', 'rejected', `top similarity ${top === undefined ? 'n/a' : fmt(top)} < floor ${fmt(settings.similarityFloor)}`);
      return this.finish(run, await this.faqFloor(run, 'no_relevant_context'));
    }
    run.trace('similarity_floor', 'ok', `${relevant.length} of ${run.retrieved.length} chunks >= ${fmt(settings.similarityFloor)}`);

    const tier1 = await this.tier1(run, relevant, settings);
    if (tier1) return this.finish(run, tier1);

    const snippets = relevant.slice(0, MAX_SNIPPETS);
    run.trace('tier2_snippets', 'ok', `returning ${snippets.length} excerpt(s) verbatim`);
    return this.finish(run, {
      tier: 'rag_snippets',
      answer: SNIPPETS_PREFACE,
      citations: snippets.map(toCitation),
      confidence: null,
      faqMatchId: null,
      decision: run.tier1Decision,
    });
  }

  /** Returns the accepted Tier 1 rung, or null (with the reason traced) to fall through to Tier 2. */
  private async tier1(run: Run, relevant: RetrievedChunk[], settings: LadderSettings): Promise<Rung | null> {
    if (this.breaker.isOpen()) {
      run.trace('tier1_generate', 'skipped', 'circuit breaker open after repeated model failures');
      run.tier1Decision = 'tier1_circuit_open';
      return null;
    }

    const signal = AbortSignal.timeout(this.tier1TimeoutMs);
    let output: GenerateOutput;
    try {
      const pending = this.ai.generateAnswer({
        query: run.query,
        chunks: relevant.map(({ id, content }) => ({ id, content })),
        signal,
      });
      output = await raceAbort(pending, signal);
      this.breaker.recordSuccess();
    } catch (err) {
      this.breaker.recordFailure();
      const timedOut = signal.aborted;
      run.trace('tier1_generate', 'failed', timedOut ? `timed out after ${this.tier1TimeoutMs}ms` : errorMessage(err));
      run.tier1Decision = timedOut ? 'tier1_timeout' : 'tier1_model_error';
      return null;
    }
    // Recorded before validation: a rejected answer still cost tokens.
    run.usage = { model: output.model, tokensIn: output.tokensIn, tokensOut: output.tokensOut };
    run.trace('tier1_generate', 'ok', `${output.model}: ${output.tokensIn} in / ${output.tokensOut} out tokens`);

    const parsed = parseModelAnswer(output.rawText);
    if (!parsed.ok) return this.reject(run, 'tier1_invalid_output', `invalid output: ${parsed.error}`);

    const { answer, citedChunkIds, confidence } = parsed.value;
    if (confidence < settings.confidenceThreshold) {
      return this.reject(run, 'tier1_low_confidence', `confidence ${fmt(confidence)} < threshold ${fmt(settings.confidenceThreshold)}`);
    }
    if (citedChunkIds.length === 0) return this.reject(run, 'tier1_no_citations', 'answer cites no passages');

    const byId = new Map(relevant.map((c) => [c.id, c]));
    const unknown = citedChunkIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      return this.reject(run, 'tier1_invalid_citation', `cites ${unknown.length} chunk id(s) that were never retrieved`);
    }

    const cited = [...new Set(citedChunkIds)].map((id) => byId.get(id)!);
    run.trace('tier1_validate', 'ok', `confidence ${fmt(confidence)}, ${cited.length} citation(s) verified`);
    return {
      tier: 'ai_answer',
      answer,
      citations: cited.map(toCitation),
      confidence,
      faqMatchId: null,
      decision: 'tier1_accepted',
    };
  }

  private reject(run: Run, decision: string, detail: string): null {
    run.trace('tier1_validate', 'rejected', detail);
    run.tier1Decision = decision;
    return null;
  }

  private async faqFloor(run: Run, decision: string): Promise<Rung> {
    let match: FaqMatch | null = null;
    try {
      match = await this.faq.findBestMatch(run.query);
      run.trace('tier3_faq', match ? 'ok' : 'rejected', match ? `matched FAQ "${match.question}"` : 'no keyword match — hand-off message');
    } catch (err) {
      run.trace('tier3_faq', 'failed', `${errorMessage(err)} — hand-off message`);
    }
    return {
      tier: 'faq_floor',
      answer: match?.answer ?? HANDOFF_MESSAGE,
      citations: [],
      confidence: null,
      faqMatchId: match?.id ?? null,
      decision,
    };
  }

  private finish(run: Run, rung: Rung): AnswerOutcome {
    const outcome: AnswerOutcome = {
      answerId: randomUUID(),
      tier: rung.tier,
      answer: rung.answer,
      citations: rung.citations,
      confidence: rung.confidence,
      topSimilarity: run.retrieved[0]?.similarity ?? null,
      faqMatchId: rung.faqMatchId,
      trace: run.steps,
      latencyMs: Date.now() - run.started,
    };
    const event: AnswerCompletedEvent = {
      ...outcome,
      workspaceId: run.workspaceId,
      query: run.query,
      channel: run.channel,
      decision: rung.decision,
      model: run.usage?.model ?? null,
      tokensIn: run.usage?.tokensIn ?? null,
      tokensOut: run.usage?.tokensOut ?? null,
      retrievedChunkIds: run.retrieved.map((c) => c.id),
      citedChunkIds: rung.citations.map((c) => c.chunkId),
    };
    // Fire-and-forget: the audit write happens off the response path, and its
    // failure can never demote or break an answer that already succeeded.
    try {
      this.events.emit(ANSWER_COMPLETED, event);
    } catch (err) {
      this.logger.error(`Failed to emit audit event for ${outcome.answerId}: ${errorMessage(err)}`);
    }
    return outcome;
  }
}

/** Resolves/rejects with `promise`, but rejects as soon as `signal` aborts even if the provider ignores it. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  promise.catch(() => undefined); // the loser of the race must not become an unhandled rejection
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}

function toCitation(c: RetrievedChunk): Citation {
  return { chunkId: c.id, documentId: c.documentId, documentTitle: c.documentTitle, snippet: c.content, similarity: c.similarity };
}

const fmt = (n: number) => n.toFixed(2);

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > 300 ? `${message.slice(0, 300)}…` : message;
}
