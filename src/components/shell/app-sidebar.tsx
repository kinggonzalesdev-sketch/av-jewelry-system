'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';

import {
  canSeeNavItem,
  mobileBarItems,
  mobileLabel,
  mobileSheetItems,
  mobileShortLabel,
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
  const more = variant === 'more';
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await signOut()))}
      data-testid="logout"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
        'text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
        // The More sheet row: the same 48px row as the modules above it, red like the
        // desktop hover state so it reads as the destructive action it is.
        more && 'min-h-12 gap-3 px-3 text-destructive',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('shrink-0 text-center', more ? 'w-5 text-base' : 'w-4 text-xs')}
      >
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
  const router = useRouter();
  // Manual open/close per collapsible group. Undefined → follow whether a child is
  // active (so navigating into Attendance/Payroll auto-expands Team Management).
  const [openSection, setOpenSection] = useState<Record<string, boolean>>({});
  const roleWord = roleKey ? (ROLE_WORD[roleKey] ?? 'Team') : 'Team';
  // Page permissions the member holds. Undefined -> no filtering (unchanged
  // behaviour); a Set -> links they cannot open are hidden. The PAGE still
  // re-checks, so hiding is convenience, never the control.
  const allowed = allowedPages ? new Set(allowedPages) : undefined;

  // Mobile bottom bar (Owner 2026-09-06): this member's five permitted tabs + More; the More
  // sheet lists every permitted module that did not make the bar, then Settings and Logout.
  // It is the ONE secondary menu on phones — no theme control inside (the header has the
  // single theme button), no second navigation bar.
  const barItems = mobileBarItems(roleKey, allowed);
  const sheetItems = mobileSheetItems(roleKey, allowed, barItems);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreOpenRef = useRef(false);
  useEffect(() => {
    moreOpenRef.current = moreOpen;
  }, [moreOpen]);

  // Device Back closes the sheet instead of leaving the page: opening pushes one history entry
  // (Next.js copies its own router state into it), and popstate closes the sheet. Closing from
  // the UI pops that entry itself; choosing a module pops it first and navigates once the pop
  // has landed, so the module never ends up "behind" a stale sheet entry.
  const pendingHref = useRef<string | null>(null);
  const historyMarked = () =>
    Boolean((window.history.state as { mineflowMore?: boolean } | null)?.mineflowMore);
  const openMore = () => {
    setMoreOpen(true);
    try {
      window.history.pushState({ mineflowMore: true }, '');
    } catch {
      // History unavailable: the sheet still opens; Back simply will not close it.
    }
  };
  const closeMore = useCallback(() => {
    setMoreOpen(false);
    if (historyMarked()) window.history.back();
  }, []);
  const selectFromMore = (href: string) => {
    setMoreOpen(false);
    if (!historyMarked()) {
      router.push(href);
      return;
    }
    pendingHref.current = href;
    window.history.back();
    // Belt and braces: if the browser never reports the pop, navigate anyway.
    window.setTimeout(() => {
      if (pendingHref.current === href) {
        pendingHref.current = null;
        router.push(href);
      }
    }, 300);
  };
  useEffect(() => {
    const onPop = () => {
      if (moreOpenRef.current) setMoreOpen(false);
      const href = pendingHref.current;
      if (href) {
        pendingHref.current = null;
        // Let the router finish restoring the popped entry before navigating away — a push
        // dispatched inside the same popstate task is superseded by that restore.
        window.setTimeout(() => router.push(href), 0);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [router]);

  // Sheet: Escape closes it and background scroll is locked while it is open.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMore();
    };
    document.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [moreOpen, closeMore]);

  const isActive = (href: string) =>
    pathname === href ||
    // A parent tab is active for its sub-routes, but /orders must NOT light up
    // for /orders/invoice etc. — those are their own nav items.
    (href !== '/orders' && pathname.startsWith(`${href}/`));

  const renderSidebarLink = (item: NavItem, indent = false, onNavigate?: () => void) => (
    <li key={item.href}>
      <Link
        href={item.href}
        {...(onNavigate ? { onClick: onNavigate } : {})}
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
                const items = row.items.filter((it) =>
                  canSeeNavItem(it, roleKey, allowed),
                );
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
          {/* pt-[safe-area-inset-top] pairs with viewport-fit=cover so the header clears an
              iPhone notch / dynamic island; resolves to 0 on Android and desktop. */}
          <header className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] lg:hidden">
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

          {/* Bottom padding = the fixed 64px bar + the home-indicator inset + 16px breathing room,
              so the last card/button is never hidden behind the bar. Desktop keeps pb-8. */}
          <main
            id="main-content"
            className="min-w-0 flex-1 p-3 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-5 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8"
          >
            {children}
          </main>
        </div>
      </div>

      {/* Email kept discoverable for support without cluttering the chrome. */}
      <span className="sr-only" data-testid="authenticated-user-email">
        {userEmail}
      </span>

      {/* ---------------- Mobile bottom bar: five modules + More (Owner 2026-09-06) ---------------- */}
      {/* The ONE mobile navigation system: a fixed 64px bar over the home-indicator safe area,
          six slots, More always right-most. The slot count follows the member's PERMITTED
          modules (never a blank or forbidden tab); the bar's height/position classes are the
          same for every role — geometry never depends on role. */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden"
        data-testid="bottom-nav"
      >
        <ul
          className="grid h-16"
          style={{
            gridTemplateColumns: `repeat(${barItems.length + 1}, minmax(0, 1fr))`,
          }}
        >
          {barItems.map((item) => {
            const active = isActive(item.href);
            return (
              <li key={item.href} className="min-w-0">
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  data-testid={`bottom-tab-${item.href.replace(/^\//, '').replace(/\//g, '-')}`}
                  className={cn(
                    'flex h-full min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium leading-none transition-colors',
                    active ? 'text-gold-strong' : 'text-muted-foreground',
                  )}
                >
                  {/* Icon on a subtle gold pill when active — the existing accent, nothing new. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-7 items-center justify-center rounded-full px-3 text-xl leading-none',
                      active && 'bg-gold/15',
                    )}
                  >
                    {item.icon}
                  </span>
                  {/* Full label from 360px up; below that a meaning-preserving short form
                      ("Inv.", "Cash", "Dash") instead of shrinking the text. */}
                  <span className="hidden max-w-full truncate min-[360px]:inline">
                    {mobileLabel(item)}
                  </span>
                  <span className="max-w-full truncate min-[360px]:hidden">
                    {mobileShortLabel(item)}
                  </span>
                </Link>
              </li>
            );
          })}
          <li className="min-w-0">
            <button
              type="button"
              onClick={moreOpen ? closeMore : openMore}
              aria-expanded={moreOpen}
              aria-haspopup="dialog"
              aria-controls="mobile-more-sheet"
              data-testid="mobile-more-button"
              className={cn(
                'flex h-full w-full min-w-0 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium leading-none transition-colors',
                moreOpen ? 'text-gold-strong' : 'text-muted-foreground',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 items-center justify-center rounded-full px-3 text-xl leading-none',
                  moreOpen && 'bg-gold/15',
                )}
              >
                ⋯
              </span>
              <span>More</span>
            </button>
          </li>
        </ul>
      </nav>

      {/* ---------------- More: a bottom sheet above the bar ---------------- */}
      {moreOpen ? (
        <div
          className="fixed inset-0 z-40 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="More"
          id="mobile-more-sheet"
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={closeMore}
            className="absolute inset-0 bg-black/50"
            data-testid="mobile-more-overlay"
          />
          <div
            className="absolute inset-x-0 flex max-h-[calc(100dvh-5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] flex-col rounded-t-2xl border border-border bg-card shadow-xl"
            style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
            data-testid="mobile-more-sheet"
          >
            <div className="flex items-center justify-between px-4 pb-1 pt-3">
              <p className="text-sm font-semibold text-foreground">More</p>
              <button
                type="button"
                onClick={closeMore}
                aria-label="Close menu"
                data-testid="mobile-more-close"
                className="tap-44 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm text-muted-foreground"
              >
                ✕
              </button>
            </div>
            {/* The SAME role/permission filter as the desktop sidebar — never a second
                hard-coded list. Modules first, then Settings and Logout under a divider. */}
            <nav aria-label="More" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              <ul className="space-y-0.5">
                {sheetItems.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={(e) => {
                        e.preventDefault();
                        selectFromMore(item.href);
                      }}
                      aria-current={isActive(item.href) ? 'page' : undefined}
                      className={cn(
                        'flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                        isActive(item.href)
                          ? 'bg-gold/15 text-gold-strong'
                          : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-5 shrink-0 text-center text-base"
                      >
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                      {item.available ? null : <SoonTag />}
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
                ))}
              </ul>
              <div className="my-2 border-t border-border" aria-hidden="true" />
              <ul className="space-y-0.5">
                {canSeeNavItem(SETTINGS_ITEM, roleKey, allowed) ? (
                  <li>
                    <Link
                      href={SETTINGS_ITEM.href}
                      onClick={(e) => {
                        e.preventDefault();
                        selectFromMore(SETTINGS_ITEM.href);
                      }}
                      aria-current={isActive(SETTINGS_ITEM.href) ? 'page' : undefined}
                      data-testid="more-settings"
                      className={cn(
                        'flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors',
                        isActive(SETTINGS_ITEM.href)
                          ? 'bg-gold/15 text-gold-strong'
                          : 'text-foreground hover:bg-accent',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className="w-5 shrink-0 text-center text-base"
                      >
                        {SETTINGS_ITEM.icon}
                      </span>
                      <span>{SETTINGS_ITEM.label}</span>
                    </Link>
                  </li>
                ) : null}
                <li>
                  <LogoutButton variant="more" />
                </li>
              </ul>
            </nav>
          </div>
        </div>
      ) : null}
    </div>
  );
}
