/**
 * Primary navigation model (Bible §8.2).
 *
 * Exactly five bottom-navigation items: Dashboard, Live, Claims, Orders, More.
 * Global Search is a header entry, NOT a sixth bottom-nav item.
 *
 * In the real system, navigation items render based on role and permissions
 * (Bible §8.2). That filtering arrives with roles/permissions in Roadmap Phase 2.
 * When it does, remember: hiding a nav item is a convenience, not a security
 * control (Bible §30.3 r2).
 */
export type NavItem = {
  readonly href: string;
  readonly label: string;
};

export const PRIMARY_NAV_ITEMS: readonly NavItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/live', label: 'Live' },
  { href: '/claims', label: 'Claims' },
  { href: '/orders', label: 'Orders' },
  { href: '/more', label: 'More' },
] as const;
