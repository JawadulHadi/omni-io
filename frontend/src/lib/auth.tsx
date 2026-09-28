import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { API_BASE, readError } from './api';

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export interface Session {
  accessToken: string;
  expiresAt: number;
  workspaceId: string;
  role: Role;
  userId: string;
}

type AuthState = { status: 'loading' } | { status: 'anonymous' } | { status: 'authenticated'; session: Session };

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  workspaceId: string;
  role: Role;
}

interface AuthContextValue {
  state: AuthState;
  login(email: string, password: string): Promise<void>;
  register(input: { email: string; password: string; displayName: string; workspaceName: string }): Promise<void>;
  refresh(): Promise<Session | null>;
  switchWorkspace(workspaceId: string): Promise<void>;
  logout(): Promise<void>;
}

/*
 * The access token lives only in memory (never localStorage), so an XSS can't
 * lift a long-lived credential. The refresh token is an httpOnly cookie the
 * JavaScript never sees. Refreshes are single-flight within a tab and
 * serialised across tabs with a Web Lock: the server treats a re-used refresh
 * token as theft and revokes the session, so two tabs must never race.
 */
let currentToken: string | null = null;
let currentExpiry = 0;
let inFlight: Promise<Session | null> | null = null;

export const getAccessToken = () => currentToken;
export const tokenExpiringSoon = () => currentToken !== null && Date.now() > currentExpiry - 10_000;

async function authCall(path: string, body?: unknown): Promise<AuthResponse> {
  const res = await fetch(`${API_BASE}/auth/${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw await readError(res);
  return res.json();
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  return navigator.locks ? (navigator.locks.request('omniio-auth-rotation', fn) as Promise<T>) : fn();
}

function decodeSub(token: string): string {
  try {
    return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub ?? '';
  } catch {
    return '';
  }
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const apply = useCallback((r: AuthResponse): Session => {
    const session: Session = {
      accessToken: r.accessToken,
      expiresAt: Date.now() + r.expiresIn * 1000,
      workspaceId: r.workspaceId,
      role: r.role,
      userId: decodeSub(r.accessToken),
    };
    currentToken = session.accessToken;
    currentExpiry = session.expiresAt;
    setState({ status: 'authenticated', session });
    return session;
  }, []);

  const clear = useCallback(() => {
    currentToken = null;
    currentExpiry = 0;
    setState({ status: 'anonymous' });
  }, []);

  const refresh = useCallback((): Promise<Session | null> => {
    inFlight ??= withLock(() => authCall('refresh'))
      .then(apply, () => {
        clear();
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }, [apply, clear]);

  // Restore the session from the refresh cookie on load (also completes Google sign-in).
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Refresh a minute before the access token expires.
  useEffect(() => {
    if (state.status !== 'authenticated') return;
    const delay = Math.max(state.session.expiresAt - Date.now() - 60_000, 5_000);
    const timer = setTimeout(() => void refresh(), delay);
    return () => clearTimeout(timer);
  }, [state, refresh]);

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      refresh,
      login: async (email, password) => {
        apply(await authCall('login', { email, password }));
      },
      register: async (input) => {
        apply(await authCall('register', input));
      },
      switchWorkspace: async (workspaceId) => {
        apply(await withLock(() => authCall('switch-workspace', { workspaceId })));
      },
      logout: async () => {
        await authCall('logout').catch(() => undefined);
        clear();
      },
    }),
    [state, refresh, apply, clear],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}

/** The signed-in session. Only call below <RequireAuth>. */
export function useSession(): Session {
  const { state } = useAuth();
  if (state.status !== 'authenticated') throw new Error('useSession outside an authenticated route');
  return state.session;
}

/** UI gating only — the API re-checks every role server-side. */
export function useCan(minRole: Role): boolean {
  return ROLE_RANK[useSession().role] >= ROLE_RANK[minRole];
}
