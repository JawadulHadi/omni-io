import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/feedback';
import type { DocumentRow, IngestionProgress } from '@/lib/gql';

/** Status badge that switches to a live progress bar while the worker is embedding. */
export function DocumentStatus({ doc, live }: { doc: DocumentRow; live?: IngestionProgress }) {
  const inProgress = live && (live.status === 'processing' || live.status === 'retrying') && doc.status !== 'ready';
  if (inProgress) {
    return (
      <div className="grid min-w-32 gap-1">
        <span className="text-xs text-muted-foreground">
          {live.status === 'retrying' ? 'Retrying…' : 'Embedding'} {live.percent}%
        </span>
        <ProgressBar value={live.percent} label={`Ingestion progress for ${doc.title}`} />
      </div>
    );
  }
  switch (doc.status) {
    case 'ready':
      return <Badge variant="tier1">Ready</Badge>;
    case 'failed':
      return (
        <Badge variant="tier3" title={doc.error ?? undefined}>
          Failed
        </Badge>
      );
    case 'processing':
      return <Badge variant="tier2">Processing</Badge>;
    default:
      return <Badge variant="secondary">Queued</Badge>;
  }
}
