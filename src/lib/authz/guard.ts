import 'server-only';

import { cache } from 'react';

import type { User } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth/session';
import {
  permissionsForRole,
  type PermissionKey,
  type RoleKey,
} from '@/lib/authz/permissions';
import { createClient } from '@/lib/supabase/server';

/**
 * Server-side authorization boundary (ADR §7, §8).
 *
 * The layered model:
 *   1. RLS at the data layer            — last line of defence
 *   2. THIS module (server boundary)    — exact permission per action, at execution time
 *   3. Owner-only gate                  — the six non-delegable approvals
 *   4. Shop/page scope                  — applicable-scope restriction
 *   5. UI                               — convenience only, NEVER the security control
 *
 * Standing rules:
 *   - UI visibility is not authorization; assignment is not permission; role
 *     title is not authority (Bible §5, §11, §30.3 r2).
 *   - Nothing here trusts client-supplied role, permission, scope, or actor id.
 *     Identity always comes from the verified session (auth.uid()).
 *   - Permission, scope, record state, and Owner approval are revalidated at
 *     EXECUTION time, not merely at render time (Bible §29.8).
 *   - These checks and RLS must AGREE. This layer produces clear errors and good
 *     UX; RLS guarantees that a bug here cannot expose data.
 */

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthorizationError';
  }
}

export type StaffContext = {
  staffProfileId: string;
  authUserId: string;
  roleKey: RoleKey;
  isActive: boolean;
  mfaEnrolled: boolean;
};

/**
 * Requires an authenticated session. Proves only WHO the caller is.
 */
export async function requireAuthenticatedStaff(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) {
    redirect('/sign-in');
  }

  return user;
}

/**
 * Requires an authenticated AND ACTIVE staff account.
 *
 * A deactivated account loses future access (Bible §30.6). It is redirected to an
 * explicit "access disabled" screen rather than sign-in, because the credentials
 * are valid — the account is not.
 *
 * The profile is read through the user-scoped client, so RLS applies: a caller
 * can only ever read their own profile here.
 */
/**
 * The authenticated staff member's OWN display identity.
 *
 * This is what the shell renders in place of the prototype's hardcoded
 * "A.V. Owner / Owner". Every field is the caller's real, database-backed
 * profile — never a fixture, never a guess.
 *
 * Readable by any role: the `staff_profiles_read_self` RLS policy lets a staff
 * member read their own row (auth_user_id = auth.uid()), independently of the
 * Owner-only policy that governs reading OTHER people's rows. So a Staff member
 * sees their own name here without being able to see anyone else's.
 */
export type CurrentStaffProfile = {
  fullName: string;
  roleKey: RoleKey;
  isSelectedAdmin: boolean;
  isActive: boolean;
};

export const getCurrentStaffProfile = cache(async (): Promise<CurrentStaffProfile> => {
  const staff = await requireActiveStaff();
  const supabase = await createClient();

  const { data } = await supabase
    .from('staff_profiles')
    .select('full_name')
    .eq('auth_user_id', staff.authUserId)
    .maybeSingle<{ full_name: string }>();

  return {
    // Falls back to a neutral label rather than a fabricated name if the
    // self-read ever returns nothing — never "A.V. Owner".
    fullName: data?.full_name ?? 'Staff member',
    roleKey: staff.roleKey,
    isSelectedAdmin: staff.roleKey === 'selected_admin',
    isActive: staff.isActive,
  };
});

// Cached per request: the staff_profiles lookup runs ONCE even though many
// callers (permissions, staff profile, every page guard) ask for it per render.
export const requireActiveStaff = cache(async (): Promise<StaffContext> => {
  const user = await requireAuthenticatedStaff();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, auth_user_id, role_key, is_active, mfa_enrolled')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  // No profile: authenticated with Supabase, but not a staff member. There is no
  // customer login, so this is not a valid application user.
  if (error || !data) {
    redirect('/account-disabled');
  }

  if (!data.is_active) {
    redirect('/account-disabled');
  }

  return {
    staffProfileId: data.id as string,
    authUserId: data.auth_user_id as string,
    roleKey: data.role_key as RoleKey,
    isActive: data.is_active as boolean,
    mfaEnrolled: data.mfa_enrolled as boolean,
  };
});

/**
 * Returns the permissions the caller effectively holds.
 *
 * Mirrors `app_private.has_permission` (Bible §5, §5.13): the OWNER is the main
 * administrator and holds EVERY permission by an explicit owner-level rule; every
 * other role holds ONLY its explicit grants — role title is not authority for
 * Selected Admin or Staff. This must agree with the SQL, so the UI never shows a
 * control the database then refuses.
 */
