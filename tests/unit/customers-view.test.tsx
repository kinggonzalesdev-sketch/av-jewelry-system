import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CustomersView } from '@/components/customers/customers-view';
import type { CustomerDetailResult, CustomersResult } from '@/lib/customers/service';

// The camera/upload control is exercised by its own tests; stub it here so the
// directory view stays focused on list/detail rendering (and needs no router).
vi.mock('@/components/attachments/photo-capture', () => ({
  PhotoCapture: () => null,
}));

const rows: CustomersResult = {
  ok: true,
  rows: [
    {
      id: 'c1',
      displayName: 'Ana Reyes',
      contactNumber: '0917 000 0001',
      isActive: true,
      sourceKind: 'native',
      createdAt: '2026-07-01T00:00:00Z',
    },
    {
      id: 'c2',
      displayName: 'Bea Lim',
      contactNumber: null,
      isActive: false,
      sourceKind: 'migrated',
      createdAt: '2026-07-02T00:00:00Z',
    },
  ],
};

describe('CustomersView list states', () => {
  it('surfaces a read error explicitly, never an empty table', () => {
    render(
      <CustomersView
        result={{ ok: false, reason: 'boom' }}
        query=""
        detail={null}
        selectedId={null}
        attachments={[]}
      />,
    );
    expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows a genuine empty state when there are no customers', () => {
    render(
      <CustomersView
        result={{ ok: true, rows: [] }}
        query=""
        detail={null}
        selectedId={null}
        attachments={[]}
      />,
    );
    expect(screen.getByText(/No customers yet/i)).toBeInTheDocument();
  });

  it('distinguishes "no matches" for a search from "no customers"', () => {
    render(
      <CustomersView
        result={{ ok: true, rows: [] }}
        query="zzz"
        detail={null}
        selectedId={null}
        attachments={[]}
      />,
    );
    expect(screen.getByText(/No matches/i)).toBeInTheDocument();
  });

  it('renders customers with a detail link each', () => {
    render(
      <CustomersView
        result={rows}
        query=""
        detail={null}
        selectedId={null}
        attachments={[]}
      />,
    );
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.getByText('Bea Lim')).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /view/i });
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('id=c1'));
  });
});

describe('CustomersView detail panel', () => {
  it('shows the customer with related orders and claims', () => {
    const detail: CustomerDetailResult = {
      ok: true,
      customer: {
        id: 'c1',
        displayName: 'Ana Reyes',
        contactNumber: '0917 000 0001',
        notes: 'VIP',
        isActive: true,
        sourceKind: 'native',
        createdAt: '2026-07-01T00:00:00Z',
      },
      orders: [
        {
          id: 'o1',
          orderNumber: 'ORD-2026-000101',
          invoiceNumber: 'INV-2026-000101',
          status: 'active_layaway',
          createdAt: '2026-07-03T00:00:00Z',
        },
      ],
      claims: [
        {
          id: 'cl1',
          claimReference: 'CLM-2026-000101',
          status: 'confirmed_claim',
          quantity: 2,
          createdAt: '2026-07-02T00:00:00Z',
        },
      ],
    };

    render(
      <CustomersView
        result={rows}
        query=""
        detail={detail}
        selectedId="c1"
        attachments={[]}
      />,
    );

    expect(screen.getByText('ORD-2026-000101')).toBeInTheDocument();
    expect(screen.getByText('CLM-2026-000101')).toBeInTheDocument();
    expect(screen.getByText(/Official Orders \(1\)/)).toBeInTheDocument();
    expect(screen.getByText(/Claims \(1\)/)).toBeInTheDocument();
  });

  it('shows a not-found state for a missing customer', () => {
    render(
      <CustomersView
        result={rows}
        query=""
        detail={{ ok: true, customer: null, orders: [], claims: [] }}
        selectedId="missing"
        attachments={[]}
      />,
    );
    expect(screen.getByText(/Customer not found/i)).toBeInTheDocument();
  });

  it('surfaces a detail read error explicitly', () => {
    render(
      <CustomersView
        result={rows}
        query=""
        detail={{ ok: false, reason: 'denied' }}
        selectedId="c1"
        attachments={[]}
      />,
    );
    expect(screen.getByText(/details could not be loaded/i)).toBeInTheDocument();
  });
});
