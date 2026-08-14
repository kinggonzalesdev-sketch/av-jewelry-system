import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';

// The view modal now uses the app router (for the post-complete refresh) — stub it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const loadMock = vi.fn<(id: string) => Promise<LayawayLedgerDetail | null>>();
vi.mock('@/lib/payments/actions', () => ({
  loadLayawayLedgerDetailAction: (id: string) => loadMock(id),
  completeLayawayLedgerAction: vi.fn(() => Promise.resolve({ ok: true })),
}));

function detail(over: Partial<LayawayLedgerDetail> = {}): LayawayLedgerDetail {
  return {
    id: 'L1',
    code: 'A5',
    uniqueCode: 'SBA-N-2683',
    sourceKind: 'manual',
    accountNo: 'LAY-2026-000101',
    customerName: 'Abby Santos',
    status: 'active',
    remarks: null,
    datePurchased: '2026-06-19',
    itemAmount: '50000.00',
    interest: '1875.00',
    grandTotal: '51875.00',
    payment: '0.00',
    balance: '51875.00',
    balanceMismatch: false,
    nextDueDate: '2026-07-19',
    monthlyInterest: '1875.00',
    totalInstallmentInterest: '1875.00',
    lastPaymentDate: null,
    modeOfPayment: null,
    latestPaymentDp: null,
    resize: null,
    screw: null,
    notes: null,
    interestType: 'custom',
    layawayTerm: 3,
    interestRate: null,
    fixedInterest: null,
    perGram: {
      grams: '12.5',
      monthlyInterest: '1875.00',
      interestCharged: '1875.00',
      chargesCount: 1,
      nextInterestDate: '2026-07-19',
      remainingMonths: 2,
      term: 3,
    },
    installments: [],
    payments: [],
    items: [],
    ...over,
  };
}

async function openView(d: LayawayLedgerDetail) {
  loadMock.mockResolvedValueOnce(d);
  render(<LayawayLedgerViewModal ledgerId={d.id} />);
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect(screen.getByTestId('layaway-view-pergram')).toBeInTheDocument(),
  );
}

describe('Layaway View — per-gram interest block', () => {
  it('shows Grams, Monthly Interest, Interest Already Charged, Next Date, Remaining, Term', async () => {
    await openView(detail());
    const block = screen.getByTestId('layaway-view-pergram');
    expect(within(block).getByText('Grams')).toBeInTheDocument();
    expect(within(block).getByText('12.5g')).toBeInTheDocument();
    expect(within(block).getByText(/Interest Already Charged/i)).toBeInTheDocument();
    expect(within(block).getByText(/Next Interest Date/i)).toBeInTheDocument();
    expect(within(block).getByText(/Remaining Possible Months/i)).toBeInTheDocument();
    expect(within(block).getByText('2')).toBeInTheDocument();
    // ₱1,875 appears for both monthly interest and interest already charged.
    expect(within(block).getAllByText('₱1,875').length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT render the per-gram block for a legacy/imported account', async () => {
    await new Promise<void>((resolve) => {
      loadMock.mockResolvedValueOnce(detail({ perGram: null }));
      render(<LayawayLedgerViewModal ledgerId="L2" />);
      fireEvent.click(screen.getByRole('button'));
      void waitFor(() =>
        expect(screen.getByText('Abby Santos')).toBeInTheDocument(),
      ).then(() => resolve());
    });
    expect(screen.queryByTestId('layaway-view-pergram')).not.toBeInTheDocument();
  });
});
