'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { PreviewButton, SampleBadge, StatusBadge } from '@/components/preview/primitives';
import type { PrinterState } from '@/components/preview/sample-data';
import { cn } from '@/lib/utils';

/**
 * PROTOTYPE SHELL — sidebar, mobile nav, printer status.
 *
 * Navigation order is the Owner-approved order. There is deliberately NO
 * separate multi-platform "Connections" tab: Pancake lives under
 * Settings → Integrations → Pancake.
 */

const BASE = '/preview';

export const PREVIEW_NAV = [
  { href: `${BASE}/dashboard-report`, label: 'Dashboard Report', icon: '▥' },
  { href: `${BASE}/orders`, label: 'Orders', icon: '□' },
  { href: `${BASE}/invoice`, label: 'Invoice', icon: '▤' },
  { href: `${BASE}/live`, label: 'Live', icon: '◉' },
  { href: `${BASE}/customers`, label: 'Customers', icon: '☺' },
  { href: `${BASE}/items`, label: 'Items / Inventory', icon: '◈' },
  { href: `${BASE}/payments`, label: 'Payments', icon: '₱' },
  { href: `${BASE}/fulfillment`, label: 'Fulfillment', icon: '➤' },
  { href: `${BASE}/reports`, label: 'Reports', icon: '▦' },
  { href: `${BASE}/settings`, label: 'Settings', icon: '⚙' },
] as const;

/**
 * Mobile bottom nav carries the four most-used; the rest live under More.
 *
 * Dashboard Report is the landing page but NOT in the bottom four: on a phone the
 * daily work is Orders/Invoice/Live, and a summary screen would displace one of
 * them. It stays one tap away under More.
 */
const MOBILE_PRIMARY = PREVIEW_NAV.slice(1, 5);
// PREVIEW_NAV is `as const`, so index 0 is known-present — no assertion needed.
const MOBILE_MORE = [PREVIEW_NAV[0], ...PREVIEW_NAV.slice(5)];

const PRINTER_TONE: Record<PrinterState, 'green' | 'amber' | 'red' | 'slate'> = {
  Connected: 'green',
  Connecting: 'amber',
  Disconnected: 'slate',
  Error: 'red',
  'Unsupported on Device': 'slate',
};

function UserCard({ collapsed }: { collapsed: boolean }) {
  if (collapsed) {
    return (
      <div className="flex justify-center py-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          AV
        </div>
      </div>
    );
  }

  return (
    <div className="mx-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
          AV
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">A.V. Owner</p>
          <p className="truncate text-[11px] text-slate-500">Owner</p>
        </div>
        <span
          className="h-2 w-2 shrink-0 rounded-full bg-emerald-500"
          title="Account active"
          aria-label="Account active"
        />
      </div>
      <p className="mt-2 truncate text-[11px] text-slate-500">
        Active page: <span className="font-medium text-slate-700">A.V. Jewelry Main</span>
      </p>
    </div>
  );
}

function PrinterRow({
  state,
  onCycle,
  collapsed,
}: {
  state: PrinterState;
  onCycle: () => void;
  collapsed: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onCycle}
      title="Bluetooth / Printer status (prototype: click to cycle states)"
      className={cn(
        'flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-left transition-colors hover:bg-slate-50',
        collapsed && 'justify-center px-0',
      )}
      data-testid="printer-status"
    >
      <span aria-hidden="true" className="text-sm text-slate-500">
        ⎙
      </span>
      {collapsed ? null : (
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium text-slate-700">
            Bluetooth / Printer
          </span>
          <StatusBadge label={state} tone={PRINTER_TONE[state]} className="mt-0.5" />
        </span>
      )}
    </button>
  );
}

const PRINTER_CYCLE: PrinterState[] = [
  'Disconnected',
  'Connecting',
  'Connected',
  'Error',
  'Unsupported on Device',
];

