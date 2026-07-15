import type { Metadata } from 'next';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getMfaStatus, MFA_ENFORCEMENT_IMPLEMENTED } from '@/lib/auth/mfa';
import { requireActiveStaff } from '@/lib/authz/guard';

export const metadata: Metadata = {
  title: 'Security — A.V. Jewelry Operations',
};

export const dynamic = 'force-dynamic';

/**
 * MFA readiness screen.
 *
 * Reports the caller's real MFA state from Supabase. It states plainly that MFA
 * is not enforced, because claiming otherwise would be the exact false-assurance
 * the project prohibits.
 */
export default async function SecurityPage() {
  const staff = await requireActiveStaff();
  const mfa = await getMfaStatus();

  const isOwner = staff.roleKey === 'owner';

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
        <p className="text-sm text-muted-foreground">
          Multi-factor authentication for your account.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Authenticator app (TOTP)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">Enrolled factor</span>
            <span className="font-medium" data-testid="mfa-factor-state">
              {mfa.hasVerifiedFactor ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">This session</span>
            <span className="font-medium" data-testid="mfa-aal-state">
              {mfa.currentLevel ?? 'unknown'}
            </span>
          </div>

          {mfa.elevationPending ? (
            <p className="rounded-md border border-border bg-muted p-3 text-xs text-muted-foreground">
              You have an authenticator enrolled, but this session has not been verified
              with a code. It is running at aal1.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {isOwner ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Owner readiness</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">
                Owner MFA is required before the controlled pilot and before production.
              </span>{' '}
              It is not required in development, because an Owner must be able to sign in
              to enrol in the first place.
            </p>
            <p>
              Store your recovery material offline. Staff and Selected Admin accounts
              cannot reset Owner MFA — lost-device recovery follows a controlled
              Owner-account recovery process.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <div>
            <span
              className="inline-flex items-center rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              data-testid="placeholder-badge"
            >
              Not enforced
            </span>
          </div>
          <CardTitle className="pt-1 text-base">MFA enforcement status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Enrollment, verification, and aal1/aal2 detection are implemented and tested.
            <span className="font-medium text-foreground">
              {' '}
              MFA is not currently required for any action.
            </span>{' '}
            No action is gated behind an elevated session yet — deciding which actions
            demand elevation is still an open decision.
          </p>
          <p className="font-mono text-xs">
            MFA_ENFORCEMENT_IMPLEMENTED = {String(MFA_ENFORCEMENT_IMPLEMENTED)}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
