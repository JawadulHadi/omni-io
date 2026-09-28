import {
  AiProvider,
  assertEmbeddings,
  EMBEDDING_DIMENSIONS,
  EmbedTask,
  GenerateInput,
  GenerateOutput,
  l2normalize,
} from './ai.provider';
import { ANSWER_JSON_SCHEMA, buildUserPrompt, SYSTEM_PROMPT } from './prompt';

// Keep each embedding request well under the per-request input limit.
const MAX_BATCH_ITEMS = 50;
const MAX_BATCH_CHARS = 20_000;

// @google/genai is ESM-only for type resolution; a real dynamic import loads it from this CommonJS build.
const loadGenAI = () => import('@google/genai');
type GenAIClient = InstanceType<Awaited<ReturnType<typeof loadGenAI>>['GoogleGenAI']>;

export class GeminiProvider implements AiProvider {
  readonly name = 'gemini' as const;
  private client?: Promise<GenAIClient>;

  constructor(
    private readonly apiKey: string,
    readonly chatModel: string,
    readonly embeddingModel: string,
  ) {}

  private getClient(): Promise<GenAIClient> {
    this.client ??= loadGenAI().then(({ GoogleGenAI }) => new GoogleGenAI({ apiKey: this.apiKey }));
    return this.client;
  }

  async embed(texts: string[], task: EmbedTask, signal?: AbortSignal): Promise<number[][]> {
    // gemini-embedding-001 takes a taskType; the gemini-embedding-2 family takes
    // the task as an inline instruction instead.
    const legacyTaskType = this.embeddingModel.includes('embedding-001');
    const client = await this.getClient();
    const out: number[][] = [];

    for (const batch of batches(texts)) {
      const res = await client.models.embedContent({
        model: this.embeddingModel,
        // One Content per text: plain strings are aggregated into a SINGLE vector
        // by gemini-embedding-2, which would silently corrupt the index.
        contents: batch.map((text) => ({
          role: 'user',
          parts: [{ text: legacyTaskType ? text : withTaskInstruction(text, task) }],
        })),
        config: {
          outputDimensionality: EMBEDDING_DIMENSIONS,
          abortSignal: signal,
          ...(legacyTaskType ? { taskType: task === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT' } : {}),
        },
      });
      const vectors = (res.embeddings ?? []).map((e) => e.values ?? []);
      assertEmbeddings(vectors, batch.length);
      // Truncated (non-default) dimensions must be re-normalised for cosine math.
      out.push(...vectors.map(l2normalize));
    }
    return out;
  }

  async generateAnswer({ query, chunks, signal }: GenerateInput): Promise<GenerateOutput> {
    const client = await this.getClient();
    const res = await client.models.generateContent({
      model: this.chatModel,
      contents: buildUserPrompt(query, chunks),
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: ANSWER_JSON_SCHEMA,
        abortSignal: signal,
      },
    });
    const usage = res.usageMetadata;
    return {
      rawText: res.text ?? '',
      model: res.modelVersion ?? this.chatModel,
      tokensIn: usage?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output, so count them for cost review.
      tokensOut: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    };
  }
}

function withTaskInstruction(text: string, task: EmbedTask): string {
  return task === 'query' ? `task: search result | query: ${text}` : `title: none | text: ${text}`;
}

function* batches(texts: string[]): Generator<string[]> {
  let current: string[] = [];
  let chars = 0;
  for (const text of texts) {
    if (current.length > 0 && (current.length >= MAX_BATCH_ITEMS || chars + text.length > MAX_BATCH_CHARS)) {
      yield current;
      current = [];
      chars = 0;
    }
    current.push(text);
    chars += text.length;
  }
  if (current.length > 0) yield current;
}
