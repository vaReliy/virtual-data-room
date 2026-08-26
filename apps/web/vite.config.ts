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
      /**
       * **The web app consumes the contracts as TypeScript source, not as `dist`** —
       * decision #12's actual wording, which the package's `main` alone does not deliver.
       *
       * Without this alias the import resolves to `packages/contracts/dist/index.js`,
       * which is CommonJS (the API is CJS and shares the package), so the dev server has
       * to pre-bundle it through `optimizeDeps` or every named import fails with "does not
       * provide an export named …". That pre-bundle is the problem: Vite keys its cache on
       * the lockfile and this config, **not** on the contents of a linked package's `dist`,
       * so rebuilding the contracts leaves a running dev server serving the previous
       * build's exports. What that looks like is not an error — it is `undefined` for
       * everything added since, which surfaced here as `NaN MB` in the upload hint while
       * `presignUploadResponseSchema` was quietly `undefined` too.
       *
       * Pointing at the source removes all of it: no CJS interop, no pre-bundle, no `dist`
       * in the loop, and an edit to a schema hot-reloads. `apps/api` is untouched and still
       * consumes `dist`, which is what a Nest build needs.
       */
      '@dr/contracts': fileURLToPath(
        new URL('../../packages/contracts/src/index.ts', import.meta.url),
      ),
    },
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
