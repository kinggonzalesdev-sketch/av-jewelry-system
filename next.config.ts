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
  const fromEnv = (
    process.env.APP_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    ''
  ).trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

/**
 * Baseline security headers on every response (system audit 2026-09-16). Deliberately NO
 * Content-Security-Policy yet: the theme bootstrap script and the print/waybill documents use
 * inline script/style, so a CSP needs nonces first — tracked as a follow-up, not silently
 * shipped in report-only mode either. Everything below is safe for this app as built:
 *   - framing denied except by the app itself (print previews are same-origin iframes);
 *   - MIME sniffing off; referrer trimmed to the origin cross-site;
 *   - camera stays available to the app (attendance selfies / capture photos), the rest of the
 *     powerful features are switched off.
 */
const SECURITY_HEADERS = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()',
  },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }];
  },

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
