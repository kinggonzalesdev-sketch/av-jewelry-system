import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar } from '@/components/shell/app-sidebar';
import {
  mobileLabel,
  mobileMoreItems,
  mobilePrimaryItems,
  PRIMARY_NAV,
} from '@/components/shell/navigation';

// Nav components read the current path; signOut is a server action; the theme
// toggle reads matchMedia — stub all three so the shell renders in jsdom.
vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard' }));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false, // OS prefers light in tests unless a test overrides.
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
});

/**
 * The Owner-approved shell (recovered prototype layout, verbatim).
 */
describe('approved navigation model (navigation.ts is the source of truth)', () => {
  it('lists the exact approved desktop sidebar order', () => {
    expect(PRIMARY_NAV.map((i) => i.label)).toEqual([
      'Dashboard Report',
      'Orders',
      'Invoice',
      'Live',
      'Customers',
      'Items / Inventory',
      'Payments & Layaway',
      'Fulfillment',
      'Reports',
      'Settings',
    ]);
  });

  it('has the exact approved mobile bottom-nav primary four', () => {
    expect(mobilePrimaryItems().map((i) => i.label)).toEqual([
      'Orders',
      'Invoice',
      'Live',
      'Customers',
    ]);
  });

  it('puts the rest under More, Dashboard Report first', () => {
    expect(mobileMoreItems().map((i) => i.label)).toEqual([
      'Dashboard Report',
      'Items / Inventory',
      'Payments & Layaway',
      'Fulfillment',
      'Reports',
      'Settings',
    ]);
  });

  it('does NOT make New Entry a primary nav item', () => {
    // New Entry is an in-page action inside Orders/Live, never a nav item.
    expect(PRIMARY_NAV.some((i) => /new entry/i.test(i.label))).toBe(false);
  });

  it('keeps Fulfillment in its recovered approved placement (standalone, /orders/fulfillment)', () => {
    const fulfillment = PRIMARY_NAV[7];
    expect(fulfillment).toMatchObject({
      label: 'Fulfillment',
      href: '/orders/fulfillment',
      mobilePrimary: false, // desktop-standalone; lives under More on mobile.
    });
  });

  it('does not promote Staff or Capabilities to standalone nav items', () => {
    for (const href of ['/admin/staff', '/admin/capabilities']) {
      expect(PRIMARY_NAV.some((i) => i.href === href)).toBe(false);
    }
  });

  it('marks only the not-yet-built modules as unavailable (honest state, not a dead link)', () => {
    // Customers is now a real read-only module; Reports and Settings remain
    // honest "unavailable" placeholders until built.
    const unavailable = PRIMARY_NAV.filter((i) => !i.available).map((i) => i.href);
    expect(unavailable).toEqual(['/settings']);
  });
});

describe('AppSidebar renders the approved shell', () => {
  const renderShell = () =>
    render(
      <AppSidebar fullName="Maria Santos" roleKey="staff" userEmail="maria@example.com">
        <p>content</p>
      </AppSidebar>,
    );

  it('renders the desktop sidebar links in the approved order', () => {
    renderShell();
    const sidebar = screen.getByTestId('app-sidebar');
    const labels = within(sidebar)
      .getAllByRole('link')
      .map((a) => a.textContent?.replace(/Soon$/, '').trim());
    // Each link renders its icon glyph then its label (unavailable items also get
    // a "Soon" tag, stripped above). Asserting icon+label proves order and icons.
    expect(labels).toEqual(PRIMARY_NAV.map((i) => `${i.icon}${i.label}`));
  });

  it('renders the mobile bottom nav: four primary destinations + More', () => {
    renderShell();
    const nav = screen.getByTestId('bottom-nav');
    for (const item of mobilePrimaryItems()) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(mobileLabel(item)) }),
      ).toHaveAttribute('href', item.href);
    }
    expect(within(nav).getByRole('button', { name: /more/i })).toBeInTheDocument();
  });

  it('shows the real authenticated identity, never a hardcoded name', () => {
    renderShell();
    expect(screen.getByTestId('authenticated-full-name')).toHaveTextContent(
      'Maria Santos',
    );
    expect(screen.getByTestId('authenticated-role')).toHaveTextContent('Staff');
    expect(screen.queryByText(/A\.V\. Owner/)).not.toBeInTheDocument();
  });

  it('restores the Bluetooth/printer control, the theme toggle, and Logout', () => {
    renderShell();
    expect(screen.getAllByTestId('printer-status').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('theme-toggle').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('logout').length).toBeGreaterThan(0);
  });

  it('shows the exact approved footer wording', () => {
    renderShell();
    expect(screen.getAllByTestId('footer-branding')[0]).toHaveTextContent(
      'Powered by King GenZ Digital',
    );
  });

  it('never shows a false connected/ready printer state', () => {
    renderShell();
    for (const el of screen.getAllByTestId('printer-status')) {
      expect(el.textContent).not.toMatch(/Printer Ready|Connected/);
    }
  });

  it('does not render a New Entry primary nav item', () => {
    renderShell();
    expect(screen.queryByRole('link', { name: /new entry/i })).not.toBeInTheDocument();
  });
});

describe('manual theme toggle persists the choice', () => {
  it('sets data-theme on <html> and writes localStorage on toggle', () => {
    render(
      <AppSidebar fullName="Maria Santos" roleKey="staff" userEmail="maria@example.com">
        <p>content</p>
      </AppSidebar>,
    );

    // Effect resolves the effective theme (OS light) on mount; first toggle → dark.
    fireEvent.click(screen.getAllByTestId('theme-toggle')[0]!);

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('av-theme')).toBe('dark');
  });
});
