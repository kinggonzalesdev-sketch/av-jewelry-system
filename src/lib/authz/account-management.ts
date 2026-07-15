import 'server-only';

import { AuthorizationError, requireOwner, type StaffContext } from '@/lib/authz/guard';
import type { PermissionKey, RoleKey } from '@/lib/authz/permissions';
import { createClient } from '@/lib/supabase/server';

/**
 * Internal account management — Owner-only (Bible §5.3, §5.4, §30.5).
 *
 * There is NO public registration and NO customer login. Staff accounts are
 * created, invited, activated, and disabled only through this authorized
 * internal process.
 *
 * Every function here re-checks Owner authority at EXECUTION time. That check is
 * deliberately redundant with RLS: RLS guarantees a bug here cannot alter data,
 * and these checks give clear errors. Neither is trusted alone (ADR §7).
 *
 * ⚠️  No real production users are created by this module or by any migration.
 */

export type AccountActionResult = { ok: true } | { ok: false; error: string };

/**
 * Grants one permission to one account.
 *
 * Grants are explicit and additive; nothing is implied by role. Granting the same
 * permission twice is idempotent (the unique constraint absorbs the retry).
 */
export async function grantPermission(
  staffProfileId: string,
  permission: PermissionKey,
): Promise<AccountActionResult> {
  const owner = await requireOwner();
  const supabase = await createClient();

  const { error } = await supabase.from('staff_permission_grants').upsert(
    {
      staff_profile_id: staffProfileId,
      permission_key: permission,
      granted_by: owner.staffProfileId,
    },
    { onConflict: 'staff_profile_id,permission_key', ignoreDuplicates: true },
  );

  if (error) {
    return { ok: false, error: 'The permission could not be granted.' };
  }

  return { ok: true };
}

/**
 * Revokes one permission from one account. Access is removed immediately.
 */
export async function revokePermission(
  staffProfileId: string,
  permission: PermissionKey,
): Promise<AccountActionResult> {
  await requireOwner();
  const supabase = await createClient();

  // Revocation removes the grant row. The ACCOUNT and its audit history are never
  // deleted — only the authority to act going forward is withdrawn.
  const { error } = await supabase
    .from('staff_permission_grants')
    .delete()
    .eq('staff_profile_id', staffProfileId)
    .eq('permission_key', permission);

  if (error) {
    return { ok: false, error: 'The permission could not be revoked.' };
  }

  return { ok: true };
}

/**
 * Deactivates an account. Deactivation is NOT deletion: the account row, its
 * grants, and its audit trail all survive, so historical attribution remains
 * (Bible §31). A database trigger also revokes the account's trusted devices.
 */
export async function deactivateAccount(
  staffProfileId: string,
  reason: string,
): Promise<AccountActionResult> {
  const owner = await requireOwner();

  if (staffProfileId === owner.staffProfileId) {
    return {
      ok: false,
      error: 'You cannot deactivate your own Owner account. Another Owner must do this.',
    };
  }

  if (!reason.trim()) {
    return { ok: false, error: 'A reason is required to deactivate an account.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('staff_profiles')
    .update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivated_reason: reason.trim(),
    })
    .eq('id', staffProfileId);

  if (error) {
    return { ok: false, error: 'The account could not be deactivated.' };
  }

  return { ok: true };
}

/**
 * Reactivates a previously disabled account.
 */
export async function reactivateAccount(
  staffProfileId: string,
): Promise<AccountActionResult> {
  await requireOwner();
  const supabase = await createClient();

  const { error } = await supabase
    .from('staff_profiles')
    .update({ is_active: true, deactivated_at: null, deactivated_reason: null })
    .eq('id', staffProfileId);

  if (error) {
    return { ok: false, error: 'The account could not be reactivated.' };
  }

  return { ok: true };
}

