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
    // Phase 11 owns §34.3 stage 4 (integration) and enabled tests/integration.
    //
    // tests/e2e stays excluded, and that is a deliberate decision rather than an
    // omission: browser-driven E2E needs a test tool that §34.9 leaves open
    // ("test tools", "automation framework" — Owner/developer, before pilot), so
    // choosing Playwright here would silently resolve an open item (§33.2).
    // End-to-end lifecycle coverage is not missing meanwhile — it runs at the
    // trusted boundary where the rules actually live, in
    // supabase/tests/15_phase11_e2e_lifecycle.test.sql.
    exclude: ['node_modules/**', '.next/**', 'tests/e2e/**'],
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
