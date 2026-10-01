import { Link2, UserMinus, Users, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { gqlErrorMessage } from '@/lib/api';
import { ROLE_RANK, useSession, type Role } from '@/lib/auth';
import {
  CREATE_INVITATION,
  INVITATIONS_QUERY,
  MEMBERS_QUERY,
  REMOVE_MEMBER,
  REVOKE_INVITATION,
  UPDATE_MEMBER_ROLE,
  type Invitation,
  type Member,
} from '@/lib/gql';
import { relativeTime } from '@/lib/utils';

const ROLES: Role[] = ['viewer', 'editor', 'admin', 'owner'];
const ROLE_HELP: Record<Role, string> = {
  viewer: 'Read everything, ask in the playground',
  editor: 'Manage documents and FAQs',
  admin: 'Members, widget, ladder settings, erasure',
  owner: 'Everything, including other owners',
};

export default function MembersPage() {
  const session = useSession();
  const myRank = ROLE_RANK[session.role];
  const isAdmin = myRank >= ROLE_RANK.admin;
  const grantable = ROLES.filter((r) => ROLE_RANK[r] <= myRank);
  const context = useMemo(() => ({ additionalTypenames: ['Member'] }), []);
  const [{ data, fetching, error }] = useQuery<{ members: Member[] }>({ query: MEMBERS_QUERY, context });
  const [, updateRole] = useMutation(UPDATE_MEMBER_ROLE);
  const [, remove] = useMutation(REMOVE_MEMBER);
  const [actionError, setActionError] = useState<string | null>(null);

  async function onRole(userId: string, role: Role) {
    const res = await updateRole({ input: { userId, role } });
    setActionError(res.error ? gqlErrorMessage(res.error) : null);
  }

  async function onRemove(m: Member) {
    if (!window.confirm(`Remove ${m.email} from this workspace? They lose access immediately.`)) return;
    const res = await remove({ userId: m.userId }, { additionalTypenames: ['Member'] });
    setActionError(res.error ? gqlErrorMessage(res.error) : null);
  }

  return (
    <>
      <PageHeader title="Members" description="Roles are checked against this list on every request — changes apply immediately, not at next sign-in." />
      {isAdmin && <InviteCard grantable={grantable} />}
      {isAdmin && <PendingInvitations />}
      {error && <Alert variant="destructive" title="Could not load members">{gqlErrorMessage(error)}</Alert>}
      {actionError && <Alert variant="destructive">{actionError}</Alert>}
      <Card>
        <CardContent>
          {!data && fetching ? (
            <Skeleton className="h-24 w-full" />
          ) : data?.members.length === 0 ? (
            <EmptyState icon={Users} title="No members" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead className="sr-only">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.members.map((m) => {
                  const isMe = m.userId === session.userId;
                  const editable = isAdmin && !isMe && ROLE_RANK[m.role] <= myRank;
                  return (
                    <TableRow key={m.userId}>
                      <TableCell>
                        <div className="font-medium">
                          {m.displayName ?? m.email} {isMe && <Badge variant="outline">You</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{m.email}</div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <Select aria-label={`Role of ${m.email}`} value={m.role} onChange={(e) => void onRole(m.userId, e.target.value as Role)} className="h-8 w-28">
                            {grantable.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </Select>
                        ) : (
                          <Badge variant="secondary" className="capitalize">
                            {m.role}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{relativeTime(m.createdAt)}</TableCell>
                      <TableCell className="text-right">
                        {editable && (
                          <Button variant="ghost" size="icon" aria-label={`Remove ${m.email}`} onClick={() => void onRemove(m)}>
                            <UserMinus />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function InviteCard({ grantable }: { grantable: Role[] }) {
  const [{ fetching }, create] = useMutation(CREATE_INVITATION);
  const [role, setRole] = useState<Role>('viewer');
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const label = String(new FormData(formEl).get('label') ?? '').trim();
    const res = await create({ input: { role, label: label || null } }, { additionalTypenames: ['Invitation'] });
    if (res.error) return setError(gqlErrorMessage(res.error));
    setError(null);
    setLink(`${window.location.origin}/invite/${res.data.createInvitation.token}`);
    formEl.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invite someone</CardTitle>
        <CardDescription>
          Creates a single-use link, valid for 7 days. Send it to them yourself; they join once they open it and sign in or create an account. You can grant any role
          up to your own.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={onSubmit}>
          <Field label="For (optional)" htmlFor="invite-label" hint="A name or email, so you can tell pending links apart.">
            <Input id="invite-label" name="label" maxLength={200} placeholder="sam@example.com" />
          </Field>
          <Field label="Role" htmlFor="invite-role" hint={ROLE_HELP[role]}>
            <Select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {grantable.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={fetching} className="sm:mb-5">
            <Link2 aria-hidden /> Create link
          </Button>
        </form>
        {error && <Alert variant="destructive">{error}</Alert>}
        {link && (
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Invite link — shown once, copy it now</p>
            <CopyField value={link} label="Invite link" />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PendingInvitations() {
  const context = useMemo(() => ({ additionalTypenames: ['Invitation'] }), []);
  const [{ data }] = useQuery<{ invitations: Invitation[] }>({ query: INVITATIONS_QUERY, context });
  const [, revoke] = useMutation(REVOKE_INVITATION);
  const [error, setError] = useState<string | null>(null);

  if (!data?.invitations.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Pending invitations</CardTitle>
        <CardDescription>Links that haven't been used yet. Revoking one stops it working immediately.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {error && <Alert variant="destructive">{error}</Alert>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>For</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Expires</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.invitations.map((inv) => (
              <TableRow key={inv.id}>
                <TableCell>{inv.label ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="capitalize">
                    {inv.role}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{new Date(inv.expiresAt).toLocaleDateString()}</TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Revoke invitation${inv.label ? ` for ${inv.label}` : ''}`}
                    onClick={async () => {
                      const res = await revoke({ id: inv.id }, { additionalTypenames: ['Invitation'] });
                      setError(res.error ? gqlErrorMessage(res.error) : null);
                    }}
                  >
                    <X />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
