import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * TOTP MFA — Supabase-validated flows only.
 * =========================================
 *
 * Approved method (ADR §5): **Supabase Auth TOTP (authenticator-app)**.
 * NOT approved and NOT implemented: SMS, WhatsApp, or email MFA.
 *
 * ⚠️  MFA IS NOT ENFORCED. See MFA_ENFORCEMENT_IMPLEMENTED below for exactly what
 *     that means and why.
 *
 * Approved policy:
 *   - Owner MFA: REQUIRED before pilot and production (readiness, not a dev gate)
 *   - Selected Admin MFA: strongly recommended
 *   - Staff MFA: optional in V1
 *   - Staff and Selected Admin cannot reset Owner MFA
 *
 * Recovery: Supabase exposes no recovery-code API for TOTP factors. No such API
 * is invented here. The approved process is that the Owner stores recovery
 * material offline and lost-device recovery follows a controlled Owner-account
 * recovery process — a documented human procedure, not code. See
 * docs/PHASE-2-AUTH-PERMISSIONS.md.
 */

export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2';

/** The approved MFA method for V1. */
export const APPROVED_MFA_METHOD = 'totp' as const;

/**
 * ⚠️  BLANKET MFA ENFORCEMENT IS NOT IMPLEMENTED.
 *
 * What IS implemented and tested:
 *   - TOTP enrollment, challenge, and verification via Supabase (below)
 *   - aal1 vs aal2 detection, server-side (`getCurrentAal`) and in the database
 *     (`app_private.current_auth_aal()`, which defaults to aal1 — fails closed)
 *   - `requireAal2()`, a working enforcement primitive
 *   - Owner MFA readiness reporting (`app_private.owner_mfa_ready()`)
 *
 * What is NOT implemented — which is why this stays false:
 *   - MFA is not REQUIRED of anyone. An Owner without an enrolled factor can
 *     still sign in and exercise Owner authority. Requiring it now would make
 *     initial setup impossible: an Owner cannot enroll a factor if they cannot
 *     first sign in and reach the enrollment screen.
 *   - No action currently calls `requireAal2()`. Deciding WHICH actions demand
 *     elevation is a business decision that has not been made.
 *
 * Flip this to true ONLY in the same commit as real enforcement plus tests that
 * prove it. A test asserts it is false, so a premature flip fails the suite —
 * that is deliberate.
 */
export const MFA_ENFORCEMENT_IMPLEMENTED = false;

export type EnrollTotpResult =
  | { ok: true; factorId: string; qrCodeSvg: string; secret: string }
  | { ok: false; error: string };

/**
 * Begins TOTP enrollment. Returns the QR code and secret for the authenticator
 * app. The factor is UNVERIFIED until a challenge is verified — enrolling alone
 * does not make the account MFA-protected.
 */
export async function enrollTotp(friendlyName?: string): Promise<EnrollTotpResult> {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    ...(friendlyName ? { friendlyName } : {}),
  });

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'Enrollment could not be started.' };
  }

  return {
    ok: true,
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
  };
}

export type VerifyTotpResult = { ok: true } | { ok: false; error: string };

/**
 * Creates a challenge and verifies a TOTP code against it. On success the session
 * is elevated to aal2.
 *
 * The code is verified by Supabase — never compared locally, and never stored.
 */
export async function verifyTotp(
  factorId: string,
  code: string,
): Promise<VerifyTotpResult> {
  const supabase = await createClient();

  const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });

  if (challengeError || !challenge) {
    return { ok: false, error: 'Could not start verification. Try again.' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: challenge.id,
    code,
  });

  if (verifyError) {
    // Deliberately generic: never reveal whether the factor or the code was wrong.
    return { ok: false, error: 'That code was not accepted. Try again.' };
  }

  return { ok: true };
}

/**
 * Cancels an incomplete enrollment by removing an unverified factor.
 * Supabase supports unenroll; nothing is invented here.
 */
export async function cancelTotpEnrollment(factorId: string): Promise<VerifyTotpResult> {
  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });

  if (error) {
    return { ok: false, error: 'Could not cancel enrollment.' };
  }

  return { ok: true };
}

export type MfaStatus = {
  hasVerifiedFactor: boolean;
  currentLevel: AuthenticatorAssuranceLevel | null;
  nextLevel: AuthenticatorAssuranceLevel | null;
  /** True when a verified factor exists but this session has not been elevated. */
  elevationPending: boolean;
};

/**
 * Reports the caller's MFA state. Reads only — enforces nothing.
 */
export async function getMfaStatus(): Promise<MfaStatus> {
  const supabase = await createClient();

  const { data: factors } = await supabase.auth.mfa.listFactors();
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  const hasVerifiedFactor = (factors?.totp ?? []).length > 0;
  const currentLevel = (aal?.currentLevel ?? null) as AuthenticatorAssuranceLevel | null;
  const nextLevel = (aal?.nextLevel ?? null) as AuthenticatorAssuranceLevel | null;

  return {
    hasVerifiedFactor,
    currentLevel,
    nextLevel,
    elevationPending:
      currentLevel === 'aal1' && nextLevel === 'aal2' && hasVerifiedFactor,
  };
}
