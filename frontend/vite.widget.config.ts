import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The embeddable widget: one self-contained IIFE (dist/widget.js) with its CSS
 * inlined into a Shadow DOM. Built separately so a customer's page never
 * downloads the admin console — no router, no urql, no Tailwind.
 */
export default defineConfig({
  plugins: [react()],
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // Escape every non-ASCII character: customer pages may not declare UTF-8, and a
  // script decoded as Windows-1252 would turn "×" into "Ã—".
  esbuild: { charset: 'ascii' },
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
