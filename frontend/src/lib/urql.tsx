import { authExchange } from '@urql/exchange-auth';
import { createClient as createWsClient, type Client as WsClient } from 'graphql-ws';
import { useEffect, useMemo, type ReactNode } from 'react';
import { cacheExchange, Client, fetchExchange, Provider, subscriptionExchange } from 'urql';
import { API_BASE } from './api';
import { getAccessToken, tokenExpiringSoon, useAuth } from './auth';

/**
 * urql over Apollo: the console is CRUD-shaped and the document cache
 * (invalidate-by-typename after a mutation) covers it with a fraction of the
 * bundle and no normalised-cache configuration.
 */
function makeClient(refresh: () => Promise<unknown>) {
  let ws: WsClient | null = null;
  const wsUrl = () => {
    const base = API_BASE ? new URL(API_BASE) : window.location;
    return `${base.protocol === 'https:' ? 'wss' : 'ws'}://${base.host}/graphql`;
  };
  // Created lazily and re-created after dispose, so React StrictMode's
  // mount/unmount/mount cycle doesn't leave a dead socket behind.
  const getWs = () =>
    (ws ??= createWsClient({
      url: wsUrl(),
      lazy: true,
      retryAttempts: 5,
      connectionParams: () => ({ authorization: `Bearer ${getAccessToken() ?? ''}` }),
    }));

  const client = new Client({
    url: `${API_BASE}/graphql`,
    fetchOptions: { credentials: 'include' },
    exchanges: [
      cacheExchange,
      authExchange(async (utils) => ({
        addAuthToOperation(operation) {
          const token = getAccessToken();
          return token ? utils.appendHeaders(operation, { Authorization: `Bearer ${token}` }) : operation;
        },
        willAuthError: () => tokenExpiringSoon(),
        didAuthError: (error) => error.graphQLErrors.some((e) => e.extensions?.code === 'UNAUTHENTICATED'),
        refreshAuth: async () => {
          await refresh();
        },
      })),
      fetchExchange,
      subscriptionExchange({
        forwardSubscription(request) {
          const input = { ...request, query: request.query ?? '' };
          return {
            subscribe(sink) {
              const unsubscribe = getWs().subscribe(input, sink);
              return { unsubscribe };
            },
          };
        },
      }),
    ],
  });
  const dispose = () => {
    void ws?.dispose();
    ws = null;
  };
  return { client, dispose };
}

/** One client per workspace: switching workspace starts from an empty cache. */
export function UrqlProvider({ children }: { children: ReactNode }) {
  const { state, refresh } = useAuth();
  const workspaceId = state.status === 'authenticated' ? state.session.workspaceId : null;
  const { client, dispose } = useMemo(() => makeClient(refresh), [workspaceId, refresh]);
  useEffect(() => dispose, [dispose]);
  return <Provider value={client}>{children}</Provider>;
}
