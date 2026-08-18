import { afterEach, describe, expect, it, vi } from 'vitest';

import { appCommit } from '@/lib/app-version';

afterEach(() => vi.unstubAllEnvs());

describe('appCommit', () => {
  it('prefers the baked APP_COMMIT, shortened to 7', () => {
    vi.stubEnv('APP_COMMIT', 'abcdef1234567');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'zzzzzzz');
    expect(appCommit()).toBe('abcdef1');
  });

  it('falls back to VERCEL_GIT_COMMIT_SHA when APP_COMMIT is empty', () => {
    vi.stubEnv('APP_COMMIT', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'deadbeefcafe');
    expect(appCommit()).toBe('deadbee');
  });

  it("returns 'local' only when neither is set (never on a real deploy)", () => {
    vi.stubEnv('APP_COMMIT', '');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', '');
    expect(appCommit()).toBe('local');
  });
});
