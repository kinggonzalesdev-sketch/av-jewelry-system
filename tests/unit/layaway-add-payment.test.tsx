import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LedgerAddPayment } from '@/components/payments/layaway-ledger-actions';

// Server actions are transport; stub them so the client control renders in jsdom.
const addPayment = vi.fn(() =>
  Promise.resolve({ ok: true as const, payment: '0', balance: '0', status: 'active' }),
);
vi.mock('@/lib/payments/actions', () => ({
  addLayawayLedgerPaymentAction: () => addPayment(),
  loadLayawayLedgerDetailAction: vi.fn(),
  updateLayawayLedgerAccountAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

function renderControl(grandTotal: string | null, paidToDate: string | null) {
  return render(
    <LedgerAddPayment
      id="lay-1"
      accountNo="LAY-2026-000001"
      customerName="Ana Cruz"
      grandTotal={grandTotal}
      paidToDate={paidToDate}
    />,
  );
}

/** Open the modal and type an amount into the money field. */
function openAndType(amount: string) {
  fireEvent.click(screen.getByTestId('ledger-add-payment-lay-1'));
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });
}

describe('Layaway Add Payment — remaining balance', () => {
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

  it('disables Add Payment entirely once the account is fully paid', () => {
    renderControl('20000.00', '20000.00');
    const button = screen.getByTestId('ledger-add-payment-lay-1');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', 'This layaway account is already fully paid.');
  });

  it('does not submit an invalid payment to the server', () => {
    addPayment.mockClear();
    renderControl('20000.00', '13000.00');
    openAndType('9999');
    fireEvent.click(screen.getByRole('button', { name: /record payment/i }));
    expect(addPayment).not.toHaveBeenCalled();
  });
});
