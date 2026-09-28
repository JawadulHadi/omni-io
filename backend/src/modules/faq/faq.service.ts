import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { TenantContext } from '../../db/tenant-context';
import { Faq, FaqInput } from './faq.models';

export interface FaqMatch {
  id: string;
  question: string;
  answer: string;
}

/** Lowercase, collapse everything that isn't a letter/number to single spaces. */
export function normalizeForMatch(text: string): string {
  return text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(' ');
}

function normalizeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map(normalizeForMatch).filter(Boolean))];
}

/**
 * Tier 3: the deterministic floor. No model, no embeddings — keywords are
 * normalised once on write, and matching is a whole-word/phrase test done in
 * SQL, so it keeps working when every AI dependency is down.
 */
@Injectable()
export class FaqService {
  constructor(
    private readonly db: DbService,
    private readonly tenant: TenantContext,
  ) {}

  async findBestMatch(query: string): Promise<FaqMatch | null> {
    const haystack = ` ${normalizeForMatch(query)} `;
    if (haystack.trim() === '') return null;
    const [row] = await this.db.query<FaqMatch>(
      `select id, question, answer from (
         select f.id, f.question, f.answer, f.created_at,
                count(kw.k) as score,
                coalesce(sum(length(kw.k)), 0) as matched_chars
         from faqs f
         left join lateral unnest(f.keywords) as kw(k) on position(' ' || kw.k || ' ' in $2) > 0
         where f.workspace_id = $1
         group by f.id
       ) s
       where score > 0
       order by score desc, matched_chars desc, created_at
       limit 1`,
      [this.tenant.requireWorkspaceId(), haystack],
    );
    return row ?? null;
  }

  async list(): Promise<Faq[]> {
    const rows = await this.db.query(
      'select id, question, answer, keywords, created_at from faqs where workspace_id = $1 order by created_at',
      [this.tenant.requireWorkspaceId()],
    );
    return rows.map(toFaq);
  }

  async create(input: FaqInput): Promise<Faq> {
    const [row] = await this.db.query(
      `insert into faqs (workspace_id, question, answer, keywords) values ($1, $2, $3, $4)
       returning id, question, answer, keywords, created_at`,
      [this.tenant.requireWorkspaceId(), input.question, input.answer, normalizeKeywords(input.keywords)],
    );
    return toFaq(row);
  }

  async update(id: string, input: FaqInput): Promise<Faq> {
    const [row] = await this.db.query(
      `update faqs set question = $2, answer = $3, keywords = $4 where id = $1
       returning id, question, answer, keywords, created_at`,
      [id, input.question, input.answer, normalizeKeywords(input.keywords)],
    );
    if (!row) throw new NotFoundException('FAQ not found');
    return toFaq(row);
  }

  async delete(id: string): Promise<boolean> {
    const rows = await this.db.query('delete from faqs where id = $1 returning id', [id]);
    if (rows.length === 0) throw new NotFoundException('FAQ not found');
    return true;
  }
}

function toFaq(r: any): Faq {
  return { id: r.id, question: r.question, answer: r.answer, keywords: r.keywords, createdAt: r.created_at };
}
