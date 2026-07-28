import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderCancelAction } from '@/components/orders/order-cancel-action';

const requestCancel = vi.fn(() => Promise.resolve({ ok: true as const, changed: true }));
const finalizeCancel = vi.fn(() =>
  Promise.resolve({ ok: true as const, changed: true, returned: 1, kept: 0 }),
);
vi.mock('@/lib/orders/actions', () => ({
  requestOrderCancellationAction: () => requestCancel(),
  finalizeOrderCancellationAction: () => finalizeCancel(),
}));

function renderAction(status: string, isOwner = true) {
  return render(
    <OrderCancelAction
      orderId="o1"
      orderNumber="ORD-2026-000010"
      customerName="Ana Cruz"
      status={status}
      isOwner={isOwner}
      onDone={vi.fn()}
    />,
  );
}

describe('Cancel Order — where it appears', () => {
  it.each([
    'invoiced',
    'awaiting_required_payment',
    'required_payment_verified',
    'for_preparation',
    'for_shipping_or_pickup',
    'approved_for_release',
    'dispatched_or_picked_up',
    'for_layaway',
    'keep',
  ])('offers Cancel Order for an active order (%s)', (status) => {
    renderAction(status);
    expect(screen.getByTestId('order-cancel')).toHaveTextContent('Cancel Order');
  });

  it.each(['completed', 'cancelled'])('offers nothing for a %s order', (status) => {
    renderAction(status);
    expect(screen.queryByTestId('order-cancel')).not.toBeInTheDocument();
  });

  it('offers Finalize (not Cancel) once the order is already For Cancel', () => {
    renderAction('for_cancel');
    expect(screen.getByTestId('order-cancel')).toHaveTextContent('Finalize Cancellation');
  });

  it('only the Owner / Selected Admin may finalize', () => {
    renderAction('for_cancel', false);
    expect(screen.getByTestId('order-cancel')).toBeDisabled();
  });
});

describe('Cancel Order — the confirmation', () => {
  it('shows the order number and customer, and needs a reason AND the word CANCEL', () => {
    requestCancel.mockClear();
    renderAction('for_preparation');
    fireEvent.click(screen.getByTestId('order-cancel'));

    expect(screen.getByText('ORD-2026-000010')).toBeInTheDocument();
    expect(screen.getByText('Ana Cruz')).toBeInTheDocument();

    const confirmBtn = screen.getByTestId('order-cancel-confirm');
    expect(confirmBtn).toBeDisabled();

    // A reason alone is not enough.
    fireEvent.change(screen.getByPlaceholderText(/why is this order being cancelled/i), {
      target: { value: 'Customer changed their mind' },
    });
    expect(confirmBtn).toBeDisabled();

    // The wrong word is not enough either.
    fireEvent.change(screen.getByPlaceholderText('CANCEL'), { target: { value: 'cancel' } });
    expect(confirmBtn).toBeDisabled();

    // Exact word unlocks it.
    fireEvent.change(screen.getByPlaceholderText('CANCEL'), { target: { value: 'CANCEL' } });
    expect(confirmBtn).toBeEnabled();
  });

  it('offers Back, and does not cancel when the confirmation is incomplete', () => {
    requestCancel.mockClear();
    renderAction('for_preparation');
    fireEvent.click(screen.getByTestId('order-cancel'));
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('order-cancel-confirm'));
    expect(requestCancel).not.toHaveBeenCalled();
  });
});
