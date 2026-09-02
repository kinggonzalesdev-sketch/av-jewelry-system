/**
 * Pure helpers for the password-reset UI (Owner 2026-09-02). Kept framework-free so the
 * countdown, the OTP input rule, and the password checks are unit-tested without a DOM.
 */

/** Resend "cooldown" window — gates ONLY the Resend button; it never shortens the OTP. */
export const RESEND_COOLDOWN_MS = 60_000;

/** A DEADLINE (absolute ms), not a counter — a decrementing tick drifts when the tab is
 *  backgrounded and timers are throttled. The UI derives the remaining seconds from this. */
export function cooldownDeadline(now: number = Date.now()): number {
  return now + RESEND_COOLDOWN_MS;
}

/** Whole seconds left until `deadline` (0 when past or unset). Ceil so "59.4s" reads "60". */
export function secondsLeft(deadline: number | null, now: number = Date.now()): number {
  if (deadline == null) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/** Keep only digits, hard-capped at 6 — the OTP is exactly six numeric digits. */
export function sanitizeOtp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/** True only for a complete 6-digit code — the Verify button enables solely on this. */
export function isCompleteOtp(code: string): boolean {
  return /^\d{6}$/.test(code);
}

/**
 * Live password-requirement ticks. Uses the app's EXISTING policy (min length from
 * validation/auth.ts) rather than inventing a different one for reset — a reset password
 * must satisfy the same rule as every other place a password is set.
 */
export function passwordChecks(
  password: string,
  confirmPassword: string,
  minLength: number,
): { length: boolean; match: boolean; valid: boolean } {
  const length = password.length >= minLength;
  const match = password.length > 0 && password === confirmPassword;
  return { length, match, valid: length && match };
}
