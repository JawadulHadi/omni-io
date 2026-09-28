import { History, Loader2, SendHorizontal } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useOutletContext } from 'react-router-dom';
import { useMutation } from 'urql';
import { CitationList, DecisionTrace, TIER_META, TierBadge } from '@/components/playground/ladder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import type { ShellData } from '@/components/layout/console-layout';
import { gqlErrorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ASK_QUESTION, UPDATE_LADDER, type AnswerResult } from '@/lib/gql';
import { pct } from '@/lib/utils';

// Built at runtime so Tailwind's class scanner doesn't mistake the markers for arbitrary CSS properties.
const FAILURE_MARKERS = ['error', 'timeout', 'json', 'lowconf', 'cite'].map((mode) => '[fail' + ':' + mode + ']');

/**
 * Shows support staff *why* an answer looked the way it did: which rung of the
 * resilience ladder answered, the exact passages behind it, and every decision
 * on the way — the same trace the audit log stores.
 */
export default function PlaygroundPage() {
  const shell = useOutletContext<ShellData | undefined>();
  const [{ fetching }, ask] = useMutation<{ askQuestion: AnswerResult }>(ASK_QUESTION);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ query: string; result: AnswerResult }[]>([]);
  const [selected, setSelected] = useState(0);
  const current = history[selected];

  async function onAsk(e?: FormEvent) {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setError(null);
    const res = await ask({ query: q });
    if (res.error || !res.data) return setError(gqlErrorMessage(res.error) ?? 'No answer returned');
    setHistory((h) => [{ query: q, result: res.data!.askQuestion }, ...h].slice(0, 20));
    setSelected(0);
  }

  return (
    <>
      <PageHeader title="Playground" description="Ask what a customer would ask. See which rung of the ladder answered, and why." />
      <div className="grid items-start gap-6 lg:grid-cols-[1fr_300px]">
        <div className="grid gap-6">
          <Card>
            <CardContent>
              <form onSubmit={onAsk} className="grid gap-3">
                <Textarea
                  aria-label="Question"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void onAsk();
                  }}
                  maxLength={1000}
                  placeholder="e.g. How long do refunds take to reach my card?"
                  className="min-h-24"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {shell?.systemInfo.aiProvider === 'fake' ? (
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>Force a Tier 1 failure:</span>
                      {FAILURE_MARKERS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="rounded border px-1.5 py-0.5 font-mono hover:bg-accent hover:text-foreground"
                          onClick={() => setQuery((q) => `${q.replace(/\s*\[fail:\w+\]/g, '')} ${m}`.trim())}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">Ctrl/⌘ + Enter to ask</span>
                  )}
                  <Button type="submit" disabled={fetching || !query.trim()}>
                    {fetching ? <Loader2 className="animate-spin" aria-hidden /> : <SendHorizontal aria-hidden />}
                    Ask
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {error && <Alert variant="destructive" title="Request failed">{error}</Alert>}
          {current ? <ResultCard result={current.result} /> : <LadderExplainer />}
        </div>

        <div className="grid gap-6">
          {shell && <LadderSettingsCard key={shell.workspace.id} threshold={shell.workspace.confidenceThreshold} floor={shell.workspace.similarityFloor} />}
          {history.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <History className="size-4" aria-hidden /> This session
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-1">
                  {history.map((h, i) => (
                    <li key={h.result.answerId}>
                      <button
                        type="button"
                        onClick={() => setSelected(i)}
                        aria-current={i === selected}
                        className="grid w-full gap-1 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent aria-[current=true]:bg-accent"
                      >
                        <span className="truncate">{h.query}</span>
                        <TierBadge tier={h.result.tier} short />
                      </button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ResultCard({ result }: { result: AnswerResult }) {
  return (
    <Card aria-live="polite">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <TierBadge tier={result.tier} />
          <span className="text-xs text-muted-foreground">{TIER_META[result.tier].blurb}</span>
          <span className="ml-auto flex gap-3 text-xs tabular-nums text-muted-foreground">
            {result.confidence != null && <span>confidence {pct(result.confidence)}</span>}
            {result.topSimilarity != null && <span>top similarity {pct(result.topSimilarity)}</span>}
            <span>{result.latencyMs} ms</span>
          </span>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <p className="whitespace-pre-wrap leading-relaxed">{result.answer}</p>
        {result.citations.length > 0 && (
          <section className="grid gap-2">
            <h3 className="text-sm font-medium text-muted-foreground">{result.tier === 'rag_snippets' ? 'Excerpts' : 'Citations'}</h3>
            <CitationList citations={result.citations} />
          </section>
        )}
        <section className="grid gap-2 border-t pt-4">
          <h3 className="text-sm font-medium text-muted-foreground">Decision trace</h3>
          <DecisionTrace steps={result.trace} />
        </section>
      </CardContent>
    </Card>
  );
}

function LadderExplainer() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">How an answer is chosen</CardTitle>
        <CardDescription>Every question walks down the same ladder, and always gets an answer back.</CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="grid gap-3 text-sm">
          {(Object.keys(TIER_META) as (keyof typeof TIER_META)[]).map((tier) => (
            <li key={tier} className="flex items-start gap-3">
              <TierBadge tier={tier} short />
              <span className="text-muted-foreground">{TIER_META[tier].blurb}</span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function LadderSettingsCard({ threshold, floor }: { threshold: number; floor: number }) {
  const canEdit = useCan('admin');
  const [values, setValues] = useState({ threshold: String(threshold), floor: String(floor) });
  const [{ fetching }, save] = useMutation(UPDATE_LADDER);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setValues({ threshold: String(threshold), floor: String(floor) }), [threshold, floor]);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    const res = await save({ input: { confidenceThreshold: Number(values.threshold), similarityFloor: Number(values.floor) } });
    setMessage(res.error ? { ok: false, text: gqlErrorMessage(res.error)! } : { ok: true, text: 'Saved' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Ladder settings</CardTitle>
        <CardDescription>{canEdit ? 'Per workspace. Admins and owners can change these.' : 'Read-only for your role.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSave}>
          <Field label="Confidence threshold" htmlFor="threshold" hint="Tier 1 answers below this fall to Tier 2.">
            <Input id="threshold" type="number" min={0} max={1} step={0.05} disabled={!canEdit} value={values.threshold} onChange={(e) => setValues((v) => ({ ...v, threshold: e.target.value }))} />
          </Field>
          <Field label="Similarity floor" htmlFor="floor" hint="Retrieval below this skips straight to Tier 3.">
            <Input id="floor" type="number" min={0} max={1} step={0.05} disabled={!canEdit} value={values.floor} onChange={(e) => setValues((v) => ({ ...v, floor: e.target.value }))} />
          </Field>
          {canEdit && (
            <Button type="submit" size="sm" variant="outline" disabled={fetching}>
              Save settings
            </Button>
          )}
          {message && <p className={message.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>{message.text}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
