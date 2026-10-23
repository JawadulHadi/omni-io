import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.VITE_DEV_API ?? 'http://localhost:3000';

/** Serve the hosted widget page (widget.html) at /w/:key in dev, like the production rewrite does. */
const widgetPageRewrite = (): Plugin => ({
  name: 'omniio-widget-page',
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/w\/[0-9a-f]{32}\/?(\?.*)?$/.test(req.url)) req.url = '/widget.html';
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), widgetPageRewrite()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    // Regex keys: a plain "/w" prefix would also swallow the console's /widget route.
    proxy: {
      '/graphql': { target: API, ws: true },
      '^/auth/': { target: API },
      '^/documents/upload$': { target: API },
      '^/w/[^/]+/(ask|config)$': { target: API },
      '^/(mcp|health)': { target: API },
    },
  },
  build: {
    rollupOptions: {
      input: {
        console: fileURLToPath(new URL('./index.html', import.meta.url)),
        widget: fileURLToPath(new URL('./widget.html', import.meta.url)),
      },
    },
  },
});
