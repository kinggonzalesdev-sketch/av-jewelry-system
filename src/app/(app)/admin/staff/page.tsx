import type { Metadata } from 'next';

import { StaffConsole } from '@/components/admin/staff-console';
import { NotAuthorized } from '@/components/states/not-authorized';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  listAccountAuditTrail,
  listScopes,
  listStaffAccounts,
} from '@/lib/authz/account-management';
import { requireActiveStaff } from '@/lib/authz/guard';

export const metadata: Metadata = {
};

export const dynamic = 'force-dynamic';

/**
 * Owner-only staff management (Bible §5.3, §5.4).
 *
 * This screen exists to EXERCISE the authorization boundary, not to be a finished
 * administration console. It shows real accounts from the database — never
 * fabricated ones — and shows nothing at all to a non-Owner.
 *
 * Note the shape of the check: the page asks for the caller's role and renders
 * `NotAuthorized` for a non-Owner. That is a UX affordance. The actual protection
 * is that `listStaffAccounts()` calls `requireOwner()` server-side AND RLS
 * restricts `staff_profiles` reads to the Owner — so even if this branch were
 * deleted, a Staff member would still see nothing (Bible §30.3 r2: UI visibility
 * is not authorization).
 */
export default async function StaffManagementPage() {
  const staff = await requireActiveStaff();

  if (staff.roleKey !== 'owner') {
    return (
      <NotAuthorized
        title="Owner only"
        description="Staff management is reserved to the Owner."
      />
    );
  }

  const [accounts, scopes] = await Promise.all([listStaffAccounts(), listScopes()]);

  const activeSelectedAdmins = accounts.filter(
    (a) => a.roleKey === 'selected_admin' && a.isActive,
  ).length;

  // Audit trails are loaded server-side per account: the trail is Owner-only and
  // must not become a client-callable endpoint just to power a disclosure toggle.
  const trails = await Promise.all(
    accounts.map((a) =>
      listAccountAuditTrail(a.id).then((events) => [a.id, events] as const),
    ),
  );
  const auditTrails = Object.fromEntries(trails);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Staff management</h1>
        <p className="text-sm text-muted-foreground">
          Owner-only. Accounts, roles, and permission grants.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Selected Admins: {activeSelectedAdmins}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Admin is the standard team role (Owner decision) — the former max-2 cap
            was retired, so any number of members may be Admin. The Super Admin cap
            of 2 is separate and still enforced.
          </p>
          <p>
            Selected Admin status does not grant permissions. Every permission is granted
            individually, to a specific account.
          </p>
        </CardContent>
      </Card>

      {accounts.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground" data-testid="empty-state">
              No staff accounts exist yet. Accounts are created through an authorized
              internal process — there is no public registration.
            </p>
          </CardContent>
        </Card>
      ) : (
        <StaffConsole accounts={accounts} scopes={scopes} auditTrails={auditTrails} />
      )}

      <Card>
        <CardHeader>
          <div>
            <span
              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              data-testid="placeholder-badge"
            >
              Placeholder — not implemented
            </span>
          </div>
          <CardTitle className="pt-1 text-base">Account creation</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <p>
            Creating or inviting an account requires the Supabase Admin API and the
            service-role key, which bypasses Row Level Security entirely and is
            intentionally not wired (ADR §11). It is the one path that can mint
            credentials, so it stays an explicit decision rather than a side-effect of a
            UI pass. Create accounts directly in your Supabase project.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
