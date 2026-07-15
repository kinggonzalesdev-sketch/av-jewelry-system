import type { ReactNode } from 'react';

import { AppHeader } from '@/components/shell/app-header';
import { BottomNav, SideNav } from '@/components/shell/bottom-nav';

/**
 * Mobile-first internal application shell (Bible §8.2, §8.20).
 *
 * One shared structure for all roles — not a separate product per role.
 * Bottom navigation on mobile, a side rail from `md` up.
 */
export function AppShell({
  userEmail,
  roleKey,
  children,
}: {
  userEmail: string;
  roleKey?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader userEmail={userEmail} roleKey={roleKey} />

      <div className="flex flex-1">
        <SideNav />

        {/* pb-20 clears the fixed bottom nav on mobile. */}
        <main id="main-content" className="flex-1 px-4 pb-20 pt-4 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav />
    </div>
  );
}
