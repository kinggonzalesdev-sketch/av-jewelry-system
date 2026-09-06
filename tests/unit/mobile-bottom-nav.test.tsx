import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppSidebar } from '@/components/shell/app-sidebar';
import { mobileBarItems, PRIMARY_NAV } from '@/components/shell/navigation';

/**
 * Mobile bottom navigation + More sheet (Owner 2026-09-06). The numbered tests mirror the
 * Owner's required test list; the width tests (13–15) are geometry and are proven in a real
 * browser instead (jsdom has no layout), so here they assert the responsive label markup.
 */

const push = vi.fn();
let pathname = '/dashboard';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/auth/actions', () => ({ signOut: vi.fn() }));

beforeEach(() => {
  pathname = '/dashboard';
  push.mockClear();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
  // A clean history entry per test so the sheet's Back-support marker never leaks across.
  window.history.replaceState(null, '', '/dashboard');
});

function renderShell(props?: { roleKey?: string; allowedPages?: string[] }) {
  return render(
    <AppSidebar
      fullName="Maria Santos"
      roleKey={props?.roleKey ?? 'owner'}
      userEmail="maria@example.com"
      allowedPages={props?.allowedPages}
      pendingApprovals={2}
    >
      <p>content</p>
    </AppSidebar>,
  );
}
const bar = () => screen.getByTestId('bottom-nav');
const openMore = () => fireEvent.click(screen.getByTestId('mobile-more-button'));
const sheet = () => screen.getByTestId('mobile-more-sheet');
const hrefsIn = (el: HTMLElement) =>
  within(el)
    .getAllByRole('link')
    .map((a) => a.getAttribute('href'));

