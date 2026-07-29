import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { ALL_ACCESS_KEYS } from '@/lib/authz/access-catalogue';
import {
  AuthorizationError,
  PRIMARY_SUPER_ADMIN_EMAIL,
  requireActiveStaff,
  requireOwner,
} from '@/lib/authz/guard';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { generateTempPassword } from '@/lib/authz/temp-password';

/**
 * Team-member sign-in management (Owner request 2026-07-22, overriding ADR §11's
 * "no account creation from the UI" default — a deliberate Owner decision).
 *
 * SECURITY — read before touching:
 *   - EVERY Owner operation here calls `requireOwner()` FIRST. The service-role
 *     admin client BYPASSES RLS, so this TypeScript gate is the boundary — there
 *     is no RLS net underneath account creation.
 *   - The admin client is used ONLY to create/reset the auth user (the one thing
 *     the signed-in Owner cannot do as themselves). The staff_profiles row is
 *     inserted through the Owner's OWN user-scoped client, so RLS still checks it.
 *   - Passwords are auto-generated (strong) and returned to the Owner ONCE to
 *     hand to the member; they are never stored in plain text anywhere.
 *   - The member self-service change (changeMyPassword) uses the member's OWN
 *     session — no service-role in that path.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The service-role admin client, or null when it is not configured (missing
 *  SUPABASE_SERVICE_ROLE_KEY) — so callers degrade gracefully instead of crashing. */
