import { AiProvider, EMBEDDING_DIMENSIONS, GenerateInput, GenerateOutput, l2normalize } from './ai.provider';

const STOPWORDS = new Set(
  'a an and are as at be but by can do does for from how i if in is it its me my no not of on or our so that the their them then there these they this to us was we what when where which who why will with you your'.split(
    ' ',
  ),
);

/**
 * Deterministic, offline stand-in for a real model — used by tests and local dev
 * (AI_PROVIDER=fake). Embeddings are a signed hashing-trick bag of words, so
 * retrieval genuinely favours passages that share words with the question.
 *
 * Put a marker in a playground question to force a Tier 1 failure mode and
 * watch the ladder degrade:
 *   [fail:error] [fail:timeout] [fail:json] [fail:lowconf] [fail:cite]
 */
export class FakeProvider implements AiProvider {
  readonly name = 'fake' as const;
  readonly chatModel = 'fake-chat-1';
  readonly embeddingModel = 'fake-hash-768';

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(hashEmbed);
  }

  async generateAnswer({ query, chunks, signal }: GenerateInput): Promise<GenerateOutput> {
    const mode = /\[fail:(error|timeout|json|lowconf|cite)\]/i.exec(query)?.[1]?.toLowerCase();
    const tokensIn = approxTokens(query) + chunks.reduce((n, c) => n + approxTokens(c.content), 0);

    if (mode === 'error') throw new Error('Simulated 503 from the model API');
    if (mode === 'timeout') {
      return new Promise((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (mode === 'json') {
      return { rawText: 'Sure! Here is what I found: {"answer": "unterminated', model: this.chatModel, tokensIn, tokensOut: 12 };
    }

    const top = chunks[0];
    const rawText = JSON.stringify({
      answer: top ? extractiveAnswer(query, top.content) : 'I do not know.',
      citedChunkIds: mode === 'cite' ? ['00000000-0000-0000-0000-000000000000:0'] : top ? [top.id] : [],
      confidence: mode === 'lowconf' ? 0.2 : top ? 0.9 : 0,
    });
    return { rawText, model: this.chatModel, tokensIn, tokensOut: approxTokens(rawText) };
  }
}

const contentWords = (text: string) =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));

const MAX_HASH_INPUT_CHARS = 8_192;

export function hashEmbed(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = contentWords(text);
  for (const token of tokens) {
    const h = fnv1a(token);
    vec[h % EMBEDDING_DIMENSIONS] += (h & 0x80000000) === 0 ? 1 : -1;
  }
  if (tokens.length === 0) vec[0] = 1; // never emit a zero vector: cosine distance would be NaN
  return l2normalize(vec);
}

function fnv1a(s: string): number {
  const str = String(s);
  const limit = Math.min(str.length, MAX_HASH_INPUT_CHARS);

  let h = 0x811c9dc5;
  for (let i = 0; i < limit; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const approxTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * A crude extractive "answer": the (up to) two sentences of the passage sharing
 * the most words with the question, in their original order. Markdown headings
 * are dropped. Good enough to make offline demos read like real answers.
 */
export function extractiveAnswer(query: string, passage: string, max = 2): string {
  const body = passage.replace(/^\s{0,3}#{1,6}\s.*$/gm, ' ').replace(/\s+/g, ' ').trim();
  const sentences = (body.match(/[^.!?]+[.!?]+/g) ?? [body.slice(0, 300)]).map((s) => s.trim()).filter(Boolean);
  const wanted = new Set(contentWords(query));
  const scored = sentences.map((text, index) => ({ text, index, score: contentWords(text).filter((w) => wanted.has(w)).length }));
  const best = scored.some((s) => s.score > 0) ? [...scored].sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max) : scored.slice(0, max);
  return best
    .sort((a, b) => a.index - b.index)
    .map((s) => s.text)
    .join(' ');
}
