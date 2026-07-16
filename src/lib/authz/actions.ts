'use server';

import { revalidatePath } from 'next/cache';

import {
  assignScope,
  deactivateAccount,
  grantPermission,
  reactivateAccount,
  removeScope,
  revokePermission,
  setSelectedAdminStatus,
} from '@/lib/authz/account-management';
import { PERMISSIONS, type PermissionKey } from '@/lib/authz/permissions';

/**
 * Staff administration server actions (Bible §5.3, §5.4, §5.13, §30.5).
 *
 * Transport only. Every function below delegates to a domain module that calls
 * `requireOwner()` at execution time, and RLS refuses underneath that. Invoking
 * these directly — bypassing the console entirely — is checked identically, so
 * the screen's buttons are a convenience and never the control (§30.3 r2).
 *
 * NOT here, deliberately: staff INVITATION. Creating an account needs the
 * Supabase Admin API and the service-role key, which bypasses RLS entirely and
 * is intentionally unwired (ADR §11). It is the one path that can mint
 * credentials, so it stays an explicit decision rather than a side-effect of a
 * UI-completion pass. Accounts are provisioned out-of-band until then.
 */

export type StaffAdminActionState = { error: string | null; success: string | null };

export const EMPTY_STAFF_ADMIN_STATE: StaffAdminActionState = {
  error: null,
  success: null,
};

function text(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Only keys in the approved catalog may be granted — never a free-text string. */
function asPermissionKey(value: string | null): PermissionKey | null {
  if (!value) return null;
  const known = Object.values(PERMISSIONS) as string[];
  return known.includes(value) ? (value as PermissionKey) : null;
}

function refresh() {
  revalidatePath('/admin/staff');
}

export async function grantPermissionAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const permission = asPermissionKey(text(formData, 'permission'));

  if (!staffProfileId) return { error: 'An account is required.', success: null };
  if (!permission) {
    return { error: 'That is not a permission in the approved catalog.', success: null };
  }

  const result = await grantPermission(staffProfileId, permission);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    // Says what was granted and what was NOT: grants are explicit and additive,
    // and no permission silently includes another (§5.13).
    success: `Granted ${permission}. It grants that permission only — nothing else is implied.`,
  };
}

export async function revokePermissionAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const permission = asPermissionKey(text(formData, 'permission'));

  if (!staffProfileId) return { error: 'An account is required.', success: null };
  if (!permission) {
    return { error: 'That is not a permission in the approved catalog.', success: null };
  }

  const result = await revokePermission(staffProfileId, permission);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    success: `Revoked ${permission}. Past actions keep their attribution — history is not rewritten.`,
  };
}

export async function deactivateAccountAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const reason = text(formData, 'reason');

  if (!staffProfileId) return { error: 'An account is required.', success: null };
  if (!reason)
    return { error: 'Deactivating an account requires a reason.', success: null };

  const result = await deactivateAccount(staffProfileId, reason);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    // Both halves of §30.3 r17, stated plainly — the second half is the one an
    // operator doubts, and doubting it leads to someone deleting history.
    success:
      'Account deactivated. They lose access immediately; their grants and their audit history are preserved.',
  };
}

export async function reactivateAccountAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  if (!staffProfileId) return { error: 'An account is required.', success: null };

  const result = await reactivateAccount(staffProfileId);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    success:
      'Account reactivated with the grants it already had. No permission was added.',
  };
}

export async function setSelectedAdminAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const make = text(formData, 'makeSelectedAdmin') === 'true';

  if (!staffProfileId) return { error: 'An account is required.', success: null };

  const result = await setSelectedAdminStatus(staffProfileId, make);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    success: make
      ? 'Selected Admin status granted. The TITLE grants no operational permission — grant each one explicitly.'
      : 'Selected Admin status removed. The account keeps its explicit grants; only the title changed.',
  };
}

export async function assignScopeAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const scopeId = text(formData, 'scopeId');

  if (!staffProfileId) return { error: 'An account is required.', success: null };
  if (!scopeId) return { error: 'A scope is required.', success: null };

  const result = await assignScope(staffProfileId, scopeId);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return {
    error: null,
    // Assignment ≠ permission (§5). A scope NARROWS what a granted permission
    // reaches; it never hands one out.
    success:
      'Scope assigned. Assignment is not permission — a scope narrows where a granted permission applies, it grants nothing.',
  };
}

export async function removeScopeAction(
  _prev: StaffAdminActionState,
  formData: FormData,
): Promise<StaffAdminActionState> {
  const staffProfileId = text(formData, 'staffProfileId');
  const scopeId = text(formData, 'scopeId');

  if (!staffProfileId) return { error: 'An account is required.', success: null };
  if (!scopeId) return { error: 'A scope is required.', success: null };

  const result = await removeScope(staffProfileId, scopeId);
  if (!result.ok) return { error: result.error, success: null };

  refresh();
  return { error: null, success: 'Scope removed.' };
}
