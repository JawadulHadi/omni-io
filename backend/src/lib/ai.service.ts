import { Injectable } from '@nestjs/common';

interface RetrievedChunk { id: string; content: string; similarity: number }
interface AiAnswer {
  answer: string;
  citedChunkIds: string[];
  confidence: number;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Provider-agnostic wrapper. Swap the TODO'd calls for your provider of
 * choice (OpenAI, Anthropic, a self-hosted embedding model, etc.) — nothing
 * else in the codebase needs to change since AnswerService only depends on
 * this interface.
 */
@Injectable()
export class AiService {
  async embed(_text: string): Promise<number[]> {
    // TODO: call your embedding provider, return a 768-dim vector.
    throw new Error('AiService.embed not implemented — plug in your embedding provider');
  }

  async answerWithCitations(query: string, context: RetrievedChunk[]): Promise<AiAnswer> {
    // TODO: call your chat-completion provider with a prompt that requires
    // structured JSON output: { answer, citedChunkIds, confidence }.
    // Validate the JSON shape before trusting it — AnswerService treats any
    // throw or malformed shape as a Tier 1 failure and falls back cleanly.
    throw new Error('AiService.answerWithCitations not implemented — plug in your chat-completion provider');
  }
}
