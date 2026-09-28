export const AI_PROVIDER = Symbol('AI_PROVIDER');

/** Must match `chunks.embedding vector(768)` and `match_chunks(p_query_embedding vector(768))`. */
export const EMBEDDING_DIMENSIONS = 768;

export type EmbedTask = 'document' | 'query';

export interface ContextChunk {
  id: string;
  content: string;
}

export interface GenerateInput {
  query: string;
  chunks: ContextChunk[];
  signal: AbortSignal;
}

/**
 * The provider returns raw model text plus usage — it does NOT decide whether the
 * answer is trustworthy. Parsing and validation live in the ladder, so every
 * provider is held to the same bar and tokens are recorded even for rejected
 * answers.
 */
export interface GenerateOutput {
  rawText: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  readonly name: 'gemini' | 'fake';
  readonly chatModel: string;
  readonly embeddingModel: string;
  embed(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<number[][]>;
  generateAnswer(input: GenerateInput): Promise<GenerateOutput>;
}

export function assertEmbeddings(vectors: number[][], expectedCount: number): void {
  if (vectors.length !== expectedCount) {
    throw new Error(`Embedding provider returned ${vectors.length} vectors for ${expectedCount} inputs`);
  }
  for (const v of vectors) {
    if (v.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding has ${v.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`);
    }
  }
}

export function l2normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  return norm === 0 ? v : v.map((x) => x / norm);
}
