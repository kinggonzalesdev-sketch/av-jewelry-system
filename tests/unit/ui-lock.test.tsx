import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  mobileMoreItems,
  mobilePrimaryItems,
  PRIMARY_NAV,
} from '@/components/shell/navigation';

/**
 * UI LOCK — the Owner-approved UI, pinned.
 *
 * See docs/FINAL-UI-SOURCE-OF-TRUTH.md. Nothing here may change without an
 * explicit Owner request that updates that document first. A failure means a
 * change touched the locked UI, not that the test is wrong.
 */

const srcRoot = join(__dirname, '..', '..', 'src');
const read = (rel: string) => readFileSync(join(srcRoot, rel), 'utf8');

describe('LOCKED: desktop sidebar (exact order, labels, routes, icons)', () => {
  it('matches the approved structure exactly', () => {
    expect(
      PRIMARY_NAV.map((i) => ({ label: i.label, href: i.href, icon: i.icon })),
    ).toEqual([
      { label: 'Dashboard Profile', href: '/dashboard', icon: '▥' },
      { label: 'Orders', href: '/orders', icon: '□' },
      { label: 'Inventory', href: '/orders/inventory', icon: '◈' },
      { label: 'Layaway', href: '/orders/payments', icon: '₱' },
      { label: 'Scrap', href: '/admin/scrap', icon: '♻' },
      // Team Management collapsible group (Owner request 2026-07-22). Settings moved
      // to the fixed footer (SETTINGS_ITEM), so it is no longer in PRIMARY_NAV.
      { label: 'Attendance', href: '/admin/attendance', icon: '⏱' },
      { label: 'Review Attendance', href: '/admin/attendance/review', icon: '☑' },
      { label: 'Payroll', href: '/admin/payroll', icon: '▤' },
      // Owner request 2026-08-01 — staff pricing/down-payment utility, placed last.
      { label: 'Special Calculator', href: '/calculator', icon: '🧮' },
    ]);
  });
});

describe('LOCKED: mobile navigation', () => {
  it('bottom bar is exactly Orders (+ More)', () => {
    // Invoice folded into Orders → For Invoice (Owner request 2026-07-22).
    expect(mobilePrimaryItems().map((i) => i.label)).toEqual(['Orders']);
  });

  it('More carries the rest, Dashboard Profile first', () => {
    expect(mobileMoreItems().map((i) => i.label)).toEqual([
      'Dashboard Profile',
      'Inventory',
      'Layaway',
      'Scrap',
      'Attendance',
      'Review Attendance',
      'Payroll',
      'Special Calculator',
    ]);
  });
});

describe('LOCKED: placements', () => {
  it('capture is not a nav item; it lives inside Orders as the New Order form', () => {
    // Neither "New Entry" nor "New Order" is a primary nav item — capture is an
    // in-page action. The old "New Entry → /live" header link was removed by
    // Owner request (2026-07-18); New Order is the single capture entry, wired to
    // the real, permission-guarded capture flow.
    expect(PRIMARY_NAV.some((i) => /new (entry|order)/i.test(i.label))).toBe(false);
    const workflow = read('components/orders/new-order-workflow.tsx');
    expect(workflow).toMatch(/New Order/);
    // Wired to the real, permission-guarded capture flow (captureManualOrder →
    // captureClaim). Pick-or-type resolves/creates the customer + item first.
    expect(workflow).toMatch(/captureManualOrderAction/);
  });

  it('Fulfillment is no longer a sidebar item (route kept as fallback)', () => {
    // Owner request: removed from the sidebar to keep the workflow Orders-centred;
    // /orders/fulfillment still exists as a fallback route.
    expect(PRIMARY_NAV.some((i) => i.href === '/orders/fulfillment')).toBe(false);
  });

  it('Staff and Capabilities are not standalone nav items', () => {
    const hrefs = PRIMARY_NAV.map((i) => i.href);
    expect(hrefs).not.toContain('/admin/staff');
    expect(hrefs).not.toContain('/admin/capabilities');
  });
});

describe('LOCKED: controls and footer', () => {
  const sidebar = () => read('components/shell/app-sidebar.tsx');

  it('renders the theme toggle, printer status, and Logout', () => {
    const s = sidebar();
    expect(s).toMatch(/ThemeToggle/);
    expect(s).toMatch(/PrinterStatus(Row|Badge)/);
    expect(s).toMatch(/LogoutButton/);
    expect(s).toMatch(/import \{ signOut \}/);
  });

  it('shows real identity, never a hardcoded name', () => {
    const s = sidebar();
    expect(s).toMatch(/data-testid="authenticated-full-name"/);
    expect(s).not.toMatch(/A\.V\.\s*Owner/);
  });

  it('footer wording is exactly "Powered by King GenZ Digital"', () => {
    expect(sidebar()).toMatch(/Powered by King GenZ Digital/);
  });
});

describe('LOCKED: branding (emerald green theme via tokens; no hardcoded palette)', () => {
  it('globals.css defines the brand accent tokens (named --gold*, now holding green)', () => {
    // The token NAMES are retained to avoid codebase-wide churn; per the
    // 2026-07-16 Owner decision (SOT §3) they carry the approved GREEN.
    const css = read('app/globals.css');
    expect(css).toMatch(/--gold:/);
    expect(css).toMatch(/--gold-strong:/);
  });

  it('the production shell uses brand TOKENS, never a hardcoded palette', () => {
    // Components must theme through the tokens (bg-gold / text-gold-strong / etc.)
    // rather than hardcoding a color family — so the one-place palette swap in
    // globals.css re-themes the whole app. The prototype's night-mode `slate`
    // classes must never leak into production.
    for (const file of [
      'components/shell/app-sidebar.tsx',
      'components/shell/theme-toggle.tsx',
      'components/shell/printer-status.tsx',
    ]) {
      const s = read(file);
      expect(s, `${file} must not hardcode a slate palette`).not.toMatch(/slate/);
    }
  });
});

describe('LOCKED: printer status stays honest', () => {
  it('never hard-codes a connected/ready state; Ready needs validation', () => {
    const printer = read('components/shell/printer.ts');
    // The only path to "Printer Ready" requires a recorded validation.
    expect(printer).toMatch(
      /if \(!env\.validated\) return 'Bluetooth Validation Required'/,
    );
    expect(printer).toMatch(/return 'Printer Ready'/);
  });
});