/**
 * Promotes an account to Selected Admin, or demotes it back to Staff.
 *
 * Only the Owner may do this (Bible §5.4), and at most two Selected Admins may be
 * active. The cap is enforced atomically by a database trigger, so a concurrent
 * double-promotion cannot slip past — this function surfaces that rejection as a
 * readable message rather than re-implementing (and possibly disagreeing with)
 * the rule.
 */
export async function setSelectedAdminStatus(
  staffProfileId: string,
  makeSelectedAdmin: boolean,
): Promise<AccountActionResult> {
  await requireOwner();
  const supabase = await createClient();

  const nextRole: RoleKey = makeSelectedAdmin ? 'selected_admin' : 'staff';

  const { error } = await supabase
    .from('staff_profiles')
    .update({ role_key: nextRole })
    .eq('id', staffProfileId);

  if (error) {
    // 23514 = the check_violation raised by the max-two trigger.
    if (error.code === '23514') {
      return {
        ok: false,
        error:
          'A maximum of two active Selected Admin accounts is permitted. Demote or deactivate one first.',
      };
    }
    return { ok: false, error: 'The role could not be changed.' };
  }

  return { ok: true };
}

/**
 * Assigns a shop/page scope to an account. Scope narrows access; it grants nothing.
 */
export async function assignScope(
  staffProfileId: string,
  scopeId: string,
): Promise<AccountActionResult> {
  const owner = await requireOwner();
  const supabase = await createClient();

  const { error } = await supabase.from('staff_scope_assignments').upsert(
    {
      staff_profile_id: staffProfileId,
      scope_id: scopeId,
      assigned_by: owner.staffProfileId,
    },
    { onConflict: 'staff_profile_id,scope_id', ignoreDuplicates: true },
  );

  if (error) {
    return { ok: false, error: 'The scope could not be assigned.' };
  }

  return { ok: true };
}

export async function removeScope(
  staffProfileId: string,
  scopeId: string,
): Promise<AccountActionResult> {
  await requireOwner();
  const supabase = await createClient();

  const { error } = await supabase
    .from('staff_scope_assignments')
    .delete()
    .eq('staff_profile_id', staffProfileId)
    .eq('scope_id', scopeId);

  if (error) {
    return { ok: false, error: 'The scope could not be removed.' };
  }

  return { ok: true };
}

/**
 * Lists staff accounts for the Owner's management screen.
 * RLS restricts this to the Owner; a non-Owner would simply see nothing.
 */
export async function listStaffAccounts(): Promise<
  Array<{
    id: string;
    fullName: string;
    roleKey: RoleKey;
    isActive: boolean;
    mfaEnrolled: boolean;
  }>
> {
  await requireOwner();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, full_name, role_key, is_active, mfa_enrolled')
    .order('full_name');

  if (error || !data) {
    return [];
  }

  return data.map((row) => ({
    id: row.id as string,
    fullName: row.full_name as string,
    roleKey: row.role_key as RoleKey,
    isActive: row.is_active as boolean,
    mfaEnrolled: row.mfa_enrolled as boolean,
  }));
}

/**
 * ACCOUNT CREATION / INVITATION — BOUNDARY ONLY. NOT IMPLEMENTED.
 *
 * Creating a staff account requires the Supabase Admin API (`auth.admin`), which
 * needs the SERVICE-ROLE key. That key is deliberately not required for ordinary
 * startup (ADR §11) and has no caller in this codebase.
 *
 * Wiring it is a real decision with real consequences — it is the one path that
 * can mint credentials — so it is left for the phase that owns account
 * provisioning, with the invitation flow and its audit trail designed together.
 * Until then, development accounts are created out-of-band in your own local
 * Supabase project.
 */
export async function inviteStaffAccount(): Promise<never> {
  await requireOwner();

  throw new AuthorizationError(
    'Staff invitation is not implemented in Phase 2. It requires the Supabase Admin API and the service-role key, which is intentionally unwired. Create development accounts directly in your local Supabase project.',
  );
}

export type { StaffContext };
