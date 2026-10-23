import { TenantContext } from '../../db/tenant-context';
import type { AiProvider, GenerateOutput } from '../../lib/ai/ai.provider';
import { FakeProvider } from '../../lib/ai/fake.provider';
import type { FaqMatch } from '../faq/faq.service';
import type { RetrievedChunk } from '../ingestion/chunks.repository';
import type { LadderSettings } from '../workspaces/workspaces.service';
import { AnswerService, HANDOFF_MESSAGE, LadderBreakers, SNIPPETS_PREFACE } from './answer.service';
import { ANSWER_COMPLETED, AnswerChannel, AnswerCompletedEvent } from './answer.types';
import { CircuitBreaker } from './circuit-breaker';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SETTINGS: LadderSettings = { confidenceThreshold: 0.75, similarityFloor: 0.6 };
const FAQ: FaqMatch = { id: 'faq-1', question: 'How do refunds work?', answer: 'Refunds take 5 business days.' };

const chunk = (i: number, similarity: number): RetrievedChunk => ({
  id: `doc-1:${i}`,
  documentId: 'doc-1',
  documentTitle: 'Refund policy',
  content: `Passage ${i}. Refunds are issued within 5 business days.`,
  similarity,
});

interface Options {
  retrieved?: RetrievedChunk[] | Error;
  generate?: AiProvider['generateAnswer'];
  embed?: AiProvider['embed'];
  faq?: FaqMatch | null | Error;
  settings?: LadderSettings | Error;
  timeoutMs?: number;
  retrievalTimeoutMs?: number;
  minGrounding?: number;
  generationBreaker?: CircuitBreaker;
  retrievalBreaker?: CircuitBreaker;
  budgetLeft?: boolean;
  emitThrows?: boolean;
}

