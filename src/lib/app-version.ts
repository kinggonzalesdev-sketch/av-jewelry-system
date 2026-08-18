/**
 * The deployed app commit/version for System Diagnostics + System Check. Resolution order:
 *   1. APP_COMMIT — baked at build time by next.config (from `--build-env APP_COMMIT=<sha>`, a
 *      Git-connected `VERCEL_GIT_COMMIT_SHA`, or local `git rev-parse`).
 *   2. VERCEL_GIT_COMMIT_SHA — runtime fallback for Git-connected Vercel deploys.
 *   3. 'local' — only when no commit is available (true local dev without git).
 *
 * Never exposes a secret. A production deploy that carries a commit no longer shows 'local'.
 */
export function appCommit(): string {
  const baked = (process.env.APP_COMMIT ?? '').trim();
  if (baked) return baked.slice(0, 7);
  const sha = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').trim();
  if (sha) return sha.slice(0, 7);
  return 'local';
}
