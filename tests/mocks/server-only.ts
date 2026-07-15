/**
 * Test stub for the `server-only` package.
 *
 * The real package throws when resolved outside a React Server Component context.
 * Vitest runs in jsdom, which is neither a server nor a real client bundle, so
 * importing any server-only module from a test would throw before a single
 * assertion ran.
 *
 * ⚠️  This stub applies ONLY to the Vitest environment (aliased in vitest.config.ts).
 *     It does NOT weaken the production boundary, which is enforced independently by:
 *       1. the Next.js bundler — a Client Component importing a server-only module
 *          fails the BUILD;
 *       2. ESLint `no-restricted-imports` — fails the LINT gate;
 *       3. `tests/unit/server-only-boundary.test.ts` — asserts the markers and the
 *          absence of client imports by reading source text, so it never needs this
 *          stub to be resolved.
 */
export {};