function adminOrNull(): ReturnType<typeof createAdminClient> | null {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

const NOT_CONFIGURED =
  'Account service is not configured on the server (SUPABASE_SERVICE_ROLE_KEY).';

export type TeamMemberRow = {
  staffProfileId: string;
  fullName: string;
  roleKey: string;
  email: string | null;
  isActive: boolean;
  passwordIsTemp: boolean;
  /** True for the signed-in Owner's own row — the button reads "Set my password". */
  isSelf: boolean;
  /** The Primary Super Admin — cannot be demoted, deleted, or disabled. */
  isPrimarySuperAdmin: boolean;
};

/** One member's saved access, for the Manage Access modal. */
export type TeamMemberAccess = {
  staffProfileId: string;
  fullName: string;
  email: string | null;
  roleKey: string;
  isActive: boolean;
  isPrimarySuperAdmin: boolean;
  /** Permission keys currently granted. A Super Admin holds everything implicitly. */
  permissionKeys: string[];
};

export type AccessMutationResult = { ok: true } | { ok: false; error: string };

export type TeamActionResult =
  { ok: true; tempPassword: string; email: string } | { ok: false; error: string };

/** The team roster with sign-in emails and temp-password status. Owner-only. */
export async function listTeamMembers(): Promise<TeamMemberRow[]> {
  const owner = await requireOwner();

  const emailById = new Map<string, string | null>();
  const admin = adminOrNull();
  if (admin) {
    const { data: authList } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    for (const u of authList?.users ?? []) emailById.set(u.id, u.email ?? null);
  }

  const supabase = await createClient();
  // Real team members only — demo/seeded accounts (is_demo) are excluded at the
  // DATA layer, the SAME flag payroll uses, so the Team Members roster and Payroll
  // stay in sync from one source. Demo accounts still exist and still power demo
  // login; they are just not real team members.
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, auth_user_id, full_name, role_key, is_active, password_is_temp')
    .eq('is_demo', false)
    .order('full_name');

  if (error || !data) return [];

  return (data as Array<Record<string, unknown>>).map((r) => {
    const email = emailById.get(r.auth_user_id as string) ?? null;
    return {
      staffProfileId: r.id as string,
      fullName: (r.full_name as string | null) ?? 'Team member',
      roleKey: (r.role_key as string | null) ?? 'staff',
      email,
      isActive: r.is_active === true,
      passwordIsTemp: r.password_is_temp === true,
      isSelf: (r.auth_user_id as string) === owner.authUserId,
      isPrimarySuperAdmin:
        (email ?? '').trim().toLowerCase() === PRIMARY_SUPER_ADMIN_EMAIL,
    };
  });
}

/**
 * One member's saved access for the Manage Access modal. Super-Admin-only, and the
 * database re-checks on save — this read only decides what the modal shows.
 */
export async function getTeamMemberAccess(
  staffProfileId: string,
): Promise<TeamMemberAccess | null> {
  await requireOwner();
  if (!staffProfileId) return null;

  const supabase = await createClient();
  const [{ data: profile }, { data: grants }] = await Promise.all([
    supabase
      .from('staff_profiles')
      .select('id, auth_user_id, full_name, role_key, is_active')
      .eq('id', staffProfileId)
      .maybeSingle(),
    supabase
      .from('staff_permission_grants')
      .select('permission_key')
      .eq('staff_profile_id', staffProfileId),
  ]);

  const p = profile as Record<string, unknown> | null;
  if (!p) return null;

  let email: string | null = null;
  const admin = adminOrNull();
  if (admin) {
    const { data } = await admin.auth.admin.getUserById(p.auth_user_id as string);
    email = data?.user?.email ?? null;
  }

  return {
    staffProfileId: p.id as string,
    fullName: (p.full_name as string | null) ?? 'Team member',
    email,
    roleKey: (p.role_key as string | null) ?? 'staff',
    isActive: p.is_active === true,
    isPrimarySuperAdmin: (email ?? '').trim().toLowerCase() === PRIMARY_SUPER_ADMIN_EMAIL,
    permissionKeys: ((grants ?? []) as Array<{ permission_key: string }>).map(
      (g) => g.permission_key,
    ),
  };
}

/**
 * Change a member's role. The DATABASE is the authority: only the Primary Super
 * Admin may create or remove a Super Admin, the cap of 2 is re-checked inside the
 * transaction, the Primary can never be demoted, and nobody changes their own role.
 * Its refusals are surfaced verbatim.
 */
export async function setTeamMemberRole(
  staffProfileId: string,
  roleKey: string,
): Promise<AccessMutationResult> {
  if (!staffProfileId) return { ok: false, error: 'A team member is required.' };

  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const before = await getTeamMemberAccess(staffProfileId);

  const supabase = await createClient();
  const res = (await supabase.rpc('set_team_member_role', {
    p_staff_profile_id: staffProfileId,
    p_role: roleKey,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'team_member.role_change',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  if (res.data?.changed === true) {
    await recordAuditEvent({
      action: 'team_member.role_change',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      context: {
        member: before?.fullName ?? null,
        previousRole: before?.roleKey ?? null,
        newRole: roleKey,
      },
    });
  }
  return { ok: true };
}

/**
 * Replace a member's permission grants. Super-Admin-only; the database refuses a
 * Super Admin target (they hold everything implicitly) and self-edits, and replaces
 * the whole set in one transaction. The audit records the old AND new sets.
 */
export async function setTeamMemberPermissions(
  staffProfileId: string,
  permissionKeys: string[],
): Promise<AccessMutationResult> {
  if (!staffProfileId) return { ok: false, error: 'A team member is required.' };

  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  // Only keys the access catalogue actually offers — never arbitrary input.
  const keys = [...new Set(permissionKeys)].filter((k) => ALL_ACCESS_KEYS.includes(k));
  const before = await getTeamMemberAccess(staffProfileId);

  const supabase = await createClient();
  const res = (await supabase.rpc('set_team_member_permissions', {
    p_staff_profile_id: staffProfileId,
    p_keys: keys,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'team_member.permissions_change',
      entityType: 'staff_profile',
      entityId: staffProfileId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'team_member.permissions_change',
    entityType: 'staff_profile',
    entityId: staffProfileId,
    context: {
      member: before?.fullName ?? null,
      role: before?.roleKey ?? null,
      previousPermissions: before?.permissionKeys ?? [],
      newPermissions: keys,
    },
  });
  return { ok: true };
}

/** Create a team member with an auto-generated temp password. Owner-only. */
export async function createTeamMember(input: {
  fullName: string;
  email: string;
}): Promise<TeamActionResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const fullName = (input.fullName ?? '').trim();
  const email = (input.email ?? '').trim().toLowerCase();
  if (fullName.length === 0) return { ok: false, error: 'Enter a name.' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' };

  const admin = adminOrNull();
  if (!admin) return { ok: false, error: NOT_CONFIGURED };
  const tempPassword = generateTempPassword();

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
  });

  if (createErr || !created?.user) {
    return {
      ok: false,
      error: createErr?.message?.match(/already/i)
        ? 'That email already has an account.'
        : 'The account could not be created.',
    };
  }

  // Insert the profile through the OWNER's user client so RLS still checks it.
  const supabase = await createClient();
  const { error: profileErr } = await supabase.from('staff_profiles').insert({
    auth_user_id: created.user.id,
    full_name: fullName,
    role_key: 'staff',
    is_active: true,
    password_is_temp: true,
  });

  if (profileErr) {
    // Roll back the orphaned auth user so a retry is clean.
    await admin.auth.admin.deleteUser(created.user.id);
    return { ok: false, error: 'The team member profile could not be created.' };
  }

  await recordAuditEvent({
    action: 'team.create_member',
    entityType: 'staff_profile',
    entityId: created.user.id,
    context: { email, role: 'staff', password_is_temp: true },
  });

  return { ok: true, tempPassword, email };
}

/**
 * Set a member's password to an Owner-CHOSEN value (not auto-generated). Owner-only.
 *
 *   - Setting SOMEONE ELSE's password marks it temporary ("Temp (Not Changed)") so
 *     they are expected to change it themselves at sign-in.
 *   - Setting your OWN password (the Owner's row) clears the temp flag — you chose
 *     it, so it is not a temporary password to be handed over.
 *
 * The password is chosen by the Owner and never returned/revealed here: they
 * already know it, so there is nothing to show once.
 */
export async function setTeamMemberPassword(
  staffProfileId: string,
  newPassword: string,
): Promise<{ ok: true; email: string; self: boolean } | { ok: false; error: string }> {
  let owner: Awaited<ReturnType<typeof requireOwner>>;
  try {
    owner = await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const password = (newPassword ?? '').trim();
  if (password.length < 8) return { ok: false, error: 'Use at least 8 characters.' };

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from('staff_profiles')
    .select('auth_user_id')
    .eq('id', staffProfileId)
    .maybeSingle();

  const authUserId = profile?.auth_user_id as string | undefined;
  if (!authUserId) return { ok: false, error: 'That team member could not be found.' };

  const admin = adminOrNull();
  if (!admin) return { ok: false, error: NOT_CONFIGURED };

  const { data: updated, error } = await admin.auth.admin.updateUserById(authUserId, {
    password,
  });
  if (error || !updated?.user) {
    return { ok: false, error: 'The password could not be set.' };
  }

  const self = authUserId === owner.authUserId;

  // Owner client updates the flag (RLS: Owner may update staff_profiles).
  await supabase
    .from('staff_profiles')
    .update({ password_is_temp: !self })
    .eq('id', staffProfileId);

  await recordAuditEvent({
    action: self ? 'team.change_own_password' : 'team.set_password',
    entityType: 'staff_profile',
    entityId: staffProfileId,
    context: { password_is_temp: !self, owner_set: true },
  });

  return { ok: true, email: updated.user.email ?? '', self };
}

/**
 * Delete a team member — the account itself and the member's OWN account-scoped
 * rows (their permission grants, scope assignments, trusted devices, and
 * notifications). Owner-only. NEVER deletes business records: it runs through the
 * `delete_team_member` SECURITY DEFINER RPC in ONE transaction, so if the member
 * authored anything (orders, granted permissions to others, etc.) a RESTRICT
 * foreign key aborts the whole delete and nothing is left half-removed.
 *
 * Guards (enforced both here and inside the RPC): must be the Owner, and you can
 * never delete your own account.
 */
export async function deleteTeamMember(
  staffProfileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let owner: Awaited<ReturnType<typeof requireOwner>>;
  try {
    owner = await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('delete_team_member', {
    p_staff_profile_id: staffProfileId,
  });

  if (error) {
    const msg = error.message ?? '';
    if (/own account/i.test(msg)) {
      return { ok: false, error: 'You cannot delete your own account.' };
    }
    if (/not authorized/i.test(msg)) return { ok: false, error: 'Not authorized.' };
    if (/not found/i.test(msg)) {
      return { ok: false, error: 'That team member could not be found.' };
    }
    if (/foreign key|violates|restrict/i.test(msg)) {
      return {
        ok: false,
        error:
          'This member has activity in the system and cannot be deleted. Disable the account instead.',
      };
    }
    return { ok: false, error: 'The team member could not be deleted.' };
  }

  await recordAuditEvent({
    action: 'team.delete_member',
    entityType: 'staff_profile',
    entityId: staffProfileId,
    context: { deleted_by: owner.authUserId },
  });

  return { ok: true };
}

/**
 * A member changes their OWN password. Uses their own session (no service-role),
 * then clears the temp-password flag via the self-scoped security-definer RPC.
 */
export async function changeMyPassword(
  newPassword: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActiveStaff(); // must be a signed-in, active staff member
  const password = (newPassword ?? '').trim();
  if (password.length < 8) {
    return { ok: false, error: 'Use at least 8 characters.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { ok: false, error: 'The password could not be changed.' };
  }

  // Clear the temp flag on the member's OWN row (self-scoped, RLS-safe).
  await supabase.rpc('clear_my_temp_password_flag');

  await recordAuditEvent({
    action: 'team.change_own_password',
    entityType: 'staff_profile',
    context: { self_service: true },
  });

  return { ok: true };
}
