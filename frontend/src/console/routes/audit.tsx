import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react';
import { Fragment, useEffect, useState } from 'react';
import { useQuery } from 'urql';
import { DecisionTrace, TIER_META, TierBadge } from '@/components/playground/ladder';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { gqlErrorMessage } from '@/lib/api';
import { ANSWERS_QUERY, type AnswerLog, type Channel, type Tier } from '@/lib/gql';
import { cn, pct } from '@/lib/utils';

const PAGE = 25;

interface AnswersData {
  answers: { total: number; totalTokens: number; tierCounts: { tier: Tier; count: number }[]; items: AnswerLog[] };
}

/** Every answer, which tier produced it, what it cost, and the full decision trace — for cost and quality review. */
export default function AuditPage() {
  const [tier, setTier] = useState<Tier | ''>('');
  const [channel, setChannel] = useState<Channel | ''>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);
  useEffect(() => setOffset(0), [tier, channel, search]);

  const filter = { tier: tier || undefined, channel: channel || undefined, search: search || undefined, limit: PAGE, offset };
  const [{ data, fetching, error }] = useQuery<AnswersData>({ query: ANSWERS_QUERY, variables: { filter }, requestPolicy: 'cache-and-network' });
  const page = data?.answers;
  const distributionTotal = page?.tierCounts.reduce((n, c) => n + c.count, 0) ?? 0;

  return (
    <>
      <PageHeader title="Answer audit" description="One row per question: tier, model, tokens, retrieved vs. cited chunks, and why the ladder decided what it did." />

      {page && distributionTotal > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Tier distribution</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label="Share of answers by tier">
              {page.tierCounts.map((c) => (
                <div key={c.tier} className={TIER_META[c.tier].color} style={{ width: `${(c.count / distributionTotal) * 100}%` }} />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              {page.tierCounts.map((c) => (
                <span key={c.tier} className="flex items-center gap-2">
                  <span className={cn('size-2.5 rounded-full', TIER_META[c.tier].color)} aria-hidden />
                  {TIER_META[c.tier].label}
                  <span className="tabular-nums text-muted-foreground">
                    {c.count} ({Math.round((c.count / distributionTotal) * 100)}%)
                  </span>
                </span>
              ))}
              <span className="ml-auto tabular-nums text-muted-foreground">{page.totalTokens.toLocaleString()} tokens</span>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex flex-wrap gap-2">
        <Input aria-label="Search questions" placeholder="Search questions…" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="max-w-xs" />
        <Select aria-label="Filter by tier" value={tier} onChange={(e) => setTier(e.target.value as Tier | '')} className="w-44">
          <option value="">All tiers</option>
          <option value="ai_answer">Tier 1 · AI answer</option>
          <option value="rag_snippets">Tier 2 · Snippets</option>
          <option value="faq_floor">Tier 3 · FAQ floor</option>
        </Select>
        <Select aria-label="Filter by channel" value={channel} onChange={(e) => setChannel(e.target.value as Channel | '')} className="w-36">
          <option value="">All channels</option>
          <option value="console">Console</option>
          <option value="widget">Widget</option>
          <option value="mcp">MCP</option>
        </Select>
      </div>

      {error && <Alert variant="destructive" title="Could not load the audit log">{gqlErrorMessage(error)}</Alert>}

      <Card>
        <CardContent>
          {!page && fetching ? (
            <Skeleton className="h-40 w-full" />
          ) : page?.items.length === 0 ? (
            <EmptyState icon={ScrollText} title={tier || channel || search ? 'No answers match these filters' : 'No answers yet'}>
              {!(tier || channel || search) && 'Ask something in the playground or through the widget and it will appear here.'}
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-6" />
                  <TableHead>When</TableHead>
                  <TableHead>Question</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Tokens in/out</TableHead>
                  <TableHead className="text-right">Conf.</TableHead>
                  <TableHead className="text-right">Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page?.items.map((a) => {
                  const open = expanded === a.id;
                  return (
                    <Fragment key={a.id}>
                      <TableRow className="cursor-pointer" onClick={() => setExpanded(open ? null : a.id)} aria-expanded={open}>
                        <TableCell>{open ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}</TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{new Date(a.createdAt).toLocaleString()}</TableCell>
                        <TableCell className="max-w-72 truncate" title={a.query}>
                          {a.query}
                        </TableCell>
                        <TableCell>
                          <TierBadge tier={a.tier} short />
                        </TableCell>
                        <TableCell className="capitalize">{a.channel}</TableCell>
                        <TableCell className="max-w-32 truncate text-muted-foreground" title={a.model ?? undefined}>
                          {a.model ?? '—'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.tokensIn != null ? `${a.tokensIn} / ${a.tokensOut}` : '—'}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(a.confidence)}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.latencyMs != null ? `${a.latencyMs} ms` : '—'}</TableCell>
                      </TableRow>
                      {open && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={9} className="bg-muted/30 p-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <div className="grid content-start gap-2 text-sm">
                                <Detail label="Question">{a.query}</Detail>
                                <Detail label="Decision">{a.decisionNote ?? '—'}</Detail>
                                <Detail label="Top similarity">{pct(a.topSimilarity)}</Detail>
                                <Detail label="Retrieved chunks">{a.retrievedChunkIds.length ? a.retrievedChunkIds.join(', ') : 'none'}</Detail>
                                <Detail label="Cited chunks">{a.citedChunkIds.length ? a.citedChunkIds.join(', ') : 'none'}</Detail>
                                {a.faqMatchId && <Detail label="FAQ match">{a.faqMatchId}</Detail>}
                              </div>
                              <div className="grid content-start gap-2">
                                <span className="text-sm font-medium text-muted-foreground">Decision trace</span>
                                <DecisionTrace steps={a.decisionTrace} />
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
          {page && page.total > PAGE && (
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>
                {offset + 1}–{Math.min(offset + PAGE, page.total)} of {page.total}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset((o) => Math.max(0, o - PAGE))}>
                  Previous
                </Button>
                <Button variant="outline" size="sm" disabled={offset + PAGE >= page.total} onClick={() => setOffset((o) => o + PAGE)}>
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}
