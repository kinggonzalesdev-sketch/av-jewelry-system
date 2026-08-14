import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';
import type { LayawayLedgerDetail } from '@/lib/payments/layaway-ledger';

// The View modal refreshes via the app router after a complete/transfer — stub it.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const loadMock = vi.fn<(id: string) => Promise<LayawayLedgerDetail | null>>();
// LedgerAddPayment (rendered inside the modal) imports these; only load/complete
// run during render, but stub all so nothing is undefined.
vi.mock('@/lib/payments/actions', () => ({
  loadLayawayLedgerDetailAction: (id: string) => loadMock(id),
  completeLayawayLedgerAction: vi.fn(() => Promise.resolve({ ok: true })),
  cancelLayawayLedgerAction: vi.fn(() => Promise.resolve({ ok: true })),
  addLayawayLedgerPaymentAction: vi.fn(),
  addLayawayPaymentAndTransferAction: vi.fn(),
  transferLayawayToDestinationAction: vi.fn(),
  updateLayawayLedgerAccountAction: vi.fn(),
}));

function detail(over: Partial<LayawayLedgerDetail> = {}): LayawayLedgerDetail {
  return {
    id: 'L1',
    code: 'A1',
    uniqueCode: null,
    sourceKind: null,
    accountNo: 'LAY-2026-000101',
    customerName: 'Allyn Mae',
    status: 'active',
    remarks: null,
    datePurchased: '2026-06-12',
    itemAmount: '22530.00',
    interest: '0.00',
    grandTotal: '22530.00',
    payment: '11280.00',
    balance: '11250.00',
    balanceMismatch: false,
    nextDueDate: '2026-07-12',
    monthlyInterest: '0.00',
    totalInstallmentInterest: '0.00',
    lastPaymentDate: '2026-06-24',
    modeOfPayment: 'BPI',
    latestPaymentDp: '6280.00',
    resize: null,
    screw: null,
    notes: null,
    interestType: 'zero',
    layawayTerm: 3,
    interestRate: null,
    fixedInterest: null,
    perGram: null,
    installments: [],
    payments: [
      {
        sequence: 1,
        paymentDate: '2026-06-12',
        amount: '5000.00',
        mop: 'BPI',
        reference: null,
        receivedBy: null,
      },
      {
        sequence: 2,
        paymentDate: '2026-06-24',
        amount: '6280.00',
        mop: 'BPI',
        reference: null,
        receivedBy: null,
      },
    ],
    items: [],
    ...over,
  };
}

async function openView(d: LayawayLedgerDetail, canAddPayment: boolean) {
  loadMock.mockResolvedValueOnce(d);
  render(<LayawayLedgerViewModal ledgerId={d.id} canAddPayment={canAddPayment} />);
  fireEvent.click(screen.getByTestId(`ledger-view-${d.id}`));
  await waitFor(() =>
    expect(screen.getByTestId('ledger-account-summary')).toBeInTheDocument(),
  );
}

describe('Layaway View — Add Payment moved inside, Order-Summary layout', () => {
  it('shows the Account Summary card and Payment History section', async () => {
    await openView(detail(), false);
    // Orders-style summary card + the bottom Payment History section both render.
    expect(screen.getByTestId('ledger-account-summary')).toBeInTheDocument();
    expect(screen.getByText('Payment History')).toBeInTheDocument();
    // A couple of the summary facts land in the card.
    expect(screen.getByText('Allyn Mae')).toBeInTheDocument();
    expect(screen.getByText('Grand Total')).toBeInTheDocument();
  });

  it('renders Add Payment INSIDE the View modal when the caller allows it', async () => {
    await openView(detail(), true);
    // The Add Payment trigger now lives in the modal (not the table row).
    const addPayment = screen.getByTestId('ledger-add-payment-L1');
    expect(addPayment).toBeInTheDocument();
    expect(addPayment).toHaveTextContent('Add Payment');
  });

  it('shows Cancel Order beside Add Payment, and the Unique Code in the summary', async () => {
    await openView(detail({ uniqueCode: 'SBA-N-2683' }), true);
    expect(screen.getByTestId('ledger-cancel-L1')).toHaveTextContent('Cancel Order');
    // Unique Code was moved into the Account Summary card.
    expect(screen.getByText('Unique Code')).toBeInTheDocument();
    expect(screen.getByText('SBA-N-2683')).toBeInTheDocument();
  });

  it('labels an imported no-item account "Imported (no item)" instead of "Not linked"', async () => {
    // Legacy amount-only import: no inventory Unique Code was ever captured, so the scary
    // "Not linked" is replaced with a clear legacy marker.
    await openView(detail({ uniqueCode: null, sourceKind: 'imported' }), true);
    expect(screen.getByText('Imported (no item)')).toBeInTheDocument();
    expect(screen.queryByText('Not linked')).not.toBeInTheDocument();
  });

  it('still shows "Not linked" for a non-imported account with no item', async () => {
    await openView(detail({ uniqueCode: null, sourceKind: 'manual' }), true);
    expect(screen.getByText('Not linked')).toBeInTheDocument();
    expect(screen.queryByText('Imported (no item)')).not.toBeInTheDocument();
  });

  it('does NOT show Add Payment / Cancel Order inside View when the caller disallows it', async () => {
    await openView(detail(), false);
    expect(screen.queryByTestId('ledger-add-payment-L1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ledger-cancel-L1')).not.toBeInTheDocument();
  });

  it('hides Add Payment for a terminal (completed) account even when allowed', async () => {
    await openView(detail({ status: 'completed' }), true);
    expect(screen.queryByTestId('ledger-add-payment-L1')).not.toBeInTheDocument();
  });
});
