import type { ReactNode } from 'react';

import { PrinterProvider } from '@/components/print/printer-context';
import { AppSidebar } from '@/components/shell/app-sidebar';
import { IdleLogout } from '@/components/shell/idle-logout';
import { PrivacyProvider } from '@/components/shell/privacy';

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
  children,
}: {
  userEmail: string;
  fullName: string;
  roleKey?: string | undefined;
  children: ReactNode;
}) {
  return (
    <PrinterProvider>
      <PrivacyProvider>
        {/* Auto sign-out after 30 min idle; session-only cookies handle browser close. */}
        <IdleLogout minutes={30} />
        <AppSidebar fullName={fullName} roleKey={roleKey} userEmail={userEmail}>
          {children}
        </AppSidebar>
      </PrivacyProvider>
    </PrinterProvider>
  );
}
