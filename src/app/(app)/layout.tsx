import type { ReactNode } from 'react';

import { AppShell } from '@/components/shell/app-shell';
import {
  getCurrentStaffProfile,
  getGrantedPermissions,
  requireActiveStaff,
  requireUser,
} from '@/lib/authz/guard';

/**
 * Protected application route boundary.
 *
 * Every route in this group requires a valid session. `requireUser()` verifies the
 * session SERVER-SIDE on each request and redirects to sign-in when absent.
 *
 * This check is intentionally redundant with middleware: middleware improves UX and
 * refreshes cookies, but authorization is enforced at the trusted server boundary,
 * never at the edge alone (ADR §7, Invariant #3). Layouts are not a substitute for
 * per-action checks either — server actions and RLS remain responsible for
 * authorizing individual writes at execution time (Bible §29.3).
 */
/**
 * Every route in this group is session-dependent and must be rendered per request.
 *
 * This is a security requirement, not a build convenience: a statically prerendered
 * or cached authenticated page could serve one user's shell to another, and would
 * evaluate the auth check at build time rather than at request time. Authorization
 * must be revalidated on each request (Bible §29.8).
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  // Authentication AND active-account status are both re-checked here on every
  // request. A deactivated account is redirected to /account-disabled: its
  // credentials are valid, but the account is not (Bible §30.6).
  await requireActiveStaff();
  const [profile, user, permissions] = await Promise.all([
    getCurrentStaffProfile(),
    requireUser(),
    getGrantedPermissions(),
  ]);

  return (
    <AppShell
      userEmail={user.email ?? 'Unknown user'}
      fullName={profile.fullName}
      roleKey={profile.roleKey}
      // The sidebar hides links this member cannot open. Each PAGE re-checks the
      // same key, so hiding is convenience — never the authorization control.
      allowedPages={[...permissions]}
    >
      {children}
    </AppShell>
  );
}
