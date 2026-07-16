'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

/**
 * Production application shell — the approved prototype LAYOUT, dressed in the
 * A.V. Jewelry BRAND: warm beige / black / gold. Colours come from the design
 * tokens (globals.css), so light and dark are handled in one place and no
 * emerald/slate remains.
 *
 * What is REAL here and was hardcoded in the prototype:
 *   - the user card shows the caller's real name + real role (props), never
 *     "A.V. Owner / Owner";
 *   - Logout runs the real signOut server action;
 *   - every nav link points at a route that EXISTS — no dead Customers/
 *     Reports/Settings links.
 *
 * Navigation reconciles both approved sources: a fuller DESKTOP sidebar, and a
 * MOBILE bottom nav of exactly the five Bible §8.2 items (those four lead the
 * array so the mobile slice stays compliant). Hiding a nav item is convenience,
 * never authorization (Bible §30.3 r2).
 */

export type ShellNavItem = {
  href: string;
  label: string;
  icon: string;
  mobilePrimary?: boolean;
};

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  selected_admin: 'Selected Admin',
  staff: 'Staff',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AV';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || 'AV';
}

/** Gold monogram mark — the brand accent, black glyph on gold. */
function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-lg bg-gold font-bold text-black',
        size === 'md' ? 'h-8 w-8 text-sm' : 'h-7 w-7 text-xs',
      )}
    >
      AV
    </div>
  );
}

function LogoutButton({ variant = 'sidebar' }: { variant?: 'sidebar' | 'more' }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await signOut()))}
      data-testid="logout"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
        variant === 'more' && 'text-destructive',
      )}
    >
      <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
        ⏻
      </span>
      <span>{pending ? 'Signing out…' : 'Logout'}</span>
    </button>
  );
}

function UserCard({ fullName, roleLabel }: { fullName: string; roleLabel: string }) {
  return (
    <div className="mx-3 rounded-xl border border-border bg-secondary p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-semibold text-black">
          {initials(fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-foreground"
            data-testid="authenticated-full-name"
          >
            {fullName}
          </p>
          <p
            className="truncate text-[11px] text-muted-foreground"
            data-testid="authenticated-role"
          >
            {roleLabel}
          </p>
        </div>
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-gold"
          title="Account active"
          aria-label="Account active"
        />
      </div>
    </div>
  );
}

export function AppSidebar({
  fullName,
  roleKey,
  userEmail,
  nav,
  children,
}: {
  fullName: string;
  roleKey?: string | undefined;
  userEmail: string;
  nav: ShellNavItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const roleLabel = roleKey ? (ROLE_LABEL[roleKey] ?? roleKey) : 'Staff';

  const isActive = (href: string) =>
    pathname === href ||
    // A parent tab is active for its sub-routes, but /orders must NOT light up
    // for /orders/invoice etc. — those are their own nav items.
    (href !== '/orders' && pathname.startsWith(`${href}/`));

  const mobilePrimary = nav.filter((i) => i.mobilePrimary);
  const mobileMore = nav.filter((i) => !i.mobilePrimary);

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <div className="flex flex-1">
        {/* ---------------- Desktop sidebar ---------------- */}
        <aside
          className="hidden w-64 shrink-0 flex-col border-r border-border bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh"
          data-testid="app-sidebar"
        >
          <div className="border-b border-border pb-3">
            <div className="flex items-center gap-2 px-3 py-3.5">
              <BrandMark />
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-foreground">
                  A.V. Jewelry
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  MineFlow Operations
                </p>
              </div>
            </div>
            <UserCard fullName={fullName} roleLabel={roleLabel} />
          </div>

          <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      isActive(item.href)
                        ? 'bg-gold/15 text-gold-strong'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
                      {item.icon}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <div className="space-y-1.5 border-t border-border p-2">
            {/* Approved footer branding — exact wording (Bible §2, §36.2). */}
            <p
              className="px-2.5 py-1 text-center text-[10px] leading-tight text-muted-foreground"
              data-testid="footer-branding"
            >
              Powered by King GenZ Digital
            </p>
            <LogoutButton />
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Compact mobile header with real identity */}
          <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark size="sm" />
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-foreground">A.V. Jewelry</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {fullName} · {roleLabel}
                </p>
              </div>
            </div>
          </header>

          <main id="main-content" className="min-w-0 flex-1 p-3 pb-24 sm:p-5 lg:pb-8">
            {children}
          </main>
        </div>
      </div>

      {/* Email kept discoverable for support without cluttering the chrome. */}
      <span className="sr-only" data-testid="authenticated-user-email">
        {userEmail}
      </span>

      {/* ---------------- Mobile bottom nav (Bible §8.2: five items) ---------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        data-testid="bottom-nav"
      >
        <ul className="grid grid-cols-5">
          {mobilePrimary.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium',
                  isActive(item.href) ? 'text-gold-strong' : 'text-muted-foreground',
                )}
              >
                <span aria-hidden="true" className="text-sm">
                  {item.icon}
                </span>
                <span className="truncate">{item.label}</span>
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen((o) => !o)}
              aria-expanded={moreOpen}
              className={cn(
                'flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium',
                moreOpen ? 'text-gold-strong' : 'text-muted-foreground',
              )}
            >
              <span aria-hidden="true" className="text-sm">
                ⋯
              </span>
              More
            </button>
          </li>
        </ul>

        {moreOpen ? (
          <div className="absolute inset-x-0 bottom-full border-t border-border bg-card p-2 shadow-lg">
            <ul className="grid grid-cols-2 gap-1">
              {mobileMore.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-1 border-t border-border pt-1">
              <LogoutButton variant="more" />
              <p className="px-2.5 pb-1 pt-2 text-center text-[10px] text-muted-foreground">
                Powered by King GenZ Digital
              </p>
            </div>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
