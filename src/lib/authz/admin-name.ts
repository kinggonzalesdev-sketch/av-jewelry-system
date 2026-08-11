import 'server-only';

import { cache } from 'react';

import { createClient } from '@/lib/supabase/server';
import { getCurrentStaffProfile, requireActiveStaff } from '@/lib/authz/guard';

/**
 * "Admin Name" — the team member an entry is recorded against (New Order, Walk-In,
 * Layaway New Entry). Formerly labelled "Salesperson".
 *
 * The rule the Owner set: the form always shows the CURRENTLY LOGGED-IN account,
 * and a normal user cannot record work under someone else's name. Only a Super
 * Admin may change it — for them the field becomes a picker of active registered
 * accounts.
 *
 * The identity that travels with the entry is the PERMANENT staff profile id, not
 * the display name, so renaming a team member never re-attributes their history.
 *
 * The list is deliberately withheld from non-Super-Admins: not merely disabled in
 * the UI, but never sent. A form that cannot see other accounts cannot post one,
 * and the server action re-checks anyway (see resolveAdminName).
 */
export type AdminNameOption = { id: string; fullName: string };

export type AdminNameContext = {
  /** The signed-in member's permanent staff profile id — always the default. */
  selfId: string;
  selfName: string;
  /** Super Admin only. Drives whether the field renders as a picker or read-only. */
  canChange: boolean;
  /** Active registered accounts; exactly [self] when canChange is false. */
  options: AdminNameOption[];
};

export const getAdminNameContext = cache(async (): Promise<AdminNameContext> => {
  const staff = await requireActiveStaff();
  const profile = await getCurrentStaffProfile();

  const self: AdminNameOption = { id: staff.staffProfileId, fullName: profile.fullName };
  // Super Admin = the owner role (the system's three tiers are owner /
  // selected_admin / staff).
  const canChange = staff.roleKey === 'owner';

  if (!canChange) {
    return {
      selfId: self.id,
      selfName: self.fullName,
      canChange: false,
      options: [self],
    };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from('staff_profiles')
    .select('id, full_name')
    .eq('is_active', true)
    .eq('is_demo', false)
    .order('full_name');

  const options = ((data as Array<Record<string, unknown>> | null) ?? []).map((r) => ({
    id: r.id as string,
    fullName: (r.full_name as string | null) ?? 'Team member',
  }));

  // Self is always selectable even if the roster read returns nothing.
  if (!options.some((o) => o.id === self.id)) options.unshift(self);

  return { selfId: self.id, selfName: self.fullName, canChange: true, options };
});

/**
 * Server-side resolution of a submitted Admin Name. This is the enforcement point:
 * a non-Super-Admin is pinned to their own profile id no matter what the request
 * body claims, and a Super Admin's choice must be a real active account.
 *
 * Returns the staff profile id to record against.
 */
export async function resolveAdminName(requestedId: string | null): Promise<string> {
  const ctx = await getAdminNameContext();
  if (!ctx.canChange) return ctx.selfId;
  if (!requestedId) return ctx.selfId;
  return ctx.options.some((o) => o.id === requestedId) ? requestedId : ctx.selfId;
}
