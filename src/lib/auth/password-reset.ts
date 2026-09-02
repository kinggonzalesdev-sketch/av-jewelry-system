'use server';

import { recordAuditEvent } from '@/lib/audit/log';
import { createClient } from '@/lib/supabase/server';
import {
  passwordResetRequestSchema,
  passwordResetVerifySchema,
  setPasswordSchema,
} from '@/lib/validation/auth';

/**
 * Password reset via Supabase Auth's OWN email-OTP recovery (Owner 2026-09-02).
 *
 * NO homemade codes, NO custom OTP table — Supabase owns generation, single-use, hashing,
 * and expiry. The flow is exactly three Supabase calls, then a global sign-out:
 *   1) resetPasswordForEmail(email)                         → emails the 6-digit code
 *   2) verifyOtp({ email, token, type: 'recovery' })        → opens a recovery session
 *   3) updateUser({ password })                             → sets the new password
 *   +) signOut({ scope: 'global' })                         → revokes every other session
 *
 * Config (OTP length = 6, expiry = 600s, template renders {{ .Token }}, SMTP) lives in the
 * Supabase dashboard / Management API, NOT in code — see the reset-password runbook.
 */

/** The ONE anti-enumeration message — identical whether or not the email exists, and even
 *  when Supabase errors. Never reveal account existence. */
const GENERIC_REQUEST_MESSAGE =
  "If an account exists for this email, we've sent a 6-digit code.";

export type RequestResetResult = { message: string };
export type VerifyResetResult =
  | { ok: true }
  | { ok: false; error: string; expired?: boolean };
export type ChangePasswordResult = { ok: true } | { ok: false; error: string };

// ---- Best-effort in-memory rate limiter --------------------------------------------------
// Per-process sliding window. It is a first gate, NOT the only one: Supabase Auth itself
// rate-limits recovery sends server-side (the real backstop across instances). A distributed
// limiter (Redis/DB) would be needed to enforce this cluster-wide.
const WINDOW_MS = 15 * 60_000;
const buckets = new Map<string, number[]>();

function rateLimited(key: string, max: number, now = Date.now()): boolean {
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= max) {
    buckets.set(key, hits);
    return true;
  }
  hits.push(now);
  buckets.set(key, hits);
  return false;
}

/** first char + domain, so server logs never carry a full address. */
function redactEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

/**
 * STEP 1 — send the recovery code. ALWAYS returns the same generic message (anti-enumeration),
 * whether the email exists, is rate-limited, or Supabase errors. Never throws to the caller.
 */
export async function requestPasswordReset(email: string): Promise<RequestResetResult> {
  const parsed = passwordResetRequestSchema.safeParse({ email });
  if (!parsed.success) {
    // Even an invalid email returns the generic message — no shape feedback that could be
    // probed. (The client validates the field shape for UX before it ever calls this.)
    return { message: GENERIC_REQUEST_MESSAGE };
  }
  const clean = parsed.data.email;

  // App-level throttle (per email). On trip, still return the generic message — silently
  // skip the send rather than reveal anything.
  if (rateLimited(`req:${clean}`, 5)) {
    console.info('[password-reset] request throttled', { email: redactEmail(clean) });
    return { message: GENERIC_REQUEST_MESSAGE };
  }

  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(clean);
    // Log the TRUE outcome server-side (the UI can't, by design) — this is the only place a
    // real SMTP/config failure is visible without the Auth logs.
    console.info('[password-reset] request', {
      email: redactEmail(clean),
      ok: !error,
      error: error?.message ?? null,
    });
  } catch (cause) {
    console.error('[password-reset] request threw', redactEmail(clean), cause);
  }
  return { message: GENERIC_REQUEST_MESSAGE };
}

/**
 * STEP 2 — verify the 6-digit code and open a recovery session. Server-side /^\d{6}$/ check
 * before verifyOtp. Distinguishes an EXPIRED code from an invalid one.
 */
export async function verifyResetOtp(
  email: string,
  code: string,
): Promise<VerifyResetResult> {
  const parsed = passwordResetVerifySchema.safeParse({ email, code });
  if (!parsed.success) {
    return { ok: false, error: 'Enter the 6-digit code from your email.' };
  }
  const clean = parsed.data;

  if (rateLimited(`vfy:${clean.email}`, 10)) {
    return { ok: false, error: 'Too many attempts. Please wait a moment and try again.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: clean.email,
    token: clean.code,
    type: 'recovery',
  });

  if (error) {
    console.info('[password-reset] verify failed', {
      email: redactEmail(clean.email),
      code: error.code ?? null,
    });
    if (error.code === 'otp_expired') {
      return {
        ok: false,
        expired: true,
        error: 'That code has expired. Send a new code and try again.',
      };
    }
    return { ok: false, error: 'Invalid or expired code. Check it and try again.' };
  }

  // A recovery session now exists → this event can be attributed to the recovering user.
  await recordAuditEvent({
    action: 'auth.password_reset_verified',
    entityType: 'auth_user',
    outcome: 'succeeded',
  });
  return { ok: true };
}

/**
 * STEP 3 — set the new password on the recovery session, then revoke EVERY session on all
 * devices. The caller must already hold a recovery session (from verifyResetOtp).
 */
export async function changePassword(
  password: string,
  confirmPassword: string,
): Promise<ChangePasswordResult> {
  const parsed = setPasswordSchema.safeParse({ password, confirmPassword });
  if (!parsed.success) {
    const first = parsed.error.issues[0]?.message ?? 'Choose a valid password.';
    return { ok: false, error: first };
  }

  const supabase = await createClient();

  // Guard: only a genuine recovery (or signed-in) session may set a password here.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: 'Your reset session expired. Start again.' };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    await recordAuditEvent({
      action: 'auth.password_changed',
      entityType: 'auth_user',
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: 'Could not set the new password. Please try again.' };
  }

  await recordAuditEvent({
    action: 'auth.password_changed',
    entityType: 'auth_user',
    outcome: 'succeeded',
  });

  // Revoke all sessions on all devices — the reset itself logs the user out everywhere; they
  // sign in fresh with the new password. Best-effort: the password is already changed.
  try {
    await supabase.auth.signOut({ scope: 'global' });
  } catch (cause) {
    console.error('[password-reset] global signOut failed', cause);
  }
  return { ok: true };
}
