export type WidgetTier = 'ai_answer' | 'rag_snippets' | 'faq_floor';

export interface WidgetTheme {
  title: string;
  greeting: string;
  primaryColor: string;
  position: 'left' | 'right';
}

export interface WidgetAnswer {
  tier: WidgetTier;
  answer: string;
  citations: { documentTitle: string; snippet: string }[];
}

export class WidgetError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'rate_limited' | 'invalid' | 'network',
    message: string,
  ) {
    super(message);
  }
}

/** Absolute URLs: when embedded, relative paths would hit the customer's site, not Omni.io. */
export function createWidgetApi(apiBase: string, key: string) {
  const base = `${apiBase.replace(/\/$/, '')}/w/${encodeURIComponent(key)}`;

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, credentials: 'omit' });
    } catch {
      throw new WidgetError('network', "Can't reach support right now. Check your connection and try again.");
    }
    if (res.status === 404) throw new WidgetError('unavailable', 'This chat is no longer available. Please refresh the page.');
    if (res.status === 429) throw new WidgetError('rate_limited', "You're sending messages quickly — please wait a moment and try again.");
    if (res.status === 400) throw new WidgetError('invalid', 'That message is too long. Please shorten it.');
    if (!res.ok) throw new WidgetError('network', 'Something went wrong. Please try again.');
    return res.json() as Promise<T>;
  }

  return {
    config: () => call<WidgetTheme>('/config'),
    ask: (query: string) =>
      call<WidgetAnswer>('/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }),
  };
}
