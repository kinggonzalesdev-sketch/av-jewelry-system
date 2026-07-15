'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { PRIMARY_NAV_ITEMS } from '@/components/shell/navigation';
import { cn } from '@/lib/utils';

/**
 * Mobile-first bottom navigation (Bible §8.2, §8.20).
 *
 * Five primary destinations. Fixed to the bottom on mobile; the shell promotes it
 * to a sidebar-style rail at larger breakpoints.
 */
export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
      data-testid="bottom-nav"
    >
      <ul className="grid grid-cols-5">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  // min-h-14 keeps the touch target comfortably above 44px.
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-1 w-6 rounded-full transition-colors',
                    isActive ? 'bg-primary' : 'bg-transparent',
                  )}
                />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Desktop/tablet rail rendering the same five destinations.
 */
export function SideNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="hidden w-56 shrink-0 border-r border-border p-3 md:block"
      data-testid="side-nav"
    >
      <ul className="space-y-1">
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
