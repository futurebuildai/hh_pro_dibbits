import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    /**
     * Two projects, because the core is DOM-free by design and running it in
     * jsdom would let a stray `document` reference pass a test and then fail
     * in a Lit build. Only `.tsx` tests get a DOM.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          // server/ is in scope so the proxy middleware is covered — its
          // absence once hid a total outage of the assistant endpoint.
          include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
          // `.dom.test.ts` also matches the include glob above, so it has to
          // be named out explicitly — otherwise it runs in BOTH projects and
          // fails here on a missing `window`.
          exclude: ['**/node_modules/**', 'src/**/*.dom.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'ui',
          environment: 'jsdom',
          // `.dom.test.ts` is for core modules that genuinely need a browser
          // API (storage events, matchMedia). Keeping them out of the node
          // project preserves the rule that core is DOM-free by default.
          include: ['src/**/*.test.tsx', 'src/**/*.dom.test.ts'],
          setupFiles: ['./src/ui/__tests__/setup.ts'],
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@core': resolve(__dirname, 'src/core'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
});