describe('mobile bottom navigation (Owner 2026-09-06)', () => {
  it('TEST 1 — Dashboard tab is highlighted on /dashboard', () => {
    renderShell();
    const tab = within(bar()).getByTestId('bottom-tab-dashboard');
    expect(tab).toHaveAttribute('aria-current', 'page');
    expect(tab.className).toMatch(/text-gold-strong/);
    expect(within(bar()).getByTestId('bottom-tab-orders')).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(bar()).getByTestId('bottom-tab-orders').className).toMatch(
      /text-muted-foreground/,
    );
  });

  it('TESTS 2–5 — six slots: Dashboard · Orders · Inventory · Layaway · Daily Cash · More, real routes, More right-most', () => {
    renderShell();
    const slots = within(bar()).getAllByRole('listitem');
    expect(slots).toHaveLength(6);
    expect(hrefsIn(bar())).toEqual([
      '/dashboard',
      '/orders',
      '/orders/inventory',
      '/orders/payments',
      '/cash/daily',
    ]);
    // Display labels are short forms; the underlying module names are unchanged.
    const links = within(bar()).getAllByRole('link');
    for (const [i, label] of [
      'Dashboard',
      'Orders',
      'Inventory',
      'Layaway',
      'Daily Cash',
    ].entries()) {
      // Two label spans per tab (full ≥360px, short below); tabs without a distinct short
      // form carry the same word twice, so match at least one.
      expect(within(links[i]!).getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(PRIMARY_NAV.find((i) => i.href === '/cash/daily')?.label).toBe(
      'Daily Cash Summary',
    );
    expect(PRIMARY_NAV.find((i) => i.href === '/dashboard')?.label).toBe(
      'Dashboard Profile',
    );
    expect(within(slots[5]!).getByTestId('mobile-more-button')).toBeInTheDocument();
  });

  it('TEST 6 — More opens a bottom sheet above the bar, not a page', () => {
    renderShell();
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    openMore();
    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
    expect(sheet().style.bottom).toBe('calc(4rem + env(safe-area-inset-bottom))');
    expect(screen.getByTestId('mobile-more-button')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(push).not.toHaveBeenCalled();
    // Opening pushed the Back-support marker entry.
    expect((window.history.state as { mineflowMore?: boolean }).mineflowMore).toBe(true);
  });

  it('TEST 7 + 8 — no theme control inside More; the single header theme button still works', () => {
    renderShell();
    openMore();
    const s = sheet();
    expect(within(s).queryByText(/light mode|dark mode|theme/i)).not.toBeInTheDocument();
    expect(within(s).queryByTestId('theme-toggle')).not.toBeInTheDocument();
    expect(within(s).queryByTestId('privacy-toggle')).not.toBeInTheDocument();
    // Exactly ONE compact (header) theme button exists for the mobile shell; the desktop
    // sidebar footer's own toggle is hidden on phones by its lg: classes.
    const compact = screen
      .getAllByTestId('theme-toggle')
      .filter((el) => el.hasAttribute('aria-label'));
    expect(compact).toHaveLength(1);
    fireEvent.click(compact[0]!);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('TESTS 9–11 — Scrap, Settings and Logout live inside More, in approved order', () => {
    renderShell();
    expect(within(bar()).queryByRole('link', { name: /scrap/i })).not.toBeInTheDocument();
    openMore();
    const s = sheet();
    expect(within(s).getByRole('link', { name: /scrap/i })).toHaveAttribute(
      'href',
      '/admin/scrap',
    );
    expect(within(s).getByTestId('more-settings')).toHaveAttribute('href', '/settings');
    expect(within(s).getByTestId('logout')).toBeInTheDocument();
    expect(hrefsIn(s)).toEqual([
      '/admin/scrap',
      '/approvals',
      '/admin/attendance',
      '/admin/attendance/review',
      '/admin/payroll',
      '/calculator',
      '/settings',
    ]);
    // The live Approvals badge follows the Approvals row into the sheet.
    expect(within(s).getByTestId('approvals-badge')).toHaveTextContent('2');
  });

  it('TEST 12 — permissions: Staff without Daily Cash gets the next permitted module in slot 5; unpermitted and Owner-only modules never appear', () => {
    const allowedPages = [
      'nav_dashboard',
      'nav_orders',
      'nav_inventory',
      'nav_layaway',
      'nav_scrap',
      'hr_attendance',
    ];
    renderShell({ roleKey: 'staff', allowedPages });
    expect(hrefsIn(bar())).toEqual([
      '/dashboard',
      '/orders',
      '/orders/inventory',
      '/orders/payments',
      '/admin/scrap',
    ]);
    expect(mobileBarItems('staff', new Set(allowedPages)).map((i) => i.href)).toEqual(
      hrefsIn(bar()),
    );
    openMore();
    const more = hrefsIn(sheet());
    expect(more).not.toContain('/cash/daily'); // no view_reports
    expect(more).not.toContain('/approvals'); // Owner-only
    expect(more).not.toContain('/admin/payroll'); // no hr_payroll
    expect(more).not.toContain('/settings'); // no view_settings
    expect(more).toContain('/admin/attendance');
    expect(more).toContain('/calculator'); // ungated staff utility
    expect(more).not.toContain('/admin/scrap'); // already in the bar
  });

  it('TEST 12b — fewer permitted modules shrink the slot count; never a blank tab', () => {
    renderShell({ roleKey: 'staff', allowedPages: ['nav_dashboard'] });
    expect(hrefsIn(bar())).toEqual(['/dashboard', '/calculator']);
    const list = within(bar()).getByRole('list');
    expect(list.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))');
    const slots = within(bar()).getAllByRole('listitem');
    expect(slots[slots.length - 1]!.textContent).toContain('More');
  });

  it('TESTS 13–15 (markup) — every tab carries a full label from 360px and a short form below it', () => {
    renderShell();
    const inv = within(bar()).getByTestId('bottom-tab-orders-inventory');
    expect(within(inv).getByText('Inventory').className).toContain('min-[360px]:inline');
    expect(within(inv).getByText('Inv.').className).toContain('min-[360px]:hidden');
    const cash = within(bar()).getByTestId('bottom-tab-cash-daily');
    expect(within(cash).getByText('Daily Cash')).toBeInTheDocument();
    expect(within(cash).getByText('Cash')).toBeInTheDocument();
    const dash = within(bar()).getByTestId('bottom-tab-dashboard');
    expect(within(dash).getByText('Dash')).toBeInTheDocument();
    // Compact bar: 64px tall, 11px labels, 20px icons.
    expect(within(bar()).getByRole('list').className).toMatch(/(^|\s)h-16(\s|$)/);
    expect(inv.className).toContain('text-[11px]');
    expect(inv.querySelector('[aria-hidden="true"]')?.className).toContain('text-xl');
  });

  it('TEST 16 + safe area — content is padded for the fixed bar; bar and sheet respect the home indicator', () => {
    const { container } = renderShell();
    const main = container.querySelector('#main-content') as HTMLElement;
    expect(main.className).toContain('pb-[calc(5rem+env(safe-area-inset-bottom))]');
    expect(main.className).toContain('lg:pb-8');
    expect(bar().className).toContain('pb-[env(safe-area-inset-bottom)]');
    openMore();
    expect(sheet().style.bottom).toContain('env(safe-area-inset-bottom)');
  });

  it('ONLY ONE bottom navigation: no drawer, no second bar, desktop sidebar hidden on phones', () => {
    renderShell();
    expect(screen.getAllByTestId('bottom-nav')).toHaveLength(1);
    expect(screen.queryByTestId('mobile-drawer')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-menu-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    expect(bar().className).toContain('lg:hidden');
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.className).toMatch(/(^|\s)hidden(\s|$)/);
    expect(sidebar.className).toContain('lg:flex');
  });

  it('TEST 17 — desktop sidebar and its footer are unchanged', () => {
    renderShell();
    const sidebar = screen.getByTestId('app-sidebar');
    expect(sidebar.className).toMatch(/(^|\s)w-64(\s|$)/);
    expect(within(sidebar).getByTestId('sidebar-settings')).toHaveAttribute(
      'href',
      '/settings',
    );
    expect(within(sidebar).getByTestId('logout')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('theme-toggle')).toBeInTheDocument();
    expect(within(sidebar).getByTestId('printer-status')).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: /team management/i }),
    ).toBeInTheDocument();
  });

  it('closes when tapping outside, on ✕, and on Escape', () => {
    renderShell();
    openMore();
    fireEvent.click(screen.getByTestId('mobile-more-overlay'));
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    openMore();
    fireEvent.click(screen.getByTestId('mobile-more-close'));
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    openMore();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('device Back closes the sheet (popstate) without leaving the page', () => {
    renderShell();
    openMore();
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it('selecting a module closes the sheet and navigates to its real route', async () => {
    renderShell();
    openMore();
    fireEvent.click(within(sheet()).getByRole('link', { name: /scrap/i }));
    expect(screen.queryByTestId('mobile-more-sheet')).not.toBeInTheDocument();
    await waitFor(() => expect(push).toHaveBeenCalledWith('/admin/scrap'));
    expect(push).toHaveBeenCalledTimes(1);
  });
});
