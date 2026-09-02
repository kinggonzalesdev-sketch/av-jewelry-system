import { describe, expect, it } from 'vitest';

import {
  cooldownDeadline,
  isCompleteOtp,
  passwordChecks,
  RESEND_COOLDOWN_MS,
  sanitizeOtp,
  secondsLeft,
} from '@/lib/auth/reset-cooldown';
import { MINIMUM_PASSWORD_LENGTH, passwordResetVerifySchema } from '@/lib/validation/auth';

describe('resend cooldown — deadline-based (never drifts)', () => {
  it('cooldownDeadline is now + 60s', () => {
    expect(cooldownDeadline(1_000_000)).toBe(1_000_000 + RESEND_COOLDOWN_MS);
    expect(RESEND_COOLDOWN_MS).toBe(60_000);
  });
  it('secondsLeft ceils and floors at 0', () => {
    const now = 1_000_000;
    expect(secondsLeft(now + 60_000, now)).toBe(60);
    expect(secondsLeft(now + 59_400, now)).toBe(60); // 59.4s reads as 60
    expect(secondsLeft(now + 500, now)).toBe(1);
    expect(secondsLeft(now - 1_000, now)).toBe(0); // past → 0
    expect(secondsLeft(null, now)).toBe(0);
  });
});

describe('OTP input rule — exactly 6 numeric digits', () => {
  it('sanitizeOtp strips non-digits and hard-caps at 6', () => {
    expect(sanitizeOtp('12a34b56789')).toBe('123456');
    expect(sanitizeOtp('  1 2-3 4 ')).toBe('1234');
    expect(sanitizeOtp('abcdef')).toBe('');
    expect(sanitizeOtp('000000')).toBe('000000');
  });
  it('isCompleteOtp enables Verify ONLY at exactly 6 digits', () => {
    expect(isCompleteOtp('123456')).toBe(true);
    expect(isCompleteOtp('12345')).toBe(false);
    expect(isCompleteOtp('1234567')).toBe(false);
    expect(isCompleteOtp('12345a')).toBe(false);
    expect(isCompleteOtp('')).toBe(false);
  });
});

describe('server-side verify schema (/^\\d{6}$/)', () => {
  const ok = { email: 'staff@example.com', code: '123456' };
  it('accepts a valid email + 6-digit code', () => {
    expect(passwordResetVerifySchema.safeParse(ok).success).toBe(true);
  });
  it('rejects 5, 7, or non-numeric codes', () => {
    for (const code of ['12345', '1234567', 'abcdef', '12 456', '']) {
      expect(passwordResetVerifySchema.safeParse({ ...ok, code }).success).toBe(false);
    }
  });
  it('rejects an invalid email', () => {
    expect(passwordResetVerifySchema.safeParse({ email: 'nope', code: '123456' }).success).toBe(
      false,
    );
  });
});

describe('password requirement ticks (app policy — min length)', () => {
  const min = MINIMUM_PASSWORD_LENGTH;
  it('length tick uses the app minimum', () => {
    expect(passwordChecks('short', 'short', min).length).toBe(false);
    expect(passwordChecks('a'.repeat(min), 'a'.repeat(min), min).length).toBe(true);
  });
  it('match tick requires equal, non-empty passwords', () => {
    expect(passwordChecks('', '', min).match).toBe(false);
    expect(passwordChecks('a'.repeat(min), 'different', min).match).toBe(false);
    expect(passwordChecks('a'.repeat(min), 'a'.repeat(min), min).match).toBe(true);
  });
  it('valid only when BOTH pass (blocks submit otherwise)', () => {
    expect(passwordChecks('a'.repeat(min), 'a'.repeat(min), min).valid).toBe(true);
    expect(passwordChecks('short', 'short', min).valid).toBe(false);
    expect(passwordChecks('a'.repeat(min), 'nomatch', min).valid).toBe(false);
  });
});
