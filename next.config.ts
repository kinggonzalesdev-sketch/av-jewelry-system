import { execSync } from 'node:child_process';

import type { NextConfig } from 'next';

/**
 * Resolve the deployed app commit at BUILD time and inline it via `env`, so System Diagnostics /
 * System Check show the real deployed version instead of "local" (the CLI-deploy bug):
 *   1. APP_COMMIT           — passed at deploy time (`vercel --build-env APP_COMMIT=<sha>`).
 *   2. VERCEL_GIT_COMMIT_SHA — set by Vercel for Git-connected deploys.
 *   3. local `git rev-parse` — for `next dev` / local builds.
 * Empty only when none is available → the app then shows "local".
 */
function resolveAppCommit(): string {
  const fromEnv = (process.env.APP_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Build-time commit, inlined for server + client (see resolveAppCommit above).
  env: {
    APP_COMMIT: resolveAppCommit(),
  },

  // Verification gates must not be bypassed at build time (ADR §20).
  // `ignoreBuildErrors` is deliberately false: type errors fail the build.
  typescript: {
    ignoreBuildErrors: false,
  },

  // Note: Next.js 16 removed `next lint` and the `eslint` config key, so the build
  // no longer runs ESLint. Linting is therefore a SEPARATE, mandatory gate
  // (`npm run lint`, wired into `npm run verify`). Dropping that gate would silently
  // remove lint enforcement from the pipeline.
};

export default nextConfig;
