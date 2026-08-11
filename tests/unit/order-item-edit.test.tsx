import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderItemEditControls } from '@/components/orders/order-item-edit';
import type { OrderLineItemDetail } from '@/lib/orders/detail-types';

const remove = vi.fn(() => Promise.resolve({ ok: true as const }));
const split = vi.fn(() => Promise.resolve({ ok: true as const, orderNumber: 'ORD-2026-000999' }));
vi.mock('@/lib/orders/actions', () => ({
  removeOrderItemAction: () => remove(),
  splitOrderItemAction: () => split(),
}));

function item(over: Partial<OrderLineItemDetail> = {}): OrderLineItemDetail {
  return {
    claimId: 'claim-a',
    claimReference: 'CLM-A',
    itemName: 'Ring',
    itemCode: 'SBA-R-1',
    gramsPerPiece: '5',
    quantity: 1,
    unitPrice: '1000.00',
    ...over,
  };
}

const twoItems = [item(), item({ claimId: 'claim-b', claimReference: 'CLM-B', itemCode: 'SBA-R-2' })];

function renderControls(over?: {
  status?: string;
  items?: OrderLineItemDetail[];
  isOwner?: boolean;
}) {
  return render(
    <OrderItemEditControls
      orderId="o1"
      status={over?.status ?? 'for_preparation'}
      items={over?.items ?? twoItems}
      isOwner={over?.isOwner ?? true}
      onRefresh={vi.fn()}
    />,
  );
}

describe('OrderItemEditControls — Edit Items (Super Admin)', () => {
  it('shows Remove + Split per item for an owner on an editable multi-item order', () => {
    renderControls();
    expect(screen.getByTestId('order-edit-items')).toBeInTheDocument();
    expect(screen.getByTestId('order-item-remove-claim-a')).toBeInTheDocument();
    expect(screen.getByTestId('order-item-split-claim-b')).toBeInTheDocument();
  });

  it('is hidden for a non-owner', () => {
    renderControls({ isOwner: false });
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
  });

  it('is hidden on a locked status (e.g. completed / dispatched)', () => {
    renderControls({ status: 'completed' });
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
  });

  it('is hidden when only one item remains (that is Cancel Order, not edit)', () => {
    renderControls({ items: [item()] });
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
  });

  it('Remove asks to confirm, then calls the action', () => {
    remove.mockClear();
    renderControls();
    fireEvent.click(screen.getByTestId('order-item-remove-claim-a'));
    // Confirm dialog appears; nothing has been called yet.
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('order-item-edit-confirm'));
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
