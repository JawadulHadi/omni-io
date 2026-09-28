import { createRoot } from 'react-dom/client';
import css from './widget.css?inline';
import { WidgetApp } from './WidgetApp';

/**
 * Entry for dist/widget.js — the customer copies:
 *   <script src="https://console.example.com/widget.js" data-omniio-key="KEY" data-api-base="https://api.example.com" async></script>
 * Everything renders inside a Shadow DOM so the host page's CSS can't break the
 * widget and ours can't leak into the host page.
 */
(function mount() {
  const script =
    (document.currentScript as HTMLScriptElement | null) ?? document.querySelector<HTMLScriptElement>('script[data-omniio-key]');
  const key = script?.dataset.omniioKey;
  if (!key) {
    console.warn('[omniio] missing data-omniio-key on the widget <script> tag');
    return;
  }
  const apiBase = script?.dataset.apiBase ?? new URL(script!.src).origin;

  const host = document.createElement('div');
  host.id = 'omniio-widget';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);

  createRoot(container).render(<WidgetApp widgetKey={key} apiBase={apiBase} mode="floating" />);
})();
