'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

/**
 * Production application shell — the approved MineFlow prototype look, wired to
 * the real app.
 *
 * What is REAL here and was hardcoded in the prototype:
 *   - the user card shows the caller's real name + real role (props), never
 *     "A.V. Owner / Owner";
 *   - Logout runs the real signOut server action;
 *   - every nav link points at a route that EXISTS. The prototype linked to
 *     Customers / Reports / Settings, which have no production route yet; those
 *     are omitted until built (secondary-page scope), never rendered as dead
 *     links.
 *
 * Navigation reconciles the two approved sources:
 *   - Desktop sidebar shows the fuller list (prototype direction).
 *   - Mobile bottom nav keeps EXACTLY the five Bible §8.2 items
 *     (Dashboard · Live · Claims · Orders · More); the rest live under More.
 *
 * Hiding a nav item is a convenience, never authorization — every page and
 * action re-checks server-side and RLS decides the data (Bible §30.3 r2).
 */

export type ShellNavItem = {
  href: string;
  label: string;
  icon: string;
  /** Mobile bottom-nav slot: the five Bible §8.2 items are marked primary. */
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
        'text-slate-600 hover:bg-rose-50 hover:text-rose-700',
        'dark:text-slate-300 dark:hover:bg-rose-950 dark:hover:text-rose-300',
        variant === 'more' && 'text-rose-700 dark:text-rose-300',
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
    <div className="mx-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          {initials(fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
            data-testid="authenticated-full-name"
          >
            {fullName}
          </p>
          <p
            className="truncate text-[11px] text-slate-500 dark:text-slate-400"
            data-testid="authenticated-role"
          >
            {roleLabel}
          </p>
        </div>
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
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
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex flex-1">
        {/* ---------------- Desktop sidebar ---------------- */}
        <aside
          className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 lg:sticky lg:top-0 lg:flex lg:h-dvh"
          data-testid="app-sidebar"
        >
          <div className="border-b border-slate-100 pb-3 dark:border-slate-800">
            <div className="flex items-center gap-2 px-3 py-3.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                M
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  MineFlow
                </p>
                <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                  A.V. Jewelry
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
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800',
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

          <div className="space-y-1.5 border-t border-slate-100 p-2 dark:border-slate-800">
            {/* Approved footer branding — exact wording (Bible §2, §36.2). */}
            <p
              className="px-2.5 py-1 text-center text-[10px] leading-tight text-slate-400 dark:text-slate-500"
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
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-xs font-bold text-white">
                M
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900 dark:text-slate-100">
                  MineFlow
                </p>
                <p className="truncate text-[10px] text-slate-500 dark:text-slate-400">
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
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] dark:border-slate-700 dark:bg-slate-900 lg:hidden"
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
                  isActive(item.href)
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-slate-500 dark:text-slate-400',
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
                moreOpen
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-slate-500 dark:text-slate-400',
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
          <div className="absolute inset-x-0 bottom-full border-t border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
            <ul className="grid grid-cols-2 gap-1">
              {mobileMore.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-1 border-t border-slate-100 pt-1 dark:border-slate-800">
              <LogoutButton variant="more" />
              <p className="px-2.5 pb-1 pt-2 text-center text-[10px] text-slate-400 dark:text-slate-500">
                Powered by King GenZ Digital
              </p>
            </div>
          </div>
        ) : null}
      </nav>
    </div>
  );
}
