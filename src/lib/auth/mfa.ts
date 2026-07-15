import 'server-only';

/**
 * TOTP MFA IMPLEMENTATION HOOK — BOUNDARY ONLY. NOT IMPLEMENTED.
 * =============================================================
 *
 * Approved method (ADR §5): **Supabase Auth TOTP (authenticator-app)**.
 * Explicitly NOT approved: SMS, WhatsApp, or email-based MFA.
 *
 * ⚠️  MFA IS NOT ENFORCED. Phase 0 records the method and marks this boundary only.
 *     Nothing in this file gates access, and no caller may claim MFA is complete.
 *
 * Approved policy this hook must eventually satisfy
 * ------------------------------------------------
 *  - Owner MFA: REQUIRED before production launch.
 *  - Selected Admin MFA (max two accounts, Bible §5.4): strongly recommended;
 *    must be reviewed before production.
 *  - Ordinary Staff MFA: optional in V1.
 *
 * Where the real implementation belongs
 * -------------------------------------
 * Enrollment and enforcement are owned by the account/permission phase
 * (Roadmap Phase 2), NOT Phase 0. The intended Supabase primitives are
 * `auth.mfa.enroll` / `challenge` / `verify`, and the session's Authenticator
 * Assurance Level (aal1 → aal2) is what any future enforcement must actually
 * check — a user with a verified factor who has not completed a TOTP challenge
 * holds an aal1 session and must not be treated as MFA-satisfied.
 *
 * Still To be confirmed before pilot (ADR §17)
 * --------------------------------------------
 *  - Recovery and lost-device handling.
 *
 * When this is implemented, the enforcement point must sit at the trusted
 * server/data boundary — never in UI visibility (Bible §30.3 r2).
 */

/**
 * Assurance levels reported by Supabase Auth. Present so future enforcement code
 * has a typed vocabulary; nothing in Phase 0 consumes it.
 */
export type AuthenticatorAssuranceLevel = 'aal1' | 'aal2';

/**
 * The approved MFA method for V1. Recorded, not enforced.
 */
export const APPROVED_MFA_METHOD = 'totp' as const;

/**
 * Phase 0 status marker, asserted by the foundation tests so that a future change
 * cannot quietly imply MFA is finished without the test being updated deliberately.
 */
export const MFA_ENFORCEMENT_IMPLEMENTED = false;
