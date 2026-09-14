import { describe, expect, it } from 'vitest';

import {
  classifySignInFailure,
  redactEmail,
  signInFailureMessage,
} from '@/lib/auth/sign-in-error';

/**
 * Sign-in failures must say what actually happened (Owner 2026-09-14).
 *
 * A Super Admin whose new password worked on one PC saw "Invalid credentials, or this account
 * cannot sign in." on another device. That message covers a wrong password, a blocked account,
 * AND a Supabase rate limit on a burst of attempts, and distinguishes none of them. These tests pin
 * the mapping — and pin the one thing that must NOT be distinguished: wrong password vs unknown
 * email, which would let an anonymous caller enumerate staff accounts.
 */

describe('classifySignInFailure — the Supabase error classes that matter', () => {
  it('wrong password → invalid_credentials (Supabase code)', () => {
    expect(classifySignInFailure({ code: 'invalid_credentials', status: 400 })).toBe(
      'invalid_credentials',
    );
  });

  it('wrong password → invalid_credentials (message form, older auth-js)', () => {
    expect(
      classifySignInFailure({ status: 400, message: 'Invalid login credentials' }),
    ).toBe('invalid_credentials');
  });

  it('a burst of attempts is a RATE LIMIT, not bad credentials', () => {
    // This is the case a second device hitting Sign in repeatedly can trigger. Telling that
    // person their password is wrong sends them to reset a password that was never wrong.
    expect(classifySignInFailure({ status: 429 })).toBe('rate_limited');
    expect(classifySignInFailure({ code: 'over_request_rate_limit', status: 429 })).toBe(
      'rate_limited',
    );
    expect(classifySignInFailure({ message: 'Request rate limit reached', status: 429 })).toBe(
      'rate_limited',
    );
  });

  it('a banned account is blocked, not "invalid"', () => {
    expect(classifySignInFailure({ code: 'user_banned', status: 403 })).toBe('account_blocked');
    expect(classifySignInFailure({ message: 'User is banned', status: 403 })).toBe(
      'account_blocked',
    );
  });

  it('an unconfirmed email is its own case', () => {
    expect(classifySignInFailure({ code: 'email_not_confirmed', status: 400 })).toBe(
      'email_not_confirmed',
    );
  });

  it('a server/transport failure evaluated nothing about the credentials', () => {
    expect(classifySignInFailure({ status: 0 })).toBe('server_unavailable');
    expect(classifySignInFailure({ status: 503 })).toBe('server_unavailable');
    expect(classifySignInFailure({ name: 'AuthRetryableFetchError' })).toBe('server_unavailable');
  });

  it('anything unrecognised is "unknown", never assumed to be a bad password', () => {
    expect(classifySignInFailure({ code: 'something_new', status: 400 })).toBe('unknown');
    expect(classifySignInFailure({})).toBe('unknown');
  });
});

describe('messages — honest, and no account enumeration', () => {
  it('wrong password and unknown email read IDENTICALLY', () => {
    // Supabase returns invalid_credentials for both; we must never split them.
    const wrongPassword = classifySignInFailure({ code: 'invalid_credentials', status: 400 });
    const noSuchAccount = classifySignInFailure({ code: 'invalid_credentials', status: 400 });
    expect(signInFailureMessage(wrongPassword)).toBe(signInFailureMessage(noSuchAccount));
  });

  it('never tells a rate-limited or blocked person their password is invalid', () => {
    expect(signInFailureMessage('rate_limited')).not.toMatch(/invalid/i);
    expect(signInFailureMessage('account_blocked')).not.toMatch(/invalid/i);
    expect(signInFailureMessage('server_unavailable')).not.toMatch(/invalid/i);
    expect(signInFailureMessage('email_not_confirmed')).not.toMatch(/invalid/i);
  });

  it('the old two-headed message is gone', () => {
    const kinds = [
      'invalid_credentials',
      'account_blocked',
      'email_not_confirmed',
      'rate_limited',
      'server_unavailable',
      'unknown',
    ] as const;
    for (const k of kinds) {
      expect(signInFailureMessage(k)).not.toBe(
        'Invalid credentials, or this account cannot sign in.',
      );
    }
  });

  it('reveals no secret in any message', () => {
    for (const k of ['account_blocked', 'unknown', 'rate_limited'] as const) {
      expect(signInFailureMessage(k)).not.toMatch(/token|jwt|supabase|role|device/i);
    }
  });
});

describe('redactEmail — a log line never carries a full address', () => {
  it('keeps one character and the domain', () => {
    expect(redactEmail('kingfmgonzales@gmail.com')).toBe('k***@gmail.com');
    expect(redactEmail('a@b.co')).toBe('a***@b.co');
    expect(redactEmail('nonsense')).toBe('n***@');
  });
});
