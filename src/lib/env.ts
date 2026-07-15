import { z } from 'zod';

/**
 * Environment validation (ADR §11 — secrets handling).
 *
 * Two separate schemas enforce the public/privileged split:
 *
 *  - `clientEnvSchema` covers values that are safe to ship to the browser. Next.js
 *    inlines `NEXT_PUBLIC_*` variables into the client bundle, so ONLY keys designed
 *    for public client use may appear here (the Supabase anon key is protected by RLS
 *    at the data layer, not by secrecy).
 *
 *  - `serverEnvSchema` covers privileged values. These are read exclusively through
 *    `getServerEnv()`, which is called only from server-side modules. The service-role
 *    key is optional by design: ordinary application startup must never require it
 *    (ADR §11; Phase 0 scope rule "service-role credentials must not be required for
 *    ordinary application startup").
 *
 * Validation fails fast and safely: a missing or malformed variable throws a clear,
 * actionable error naming the variable — and never echoes the value, so a bad secret
 * cannot leak into logs or an error page (Bible §31 r12: audit records never expose secrets).
 */

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_URL is required')
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
});

const serverEnvSchema = z.object({
  // Privileged. Server-only. Never exposed to the browser, and never required for
  // ordinary startup — only a future, explicitly privileged operation may demand it.
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;
export type ServerEnv = z.infer<typeof serverEnvSchema>;

/**
 * Formats a validation failure without ever including the offending value.
 */
function formatEnvError(error: z.ZodError, scope: string): string {
  const issues = error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

  return [
    `Invalid ${scope} environment configuration:`,
    issues,
    '',
    'Copy .env.example to .env.local and provide the required values.',
    'See README.md → "Environment variables". Never commit .env.local.',
  ].join('\n');
}

/**
 * Parses the browser-safe environment. Throws on invalid configuration.
 *
 * The variables are referenced explicitly rather than by dynamic lookup because
 * Next.js only inlines `process.env.NEXT_PUBLIC_*` for statically analysable access.
 */
export function parseClientEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): ClientEnv {
  const parsed = clientEnvSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error, 'client'));
  }

  return parsed.data;
}

/**
 * Parses the server environment. Throws on invalid configuration.
 */
export function parseServerEnv(
  source: Record<string, string | undefined> = process.env,
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(source);

  if (!parsed.success) {
    throw new Error(formatEnvError(parsed.error, 'server'));
  }

  return parsed.data;
}

export function getClientEnv(): ClientEnv {
  return parseClientEnv();
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv();
}

/**
 * Reads the privileged service-role key for an explicitly privileged server-side
 * operation. Throws if absent, so a privileged path fails loudly rather than
 * silently degrading to an under-privileged client.
 *
 * Ordinary startup never calls this.
 */
export function requireServiceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key || key.length === 0) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not configured. It is required only for explicitly privileged server-side operations and must never be exposed to the browser.',
    );
  }

  return key;
}

export const envSchemas = {
  client: clientEnvSchema,
  server: serverEnvSchema,
} as const;
