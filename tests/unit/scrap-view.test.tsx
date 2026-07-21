import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ScrapView } from '@/components/scrap/scrap-view';
import type { ScrapIncomeResult, ScrapSaleRow } from '@/lib/scrap/service';

vi.mock('@/lib/scrap/actions', () => ({ recordScrapAction: vi.fn() }));

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
  },
];

describe('ScrapView', () => {
  it('shows scrap income per material (summed in SQL)', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    const summary = screen.getByTestId('scrap-income');
    expect(within(summary).getByText('₱30,000.00')).toBeInTheDocument();
    expect(within(summary).getByText('₱1,500.00')).toBeInTheDocument();
  });

  it('offers a record form with material, grams, and amount', () => {
    render(<ScrapView income={income} sales={sales} from="2026-07-01" to="2026-07-18" />);
    expect(screen.getByLabelText('Material')).toBeInTheDocument();
    expect(screen.getByLabelText('Grams')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount (₱)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /record scrap sale/i }),
    ).toBeInTheDocument();
  });

  it('shows an explicit error, not ₱0, when income could not be read', () => {
    render(
      <ScrapView income={{ ok: false }} sales={[]} from="2026-07-01" to="2026-07-18" />,
    );
    expect(screen.getByText(/Scrap income unavailable/i)).toBeInTheDocument();
  });
});
