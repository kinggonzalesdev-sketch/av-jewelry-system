import type { ReactNode } from 'react';

import { AppSidebar, type ShellNavItem } from '@/components/shell/app-sidebar';

/**
 * Production application shell (Bible §8.2, §8.20) — the approved MineFlow look.
 *
 * Navigation reconciles the two approved sources without breaking either:
 *   - the DESKTOP sidebar lists the fuller set (prototype direction), but only
 *     routes that EXIST — Customers/Reports/Settings are omitted until built;
 *   - the MOBILE bottom nav keeps EXACTLY the five Bible §8.2 items
 *     (Dashboard · Live · Claims · Orders · More). Those four lead the array so
 *     the mobile slice is Bible-compliant while the desktop list continues on.
 *
 * Hiding the Staff link from non-Owners is a convenience only: the page and RLS
 * both re-check Owner authority regardless of what renders here (Bible §30.3 r2).
 */
function buildNav(isOwner: boolean): ShellNavItem[] {
  const items: ShellNavItem[] = [
    // The Bible §8.2 four — must lead, so the mobile bottom nav slices them.
    { href: '/dashboard', label: 'Dashboard', icon: '▥', mobilePrimary: true },
    { href: '/live', label: 'Live', icon: '◉', mobilePrimary: true },
    { href: '/claims', label: 'Claim Review', icon: '☑', mobilePrimary: true },
    { href: '/orders', label: 'Orders', icon: '□', mobilePrimary: true },
    // Desktop-only continuation — all real, functional routes.
    { href: '/orders/invoice', label: 'Invoice', icon: '▤' },
    { href: '/orders/payments', label: 'Payments & Layaway', icon: '₱' },
    { href: '/orders/fulfillment', label: 'Fulfillment', icon: '➤' },
    { href: '/orders/inventory', label: 'Items / Inventory', icon: '◈' },
  ];

  if (isOwner) {
    items.push({ href: '/admin/staff', label: 'Staff', icon: '☺' });
  }
  items.push({ href: '/admin/capabilities', label: 'Capabilities', icon: '⚙' });

  return items;
}

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
    <AppSidebar
      fullName={fullName}
      roleKey={roleKey}
      userEmail={userEmail}
      nav={buildNav(roleKey === 'owner')}
    >
      {children}
    </AppSidebar>
  );
}
