import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomersView } from '@/components/customers/customers-view';
import type { CustomersResult } from '@/lib/customers/service';

// Row actions pull in a 'use server' action (server-only). Stub the action so
// the client component renders in jsdom without loading the server chain.
vi.mock('@/lib/customers/actions', () => ({
  deactivateCustomerAction: vi.fn(),
  permanentlyDeleteCustomerAction: vi.fn(),
}));

// The row's Delete modal + the detail modal refresh use the router.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const rows: CustomersResult = {
  ok: true,
  rows: [
    {
      id: 'c1',
      displayName: 'Ana Reyes',
      address: '12 Rizal St, Cebu',
      contactNumber: '0917 000 0001',
      isActive: true,
      stage: 'Active Layaway',
      createdAt: '2026-07-01T00:00:00Z',
    },
    {
      id: 'c2',
      displayName: 'Bea Lim',
      address: null,
      contactNumber: null,
      isActive: false,
      stage: 'No orders',
      createdAt: '2026-07-02T00:00:00Z',
    },
  ],
};

describe('CustomersView list states', () => {
  it('surfaces a read error explicitly, never an empty table', () => {
    render(
      <CustomersView result={{ ok: false, reason: 'boom' }} query="" canManage={true} />,
    );
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a genuine empty state when there are no customers', () => {
    render(<CustomersView result={{ ok: true, rows: [] }} query="" canManage={true} />);
    expect(screen.getByText(/No customers yet/i)).toBeInTheDocument();
  });

  it('distinguishes "no matches" for a search from "no customers"', () => {
    render(<CustomersView result={{ ok: true, rows: [] }} query="zzz" canManage={true} />);
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  it('renders customers with a View control each', () => {
    render(<CustomersView result={rows} query="" canManage={true} />);
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Bea Lim')).toBeInTheDocument();
    expect(screen.getByTestId('customer-view-c1')).toBeInTheDocument();
  });
});

describe('CustomersView — detail modal (no right-side panel)', () => {
  it('does NOT render a right-side detail panel by default', () => {
    render(<CustomersView result={rows} query="" canManage={true} />);
    // The removed panel's headings must not appear on the page.
    expect(screen.queryByText(/Official Orders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reference photos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Attach a reference photo/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('customer-detail-modal')).not.toBeInTheDocument();
  });

  it('opens a centered modal with the five fields when View is clicked', () => {
    render(<CustomersView result={rows} query="" canManage={true} />);
    fireEvent.click(screen.getByTestId('customer-view-c1'));

    const modal = screen.getByTestId('customer-detail-modal');
    expect(modal).toBeInTheDocument();
    const inModal = within(modal);
    for (const label of [
      'Full Name',
      'Contact Number',
      'Address',
      'Stage',
      'Date Created',
    ]) {
      expect(inModal.getByText(label)).toBeInTheDocument();
    }
    expect(inModal.getByText('Ana Reyes')).toBeInTheDocument();
  });

  it('shows a dash for a missing value in the modal', () => {
    render(<CustomersView result={rows} query="" canManage={true} />);
    // Bea Lim has no address/contact — the modal must show "—", never blank.
    fireEvent.click(screen.getByTestId('customer-view-c2'));
    expect(screen.getByTestId('customer-detail-modal')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
