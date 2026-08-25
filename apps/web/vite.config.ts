import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The dev server proxies `/api` instead of the browser calling the API's origin
 * directly. That is not a convenience: decision #10 puts the SPA and the API on one
 * origin in production (a Vercel rewrite to Cloud Run) so the session cookie is
 * first-party. Talking to `localhost:3000` here would make the cookie cross-site
 * locally and first-party in production — an auth bug that only exists on a laptop.
 *
 * `vercel.json` in the Ship session declares the same rewrite. The two must stay in step.
 */
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:3000';

// No `changeOrigin`: the API must keep seeing the origin the browser used, which is what
// the OAuth callback redirect and the cookie domain are built on.
const proxy = { '/api': { target: apiTarget } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    // `@dr/contracts` compiles to CommonJS (it is consumed by the API too, and the API
    // is CJS). A linked workspace dependency is not pre-bundled by default, so the dev
    // server would serve that CJS file as raw ESM and every named import from it fails
    // with "does not provide an export named ...". The production build is unaffected —
    // the bundler applies CJS interop there — which is exactly why this only shows up
    // when the dev server is actually opened in a browser.
    include: ['@dr/contracts'],
  },
  server: {
    host: true,
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy,
  },
  // `vite preview` serves the built bundle, which is the only honest way to measure what
  // a real visitor downloads — the dev server's unbundled modules are a waterfall of
  // hundreds of requests and make any throttled measurement meaningless. It needs the
  // same proxy, or the preview cannot reach the API at all.
  preview: {
    port: Number(process.env.VITE_PREVIEW_PORT ?? 4173),
    proxy,
  },
});
