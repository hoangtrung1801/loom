import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { devBridge } from './scripts/dev-bridge.js';

/** The shipped CSP is strict; dev needs inline scripts (React refresh) and the HMR websocket. */
const relaxCspInDev = (): Plugin => ({
  name: 'loom-dev-csp',
  apply: 'serve',
  transformIndexHtml: (html) =>
    html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''),
});

export default defineConfig({
  root: 'src/renderer',
  base: './',
  resolve: { alias: { '@': resolve(import.meta.dirname, 'src/renderer') } },
  plugins: [react(), tailwindcss(), devBridge(), relaxCspInDev()],
  build: { outDir: '../../dist/renderer', emptyOutDir: true, target: 'chrome156' },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
