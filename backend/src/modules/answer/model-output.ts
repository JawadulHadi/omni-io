import { z } from 'zod';

const modelAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(8000),
  citedChunkIds: z.array(z.string().min(1)).max(20),
  // z.number() — a string "0.9" must NOT sneak past a `>=` comparison.
  confidence: z.number().min(0).max(1),
});

export type ModelAnswer = z.infer<typeof modelAnswerSchema>;
export type ParseResult = { ok: true; value: ModelAnswer } | { ok: false; error: string };

/** The model's output is untrusted input: parse, then validate the shape before any field is used. */
export function parseModelAnswer(raw: string): ParseResult {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: 'response is not valid JSON' };
  }
  const result = modelAnswerSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') };
  }
  return { ok: true, value: result.data };
}

const STOPWORDS = new Set(
  'about above after again also and any are because been before being between both but can could did does doing down during each few for from further had has have having her here hers him his how into its itself just more most must not now off once only other our ours out over own same she should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your yours'.split(
    ' ',
  ),
);

/** Lowercased content words (3+ letters, or any number) with a crude plural fold, so "refunds" meets "refund". */
function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => (w.length >= 3 || /^\p{N}+$/u.test(w)) && !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w));
}

/**
 * Share (0–1) of the answer's content words that occur in the cited passages.
 * Lexical, so it can't prove an answer correct — but an answer built from words
 * its sources never use is not grounded in them, whatever confidence it claims.
 */
export function groundingScore(answer: string, passages: string[]): number {
  const words = contentWords(answer);
  if (words.length === 0) return 1;
  const source = new Set(passages.flatMap(contentWords));
  return words.filter((w) => source.has(w)).length / words.length;
}
