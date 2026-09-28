import { Check, Copy, ExternalLink, KeyRound, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { API_BASE, gqlErrorMessage } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { ROTATE_WIDGET_KEY, UPDATE_WIDGET_THEME, WIDGET_CONFIG_QUERY, type WidgetConfig } from '@/lib/gql';
import { relativeTime } from '@/lib/utils';

export default function WidgetPage() {
  const [{ data, fetching, error }] = useQuery<{ widgetConfig: WidgetConfig }>({ query: WIDGET_CONFIG_QUERY, requestPolicy: 'cache-and-network' });
  const canEdit = useCan('admin');
  const config = data?.widgetConfig;

  return (
    <>
      <PageHeader title="Widget" description="The public, unauthenticated chat embed. Scoped by a rotating key; answers only from public documents." />
      {error && <Alert variant="destructive" title="Could not load widget settings">{gqlErrorMessage(error)}</Alert>}
      {!config && fetching && <Skeleton className="h-48 w-full" />}
      {config && (
        <>
          {config.publicDocumentCount === 0 && (
            <Alert title="No public documents yet">
              The widget can only draw on documents marked <strong>Public</strong>. Until one is ready, visitors get FAQ answers or the hand-off message.
            </Alert>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            <EmbedCard config={config} canEdit={canEdit} />
            <ThemeCard config={config} canEdit={canEdit} />
          </div>
        </>
      )}
    </>
  );
}

function EmbedCard({ config, canEdit }: { config: WidgetConfig; canEdit: boolean }) {
  const [{ fetching }, rotate] = useMutation(ROTATE_WIDGET_KEY);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiBase = API_BASE || window.location.origin;
  const snippet = `<script src="${window.location.origin}/widget.js" data-omniio-key="${config.widgetKey}" data-api-base="${apiBase}" async></script>`;

  async function onRotate() {
    const ok = window.confirm('Rotate the widget key?\n\nEvery page embedding the current key stops working immediately until you update the snippet. Console sessions are unaffected.');
    if (!ok) return;
    const res = await rotate({});
    setError(res.error ? gqlErrorMessage(res.error) : null);
  }

  async function onCopy() {
    await navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Embed</CardTitle>
        <CardDescription>Paste before &lt;/body&gt; on any page. Rate-limited per visitor IP and per workspace.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-1">
          <span className="text-sm font-medium">Widget key</span>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md border bg-muted px-2 py-1.5 font-mono text-xs">{config.widgetKey}</code>
            {canEdit && (
              <Button variant="outline" size="sm" disabled={fetching} onClick={() => void onRotate()}>
                <KeyRound aria-hidden /> Rotate
              </Button>
            )}
          </div>
          <span className="text-xs text-muted-foreground">Last rotated {relativeTime(config.rotatedAt)}</span>
        </div>
        <div className="grid gap-1">
          <span className="text-sm font-medium">Snippet</span>
          <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">{snippet}</pre>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void onCopy()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />} {copied ? 'Copied' : 'Copy snippet'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => window.open(`/w/${config.widgetKey}`, '_blank', 'noopener')}>
              <ExternalLink aria-hidden /> Open hosted page
            </Button>
          </div>
        </div>
        {error && <Alert variant="destructive">{error}</Alert>}
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          The key is public by design (it's in your page source). It only allows asking questions against public documents — rotate it if it's being abused.
        </p>
      </CardContent>
    </Card>
  );
}

function ThemeCard({ config, canEdit }: { config: WidgetConfig; canEdit: boolean }) {
  const [theme, setTheme] = useState(config.theme);
  const [{ fetching }, save] = useMutation(UPDATE_WIDGET_THEME);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => setTheme(config.theme), [config.theme]);
  const set = (patch: Partial<WidgetConfig['theme']>) => setTheme((t) => ({ ...t, ...patch }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await save({ input: theme });
    setMessage(res.error ? { ok: false, text: gqlErrorMessage(res.error)! } : { ok: true, text: 'Saved — live on the next page load.' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Appearance</CardTitle>
        <CardDescription>{canEdit ? 'Shown to visitors on your site.' : 'Admins and owners can change this.'}</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={onSubmit}>
          <fieldset disabled={!canEdit} className="grid gap-3">
            <Field label="Title" htmlFor="w-title">
              <Input id="w-title" value={theme.title} maxLength={60} required onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label="Greeting" htmlFor="w-greeting">
              <Input id="w-greeting" value={theme.greeting} maxLength={200} required onChange={(e) => set({ greeting: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Accent colour" htmlFor="w-color">
                <div className="flex gap-2">
                  <input
                    type="color"
                    aria-label="Pick accent colour"
                    value={theme.primaryColor}
                    onChange={(e) => set({ primaryColor: e.target.value })}
                    className="h-9 w-10 cursor-pointer rounded-md border bg-transparent p-1"
                  />
                  <Input id="w-color" value={theme.primaryColor} pattern="#[0-9a-fA-F]{6}" onChange={(e) => set({ primaryColor: e.target.value })} className="font-mono" />
                </div>
              </Field>
              <Field label="Position" htmlFor="w-position">
                <Select id="w-position" value={theme.position} onChange={(e) => set({ position: e.target.value as 'left' | 'right' })}>
                  <option value="right">Bottom right</option>
                  <option value="left">Bottom left</option>
                </Select>
              </Field>
            </div>
          </fieldset>
          <div className="flex items-center gap-3 rounded-lg border p-3" aria-label="Preview">
            <span className="grid size-9 place-items-center rounded-full text-white" style={{ background: theme.primaryColor }} aria-hidden>
              ?
            </span>
            <div className="min-w-0 text-sm">
              <div className="font-medium">{theme.title}</div>
              <div className="truncate text-muted-foreground">{theme.greeting}</div>
            </div>
          </div>
          {canEdit && (
            <Button type="submit" disabled={fetching}>
              Save appearance
            </Button>
          )}
          {message && <p className={`text-xs ${message.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{message.text}</p>}
        </form>
      </CardContent>
    </Card>
  );
}
