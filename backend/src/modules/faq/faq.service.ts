import { Injectable } from "@nestjs/common";
import { Pool } from "pg";

@Injectable()
export class FaqService {
  constructor(private readonly pool: Pool) {}

  async findBestMatch(workspaceId: string, query: string): Promise<{ id: string; answer: string } | null> {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    if (terms.length === 0) return null;

    const { rows } = await this.pool.query(
      `select id, answer, keywords from faqs where workspace_id = $1`,
      [workspaceId],
    );

    let best: { id: string; answer: string; score: number } | null = null;
    for (const row of rows) {
      const score = row.keywords.filter((k: string) => terms.includes(k.toLowerCase())).length;
      if (score > 0 && (!best || score > best.score)) best = { id: row.id, answer: row.answer, score };
    }
    return best ? { id: best.id, answer: best.answer } : null;
  }
}
