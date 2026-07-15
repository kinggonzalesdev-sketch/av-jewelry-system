import type { Metadata } from 'next';

import { NotAuthorized } from '@/components/states/not-authorized';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { listStaffAccounts } from '@/lib/authz/account-management';
import { requireActiveStaff } from '@/lib/authz/guard';

export const metadata: Metadata = {
  title: 'Staff management — A.V. Jewelry Operations',
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

  const accounts = await listStaffAccounts();
  const activeSelectedAdmins = accounts.filter(
    (a) => a.roleKey === 'selected_admin' && a.isActive,
  ).length;

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
            Selected Admins: {activeSelectedAdmins} of 2
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            A maximum of two Selected Admin accounts may be active at once. The limit is
            enforced by the database, not by this screen.
          </p>
          <p>
            Selected Admin status does not grant permissions. Every permission is granted
            individually, to a specific account.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="empty-state">
              No staff accounts exist yet. Accounts are created through an authorized
              internal process — there is no public registration.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{account.fullName}</p>
                    <p className="text-xs text-muted-foreground">
                      {account.roleKey.replace('_', ' ')}
                      {account.mfaEnrolled ? ' · MFA enrolled' : ' · no MFA'}
                    </p>
                  </div>
                  <span
                    className={
                      account.isActive
                        ? 'shrink-0 rounded border border-border px-2 py-0.5 text-xs'
                        : 'shrink-0 rounded border border-border px-2 py-0.5 text-xs text-muted-foreground'
                    }
                  >
                    {account.isActive ? 'Active' : 'Disabled'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

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
            service-role key, which is intentionally not wired in Phase 2. Create
            development accounts directly in your local Supabase project.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
