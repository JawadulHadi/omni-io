import { Loader2, MailOpen } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation } from 'urql';
import { Wordmark } from '@/components/brand/logo';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { gqlErrorMessage } from '@/lib/api';
import { useAuth, type InvitationOutcome } from '@/lib/auth';
import { ACCEPT_INVITATION } from '@/lib/gql';
import { UrqlProvider } from '@/lib/urql';
import { LoginPage } from './login';

/**
 * /invite/:token — a single-use link from a workspace admin. Signed out, the
 * sign-in and sign-up forms carry the link and join on success. Signed in,
 * the visitor confirms and is switched into the workspace.
 */
export default function InvitePage() {
  const { token = '' } = useParams();
  const { state } = useAuth();
  const [outcome, setOutcome] = useState<InvitationOutcome>();

  if (state.status === 'loading') {
    return (
      <div className="grid min-h-screen place-items-center" aria-busy="true">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Restoring session" />
      </div>
    );
  }
  if (state.status === 'anonymous') return <LoginPage inviteToken={token} onInvitation={setOutcome} />;
  if (outcome === 'accepted') return <Navigate to="/playground" replace />;
  return (
    <UrqlProvider>
      {/* Keyed: the sign-in result can arrive just after the auth state flips, and must reset the card. */}
      <AcceptCard key={outcome ?? 'pending'} token={token} initialError={outcome === 'invalid' ? INVALID : null} />
    </UrqlProvider>
  );
}

const INVALID = 'This invitation link is invalid, already used or expired. Ask the admin who sent it for a new one.';

function AcceptCard({ token, initialError }: { token: string; initialError: string | null }) {
  const { switchWorkspace } = useAuth();
  const navigate = useNavigate();
  const [{ fetching }, accept] = useMutation(ACCEPT_INVITATION);
  const [error, setError] = useState<string | null>(initialError);
  const [switching, setSwitching] = useState(false);

  async function onAccept() {
    setError(null);
    const res = await accept({ token });
    if (res.error) return setError(gqlErrorMessage(res.error));
    setSwitching(true);
    try {
      await switchWorkspace(res.data.acceptInvitation.workspaceId);
      navigate('/playground', { replace: true });
    } catch (err) {
      setError((err as Error).message);
      setSwitching(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <Wordmark />
          </CardTitle>
          <CardDescription>You've been invited to join a workspace with this account.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {error && <Alert variant="destructive">{error}</Alert>}
          {!initialError && (
            <Button onClick={() => void onAccept()} disabled={fetching || switching}>
              {fetching || switching ? <Loader2 className="animate-spin" aria-hidden /> : <MailOpen aria-hidden />} Join workspace
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/playground', { replace: true })}>
            {initialError ? 'Continue to the console' : 'Not now'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
