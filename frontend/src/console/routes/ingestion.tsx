import { CheckCircle2, RotateCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from 'urql';
import { DocumentStatus } from '@/components/ingestion/document-status';
import { useIngestionProgress } from '@/components/ingestion/progress-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { gqlErrorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { INGESTION_DOCUMENTS_QUERY, RETRY_INGESTION, type DocumentRow } from '@/lib/gql';
import { relativeTime } from '@/lib/utils';

/** The job view: what the worker is doing right now, and what needs a retry. */
export default function IngestionPage() {
  const context = useMemo(() => ({ additionalTypenames: ['Document'] }), []);
  const [{ data, fetching, error }] = useQuery<{ documents: DocumentRow[] }>({ query: INGESTION_DOCUMENTS_QUERY, context });
  const progress = useIngestionProgress();
  const canRetry = useCan('editor');
  const [, retry] = useMutation(RETRY_INGESTION);
  const [retryError, setRetryError] = useState<string | null>(null);

  const docs = data?.documents ?? [];
  const active = docs.filter((d) => d.status === 'pending' || d.status === 'processing' || progress[d.id]?.status === 'retrying');
  const failed = docs.filter((d) => d.status === 'failed' && !active.includes(d));
  const ready = docs.filter((d) => d.status === 'ready');

  async function onRetry(id: string) {
    const res = await retry({ id });
    setRetryError(res.error ? gqlErrorMessage(res.error) : null);
  }

  return (
    <>
      <PageHeader title="Ingestion" description="Chunking (1,200 chars, 200 overlap) and embedding run in a separate worker; progress streams here live." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="In progress" value={active.length} />
        <Stat label="Failed" value={failed.length} tone={failed.length ? 'text-destructive' : undefined} />
        <Stat label="Indexed" value={ready.length} />
      </div>

      {error && <Alert variant="destructive" title="Could not load jobs">{gqlErrorMessage(error)}</Alert>}
      {retryError && <Alert variant="destructive">{retryError}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {!data && fetching ? (
            <Skeleton className="h-24 w-full" />
          ) : active.length + failed.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="The ingestion queue is empty">
              {ready.length ? `All ${ready.length} document(s) are indexed and searchable.` : 'Add a document to start indexing.'}
            </EmptyState>
          ) : (
            <ul className="grid gap-3">
              {[...active, ...failed].map((doc) => (
                <li key={doc.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{doc.title}</div>
                    <div className="text-xs text-muted-foreground">Queued {relativeTime(doc.createdAt)}</div>
                    {(progress[doc.id]?.error ?? doc.error) && <div className="mt-1 text-xs text-destructive">{progress[doc.id]?.error ?? doc.error}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <DocumentStatus doc={doc} live={progress[doc.id]} />
                    {canRetry && doc.status === 'failed' && (
                      <Button size="sm" variant="outline" onClick={() => void onRetry(doc.id)}>
                        <RotateCcw aria-hidden /> Retry
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <Card className="py-4">
      <CardContent className="grid gap-1">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className={`text-2xl font-semibold tabular-nums ${tone ?? ''}`}>{value}</span>
      </CardContent>
    </Card>
  );
}
