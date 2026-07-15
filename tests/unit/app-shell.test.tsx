import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BottomNav, SideNav } from '@/components/shell/bottom-nav';
import { PRIMARY_NAV_ITEMS } from '@/components/shell/navigation';

// The nav components are client components that read the current path.
vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
}));

/**
 * Application shell rendering (Bible §8.2).
 */
describe('primary navigation model', () => {
  it('defines exactly the five approved bottom-nav items, in order', () => {
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).toEqual([
      'Dashboard',
      'Live',
      'Claims',
      'Orders',
      'More',
    ]);
  });

  it('does not promote Global Search to a sixth bottom-nav item', () => {
    // Bible §8.2: Global Search belongs in the header, not the bottom nav.
    expect(PRIMARY_NAV_ITEMS.map((item) => item.label)).not.toContain('Search');
    expect(PRIMARY_NAV_ITEMS).toHaveLength(5);
  });
});

describe('BottomNav', () => {
  it('renders all five destinations as links', () => {
    render(<BottomNav />);

    const nav = screen.getByTestId('bottom-nav');

    for (const item of PRIMARY_NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute(
        'href',
        item.href,
      );
    }
  });

  it('exposes an accessible name', () => {
    render(<BottomNav />);

    expect(screen.getByTestId('bottom-nav')).toHaveAccessibleName('Primary');
  });

  it('marks the current route with aria-current', () => {
    render(<BottomNav />);

    const nav = screen.getByTestId('bottom-nav');

    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Live' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});

describe('SideNav', () => {
  it('renders the same five destinations', () => {
    render(<SideNav />);

    const nav = screen.getByTestId('side-nav');

    for (const item of PRIMARY_NAV_ITEMS) {
      expect(within(nav).getByRole('link', { name: item.label })).toHaveAttribute(
        'href',
        item.href,
      );
    }
  });
});
