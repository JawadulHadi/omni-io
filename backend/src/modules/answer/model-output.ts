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
