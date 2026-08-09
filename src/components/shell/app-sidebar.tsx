'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useTransition, type ReactNode } from 'react';

import {
  canSeeNavItem,
  mobileLabel,
  mobileMoreItems,
  mobilePrimaryItems,
  navRows,
  SETTINGS_ITEM,
  type NavItem,
} from '@/components/shell/navigation';
import { PrinterStatusBadge, PrinterStatusRow } from '@/components/shell/printer-status';
import { PrivacyToggle } from '@/components/shell/privacy';
import { ThemeToggle } from '@/components/shell/theme-toggle';
import { signOut } from '@/lib/auth/actions';
import { cn } from '@/lib/utils';

/**
 * Production application shell — the approved prototype layout in the A.V.
 * Jewelry brand. What is REAL here (and was hardcoded in the prototype):
 *   - the user card shows the caller's real name + real role (props);
 *   - Logout runs the real signOut server action;
 *   - the theme toggle and Bluetooth/printer status are honest and functional;
 *   - every nav item is a real route — items without a finished screen open an
 *     honest "not available yet" page (never a dead link or fake content).
 *
 * Approved footer order (desktop), which must not change:
 *   branding → Light/Dark toggle → Bluetooth/Printer → Logout (last).
 * Bluetooth/Printer sits DIRECTLY above Logout; Logout is last.
 */

// The user chip shows a role-based control identity, not the person's name
// (Owner request 2026-07-22): Owner → "Owner", Selected Admin → "Admin",
// Staff → "Team". The chip reads "{word} Control" over "{word}". The real name
// is kept as a hover title + screen-reader text so accountability is not lost.
const ROLE_WORD: Record<string, string> = {
  owner: 'Owner',
  selected_admin: 'Admin',
  staff: 'Team',
};

/**
 * Brand mark — the A.V. Jewelry logo. Falls back to the "AV" monogram tile if the
 * logo image is missing, so the shell never shows a broken image. Drop the logo at
 * `public/av-jewelry-logo.png` and it appears automatically.
 */
function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const [imgOk, setImgOk] = useState(true);
  const box = size === 'md' ? 'h-8 w-8' : 'h-7 w-7';

  if (imgOk) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src="/av-jewelry-logo.png"
        alt="A.V. Jewelry"
        onError={() => setImgOk(false)}
        className={cn('shrink-0 rounded-lg object-contain', box)}
      />
    );
  }

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

