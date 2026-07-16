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
      { label: 'Invoice', href: '/orders/invoice', icon: '▤' },
      { label: 'Live', href: '/live', icon: '◉' },
      { label: 'Customers', href: '/customers', icon: '☺' },
      { label: 'Items / Inventory', href: '/orders/inventory', icon: '◈' },
      { label: 'Payments & Layaway', href: '/orders/payments', icon: '₱' },
      { label: 'Fulfillment', href: '/orders/fulfillment', icon: '➤' },
      { label: 'Reports', href: '/reports', icon: '▦' },
      { label: 'Settings', href: '/settings', icon: '⚙' },
    ]);
  });
});

describe('LOCKED: mobile navigation', () => {
  it('bottom bar is exactly Orders · Invoice · Live · Customers (+ More)', () => {
    expect(mobilePrimaryItems().map((i) => i.label)).toEqual([
      'Orders',
      'Invoice',
      'Live',
      'Customers',
    ]);
  });

  it('More carries the rest, Dashboard Profile first', () => {
    expect(mobileMoreItems().map((i) => i.label)).toEqual([
      'Dashboard Profile',
      'Items / Inventory',
      'Payments & Layaway',
      'Fulfillment',
      'Reports',
      'Settings',
    ]);
  });
});

describe('LOCKED: placements', () => {
  it('New Entry is not a nav item; it lives inside Orders and links to /live', () => {
    expect(PRIMARY_NAV.some((i) => /new entry/i.test(i.label))).toBe(false);
    const orders = read('app/(app)/orders/page.tsx');
    expect(orders).toMatch(/New Entry/);
    expect(orders).toMatch(/href="\/live"/);
  });

  it('Fulfillment stays standalone at position 8 (/orders/fulfillment)', () => {
    expect(PRIMARY_NAV[7]).toMatchObject({
      label: 'Fulfillment',
      href: '/orders/fulfillment',
      mobilePrimary: false,
    });
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

describe('LOCKED: branding (beige / black / gold — no emerald/slate)', () => {
  it('globals.css defines the gold brand tokens', () => {
    const css = read('app/globals.css');
    expect(css).toMatch(/--gold:/);
    expect(css).toMatch(/--gold-strong:/);
  });

  it('the production shell uses the brand, not the prototype emerald/slate', () => {
    for (const file of [
      'components/shell/app-sidebar.tsx',
      'components/shell/theme-toggle.tsx',
      'components/shell/printer-status.tsx',
    ]) {
      const s = read(file);
      expect(s, `${file} must not use emerald/slate`).not.toMatch(/emerald|slate/);
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
