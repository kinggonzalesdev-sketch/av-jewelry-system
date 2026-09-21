import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LedgerAddPayment } from '@/components/payments/layaway-ledger-actions';

// Server actions are transport; stub them so the client control renders in jsdom.
const mocks = vi.hoisted(() => ({
  addPayment: vi.fn(() =>
    Promise.resolve({ ok: true as const, payment: '0', balance: '0', status: 'active' }),
  ),
  addPaymentAndTransfer: vi.fn(),
  forfeitLayaway: vi.fn((_id: string) =>
    Promise.resolve({ ok: true as const, status: 'forfeited' as const }),
  ),
}));
vi.mock('@/lib/payments/actions', () => ({
  addLayawayLedgerPaymentAction: () => mocks.addPayment(),
  addLayawayPaymentAndTransferAction: mocks.addPaymentAndTransfer,
  forfeitLayawayLedgerAction: (id: string) => mocks.forfeitLayaway(id),
  transferLayawayToDestinationAction: vi.fn(),
  loadLayawayLedgerDetailAction: vi.fn(),
  updateLayawayLedgerAccountAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderControl(
  grandTotal: string | null,
  paidToDate: string | null,
  canForfeit = false,
) {
  return render(
    <LedgerAddPayment
      id="lay-1"
      accountNo="LAY-2026-000001"
      customerName="Ana Cruz"
      grandTotal={grandTotal}
      paidToDate={paidToDate}
      canForfeit={canForfeit}
    />,
  );
}

/** Open the modal and type an amount into the money field. */
function openAndType(amount: string) {
  fireEvent.click(screen.getByTestId('ledger-add-payment-lay-1'));
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });
}

describe('Layaway Add Payment — remaining balance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows Remaining Balance as Grand Total minus Total Payments', () => {
    renderControl('20000.00', '13000.00');
    fireEvent.click(screen.getByTestId('ledger-add-payment-lay-1'));
    // 20,000 - 13,000 = 7,000 (exact centavos, never a float).
    expect(screen.getByTestId('ledger-payment-remaining')).toHaveTextContent('₱7,000');
  });

  it('refuses a payment that exceeds the remaining balance, with the amount named', () => {
    renderControl('20000.00', '13000.00');
    openAndType('7000.01');

    expect(
      screen.getByText('Payment exceeds the remaining balance of ₱7,000.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record payment/i })).toBeDisabled();
  });

  it('accepts a payment up to exactly the remaining balance', () => {
    renderControl('20000.00', '13000.00');
    openAndType('7000');

    expect(screen.queryByText(/exceeds the remaining balance/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record payment/i })).toBeEnabled();
  });

  it('rejects zero and never enables submit for it', () => {
    renderControl('20000.00', '13000.00');
    openAndType('0');

    expect(
      screen.getByText('Enter a payment amount greater than zero.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /record payment/i })).toBeDisabled();
  });

  it('replaces Add Payment with a Transfer control once the account is fully paid', () => {
    renderControl('20000.00', '20000.00');
    const button = screen.getByTestId('ledger-add-payment-lay-1');
    // A fully-paid account no longer auto-completes: the trigger becomes "Transfer"
    // and opens the ✓ notice + Transfer-to-Destination control (no new payment).
    expect(button).toBeEnabled();
    expect(button).toHaveTextContent('Transfer');
    fireEvent.click(button);
    expect(screen.getByTestId('ledger-payment-fully-paid')).toBeInTheDocument();
  });

  it('does not submit an invalid payment to the server', () => {
    renderControl('20000.00', '13000.00');
    openAndType('9999');
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));
    expect(mocks.addPayment).not.toHaveBeenCalled();
  });

  it('confirms FORFEITED through the dedicated action exactly once', async () => {
    renderControl('20000.00', '20000.00', true);
    fireEvent.click(screen.getByTestId('ledger-add-payment-lay-1'));

    const destination = screen.getByTestId('ledger-pay-dest-lay-1');
    const forfeitedOption = within(destination).getByRole('option', {
      name: 'FORFEITED',
    });
    expect(forfeitedOption).toHaveValue('forfeited');

    fireEvent.change(destination, { target: { value: 'forfeited' } });
    fireEvent.click(screen.getByTestId('ledger-pay-save-lay-1'));

    expect(
      screen.getByRole('heading', { name: 'Mark this layaway as FORFEITED?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'The item will return to Available Inventory and the Layaway Code will become available for reuse. This action will be recorded in the layaway history.',
      ),
    ).toBeInTheDocument();

    const confirm = screen.getByRole('button', { name: 'Confirm Forfeiture' });
    expect(confirm).toHaveClass('bg-destructive');
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.forfeitLayaway).toHaveBeenCalledTimes(1));
    expect(mocks.forfeitLayaway).toHaveBeenCalledWith('lay-1');
    expect(mocks.addPaymentAndTransfer).not.toHaveBeenCalled();
  });
});
