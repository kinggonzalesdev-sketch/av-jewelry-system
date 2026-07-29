import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScrapView } from '@/components/scrap/scrap-view';
import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';

vi.mock('@/lib/scrap/actions', () => ({
  recordScrapAction: vi.fn(),
  deleteScrapSaleAction: vi.fn(),
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

  it('opens a modal with material, grams, and amount fields', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    // The record form is not inline — it lives in the standard centered dialog.
    expect(screen.queryByLabelText('Material')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /record scrap sale/i }));

    expect(screen.getByTestId('modal')).toBeInTheDocument();
    expect(screen.getByLabelText('Material')).toBeInTheDocument();
    expect(screen.getByLabelText('Grams')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount')).toBeInTheDocument();
  });

  it('shows an explicit error, not ₱0, when income could not be read', () => {
    render(
      <ScrapView income={{ ok: false }} sales={[]} from="2026-07-01" to="2026-07-18" />,
    );
    expect(screen.getByText(/Scrap income unavailable/i)).toBeInTheDocument();
  });
});
