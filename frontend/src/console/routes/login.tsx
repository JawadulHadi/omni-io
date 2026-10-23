import { Loader2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Field, Input } from '@/components/ui/form-controls';
import { API_BASE } from '@/lib/api';
import { useAuth, type InvitationOutcome } from '@/lib/auth';
import { cn } from '@/lib/utils';

const CALLBACK_ERRORS: Record<string, string> = {
  google: 'Google sign-in failed. Please try again.',
  google_exists: 'An account with this email already exists. Sign in with your password instead.',
  signup_closed: 'Sign-up is closed. Ask a workspace admin for an invite link.',
};

interface Providers {
  google: boolean;
  signup: boolean;
}

/**
 * Sign in or create an account. With `inviteToken` (rendered by the invite page)
 * both forms carry the invite link, so a new account joins that workspace
 * instead of getting its own — even when open sign-up is switched off.
 */
export function LoginPage({ inviteToken, onInvitation }: { inviteToken?: string; onInvitation?: (outcome: InvitationOutcome) => void }) {
  const { state, login, register } = useAuth();
  const location = useLocation();
  const [params] = useSearchParams();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(CALLBACK_ERRORS[params.get('error') ?? ''] ?? null);
  const [providers, setProviders] = useState<Providers>({ google: false, signup: true });
  const canSignUp = providers.signup || Boolean(inviteToken);

  useEffect(() => {
    fetch(`${API_BASE}/auth/providers`)
      .then((r) => r.json())
      .then((p: Providers) => setProviders({ google: p.google, signup: p.signup !== false }))
      .catch(() => setProviders({ google: false, signup: true }));
  }, []);

  if (state.status === 'authenticated' && !inviteToken) {
    const from = (location.state as { from?: string } | null)?.from ?? '/playground';
    return <Navigate to={from} replace />;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const get = (k: string) => String(form.get(k) ?? '');
    setBusy(true);
    setError(null);
    try {
      const outcome =
        mode === 'signin'
          ? await login(get('email'), get('password'), inviteToken)
          : await register({
              email: get('email'),
              password: get('password'),
              displayName: get('displayName'),
              ...(inviteToken ? { inviteToken } : { workspaceName: get('workspaceName') }),
            });
      onInvitation?.(outcome);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const googleUrl = `${API_BASE}/auth/google${inviteToken ? `?invite=${encodeURIComponent(inviteToken)}` : ''}`;

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <Wordmark />
          </CardTitle>
          <CardDescription>
            {inviteToken ? "You've been invited to a workspace. Sign in or create an account to join it." : 'AI support that degrades gracefully instead of failing.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {canSignUp && (
            <div role="tablist" aria-label="Authentication" className="grid grid-cols-2 rounded-lg bg-muted p-1 text-sm">
              {(['signin', 'signup'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setError(null);
                  }}
                  className={cn('rounded-md py-1.5 font-medium text-muted-foreground', mode === m && 'bg-background text-foreground shadow-xs')}
                >
                  {m === 'signin' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>
          )}

          <form className="grid gap-3" onSubmit={onSubmit}>
            {mode === 'signup' && (
              <>
                <Field label="Your name" htmlFor="displayName">
                  <Input id="displayName" name="displayName" required maxLength={100} autoComplete="name" />
                </Field>
                {!inviteToken && (
                  <Field label="Workspace name" htmlFor="workspaceName" hint="You'll be its owner. You can invite teammates later.">
                    <Input id="workspaceName" name="workspaceName" required maxLength={100} placeholder="Acme Support" />
                  </Field>
                )}
              </>
            )}
            <Field label="Email" htmlFor="email">
              <Input id="email" name="email" type="email" required autoComplete="email" defaultValue={import.meta.env.DEV && mode === 'signin' ? 'demo@omniio.dev' : undefined} />
            </Field>
            <Field label="Password" htmlFor="password" hint={mode === 'signup' ? 'At least 10 characters.' : undefined}>
              <Input
                id="password"
                name="password"
                type="password"
                required
                minLength={mode === 'signup' ? 10 : 1}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </Field>
            {error && <Alert variant="destructive">{error}</Alert>}
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="animate-spin" aria-hidden />}
              {mode === 'signin' ? (inviteToken ? 'Sign in and join' : 'Sign in') : inviteToken ? 'Create account and join' : 'Create account'}
            </Button>
          </form>

          {providers.google && (
            <Button variant="outline" onClick={() => (window.location.href = googleUrl)}>
              Continue with Google
            </Button>
          )}
          {!canSignUp && <p className="text-center text-xs text-muted-foreground">New here? Ask a workspace admin for an invite link.</p>}
          {import.meta.env.DEV && mode === 'signin' && !inviteToken && (
            <p className="text-center text-xs text-muted-foreground">
              Seeded demo: demo@omniio.dev / demo-password-123 (<code>npm run seed</code>)
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