function UserCard({ fullName, roleWord }: { fullName: string; roleWord: string }) {
  return (
    <div
      className="mx-3 rounded-xl border border-border bg-secondary p-3"
      title={fullName}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-xs font-semibold text-black">
          AV
        </div>
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-sm font-semibold text-foreground"
            data-testid="authenticated-full-name"
          >
            {roleWord} Control
          </p>
          <p
            className="truncate text-[11px] text-muted-foreground"
            data-testid="authenticated-role"
          >
            {roleWord}
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

/** A tiny, honest marker that an approved item has no finished screen yet. */
function SoonTag() {
  return (
    <span className="ml-auto shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
      Soon
    </span>
  );
}

export function AppSidebar({
  fullName,
  roleKey,
  userEmail,
  allowedPages,
  pendingApprovals = 0,
  children,
}: {
  fullName: string;
  roleKey?: string | undefined;
  userEmail: string;
  /** The member's granted page keys (undefined = do not filter). */
  allowedPages?: readonly string[] | undefined;
  /** Pending Owner-approval count — renders an amber badge on the Approvals item. */
  pendingApprovals?: number | undefined;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  // Manual open/close per collapsible group. Undefined → follow whether a child is
  // active (so navigating into Attendance/Payroll auto-expands Team Management).
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({});
  const roleWord = roleKey ? (ROLE_WORD[roleKey] ?? 'Team') : 'Team';
  // Page permissions the member holds. Undefined -> no filtering (unchanged
  // behaviour); a Set -> links they cannot open are hidden. The PAGE still
  // re-checks, so hiding is convenience, never the control.
  const allowed = allowedPages ? new Set(allowedPages) : undefined;

  const isActive = (href: string) =>
    pathname === href ||
    // A parent tab is active for its sub-routes, but /orders must NOT light up
    // for /orders/invoice etc. — those are their own nav items.
    (href !== '/orders' && pathname.startsWith(`${href}/`));

  const renderSidebarLink = (item: NavItem, indent = false) => (
    <li key={item.href}>
      <Link
        href={item.href}
        aria-current={isActive(item.href) ? 'page' : undefined}
        className={cn(
          'flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors',
          indent ? 'pl-9 pr-2.5' : 'px-2.5',
          isActive(item.href)
            ? 'bg-gold/15 text-gold-strong'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
      >
        <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
          {item.icon}
        </span>
        <span className="truncate">{item.label}</span>
        {item.available ? null : <SoonTag />}
        {/* Live pending-approval badge (amber). Only on the Approvals item, only
            when > 0; DashboardSync realtime keeps the count fresh. */}
        {item.href === '/approvals' && pendingApprovals > 0 ? (
          <span
            className="ml-auto rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400"
            data-testid="approvals-badge"
          >
            {pendingApprovals}
          </span>
        ) : null}
      </Link>
    </li>
  );

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
                <p
                  className="truncate text-[10px] text-muted-foreground"
                  data-testid="brand-tagline"
                >
                  Powered by King GenZ Digital
                </p>
              </div>
            </div>
            <UserCard fullName={fullName} roleWord={roleWord} />
          </div>

          <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {navRows().map((row) => {
                if (row.kind === 'item') {
                  return canSeeNavItem(row.item, roleKey, allowed)
                    ? renderSidebarLink(row.item)
                    : null;
                }

                // A collapsible group (e.g. Team Management). Role-filter first; a
                // group with nothing visible renders nothing.
                const items = row.items.filter((it) => canSeeNavItem(it, roleKey, allowed));
                if (items.length === 0) return null;
                const childActive = items.some((it) => isActive(it.href));
                const open = openSection[row.section] ?? childActive;
                const panelId = `nav-sect-${row.section
                  .replace(/\s+/g, '-')
                  .toLowerCase()}`;
                return (
                  <li key={row.section}>
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSection((s) => ({ ...s, [row.section]: !open }))
                      }
                      aria-expanded={open}
                      aria-controls={panelId}
                      className={cn(
                        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        childActive
                          ? 'text-foreground'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 text-center text-xs"
                      >
                        ☰
                      </span>
                      <span className="truncate">{row.section}</span>
                      <span
                        aria-hidden="true"
                        className="ml-auto text-[10px] text-muted-foreground"
                      >
                        {open ? '▾' : '▸'}
                      </span>
                    </button>
                    {open ? (
                      <ul id={panelId} className="mt-0.5 space-y-0.5">
                        {items.map((it) => renderSidebarLink(it, true))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/*
            Fixed footer (stays put while the nav above scrolls): Light/Dark →
            Bluetooth/Printer → a subtle divider → Settings → Logout (last).
          */}
          <div className="space-y-1.5 border-t border-border p-2">
            <ThemeToggle />
            <PrivacyToggle />
            <PrinterStatusRow />
            <div className="my-1 border-t border-border" aria-hidden="true" />
            <Link
              href={SETTINGS_ITEM.href}
              aria-current={isActive(SETTINGS_ITEM.href) ? 'page' : undefined}
              data-testid="sidebar-settings"
              className={cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                isActive(SETTINGS_ITEM.href)
                  ? 'bg-gold/15 text-gold-strong'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
                {SETTINGS_ITEM.icon}
              </span>
              <span className="truncate">{SETTINGS_ITEM.label}</span>
            </Link>
            <LogoutButton />
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Compact mobile header: real identity + honest printer + theme. */}
          <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <BrandMark size="sm" />
              <div className="min-w-0" title={fullName}>
                <p className="truncate text-xs font-bold text-foreground">A.V. Jewelry</p>
                <p className="truncate text-[10px] text-muted-foreground">
                  {roleWord} Control
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <PrinterStatusBadge />
              <PrivacyToggle variant="compact" />
              <ThemeToggle variant="compact" />
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

      {/* ---------------- Mobile bottom nav: four primary + More ---------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        data-testid="bottom-nav"
      >
        <ul className="grid grid-cols-5">
          {mobilePrimaryItems()
            .filter((item) => canSeeNavItem(item, roleKey, allowed))
            .map((item) => (
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
                <span className="truncate">{mobileLabel(item)}</span>
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
              {/* Role-filtered so a non-Owner is not offered an Owner-only page.
                  Settings is appended (it lives in the desktop footer, not the nav). */}
              {[
                ...mobileMoreItems().filter((item) => canSeeNavItem(item, roleKey, allowed)),
                ...(canSeeNavItem(SETTINGS_ITEM, roleKey, allowed) ? [SETTINGS_ITEM] : []),
              ].map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-xs font-medium text-foreground hover:bg-accent"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    <span className="truncate">{item.label}</span>
                    {item.available ? null : <SoonTag />}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-1 space-y-1 border-t border-border pt-1">
              <ThemeToggle />
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
