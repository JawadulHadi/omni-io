import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Escape every non-ASCII character in the final bundle as \uXXXX: customer pages
 * may not declare UTF-8, and a script decoded as Windows-1252 would turn "×" into
 * "Ã—". (esbuild's `charset: 'ascii'` did this before Vite 8; the Oxc pipeline
 * ignores it.) Runs in generateBundle, after minification, so nothing undoes it.
 * Escapes are valid in strings, templates, regexes and identifiers alike.
 */
const asciiOnly = (): Plugin => ({
  name: 'omniio-ascii-only',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'chunk') {
        file.code = file.code.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
      }
    }
  },
});

/**
 * The embeddable widget: one self-contained IIFE (dist/widget.js) with its CSS
 * inlined into a Shadow DOM. Built separately so a customer's page never
 * downloads the admin console — no router, no urql, no Tailwind.
 */
export default defineConfig({
  plugins: [react(), asciiOnly()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    copyPublicDir: false,
    lib: {
      entry: 'src/widget/embed.tsx',
      name: 'OmniioWidget',
      formats: ['iife'],
      fileName: () => 'widget.js',
    },
  },
});
