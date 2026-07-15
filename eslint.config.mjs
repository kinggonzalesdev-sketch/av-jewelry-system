import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Prototype code is not production code (ADR §20): nothing in src/ may import it.
 */
const noPrototypeImports = {
  group: ['**/ui-prototype/**', '**/prototype/**'],
  message: 'Prototype code is not production code and must not be imported (ADR §20).',
};

/**
 * The UI review prototype (`src/components/preview/**`, `src/app/(preview)/**`) is
 * not production code either. It holds sample data and makes no authorization
 * decision, so nothing in the real application may import it.
 *
 * The prototype may import production UTILITIES (e.g. `cn`) — that direction is
 * harmless. This rule blocks only the dangerous direction: production → preview.
 */
const noPreviewImports = {
  group: [
    '**/components/preview/**',
    '@/components/preview/*',
    '@/components/preview/**',
  ],
  message:
    'The UI review prototype is sample-data only and must not be imported by production code.',
};

/**
 * The privileged/service-role Supabase client is server-only (Bible §30.15, ADR §11).
 * `src/lib/supabase/admin.ts` also imports `server-only`, which fails the *build* if a
 * Client Component reaches it. This rule fails the *lint* gate earlier and more clearly.
 */
const noPrivilegedClientImports = {
  group: ['**/supabase/admin', '@/lib/supabase/admin'],
  message:
    'The privileged Supabase client is server-only and must never be imported from a component. Use @/lib/supabase/server, or move the logic into a server action.',
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'coverage/**',
      'next-env.d.ts',
    ],
  },

  // eslint-config-next 16 ships native flat config, so no FlatCompat bridge is needed.
  ...nextCoreWebVitals,
  ...nextTypeScript,

  /**
   * Pin the React version for eslint-plugin-react.
   *
   * COMPATIBILITY NOTE (ADR §17 stack pin): eslint-config-next@16.2.10 bundles
   * eslint-plugin-react@7.37.5, whose peer range stops at eslint ^9.7 — no released
   * version supports ESLint 10. Its `detect` code path calls `context.getFilename()`,
   * which ESLint 10 removed, and that crashes the whole lint run.
   *
   * Setting an explicit version string short-circuits `detectReactVersion()` before it
   * can reach the removed API, so every rule stays ENABLED and the gate is not
   * weakened. Auto-detection would only have resolved this same pinned version anyway.
   *
   * Keep this in step with the `react` version in package.json.
   */
  {
    settings: {
      react: { version: '19.2.7' },
    },
  },

  // Type-aware linting for first-party source only.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
  })),
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'tests/**/*.ts', 'tests/**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-restricted-imports': ['error', { patterns: [noPrototypeImports] }],
    },
  },

  // Components are the client-reachable surface: additionally bar the privileged client.
  // `no-restricted-imports` replaces rather than merges, so both patterns are repeated here.
  {
    files: ['src/components/**/*.{ts,tsx}', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [noPrototypeImports, noPrivilegedClientImports, noPreviewImports] },
      ],
    },
  },

  // The prototype itself may import its own modules. It is exempted from the
  // preview rule (it IS the preview) but still barred from the privileged client:
  // a prototype has no business touching a service-role client.
  {
    files: ['src/components/preview/**/*.{ts,tsx}', 'src/app/(preview)/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [noPrototypeImports, noPrivilegedClientImports] },
      ],
    },
  },

  eslintConfigPrettier,
);
