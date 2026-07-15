import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Phase 0 has no integration or e2e suites yet; those directories are
    // reserved and excluded until the phases that own them land.
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**', 'tests/integration/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // The real `server-only` package throws outside an RSC context, which jsdom is
      // not. Stubbing it here does NOT weaken the production boundary — that is
      // enforced by the Next bundler at build time, by ESLint, and by the static
      // assertions in tests/unit/server-only-boundary.test.ts.
      // See tests/mocks/server-only.ts.
      'server-only': fileURLToPath(
        new URL('./tests/mocks/server-only.ts', import.meta.url),
      ),
    },
  },
});
