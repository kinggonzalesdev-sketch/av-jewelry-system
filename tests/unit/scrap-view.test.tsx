import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScrapView } from '@/components/scrap/scrap-view';
import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';

vi.mock('@/lib/scrap/actions', () => ({
  recordScrapAction: vi.fn(),
  recordScrapSalesAction: vi.fn(),
  updateScrapSaleAction: vi.fn(),
  deleteScrapSaleAction: vi.fn(),
  requestScrapDeletionAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const income: ScrapIncomeResult = {
  ok: true,
  rows: [
    { material: 'gold', totalGrams: '12.500', totalAmount: '30000.00', saleCount: 2 },
    { material: 'silver', totalGrams: '5.000', totalAmount: '1500.00', saleCount: 1 },
  ],
};

const sales: ScrapSaleRow[] = [
  {
    id: 's1',
    material: 'gold',
    grams: '5.500',
    amount: '12000.00',
    buyer: 'Buyer A',
    contact: '0917 123 4567',
    paymentMethod: 'GCash',
    karat: '18K',
    perGram: '2000.00',
    soldOn: '2026-07-18',
    note: null,
    encodedAt: '2026-07-18T02:30:00.000Z',
    encodedBy: 'King Gonzales',
  },
];

describe('ScrapView', () => {
  it('shows scrap income per material (summed in SQL)', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    const summary = screen.getByTestId('scrap-income');
    expect(within(summary).getByText('₱30,000')).toBeInTheDocument();
    expect(within(summary).getByText('₱1,500')).toBeInTheDocument();
  });

  it('opens the multi-item entry with Customer Name + per-item fields and Add Item', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    // The record form is not inline — it lives in the standard centered dialog.
    expect(screen.queryByLabelText('Material')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('scrap-record-open'));

    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByLabelText('Customer Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Material')).toBeInTheDocument();
    expect(screen.getByLabelText('Karat')).toBeInTheDocument();
    expect(screen.getByLabelText('Grams')).toBeInTheDocument();
    expect(screen.getByLabelText('Per Gram (₱)')).toBeInTheDocument();
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
    expect(screen.getByTestId('scrap-add-item')).toBeInTheDocument();
  });

  it('adds another item row when Add Item is clicked', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    fireEvent.click(screen.getByTestId('scrap-record-open'));
    expect(screen.getByTestId('scrap-item-0')).toBeInTheDocument();
    expect(screen.queryByTestId('scrap-item-1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('scrap-add-item'));
    expect(screen.getByTestId('scrap-item-1')).toBeInTheDocument();
  });

  it('groups a customer into one row; the Owner View lists the pieces with Edit/Delete', () => {
    render(
      <ScrapView
        income={income}
        sales={sales}
        from="2026-07-01"
        to="2026-07-18"
        canDelete
        isOwner
      />,
    );
    // One grouped row for Buyer A (key = "<buyer> <soldOn>").
    expect(screen.getByText('Buyer A')).toBeInTheDocument();
    // Per-item Edit / Delete live INSIDE the grouped View, not on the table row.
    expect(screen.queryByTestId('scrap-edit-s1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('scrap-group-body')).toBeInTheDocument();
    expect(screen.getByTestId('scrap-edit-s1')).toBeInTheDocument();
    // The Owner deletes directly.
    expect(screen.getByTestId('scrap-delete-s1')).toBeInTheDocument();
  });

  it('a non-owner Admin sees Request delete (Owner approval), not a direct Delete', () => {
    render(
      <ScrapView
        income={income}
        sales={sales}
        from="2026-07-01"
        to="2026-07-18"
        canDelete
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('scrap-group-body')).toBeInTheDocument();
    // Edit stays; Delete is replaced by a Request-delete (routes to the Owner).
    expect(screen.getByTestId('scrap-edit-s1')).toBeInTheDocument();
    expect(screen.queryByTestId('scrap-delete-s1')).not.toBeInTheDocument();
    expect(screen.getByTestId('scrap-request-delete-s1')).toBeInTheDocument();
  });

  it('hides per-item Edit / Delete inside the View when not allowed', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(screen.getByTestId('scrap-group-body')).toBeInTheDocument();
    expect(screen.queryByTestId('scrap-edit-s1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('scrap-delete-s1')).not.toBeInTheDocument();
  });

  it('shows an explicit error, not ₱0, when income could not be read', () => {
    render(
      <ScrapView income={{ ok: false }} sales={[]} from="2026-07-01" to="2026-07-18" />,
    );
    expect(screen.getByText(/Scrap income unavailable/i)).toBeInTheDocument();
  });
});
