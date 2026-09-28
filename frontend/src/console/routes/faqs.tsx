import { ListChecks, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Textarea } from '@/components/ui/form-controls';
import { gqlErrorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { CREATE_FAQ, DELETE_FAQ, FAQS_QUERY, UPDATE_FAQ, type Faq } from '@/lib/gql';

const parseKeywords = (raw: string) =>
  raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

export default function FaqsPage() {
  const context = useMemo(() => ({ additionalTypenames: ['Faq'] }), []);
  const [{ data, fetching, error }] = useQuery<{ faqs: Faq[] }>({ query: FAQS_QUERY, context });
  const canEdit = useCan('editor');

  return (
    <>
      <PageHeader
        title="FAQs"
        description="Tier 3 — the deterministic floor. Keyword-matched, no model involved, so it still works when every AI dependency is down."
      />
      {canEdit && <FaqForm />}
      {error && <Alert variant="destructive" title="Could not load FAQs">{gqlErrorMessage(error)}</Alert>}
      {!data && fetching ? (
        <Skeleton className="h-32 w-full" />
      ) : data?.faqs.length === 0 ? (
        <EmptyState icon={ListChecks} title="No FAQs yet">
          Without them, questions that fall to Tier 3 get the human hand-off message.
        </EmptyState>
      ) : (
        <div className="grid gap-3">
          {data?.faqs.map((faq) => (
            <FaqCard key={faq.id} faq={faq} canEdit={canEdit} />
          ))}
        </div>
      )}
    </>
  );
}

function FaqForm({ faq, onDone }: { faq?: Faq; onDone?: () => void }) {
  const [{ fetching: creating }, create] = useMutation(CREATE_FAQ);
  const [{ fetching: updating }, update] = useMutation(UPDATE_FAQ);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const input = {
      question: String(form.get('question')),
      answer: String(form.get('answer')),
      keywords: parseKeywords(String(form.get('keywords'))),
    };
    if (input.keywords.length === 0) return setError('Add at least one keyword — FAQs match on keywords.');
    const res = faq ? await update({ id: faq.id, input }) : await create({ input });
    if (res.error) return setError(gqlErrorMessage(res.error));
    setError(null);
    if (!faq) formEl.reset();
    onDone?.();
  }

  const body = (
    <form className="grid gap-3" onSubmit={onSubmit}>
      <Field label="Question" htmlFor={`q-${faq?.id ?? 'new'}`}>
        <Input id={`q-${faq?.id ?? 'new'}`} name="question" required maxLength={500} defaultValue={faq?.question} />
      </Field>
      <Field label="Answer" htmlFor={`a-${faq?.id ?? 'new'}`}>
        <Textarea id={`a-${faq?.id ?? 'new'}`} name="answer" required maxLength={4000} defaultValue={faq?.answer} />
      </Field>
      <Field label="Keywords" htmlFor={`k-${faq?.id ?? 'new'}`} hint="Comma-separated words or phrases, matched as whole words, e.g. reset password, forgot password">
        <Input id={`k-${faq?.id ?? 'new'}`} name="keywords" required defaultValue={faq?.keywords.join(', ')} />
      </Field>
      {error && <Alert variant="destructive">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" disabled={creating || updating}>
          {faq ? 'Save' : 'Add FAQ'}
        </Button>
        {faq && (
          <Button type="button" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );

  if (faq) return body;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New FAQ</CardTitle>
        <CardDescription>Matched when any keyword appears in the customer's question; most keyword hits wins.</CardDescription>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}

function FaqCard({ faq, canEdit }: { faq: Faq; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [{ fetching }, remove] = useMutation(DELETE_FAQ);
  const [error, setError] = useState<string | null>(null);

  async function onDelete() {
    if (!window.confirm(`Delete the FAQ "${faq.question}"?`)) return;
    const res = await remove({ id: faq.id }, { additionalTypenames: ['Faq'] });
    if (res.error) setError(gqlErrorMessage(res.error));
  }

  return (
    <Card className="py-4">
      <CardContent className="grid gap-3">
        {editing ? (
          <FaqForm faq={faq} onDone={() => setEditing(false)} />
        ) : (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="grid gap-1">
                <p className="font-medium">{faq.question}</p>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{faq.answer}</p>
              </div>
              {canEdit && (
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="icon" aria-label="Edit FAQ" onClick={() => setEditing(true)}>
                    <Pencil />
                  </Button>
                  <Button variant="ghost" size="icon" aria-label="Delete FAQ" disabled={fetching} onClick={() => void onDelete()}>
                    <Trash2 />
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-1">
              {faq.keywords.map((k) => (
                <Badge key={k} variant="secondary">
                  {k}
                </Badge>
              ))}
            </div>
            {error && <Alert variant="destructive">{error}</Alert>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
