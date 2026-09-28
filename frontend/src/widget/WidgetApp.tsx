import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { createWidgetApi, WidgetError, type WidgetAnswer, type WidgetTheme } from './api';

interface Message {
  id: number;
  role: 'user' | 'bot';
  text: string;
  citations?: WidgetAnswer['citations'];
  tone?: 'error';
}

interface Props {
  widgetKey: string;
  apiBase: string;
  /** floating: launcher bubble on a customer page. page: the hosted /w/:key page. */
  mode: 'floating' | 'page';
}

const MAX_QUERY = 1000;
let nextId = 1;

/**
 * Standalone embeddable chat. Deliberately shares no code with the console
 * bundle, so a customer's page loads only this.
 */
export function WidgetApp({ widgetKey, apiBase, mode }: Props) {
  const api = useMemo(() => createWidgetApi(apiBase, widgetKey), [apiBase, widgetKey]);
  const [theme, setTheme] = useState<WidgetTheme | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [open, setOpen] = useState(mode === 'page');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.config().then(
      (t) => {
        setTheme(t);
        setStatus('ready');
      },
      (err: unknown) => {
        setStatus('unavailable');
        console.warn('[omniio] widget disabled:', (err as Error).message);
      },
    );
  }, [api]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const query = input.trim();
    if (!query || sending || status !== 'ready') return;
    setNotice(null);
    setInput('');
    setMessages((m) => [...m, { id: nextId++, role: 'user', text: query }]);
    setSending(true);
    try {
      const r = await api.ask(query);
      setMessages((m) => [...m, { id: nextId++, role: 'bot', text: r.answer, citations: r.citations }]);
    } catch (err) {
      const e = err instanceof WidgetError ? err : new WidgetError('network', 'Something went wrong. Please try again.');
      if (e.kind === 'unavailable') setStatus('unavailable');
      if (e.kind === 'rate_limited' || e.kind === 'invalid') {
        setNotice(e.message);
        setInput(query);
      } else {
        setMessages((m) => [...m, { id: nextId++, role: 'bot', text: e.message, tone: 'error' }]);
      }
    } finally {
      setSending(false);
    }
  }

  // A bad key at load time: stay invisible rather than show visitors a broken widget.
  if (mode === 'floating' && status !== 'ready' && !theme) return null;

  const style = { '--omniio-primary': theme?.primaryColor ?? '#0f172a' } as CSSProperties;
  const side = theme?.position === 'left' ? 'omniio-left' : 'omniio-right';

  const panel = (
    <section className={`omniio-panel ${mode === 'page' ? 'omniio-panel-page' : ''}`} aria-label={theme?.title ?? 'Support chat'} style={style}>
      <header className="omniio-header">
        <span className="omniio-title">{theme?.title ?? 'Support'}</span>
        {mode === 'floating' && (
          <button type="button" className="omniio-icon-button" aria-label="Close chat" onClick={() => setOpen(false)}>
            ×
          </button>
        )}
      </header>
      <div className="omniio-messages" ref={listRef} aria-live="polite">
        {status === 'loading' && <p className="omniio-muted">Connecting…</p>}
        {theme && <div className="omniio-bubble omniio-bot">{theme.greeting}</div>}
        {messages.map((m) => (
          <div key={m.id} className={`omniio-bubble omniio-${m.role} ${m.tone === 'error' ? 'omniio-error' : ''}`}>
            <p>{m.text}</p>
            {m.citations && m.citations.length > 0 && (
              <details className="omniio-sources">
                <summary>Sources ({m.citations.length})</summary>
                <ul>
                  {m.citations.map((c, i) => (
                    <li key={i}>
                      <strong>{c.documentTitle}</strong>
                      <span>{c.snippet.length > 400 ? `${c.snippet.slice(0, 400)}…` : c.snippet}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
        {sending && (
          <div className="omniio-bubble omniio-bot omniio-typing" aria-label="Answering">
            <span />
            <span />
            <span />
          </div>
        )}
        {status === 'unavailable' && <p className="omniio-banner">This chat is no longer available. Please refresh the page or contact us another way.</p>}
      </div>
      {notice && <p className="omniio-notice">{notice}</p>}
      <form className="omniio-form" onSubmit={send}>
        <textarea
          ref={inputRef}
          className="omniio-input"
          rows={1}
          value={input}
          maxLength={MAX_QUERY}
          disabled={status !== 'ready'}
          placeholder={status === 'ready' ? 'Type your question…' : 'Chat unavailable'}
          aria-label="Your question"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="omniio-send" disabled={!input.trim() || sending || status !== 'ready'}>
          Send
        </button>
      </form>
    </section>
  );

  if (mode === 'page') return <div className="omniio-page">{panel}</div>;

  return (
    <div className={`omniio-root ${side}`} style={style} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      {open && panel}
      <button type="button" className="omniio-launcher" aria-expanded={open} aria-label={open ? 'Close support chat' : 'Open support chat'} onClick={() => setOpen((o) => !o)}>
        {open ? '×' : '?'}
      </button>
    </div>
  );
}