export const getGrantedPermissions = cache(async (): Promise<Set<PermissionKey>> => {
  const staff = await requireActiveStaff();

  // The Owner holds all permissions regardless of grants — no query needed.
  if (staff.roleKey === 'owner') {
    return permissionsForRole('owner', []);
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from('staff_permission_grants')
    .select('permission_key')
    .eq('staff_profile_id', staff.staffProfileId);

  if (error || !data) {
    // Fail closed: an unreadable grant list means NO permissions, never all.
    return new Set();
  }

  return permissionsForRole(
    staff.roleKey,
    data.map((row) => row.permission_key as PermissionKey),
  );
});

export async function hasPermission(permission: PermissionKey): Promise<boolean> {
  return (await getGrantedPermissions()).has(permission);
}

/**
 * Requires an explicit grant of exactly `permission`.
 *
 * Throws rather than redirecting: a denied ACTION must not silently become a
 * navigation. The caller decides how to surface it, and the write does not run —
 * an unauthorized action changes no record (Bible §11.45).
 */
export async function requirePermission(
  permission: PermissionKey,
): Promise<StaffContext> {
  const staff = await requireActiveStaff();

  if (!(await hasPermission(permission))) {
    throw new AuthorizationError(
      `Not authorized: this action requires the ${permission} permission. No record was changed.`,
    );
  }

  return staff;
}

/**
 * Requires the caller to hold the given shop/page scope.
 * Scope NARROWS access; holding a scope grants nothing on its own.
 */
export async function requireScope(scopeId: string | null): Promise<StaffContext> {
  const staff = await requireActiveStaff();

  // An unscoped record is not scope-restricted.
  if (scopeId === null) {
    return staff;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('staff_scope_assignments')
    .select('scope_id')
    .eq('staff_profile_id', staff.staffProfileId)
    .eq('scope_id', scopeId)
    .maybeSingle();

  if (error || !data) {
    throw new AuthorizationError(
      'Not authorized: this record is outside your assigned scope. No record was changed.',
    );
  }

  return staff;
}

/**
 * Requires the Owner.
 *
 * Identity IS authority here, because the Bible makes the Owner the highest
 * authority (§5). This gate is for OWNER-ONLY surfaces (e.g. staff management).
 * Operational permissions are handled separately by has_permission, where the
 * Owner now holds every permission by the same §5 rule — but a Selected Admin or
 * Staff member never passes THIS gate, whatever grants they hold.
 */
export async function requireOwner(): Promise<StaffContext> {
  const staff = await requireActiveStaff();

  if (staff.roleKey !== 'owner') {
    throw new AuthorizationError(
      'Not authorized: this action is reserved to the Owner. No record was changed.',
    );
  }

  return staff;
}

/**
 * The PRIMARY Super Admin — identified by email, not by role, so the authority
 * survives renames, role edits, and profile changes. Mirrors
 * `app_private.primary_super_admin_email()`; the database is the real gate, this
 * only decides what the UI offers.
 */
export const PRIMARY_SUPER_ADMIN_EMAIL = 'kingfmgonzales@gmail.com';

/** True when the signed-in user IS the Primary Super Admin (case/space-insensitive). */
export async function isPrimarySuperAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const email = user?.email?.trim().toLowerCase() ?? '';
  return email === PRIMARY_SUPER_ADMIN_EMAIL;
}

/** Refuses anyone who is not the Primary Super Admin. */
export async function requirePrimarySuperAdmin(): Promise<StaffContext> {
  const staff = await requireActiveStaff();
  if (!(await isPrimarySuperAdmin())) {
    throw new AuthorizationError(
      'Not authorized: this action is reserved to the Primary Super Admin. No record was changed.',
    );
  }
  return staff;
}

/**
 * Requires the Owner OR a Selected Admin.
 *
 * The gate for destructive admin maintenance the Owner has chosen to delegate to
 * their trusted Selected Admin — permanent deletion of an isolated customer, an
 * attendance record, or a mis-encoded inventory item. Plain Staff never pass.
 * Mirrors the SQL `current_staff_role() in ('owner','selected_admin')` in the
 * matching SECURITY DEFINER delete functions.
 */
export async function requireOwnerOrAdmin(): Promise<StaffContext> {
  const staff = await requireActiveStaff();

  if (staff.roleKey !== 'owner' && staff.roleKey !== 'selected_admin') {
    throw new AuthorizationError(
      'Not authorized: this action is reserved to the Owner or Selected Admin. No record was changed.',
    );
  }

  return staff;
}

/**
 * Requires authority to decide one of the six non-delegable Owner approvals
 * (Bible §5.13, §22.14).
 *
 * Deliberately identical to requireOwner() rather than permission-based: there is
 * NO permission that confers this, and no delegation exists. It is a separate
 * function so the intent is explicit at every call site and so a future change
 * cannot accidentally widen it by editing a shared helper.
 */
export async function requireOwnerApprovalAuthority(): Promise<StaffContext> {
  const staff = await requireActiveStaff();

  if (staff.roleKey !== 'owner') {
    throw new AuthorizationError(
      'Not authorized: the six Owner approvals are non-delegable and cannot be performed by Selected Admin or Staff. No record was changed.',
    );
  }

  return staff;
}

/**
 * Reads the session's Authenticator Assurance Level.
 * 'aal1' = password only; 'aal2' = a TOTP challenge was verified this session.
 */
export async function getCurrentAal(): Promise<'aal1' | 'aal2' | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  if (error || !data.currentLevel) {
    return null;
  }

  return data.currentLevel as 'aal1' | 'aal2';
}

/**
 * Requires an MFA-elevated (aal2) session.
 *
 * ⚠️  Nothing in Phase 2 calls this yet. It is the enforcement primitive, ready
 *     for the phase that decides WHICH actions demand elevation. Applying it now
 *     would lock development behind MFA before an Owner can enroll — see
 *     src/lib/auth/mfa.ts.
 */
export async function requireAal2(): Promise<StaffContext> {
  const staff = await requireActiveStaff();
  const aal = await getCurrentAal();

  if (aal !== 'aal2') {
    throw new AuthorizationError(
      'Not authorized: this action requires multi-factor authentication. Verify your authenticator app and try again. No record was changed.',
    );
  }

  return staff;
}

/**
 * Legacy alias retained from Phase 0 so existing callers keep working.
 * Proves only WHO the caller is — never WHAT they may do.
 */
export async function requireUser(): Promise<User> {
  return requireAuthenticatedStaff();
}
