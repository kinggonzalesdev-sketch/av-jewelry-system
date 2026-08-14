import type { ReactNode } from 'react';

import { PrinterProvider } from '@/components/print/printer-context';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { DashboardSyncProvider } from '@/components/shell/dashboard-sync';
import { IdleLogout } from '@/components/shell/idle-logout';
import { PrivacyProvider } from '@/components/shell/privacy';
import { StickerSettingsSync } from '@/components/print/sticker-settings-sync';
import { IncomingCapturesStrip } from '@/components/capture/incoming-captures-strip';

/**
 * Production application shell — the Owner-approved prototype LAYOUT dressed in
 * the A.V. Jewelry BRAND (warm beige / black / gold via design tokens).
 *
 * The navigation order and mobile split are the recovered prototype's, verbatim
 * (see {@link file://./navigation.ts}). This component only wires the real
 * authenticated identity into the shell; the sidebar owns the nav and controls.
 */
export function AppShell({
  userEmail,
  fullName,
  roleKey,
  allowedPages,
  pendingApprovals = 0,
  children,
}: {
  userEmail: string;
  fullName: string;
  roleKey?: string | undefined;
  /** Page permissions the member holds — the sidebar hides the rest. */
  allowedPages?: readonly string[] | undefined;
  /** Pending Owner-approval count for the sidebar badge (0 hides it). */
  pendingApprovals?: number | undefined;
  children: ReactNode;
}) {
  return (
    <PrinterProvider>
      <PrivacyProvider>
        {/* Auto sign-out after 30 min idle; session-only cookies handle browser close. */}
        <IdleLogout minutes={30} />
        {/* Pull the ONE shared Sticker Settings the Owner saved into this device's
            localStorage cache, so every account's prints use the same config. */}
        <StickerSettingsSync />
        {/* Live reflection: Realtime nudges re-render the current page from the
            official server records (no full reload, no duplicate client totals).
            Wraps the app so any page can read the sync status for its indicator. */}
        <DashboardSyncProvider>
          {/* Capture engine — mounted app-wide (not just the Orders page) so incoming
              captures appear + auto-print in real time NO MATTER which page the operator
              is on, and the subscription persists across navigations instead of
              restarting. The panel itself stays a popup (opened from the Orders "Capture
              Pending" pill); only its always-on background processing moved up here. */}
          {allowedPages?.includes('claim_capture') ? <IncomingCapturesStrip /> : null}
          <AppSidebar
            fullName={fullName}
            roleKey={roleKey}
            userEmail={userEmail}
            allowedPages={allowedPages}
            pendingApprovals={pendingApprovals}
          >
            {children}
          </AppSidebar>
        </DashboardSyncProvider>
      </PrivacyProvider>
    </PrinterProvider>
  );
}
