import { FileText, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { DocumentStatus } from '@/components/ingestion/document-status';
import { useIngestionProgress } from '@/components/ingestion/progress-context';
import { UploadDropzone } from '@/components/ingestion/upload-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select, Textarea } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { gqlErrorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import {
  CREATE_DOCUMENT,
  DELETE_DOCUMENT,
  DOCUMENTS_QUERY,
  RETRY_INGESTION,
  SET_VISIBILITY,
  type DocumentRow,
  type Visibility,
} from '@/lib/gql';
import { formatBytes, relativeTime } from '@/lib/utils';

export default function DocumentsPage() {
  const context = useMemo(() => ({ additionalTypenames: ['Document'] }), []);
  const [{ data, fetching, error }, refetch] = useQuery<{ documents: DocumentRow[] }>({ query: DOCUMENTS_QUERY, context });
  const canEdit = useCan('editor');
  const reload = () => refetch({ requestPolicy: 'network-only' });

  return (
    <>
      <PageHeader title="Documents" description="The knowledge base every answer is grounded in. Only public documents are visible to the widget." />

      {canEdit && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload a file</CardTitle>
            </CardHeader>
            <CardContent>
              <UploadDropzone onUploaded={reload} />
            </CardContent>
          </Card>
          <PasteCard />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All documents</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <Alert variant="destructive" title="Could not load documents">{gqlErrorMessage(error)}</Alert>
          ) : !data && fetching ? (
            <Skeleton className="h-32 w-full" />
          ) : data?.documents.length === 0 ? (
            <EmptyState icon={FileText} title="No documents yet">
              Upload a PDF or paste text above. Until then every question falls through to the FAQ floor.
            </EmptyState>
          ) : (
            <DocumentsTable documents={data?.documents ?? []} canEdit={canEdit} />
          )}
        </CardContent>
      </Card>
    </>
  );
}

function PasteCard() {
  const [{ fetching }, create] = useMutation(CREATE_DOCUMENT);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError(null);
    const res = await create({
      input: { title: String(form.get('title')), content: String(form.get('content')), visibility: String(form.get('visibility')) as Visibility },
    });
    if (res.error) return setError(gqlErrorMessage(res.error));
    formEl.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Paste text</CardTitle>
        <CardDescription>Release notes, policies, macros — anything plain-text.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <Field label="Title" htmlFor="doc-title">
            <Input id="doc-title" name="title" required maxLength={200} />
          </Field>
          <Field label="Content" htmlFor="doc-content">
            <Textarea id="doc-content" name="content" required maxLength={1_000_000} className="min-h-28" />
          </Field>
          <div className="flex items-end justify-between gap-3">
            <Field label="Visibility" htmlFor="doc-visibility">
              <Select id="doc-visibility" name="visibility" defaultValue="internal">
                <option value="internal">Internal</option>
                <option value="public">Public</option>
              </Select>
            </Field>
            <Button type="submit" disabled={fetching}>
              {fetching && <Loader2 className="animate-spin" aria-hidden />}
              Add document
            </Button>
          </div>
          {error && <Alert variant="destructive">{error}</Alert>}
        </form>
      </CardContent>
    </Card>
  );
}

function DocumentsTable({ documents, canEdit }: { documents: DocumentRow[]; canEdit: boolean }) {
  const progress = useIngestionProgress();
  const canErase = useCan('admin');
  const [, setVisibility] = useMutation(SET_VISIBILITY);
  const [, retry] = useMutation(RETRY_INGESTION);
  const [, erase] = useMutation(DELETE_DOCUMENT);
  const [error, setError] = useState<string | null>(null);

  const run = async (p: Promise<{ error?: Parameters<typeof gqlErrorMessage>[0] }>) => {
    const res = await p;
    setError(res.error ? gqlErrorMessage(res.error) : null);
  };

  function onErase(doc: DocumentRow) {
    const ok = window.confirm(
      `Permanently erase "${doc.title}"?\n\nThis deletes the document, all of its vectors, the original file, and scrubs it from the answer audit log. It cannot be undone.`,
    );
    if (ok) void run(erase({ id: doc.id }, { additionalTypenames: ['Document'] }));
  }

  return (
    <div className="grid gap-3">
      {error && <Alert variant="destructive">{error}</Alert>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Visibility</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Chunks</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="sr-only">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {documents.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell className="max-w-72">
                <div className="truncate font-medium" title={doc.title}>
                  {doc.title}
                </div>
                <div className="text-xs text-muted-foreground">
                  {doc.sourceType === 'upload' ? 'Upload' : 'Pasted'}
                  {doc.byteSize ? ` · ${formatBytes(doc.byteSize)}` : ''}
                </div>
                {doc.status === 'failed' && doc.error && <div className="mt-1 text-xs text-destructive">{doc.error}</div>}
              </TableCell>
              <TableCell>
                <Select
                  aria-label={`Visibility of ${doc.title}`}
                  value={doc.visibility}
                  disabled={!canEdit}
                  onChange={(e) => void run(setVisibility({ id: doc.id, visibility: e.target.value }))}
                  className="h-8 w-28"
                >
                  <option value="internal">Internal</option>
                  <option value="public">Public</option>
                </Select>
              </TableCell>
              <TableCell>
                <DocumentStatus doc={doc} live={progress[doc.id]} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{doc.chunkCount || '—'}</TableCell>
              <TableCell className="whitespace-nowrap text-muted-foreground">{relativeTime(doc.createdAt)}</TableCell>
              <TableCell>
                <div className="flex justify-end gap-1">
                  {canEdit && doc.status === 'failed' && (
                    <Button variant="ghost" size="icon" aria-label={`Retry ingestion of ${doc.title}`} onClick={() => void run(retry({ id: doc.id }))}>
                      <RotateCcw />
                    </Button>
                  )}
                  {canErase && (
                    <Button variant="ghost" size="icon" aria-label={`Erase ${doc.title}`} onClick={() => onErase(doc)}>
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
