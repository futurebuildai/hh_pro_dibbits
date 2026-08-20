import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * The LIVE verification suite (DIB-501) — deliberately a separate config.
 *
 * `npm test` must stay hermetic: no network, no credentials, and an exactly
 * countable suite. The `*.live.ts` files drive the REAL `ErpSupplier` against
 * the REAL staging ERP, which makes them evidence, not CI — they need a
 * reachable server and a demo credential in the environment.
 *
 *   HHPRO_LIVE_BASE_URL   default https://dibbits-staging.gablelbm.com
 *   HHPRO_LIVE_EMAIL      default portal.demo@dibbits.example (migration 0055)
 *   HHPRO_LIVE_PASSWORD   REQUIRED — documented in ERP migration
 *                         0055_portal_demo_fixtures.sql; never stored here
 *
 * Run: `HHPRO_LIVE_PASSWORD=… npx vitest run --config vitest.live.config.ts`
 */
export default defineConfig({
  test: {
    name: 'live',
    environment: 'node',
    include: ['src/**/*.live.ts'],
    // One worker, generous timeouts: this talks to a real server over a real
    // network, and parallel logins against one demo account prove nothing.
    maxWorkers: 1,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
});
