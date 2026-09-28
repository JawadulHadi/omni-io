import { CheckCircle2, CircleSlash, FileText, TriangleAlert, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import type { Citation, Tier, TraceOutcome, TraceStep } from '@/lib/gql';
import { cn, pct } from '@/lib/utils';

export const TIER_META: Record<Tier, { label: string; short: string; variant: 'tier1' | 'tier2' | 'tier3'; color: string; blurb: string }> = {
  ai_answer: { label: 'Tier 1 · AI answer', short: 'Tier 1', variant: 'tier1', color: 'bg-tier-1', blurb: 'Model answer with verified citations' },
  rag_snippets: { label: 'Tier 2 · Snippets', short: 'Tier 2', variant: 'tier2', color: 'bg-tier-2', blurb: 'Top excerpts, verbatim — no model' },
  faq_floor: { label: 'Tier 3 · FAQ floor', short: 'Tier 3', variant: 'tier3', color: 'bg-tier-3', blurb: 'Deterministic FAQ or human hand-off' },
};

export function TierBadge({ tier, short = false }: { tier: Tier; short?: boolean }) {
  const meta = TIER_META[tier];
  return <Badge variant={meta.variant}>{short ? meta.short : meta.label}</Badge>;
}

const OUTCOME: Record<TraceOutcome, { icon: typeof CheckCircle2; className: string; label: string }> = {
  ok: { icon: CheckCircle2, className: 'text-tier-1', label: 'passed' },
  rejected: { icon: TriangleAlert, className: 'text-tier-2', label: 'rejected' },
  failed: { icon: XCircle, className: 'text-tier-3', label: 'failed' },
  skipped: { icon: CircleSlash, className: 'text-muted-foreground', label: 'skipped' },
};

const STEP_LABEL: Record<string, string> = {
  load_settings: 'Load ladder settings',
  retrieve: 'Embed question + vector search',
  similarity_floor: 'Similarity floor',
  tier1_generate: 'Tier 1 · model call',
  tier1_validate: 'Tier 1 · validate JSON, citations, confidence',
  tier2_snippets: 'Tier 2 · return excerpts',
  tier3_faq: 'Tier 3 · FAQ keyword match',
};

/** The "why" behind an answer: every rung the ladder tried, in order. */
export function DecisionTrace({ steps }: { steps: TraceStep[] }) {
  return (
    <ol className="grid gap-2" aria-label="Decision trace">
      {steps.map((s, i) => {
        const o = OUTCOME[s.outcome];
        return (
          <li key={i} className="grid grid-cols-[auto_1fr_auto] items-start gap-2 text-sm">
            <o.icon className={cn('mt-0.5 size-4', o.className)} aria-label={o.label} />
            <div className="min-w-0">
              <div className="font-medium">{STEP_LABEL[s.step] ?? s.step}</div>
              {s.detail && <div className="break-words text-muted-foreground">{s.detail}</div>}
            </div>
            <span className="tabular-nums text-xs text-muted-foreground">{s.ms} ms</span>
          </li>
        );
      })}
    </ol>
  );
}

export function CitationList({ citations }: { citations: Citation[] }) {
  return (
    <ul className="grid gap-2">
      {citations.map((c) => (
        <CitationItem key={c.chunkId} citation={c} />
      ))}
    </ul>
  );
}

function CitationItem({ citation }: { citation: Citation }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded-lg border bg-muted/40 p-3 text-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <FileText className="size-3.5" aria-hidden />
        <span className="font-medium text-foreground">{citation.documentTitle}</span>
        <span>· chunk {citation.chunkId.split(':')[1]}</span>
        <span className="ml-auto tabular-nums">similarity {pct(citation.similarity)}</span>
      </div>
      <p className={cn('whitespace-pre-wrap', !open && 'line-clamp-3')}>{citation.snippet}</p>
      {citation.snippet.length > 240 && (
        <button type="button" className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setOpen((v) => !v)}>
          {open ? 'Show less' : 'Show full excerpt'}
        </button>
      )}
    </li>
  );
}
