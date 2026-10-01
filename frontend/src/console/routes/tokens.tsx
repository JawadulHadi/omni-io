import { KeyRound, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { API_BASE, gqlErrorMessage } from '@/lib/api';
import { API_TOKENS_QUERY, CREATE_API_TOKEN, REVOKE_API_TOKEN, type ApiToken } from '@/lib/gql';
import { relativeTime } from '@/lib/utils';

const EXPIRY_OPTIONS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: '', label: 'Never' },
];

/** Personal access tokens for MCP clients (Claude, Cursor, …), which can't use the console's refresh cookie. */
export default function TokensPage() {
  const context = useMemo(() => ({ additionalTypenames: ['ApiToken'] }), []);
  const [{ data, fetching, error }] = useQuery<{ apiTokens: ApiToken[] }>({ query: API_TOKENS_QUERY, context });
  const [, revoke] = useMutation(REVOKE_API_TOKEN);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onRevoke(t: ApiToken) {
    if (!window.confirm(`Revoke "${t.name}"? Clients using it stop working immediately.`)) return;
    const res = await revoke({ id: t.id }, { additionalTypenames: ['ApiToken'] });
    setActionError(res.error ? gqlErrorMessage(res.error) : null);
  }

  return (
    <>
      <PageHeader
        title="API tokens"
        description="Personal tokens for MCP clients. A token acts as you — in every workspace you belong to, with your current role — and only works on /mcp."
      />
      <CreateTokenCard />
      {error && <Alert variant="destructive" title="Could not load tokens">{gqlErrorMessage(error)}</Alert>}
      {actionError && <Alert variant="destructive">{actionError}</Alert>}
      <Card>
        <CardContent>
          {!data && fetching ? (
            <Skeleton className="h-24 w-full" />
          ) : data?.apiTokens.length === 0 ? (
            <EmptyState icon={KeyRound} title="No active tokens" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last used</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.apiTokens.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="font-medium">{t.name}</TableCell>
                    <TableCell className="text-muted-foreground">{relativeTime(t.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground">{t.lastUsedAt ? relativeTime(t.lastUsedAt) : 'Never'}</TableCell>
                    <TableCell className="text-muted-foreground">{t.expiresAt ? new Date(t.expiresAt).toLocaleDateString() : 'Never'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" aria-label={`Revoke ${t.name}`} onClick={() => void onRevoke(t)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CreateTokenCard() {
  const [{ fetching }, create] = useMutation(CREATE_API_TOKEN);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mcpUrl = `${API_BASE || window.location.origin}/mcp`;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const days = String(form.get('expires'));
    const res = await create(
      { input: { name: String(form.get('name')).trim(), expiresInDays: days ? Number(days) : null } },
      { additionalTypenames: ['ApiToken'] },
    );
    if (res.error) return setError(gqlErrorMessage(res.error));
    setError(null);
    setToken(res.data.createApiToken.token);
    formEl.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">New token</CardTitle>
        <CardDescription>
          Point your MCP client at <code>{mcpUrl}</code> (Streamable HTTP) with the header <code>Authorization: Bearer &lt;token&gt;</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end" onSubmit={onSubmit}>
          <Field label="Name" htmlFor="token-name" hint="Where it will be used, e.g. Claude Desktop on my laptop.">
            <Input id="token-name" name="name" required maxLength={100} />
          </Field>
          <Field label="Expires" htmlFor="token-expires">
            <Select id="token-expires" name="expires" defaultValue="90">
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.label} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={fetching} className="sm:mb-5">
            <KeyRound aria-hidden /> Create token
          </Button>
        </form>
        {error && <Alert variant="destructive">{error}</Alert>}
        {token && (
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Your token — shown once, copy it now</p>
            <CopyField value={token} label="API token" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
