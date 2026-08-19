import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HistoricalScrapReport } from '@/components/scrap/historical-scrap-report';
import type {
  ScrapIncomeResult,
  ScrapSaleRow,
  ScrapTotal,
} from '@/lib/scrap/service';

/**
 * Historical Scrap Report (Req 15) — a READ-ONLY report of the pre-go-live scrap that is
 * deliberately excluded from the Daily Cash Summary. These tests lock that it (a) documents
 * WHY it is separate, (b) shows the SQL-summed grand total, and (c) can NEVER mutate scrap
 * (no Add / Edit / Delete — View only).
 */

const total: ScrapTotal = { totalAmount: '22177199.77', saleCount: 468 };

const income: ScrapIncomeResult = {
  ok: true,
  rows: [
    { material: 'gold', totalGrams: '1000', totalAmount: '22000000', saleCount: 460 },
    { material: 'silver', totalGrams: '500', totalAmount: '177199.77', saleCount: 8 },
  ],
};

const sales: ScrapSaleRow[] = [
  {
    id: 's1',
    material: 'gold',
    grams: '10',
    amount: '50000',
    buyer: 'Old Seller A',
    contact: '0917',
    paymentMethod: 'Cash',
    karat: '18K',
    perGram: '5000',
    soldOn: '2026-08-10',
    note: 'batch',
    encodedAt: null,
    encodedBy: 'King',
  },
  {
    id: 's2',
    material: 'silver',
    grams: '20',
    amount: '2000',
    buyer: 'Old Seller B',
    contact: null,
    paymentMethod: 'Cash',
    karat: '925',
    perGram: '100',
    soldOn: '2026-08-09',
    note: null,
    encodedAt: null,
    encodedBy: 'King',
  },
];

function renderReport(
  opts: { income?: ScrapIncomeResult; sales?: ScrapSaleRow[] } = {},
) {
  return render(
    <HistoricalScrapReport
      total={total}
      income={opts.income ?? income}
      sales={opts.sales ?? sales}
      cutoffLabel="August 17, 2026"
    />,
  );
}

describe('HistoricalScrapReport (Req 15 — read-only pre-go-live scrap)', () => {
  it('documents WHY it is separate from Daily Cash', () => {
    renderReport();
    expect(
      screen.getByRole('heading', { name: 'Historical Scrap Report' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/excluded from the Daily Cash Summary/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/August 17, 2026/)).toBeInTheDocument();
  });

  it('shows the SQL-summed grand total + sale count', () => {
    renderReport();
    const totals = screen.getByTestId('scrap-historical-totals');
    expect(
      within(totals).getByText(/Total Historical Scrap — 468 sale\(s\)/),
    ).toBeInTheDocument();
    expect(
      within(totals).getByText((c) => c.includes('22,177,199.77')),
    ).toBeInTheDocument();
  });

  it('lists the historical transactions', () => {
    renderReport();
    expect(screen.getByText('Old Seller A')).toBeInTheDocument();
    expect(screen.getByText('Old Seller B')).toBeInTheDocument();
  });

  it('is READ-ONLY — no Add / Edit / Delete, only View', () => {
    renderReport();
    expect(screen.queryByText('＋ Add New')).not.toBeInTheDocument();
    expect(screen.queryByText('Edit')).not.toBeInTheDocument();
    expect(screen.queryByText('Delete')).not.toBeInTheDocument();
    // Each grouped row exposes a read-only View.
    expect(screen.getAllByText('View').length).toBe(2);
  });

  it('offers CSV export and a link back to the live Scrap page', () => {
    renderReport();
    expect(screen.getByTestId('scrap-historical-export')).toBeInTheDocument();
    expect(screen.getByTestId('scrap-historical-back')).toHaveAttribute(
      'href',
      '/admin/scrap',
    );
  });

  it('still shows the grand total when the per-material breakdown fails to read', () => {
    renderReport({ income: { ok: false } });
    expect(
      screen.getByText((c) => c.includes('22,177,199.77')),
    ).toBeInTheDocument();
    expect(screen.getByText(/Breakdown unavailable/i)).toBeInTheDocument();
  });
});
