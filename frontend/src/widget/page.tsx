import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './widget.css';
import { WidgetApp } from './WidgetApp';

// Hosted full-page chat at /w/:key — the link a support team can share directly.
const key = window.location.pathname.match(/^\/w\/([0-9a-f]{32})/)?.[1] ?? '';
const apiBase: string = import.meta.env.VITE_API_BASE ?? window.location.origin;

createRoot(document.getElementById('omniio-widget-root')!).render(
  <StrictMode>
    <WidgetApp widgetKey={key} apiBase={apiBase} mode="page" />
  </StrictMode>,
);
