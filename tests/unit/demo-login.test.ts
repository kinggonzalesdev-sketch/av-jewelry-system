import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEMO_PERSONAS } from '@/lib/auth/demo';

/**
 * The demo-login gate is security-critical: it must be OFF by default and only
 * open when the Owner deliberately sets BOTH the flag and a password. The
 * password must never leak, and an unknown persona key must resolve to nothing.
 * demo.server is imported fresh per test so it re-reads the mutated env.
 */

const ENV_KEYS = [
  'DEMO_LOGIN_ENABLED',
  'DEMO_LOGIN_PASSWORD',
  'DEMO_OWNER_EMAIL',
  'DEMO_ADMIN_EMAIL',
  'DEMO_STAFF_EMAIL',
];

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function load() {
  // Vitest caches modules; server code reads env at call time (not import time),
  // so a single import is fine, but reset keeps tests independent.
  return import('@/lib/auth/demo.server');
}

describe('demo login gate', () => {
  it('is OFF by default (no env set)', async () => {
    const { isDemoLoginEnabled, demoCredentials } = await load();
    expect(isDemoLoginEnabled()).toBe(false);
    expect(demoCredentials('owner')).toBeNull();
  });

  it('stays OFF when the flag is set but no password is provided', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    const { isDemoLoginEnabled, demoCredentials } = await load();
    expect(isDemoLoginEnabled()).toBe(false);
    expect(demoCredentials('owner')).toBeNull();
  });

  it('stays OFF when a password is set but the flag is not "true"', async () => {
    process.env.DEMO_LOGIN_PASSWORD = 'secret';
    process.env.DEMO_LOGIN_ENABLED = '1'; // not exactly "true"
    const { isDemoLoginEnabled } = await load();
    expect(isDemoLoginEnabled()).toBe(false);
  });

  it('turns ON only with both the flag "true" and a password', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    process.env.DEMO_LOGIN_PASSWORD = 'secret';
    const { isDemoLoginEnabled, demoCredentials } = await load();
    expect(isDemoLoginEnabled()).toBe(true);
    expect(demoCredentials('owner')).toEqual({
      email: 'uat-owner@uat.local',
      password: 'secret',
    });
  });

  it('resolves each known persona and refuses an unknown key', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    process.env.DEMO_LOGIN_PASSWORD = 'secret';
    const { demoCredentials } = await load();
    for (const persona of DEMO_PERSONAS) {
      expect(demoCredentials(persona.key)?.password).toBe('secret');
    }
    expect(demoCredentials('nope')).toBeNull();
    expect(demoCredentials('')).toBeNull();
  });

  it('honors email overrides from env', async () => {
    process.env.DEMO_LOGIN_ENABLED = 'true';
    process.env.DEMO_LOGIN_PASSWORD = 'secret';
    process.env.DEMO_OWNER_EMAIL = 'boss@demo.example';
    const { demoCredentials } = await load();
    expect(demoCredentials('owner')?.email).toBe('boss@demo.example');
  });
});
