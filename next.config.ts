import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

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
