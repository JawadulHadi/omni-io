import { UserMinus, Users } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from 'urql';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Field, Input, Select } from '@/components/ui/form-controls';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { gqlErrorMessage } from '@/lib/api';
import { ROLE_RANK, useSession, type Role } from '@/lib/auth';
import { INVITE_MEMBER, MEMBERS_QUERY, REMOVE_MEMBER, UPDATE_MEMBER_ROLE, type Member } from '@/lib/gql';
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
  const [{ fetching }, invite] = useMutation(INVITE_MEMBER);
  const [role, setRole] = useState<Role>('viewer');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const email = String(new FormData(formEl).get('email'));
    const res = await invite({ input: { email, role } });
    if (res.error) return setMessage({ ok: false, text: gqlErrorMessage(res.error)! });
    setMessage({ ok: true, text: `${email} added as ${role}.` });
    formEl.reset();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Add a member</CardTitle>
        <CardDescription>They need an Omni.io account first. You can grant any role up to your own.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end" onSubmit={onSubmit}>
          <Field label="Email" htmlFor="invite-email">
            <Input id="invite-email" name="email" type="email" required />
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
            Add member
          </Button>
        </form>
        {message && <p className={`mt-3 text-sm ${message.ok ? 'text-muted-foreground' : 'text-destructive'}`}>{message.text}</p>}
      </CardContent>
    </Card>
  );
}
