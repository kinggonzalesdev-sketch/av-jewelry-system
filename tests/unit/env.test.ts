import { describe, expect, it } from 'vitest';

import { parseClientEnv, parseServerEnv } from '@/lib/env';

/**
 * Environment validation must fail SAFELY: loudly, clearly, and without ever
 * echoing the offending value (Bible §31 r12 — audit records never expose secrets).
 */
describe('client environment validation', () => {
  const validEnv = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://example-ref.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'example-anon-key',
  };

  it('accepts a valid configuration', () => {
    expect(parseClientEnv(validEnv)).toEqual(validEnv);
  });

  it('throws when the Supabase URL is missing', () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it('throws when the Supabase URL is malformed', () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: 'not-a-url' }),
    ).toThrow(/valid URL/);
  });

  it('throws when the anon key is missing', () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('throws when the anon key is empty', () => {
    expect(() =>
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_ANON_KEY: '' }),
    ).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it('names the variable without leaking the offending value', () => {
    const secretish = 'super-secret-value-that-must-not-be-echoed';

    let message = '';
    try {
      parseClientEnv({ ...validEnv, NEXT_PUBLIC_SUPABASE_URL: secretish });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(message).not.toContain(secretish);
  });
});

describe('server environment validation', () => {
  it('does not require the service-role key for ordinary startup', () => {
    // ADR §11: privileged credentials must never be required to boot the app.
    const parsed = parseServerEnv({ NODE_ENV: 'development' });

    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
  });

  it('accepts a service-role key when explicitly provided', () => {
    const parsed = parseServerEnv({
      NODE_ENV: 'development',
      SUPABASE_SERVICE_ROLE_KEY: 'local-only-test-value',
    });

    expect(parsed.SUPABASE_SERVICE_ROLE_KEY).toBe('local-only-test-value');
  });

  it('rejects an unknown NODE_ENV', () => {
    expect(() => parseServerEnv({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('defaults NODE_ENV to development when unset', () => {
    expect(parseServerEnv({}).NODE_ENV).toBe('development');
  });
});