function setup(o: Options = {}) {
  const fake = new FakeProvider();
  const ai = {
    name: fake.name,
    chatModel: fake.chatModel,
    embeddingModel: fake.embeddingModel,
    embed: jest.fn(o.embed ?? ((texts: string[]) => fake.embed(texts))),
    generateAnswer: jest.fn(o.generate ?? ((input) => fake.generateAnswer(input))),
  } satisfies AiProvider;
  const retrieved = o.retrieved ?? [chunk(0, 0.82), chunk(1, 0.71)];
  const chunks = {
    match: jest.fn(async () => {
      if (retrieved instanceof Error) throw retrieved;
      return retrieved;
    }),
  };
  const faq = {
    findBestMatch: jest.fn(async () => {
      const value = o.faq === undefined ? FAQ : o.faq;
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  const workspaces = {
    ladderSettings: jest.fn(async () => {
      const value = o.settings ?? SETTINGS;
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  const events = {
    emit: jest.fn(() => {
      if (o.emitThrows) throw new Error('listener exploded');
      return true;
    }),
  };
  const tenant = new TenantContext();
  const breakers = { generation: o.generationBreaker ?? new CircuitBreaker(), retrieval: o.retrievalBreaker ?? new CircuitBreaker() } as LadderBreakers;
  const budget = { take: jest.fn(async () => o.budgetLeft ?? true) };
  const service = new AnswerService(
    ai,
    chunks as never,
    faq as never,
    workspaces as never,
    events as never,
    breakers,
    tenant,
    { tier1TimeoutMs: o.timeoutMs ?? 200, retrievalTimeoutMs: o.retrievalTimeoutMs ?? 200, minGrounding: o.minGrounding ?? 0.2 },
    budget,
  );
  const ask = (query = 'How long do refunds take?', channel: AnswerChannel = 'console') =>
    tenant.run({ workspaceId: WORKSPACE }, () => service.askQuestion(query, { channel }));
  const event = () => {
    const call = events.emit.mock.calls.at(-1) as unknown as [string, AnswerCompletedEvent] | undefined;
    expect(call?.[0]).toBe(ANSWER_COMPLETED);
    return call![1];
  };
  return { ask, ai, chunks, faq, events, event, budget };
}

const modelReturns = (body: unknown): AiProvider['generateAnswer'] => async () =>
  ({ rawText: typeof body === 'string' ? body : JSON.stringify(body), model: 'test-model', tokensIn: 120, tokensOut: 30 }) satisfies GenerateOutput;

describe('AnswerService — resilience ladder', () => {
  describe('Tier 1 (ai_answer)', () => {
    it('accepts a valid, cited, confident answer and audits tokens + trace', async () => {
      const { ask, event } = setup();
      const result = await ask();

      expect(result.tier).toBe('ai_answer');
      expect(result.confidence).toBe(0.9);
      expect(result.citations.map((c) => c.chunkId)).toEqual(['doc-1:0']);
      expect(result.trace.map((s) => s.step)).toEqual(['load_settings', 'retrieve', 'similarity_floor', 'tier1_generate', 'tier1_validate']);

      const e = event();
      expect(e.decision).toBe('tier1_accepted');
      expect(e.workspaceId).toBe(WORKSPACE);
      expect(e.model).toBe('fake-chat-1');
      expect(e.tokensIn).toBeGreaterThan(0);
      expect(e.retrievedChunkIds).toEqual(['doc-1:0', 'doc-1:1']);
      expect(e.citedChunkIds).toEqual(['doc-1:0']);
    });

    it('only sends chunks above the similarity floor to the model', async () => {
      const { ask, ai } = setup({ retrieved: [chunk(0, 0.9), chunk(1, 0.4)] });
      await ask();
      expect(ai.generateAnswer.mock.calls[0][0].chunks.map((c) => c.id)).toEqual(['doc-1:0']);
    });
  });

  describe('Tier 1 → Tier 2 (rag_snippets)', () => {
    it.each([
      ['model error', { generate: async () => Promise.reject(new Error('503 upstream')) }, 'tier1_model_error'],
      ['invalid JSON', { generate: modelReturns('Sure! {"answer": "oops') }, 'tier1_invalid_output'],
      ['confidence as a string', { generate: modelReturns({ answer: 'x', citedChunkIds: ['doc-1:0'], confidence: '0.95' }) }, 'tier1_invalid_output'],
      ['low confidence', { generate: modelReturns({ answer: 'x', citedChunkIds: ['doc-1:0'], confidence: 0.5 }) }, 'tier1_low_confidence'],
      ['no citations', { generate: modelReturns({ answer: 'x', citedChunkIds: [], confidence: 0.99 }) }, 'tier1_no_citations'],
      ['hallucinated citation', { generate: modelReturns({ answer: 'x', citedChunkIds: ['doc-1:0', 'doc-9:3'], confidence: 0.99 }) }, 'tier1_invalid_citation'],
    ] as const)('falls to Tier 2 on %s', async (_label, opts, decision) => {
      const { ask, event } = setup(opts as Options);
      const result = await ask();

      expect(result.tier).toBe('rag_snippets');
      expect(result.answer).toBe(SNIPPETS_PREFACE);
      expect(result.citations.map((c) => c.chunkId)).toEqual(['doc-1:0', 'doc-1:1']);
      expect(event().decision).toBe(decision);
    });

    it('still records the tokens spent on a rejected Tier 1 answer', async () => {
      const { ask, event } = setup({ generate: modelReturns({ answer: 'x', citedChunkIds: ['doc-1:0'], confidence: 0.1 }) });
      await ask();
      expect(event()).toMatchObject({ model: 'test-model', tokensIn: 120, tokensOut: 30 });
    });

    it('times out a slow model within the budget', async () => {
      const { ask, event } = setup({ timeoutMs: 50 });
      const started = Date.now();
      const result = await ask('How long do refunds take? [fail:timeout]');

      expect(result.tier).toBe('rag_snippets');
      expect(event().decision).toBe('tier1_timeout');
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('times out even when the provider ignores the abort signal', async () => {
      const { ask, event } = setup({ timeoutMs: 50, generate: () => new Promise<never>(() => undefined) });
      const result = await ask();
      expect(result.tier).toBe('rag_snippets');
      expect(event().decision).toBe('tier1_timeout');
    });

    it('returns at most 3 snippets, all above the similarity floor', async () => {
      const { ask } = setup({
        retrieved: [chunk(0, 0.9), chunk(1, 0.8), chunk(2, 0.7), chunk(3, 0.65), chunk(4, 0.3)],
        generate: async () => Promise.reject(new Error('down')),
      });
      const result = await ask();
      expect(result.citations.map((c) => c.chunkId)).toEqual(['doc-1:0', 'doc-1:1', 'doc-1:2']);
    });

    it('opens the circuit breaker after repeated failures and skips the model call', async () => {
      const { ask, ai, event } = setup({
        generationBreaker: new CircuitBreaker(2, 60_000),
        generate: async () => Promise.reject(new Error('down')),
      });
      await ask();
      await ask();
      ai.generateAnswer.mockClear();

      const result = await ask();
      expect(ai.generateAnswer).not.toHaveBeenCalled();
      expect(result.tier).toBe('rag_snippets');
      expect(event().decision).toBe('tier1_circuit_open');
    });

    it("skips the model once the workspace's daily budget is used up", async () => {
      const { ask, ai, event } = setup({ budgetLeft: false });
      const result = await ask();
      expect(ai.generateAnswer).not.toHaveBeenCalled();
      expect(result.tier).toBe('rag_snippets');
      expect(event().decision).toBe('tier1_budget_exhausted');
    });

    it('rejects a confident answer whose words its citations never use', async () => {
      const { ask, event } = setup({
        generate: modelReturns({ answer: 'Shipping to Canada costs twelve dollars per parcel.', citedChunkIds: ['doc-1:0'], confidence: 0.99 }),
      });
      const result = await ask();
      expect(result.tier).toBe('rag_snippets');
      expect(event().decision).toBe('tier1_ungrounded');
    });

    it('accepts the same answer when the grounding check is disabled', async () => {
      const { ask } = setup({
        minGrounding: 0,
        generate: modelReturns({ answer: 'Shipping to Canada costs twelve dollars per parcel.', citedChunkIds: ['doc-1:0'], confidence: 0.99 }),
      });
      expect((await ask()).tier).toBe('ai_answer');
    });
  });

  describe('→ Tier 3 (faq_floor)', () => {
    it('skips the model entirely when nothing clears the similarity floor', async () => {
      const { ask, ai, event } = setup({ retrieved: [chunk(0, 0.41)] });
      const result = await ask();

      expect(result.tier).toBe('faq_floor');
      expect(result.answer).toBe(FAQ.answer);
      expect(result.faqMatchId).toBe(FAQ.id);
      expect(ai.generateAnswer).not.toHaveBeenCalled();
      expect(event().decision).toBe('no_relevant_context');
    });

    it('treats an empty index as "nothing relevant"', async () => {
      const { ask, event } = setup({ retrieved: [] });
      expect((await ask()).tier).toBe('faq_floor');
      expect(event().decision).toBe('no_relevant_context');
    });

    it('survives an embedding outage (no 500) and answers from the FAQ floor', async () => {
      const { ask, event } = setup({ embed: async () => Promise.reject(new Error('embedding API unavailable')) });
      const result = await ask();

      expect(result.tier).toBe('faq_floor');
      expect(result.trace.find((s) => s.step === 'retrieve')).toMatchObject({ outcome: 'failed' });
      expect(event().decision).toBe('retrieval_failed');
    });

    it('times out a hanging embedding call instead of hanging the question', async () => {
      const { ask, event } = setup({ retrievalTimeoutMs: 50, embed: () => new Promise<never>(() => undefined) });
      const started = Date.now();
      const result = await ask();
      expect(result.tier).toBe('faq_floor');
      expect(event().decision).toBe('retrieval_timeout');
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it('opens the retrieval breaker after repeated failures and skips the embedding call', async () => {
      const { ask, ai, event } = setup({
        retrievalBreaker: new CircuitBreaker(2, 60_000),
        embed: async () => Promise.reject(new Error('embedding API unavailable')),
      });
      await ask();
      await ask();
      ai.embed.mockClear();

      const result = await ask();
      expect(ai.embed).not.toHaveBeenCalled();
      expect(result.tier).toBe('faq_floor');
      expect(event().decision).toBe('retrieval_circuit_open');
    });

    it('survives a vector-search DB error', async () => {
      const { ask } = setup({ retrieved: new Error('connection terminated') });
      expect((await ask()).tier).toBe('faq_floor');
    });

    it('falls back to the human hand-off when no FAQ matches', async () => {
      const { ask } = setup({ retrieved: [], faq: null });
      const result = await ask();
      expect(result.answer).toBe(HANDOFF_MESSAGE);
      expect(result.faqMatchId).toBeNull();
    });

    it('falls back to the human hand-off when even the FAQ lookup fails', async () => {
      const { ask } = setup({ embed: async () => Promise.reject(new Error('down')), faq: new Error('db down') });
      const result = await ask();
      expect(result.tier).toBe('faq_floor');
      expect(result.answer).toBe(HANDOFF_MESSAGE);
    });
  });

  describe('robustness', () => {
    it('uses default settings when the settings read fails', async () => {
      const { ask } = setup({ settings: new Error('db blip') });
      const result = await ask();
      expect(result.tier).toBe('ai_answer');
      expect(result.trace[0]).toMatchObject({ step: 'load_settings', outcome: 'failed' });
    });

    it('never lets an audit failure affect the answer', async () => {
      const { ask } = setup({ emitThrows: true });
      await expect(ask()).resolves.toMatchObject({ tier: 'ai_answer' });
    });

    it('restricts widget retrieval to public documents', async () => {
      const { ask, chunks } = setup();
      await ask('refunds?', 'widget');
      expect(chunks.match).toHaveBeenCalledWith(expect.any(Array), { topK: 5, publicOnly: true });
    });

    it('restricts the widget FAQ floor to public FAQs', async () => {
      const { ask, faq } = setup({ retrieved: [] });
      await ask('refunds?', 'widget');
      expect(faq.findBestMatch).toHaveBeenCalledWith('refunds?', { publicOnly: true });
      await ask('refunds?', 'console');
      expect(faq.findBestMatch).toHaveBeenLastCalledWith('refunds?', { publicOnly: false });
    });

    it('refuses to run without a tenant context', async () => {
      const tenant = new TenantContext();
      const service = new AnswerService(
        new FakeProvider(),
        {} as never,
        {} as never,
        {} as never,
        { emit: jest.fn() } as never,
        new LadderBreakers(),
        tenant,
        { tier1TimeoutMs: 100, retrievalTimeoutMs: 100, minGrounding: 0.2 },
        { take: async () => true },
      );
      await expect(service.askQuestion('hi', { channel: 'console' })).rejects.toThrow(/No workspace in tenant context/);
    });
  });
});
