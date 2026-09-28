import { AppWindow, FileText, ListChecks, Loader2, LogOut, MessageSquareText, ScrollText, Users, Workflow } from 'lucide-react';
import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'urql';
import { Wordmark } from '@/components/brand/logo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form-controls';
import { gqlErrorMessage } from '@/lib/api';
import { useAuth, useSession } from '@/lib/auth';
import { CREATE_WORKSPACE, SHELL_QUERY, type Membership, type SystemInfo, type Workspace } from '@/lib/gql';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/playground', label: 'Playground', icon: MessageSquareText },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/ingestion', label: 'Ingestion', icon: Workflow },
  { to: '/faqs', label: 'FAQs', icon: ListChecks },
  { to: '/members', label: 'Members', icon: Users },
  { to: '/widget', label: 'Widget', icon: AppWindow },
  { to: '/audit', label: 'Answer audit', icon: ScrollText },
];

export interface ShellData {
  systemInfo: SystemInfo;
  workspace: Workspace;
  myWorkspaces: Membership[];
}

export function ConsoleLayout() {
  const session = useSession();
  const { logout, switchWorkspace } = useAuth();
  const navigate = useNavigate();
  const [{ data, error }] = useQuery<ShellData>({ query: SHELL_QUERY });
  const [, createWorkspace] = useMutation(CREATE_WORKSPACE);
  const [switching, setSwitching] = useState(false);

  async function onWorkspaceChange(value: string) {
    setSwitching(true);
    try {
      let target = value;
      if (value === '__new') {
        const name = window.prompt('Name for the new workspace')?.trim();
        if (!name) return;
        const res = await createWorkspace({ name });
        if (res.error) return window.alert(gqlErrorMessage(res.error));
        target = res.data.createWorkspace.workspaceId;
      }
      await switchWorkspace(target);
      navigate('/playground');
    } finally {
      setSwitching(false);
    }
  }

  const workspaceSelect = (
    <Select
      aria-label="Workspace"
      value={session.workspaceId}
      disabled={!data || switching}
      onChange={(e) => void onWorkspaceChange(e.target.value)}
      className="h-8 text-sm"
    >
      {data?.myWorkspaces.map((m) => (
        <option key={m.workspaceId} value={m.workspaceId}>
          {m.name}
        </option>
      )) ?? <option>Loading…</option>}
      <option value="__new">+ New workspace…</option>
    </Select>
  );

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex flex-col gap-4 border-b bg-sidebar p-4 md:sticky md:top-0 md:h-screen md:w-60 md:border-r md:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <Wordmark />
          {switching && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Switching workspace" />}
        </div>
        {workspaceSelect}
        <nav aria-label="Console" className="-mx-1 flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isActive && 'bg-accent font-medium text-foreground',
                )
              }
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto hidden gap-3 border-t pt-4 text-xs text-muted-foreground md:grid">
          {data && (
            <div className="grid gap-1">
              <span>
                Model: <span className="text-foreground">{data.systemInfo.aiProvider}</span>
              </span>
              <span className="truncate" title={data.systemInfo.chatModel}>
                {data.systemInfo.chatModel}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <Badge variant="outline" className="capitalize">
              {session.role}
            </Badge>
            <Button variant="ghost" size="sm" onClick={() => void logout()}>
              <LogOut aria-hidden /> Sign out
            </Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
        <div className="mx-auto grid max-w-6xl gap-6">
          {error && <Alert variant="destructive" title="Could not load workspace">{gqlErrorMessage(error)}</Alert>}
          <Suspense fallback={<PageSkeleton />}>
            <Outlet context={data} />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-7 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
