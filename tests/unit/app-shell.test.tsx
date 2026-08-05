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
      'Dashboard Profile',
      'Orders',
      'Inventory',
      'Layaway',
      'Scrap',
      // Team Management collapsible group (Owner request 2026-07-22). Settings moved
      // to the fixed footer, so it is no longer a PRIMARY_NAV item.
      'Attendance',
      'Review Attendance',
      'Payroll',
      'Special Calculator',
    ]);
  });

  it('has the exact approved mobile bottom-nav primary items', () => {
    // Invoice was folded into Orders → For Invoice (Owner request 2026-07-22).
    expect(mobilePrimaryItems().map((i) => i.label)).toEqual(['Orders']);
  });

  it('puts the rest under More, Dashboard Profile first', () => {
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

  it('does NOT make New Entry a primary nav item', () => {
    // New Entry is an in-page action inside Orders/Live, never a nav item.
    expect(PRIMARY_NAV.some((i) => /new entry/i.test(i.label))).toBe(false);
  });

  it('no longer lists Fulfillment as a sidebar item (route kept as fallback)', () => {
    // Owner request: Fulfillment was removed from the sidebar to keep the workflow
    // Orders-centred. The /orders/fulfillment route still exists as a fallback.
    expect(PRIMARY_NAV.some((i) => i.href === '/orders/fulfillment')).toBe(false);
    expect(PRIMARY_NAV.some((i) => i.label === 'Fulfillment')).toBe(false);
  });

  it('does not promote Staff or Capabilities to standalone nav items', () => {
    for (const href of ['/admin/staff', '/admin/capabilities']) {
      expect(PRIMARY_NAV.some((i) => i.href === href)).toBe(false);
    }
  });

  it('has every module built — no nav item is a placeholder anymore', () => {
    // Customers, Reports, and Settings are now real routes; nothing is left as an
    // honest "unavailable" placeholder.
    const unavailable = PRIMARY_NAV.filter((i) => !i.available).map((i) => i.href);
    expect(unavailable).toEqual([]);
  });
});

describe('AppSidebar renders the approved shell', () => {
  const renderShell = () =>
    render(
      <AppSidebar fullName="Maria Santos" roleKey="staff" userEmail="maria@example.com">
        <p>content</p>
      </AppSidebar>,
    );

  it('renders flat nav items in order; Team Management is a collapsible group', () => {
    renderShell();
    const sidebar = screen.getByTestId('app-sidebar');
    // Team Management is a collapsible BUTTON (not a link), collapsed by default.
    const teamBtn = within(sidebar).getByRole('button', { name: /team management/i });
    expect(teamBtn).toHaveAttribute('aria-expanded', 'false');
    // The flat (non-group) items render as links inside the primary nav, in order.
    const flat = PRIMARY_NAV.filter((i) => !i.section);
    const nav = within(sidebar).getByRole('navigation', { name: /primary/i });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent?.replace(/Soon$/, '').trim());
    expect(labels).toEqual(flat.map((i) => `${i.icon}${i.label}`));
  });

  it('Team Management expands to reveal its submenu on click', () => {
    renderShell();
    const sidebar = screen.getByTestId('app-sidebar');
    const teamBtn = within(sidebar).getByRole('button', { name: /team management/i });
    fireEvent.click(teamBtn);
    expect(teamBtn).toHaveAttribute('aria-expanded', 'true');
    // No allowedPages passed here → the permission filter is skipped, so the group
    // reveals all three items (Review Attendance is now permission-gated, not
    // owner-only, so it is no longer hard-hidden by role).
    const nav = within(sidebar).getByRole('navigation', { name: /primary/i });
    expect(within(nav).getByRole('link', { name: /review attendance/i })).toHaveAttribute(
      'href',
      '/admin/attendance/review',
    );
    expect(within(nav).getByRole('link', { name: /payroll/i })).toHaveAttribute(
      'href',
      '/admin/payroll',
    );
  });

  it('keeps Settings and Logout fixed in the sidebar footer', () => {
    renderShell();
    const sidebar = screen.getByTestId('app-sidebar');
    expect(within(sidebar).getByTestId('sidebar-settings')).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(sidebar).getAllByTestId('logout').length).toBeGreaterThan(0);
  });

  it('renders the mobile bottom nav: primary destinations + More', () => {
    renderShell();
    const nav = screen.getByTestId('bottom-nav');
    for (const item of mobilePrimaryItems()) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(mobileLabel(item)) }),
      ).toHaveAttribute('href', item.href);
    }
    expect(within(nav).getByRole('button', { name: /more/i })).toBeInTheDocument();
  });

  it('shows a role-based control identity (Owner request 2026-07-22)', () => {
    renderShell();
    // Staff maps to the "Team" word: chip reads "Team Control" over "Team".
    expect(screen.getByTestId('authenticated-full-name')).toHaveTextContent(
      'Team Control',
    );
    expect(screen.getByTestId('authenticated-role')).toHaveTextContent('Team');
    expect(screen.queryByText(/A\.V\. Owner/)).not.toBeInTheDocument();
    // The real name is preserved for accountability as a hover title, not shown.
    expect(screen.getAllByTitle('Maria Santos').length).toBeGreaterThan(0);
  });

  it('maps each role to its control word', () => {
    const render1 = (roleKey: string) =>
      render(
        <AppSidebar fullName="X Y" roleKey={roleKey} userEmail="x@example.com">
          <p>content</p>
        </AppSidebar>,
      );
    const cases: Array<[string, string]> = [
      ['owner', 'Owner'],
      ['selected_admin', 'Admin'],
      ['staff', 'Team'],
    ];
    for (const [roleKey, word] of cases) {
      const { unmount } = render1(roleKey);
      expect(screen.getAllByTestId('authenticated-full-name')[0]).toHaveTextContent(
        `${word} Control`,
      );
      unmount();
    }
  });

  it('restores the Bluetooth/printer control, the theme toggle, and Logout', () => {
    renderShell();
    expect(screen.getAllByTestId('printer-status').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('theme-toggle').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('logout').length).toBeGreaterThan(0);
  });

  it('shows the brand tagline under the A.V. Jewelry name', () => {
    renderShell();
    // Moved out of the footer (Owner request 2026-07-22) to sit under the brand
    // name in the header; the footer above the theme toggle no longer repeats it.
    expect(screen.getByTestId('brand-tagline')).toHaveTextContent(
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