export function PreviewShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Defaults to Disconnected: "Connected" is never shown without a verified
  // connection. Clicking cycles states so the Owner can review each one.
  const [printer, setPrinter] = useState<PrinterState>('Disconnected');

  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-50 text-slate-900">
      {/* Prototype banner — always visible, never dismissible. */}
      <div className="flex flex-wrap items-center justify-center gap-2 bg-amber-100 px-3 py-1.5 text-center text-[11px] font-medium text-amber-900">
        <span>
          UI PROTOTYPE — for Owner review only. Not connected to live operations.
        </span>
        <SampleBadge />
      </div>

      <div className="flex flex-1">
        {/* ---------------- Desktop sidebar ---------------- */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r border-slate-200 bg-white transition-all lg:flex',
            collapsed ? 'w-[68px]' : 'w-64',
          )}
          data-testid="preview-sidebar"
        >
          {/* Top: branding + user */}
          <div className="border-b border-slate-100 pb-3">
            <div
              className={cn(
                'flex items-center gap-2 px-3 py-3.5',
                collapsed && 'justify-center px-0',
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
                M
              </div>
              {collapsed ? null : (
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold tracking-tight text-slate-900">
                    MineFlow
                  </p>
                  <p className="truncate text-[10px] text-slate-500">A.V. Jewelry</p>
                </div>
              )}
            </div>
            <UserCard collapsed={collapsed} />
          </div>

          {/* Middle: primary navigation */}
          <nav aria-label="Primary" className="flex-1 overflow-y-auto p-2">
            <ul className="space-y-0.5">
              {PREVIEW_NAV.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive(item.href) ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                      collapsed && 'justify-center px-0',
                      isActive(item.href)
                        ? 'bg-emerald-50 text-emerald-800'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                    )}
                  >
                    <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
                      {item.icon}
                    </span>
                    {collapsed ? null : <span className="truncate">{item.label}</span>}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Fixed bottom: printer status directly above logout */}
          <div className="space-y-1.5 border-t border-slate-100 p-2">
            <PrinterRow
              state={printer}
              collapsed={collapsed}
              onCycle={() =>
                setPrinter(
                  (s) =>
                    PRINTER_CYCLE[(PRINTER_CYCLE.indexOf(s) + 1) % PRINTER_CYCLE.length]!,
                )
              }
            />
            <button
              type="button"
              title="Log out (prototype — no action)"
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-700',
                collapsed && 'justify-center px-0',
              )}
              data-testid="logout"
            >
              <span aria-hidden="true" className="w-4 shrink-0 text-center text-xs">
                ⏻
              </span>
              {collapsed ? null : <span>Logout</span>}
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="flex w-full items-center justify-center rounded-lg px-2 py-1.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {collapsed ? '»' : '« Collapse'}
            </button>
          </div>
        </aside>

        {/* ---------------- Main ---------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Compact mobile header */}
          <header className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-3 py-2.5 lg:hidden">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-xs font-bold text-white">
                M
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-slate-900">MineFlow</p>
                <p className="truncate text-[10px] text-slate-500">A.V. Owner · Owner</p>
              </div>
            </div>
            <StatusBadge label={printer} tone={PRINTER_TONE[printer]} />
          </header>

          <main id="main-content" className="min-w-0 flex-1 p-3 pb-24 sm:p-5 lg:pb-8">
            {children}
          </main>
        </div>
      </div>

      {/* ---------------- Mobile bottom nav ---------------- */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden"
        data-testid="preview-mobile-nav"
      >
        <ul className="grid grid-cols-5">
          {MOBILE_PRIMARY.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive(item.href) ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 text-[10px] font-medium',
                  isActive(item.href) ? 'text-emerald-700' : 'text-slate-500',
                )}
              >
                <span aria-hidden="true" className="text-sm">
                  {item.icon}
                </span>
                <span className="truncate">{item.label.split(' ')[0]}</span>
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
                moreOpen ? 'text-emerald-700' : 'text-slate-500',
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
          <div className="absolute inset-x-0 bottom-full border-t border-slate-200 bg-white p-2 shadow-lg">
            <ul className="grid grid-cols-2 gap-1">
              {MOBILE_MORE.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    <span aria-hidden="true">{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
            <div className="mt-1 border-t border-slate-100 pt-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                <span aria-hidden="true">⏻</span> Logout
              </button>
            </div>
          </div>
        ) : null}
      </nav>
    </div>
  );
}

export function PreviewPageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

export function ComingSoonPage({ title, phase }: { title: string; phase: string }) {
  return (
    <>
      <PreviewPageHeader title={title} description="Prototype placeholder." />
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm font-medium text-slate-700">
          Not designed in this review round
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
          This page exists so the navigation order can be reviewed end to end. Its screens
          are delivered in {phase}.
        </p>
        <PreviewButton variant="outline" size="sm" className="mt-4" disabled>
          Nothing to do here yet
        </PreviewButton>
      </div>
    </>
  );
}
