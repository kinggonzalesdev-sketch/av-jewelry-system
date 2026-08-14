import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrderItemEditControls } from '@/components/orders/order-item-edit';
import type { OrderLineItemDetail } from '@/lib/orders/detail-types';
import type { CaptureItem } from '@/lib/orders/service';

const remove = vi.fn(() => Promise.resolve({ ok: true as const }));
const split = vi.fn(() =>
  Promise.resolve({ ok: true as const, orderNumber: 'ORD-2026-000999' }),
);
// `add` forwards its args so a test can assert the exact unit price sent to the DB.
const add = vi.fn((..._a: unknown[]) =>
  Promise.resolve({ ok: true as const, total: '2000.00' }),
);
const search = vi.fn((): Promise<CaptureItem[]> => Promise.resolve([]));
const requestEdit = vi.fn(() => Promise.resolve({ ok: true as const }));
vi.mock('@/lib/orders/actions', () => ({
  removeOrderItemAction: () => remove(),
  splitOrderItemAction: () => split(),
  addOrderItemAction: (...a: unknown[]) => add(...a),
  searchCaptureItemsAction: () => search(),
  requestOrderEditAction: () => requestEdit(),
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

const twoItems = [
  item(),
  item({ claimId: 'claim-b', claimReference: 'CLM-B', itemCode: 'SBA-R-2' }),
];

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

  it('keeps the Add Item panel but hides Remove/Split when only one item remains', () => {
    renderControls({ items: [item()] });
    // The panel stays — you can still ADD an item — but Remove/Split are gone; removing
    // the last item is Cancel Order, not an edit.
    expect(screen.getByTestId('order-edit-items')).toBeInTheDocument();
    // Multi-item Add panel (Owner 2026-08-13): Item 1's inventory search is present.
    expect(screen.getByTestId('add-item-search-0')).toBeInTheDocument();
    expect(screen.queryByTestId('order-item-remove-claim-a')).not.toBeInTheDocument();
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

  it('request mode (admin): needs a reason, then creates an approval request', () => {
    requestEdit.mockClear();
    render(
      <OrderItemEditControls
        orderId="o1"
        status="for_preparation"
        items={twoItems}
        isOwner={false}
        canRequestEdit
        onRefresh={vi.fn()}
      />,
    );
    // Admin sees the panel (not owner-only) with "Request …" controls.
    expect(screen.getByTestId('order-edit-items')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('order-item-remove-claim-a'));
    // No reason yet → the request is refused (nothing sent).
    fireEvent.click(screen.getByTestId('order-item-edit-confirm'));
    expect(requestEdit).not.toHaveBeenCalled();
    // With a reason it creates the pending request.
    fireEvent.change(screen.getByTestId('order-item-edit-reason'), {
      target: { value: 'customer changed mind' },
    });
    fireEvent.click(screen.getByTestId('order-item-edit-confirm'));
    expect(requestEdit).toHaveBeenCalledTimes(1);
  });

  it('is hidden for a plain staff member (no owner, no request permission)', () => {
    render(
      <OrderItemEditControls
        orderId="o1"
        status="for_preparation"
        items={twoItems}
        isOwner={false}
        canRequestEdit={false}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
  });

  // The Add panel now matches New Order Entry: a Fixed Price / Price Per Gram toggle + an
  // editable Grams field. Per-Gram mode must add grams × rate (via the SHARED centavo
  // math), NOT the Fixed prefill — so the two forms price an item identically.
  it('Add panel — Price Per Gram: adds grams × rate as the item price', async () => {
    add.mockClear();
    // The debounced Active-Inventory search returns one weighable item (2g, catalogue
    // ₱1,000 — deliberately DIFFERENT from the per-gram result so the assertion proves
    // per-gram math ran instead of the fixed prefill).
    search.mockResolvedValueOnce([
      {
        id: 'inv-1',
        itemCode: 'SBA-R-9',
        itemName: 'Ring',
        unitPrice: '1000.00',
        gramsPerPiece: '2',
        availabilityStatus: 'available',
      },
    ]);
    renderControls({ items: [item()] });

    // Search → pick the item (prefills Fixed price + grams=2 from the item).
    fireEvent.change(screen.getByTestId('add-item-search-0'), {
      target: { value: 'SBA-R-9' },
    });
    fireEvent.click(await screen.findByTestId('order-add-item-pick-inv-1'));

    // Switch to Price Per Gram and enter ₱750/g → 2g × 750 = ₱1,500.
    fireEvent.click(screen.getByTestId('add-item-mode-per_gram-0'));
    fireEvent.change(screen.getByTestId('add-item-pergram-0'), {
      target: { value: '750' },
    });
    expect(screen.getByTestId('add-item-line-0')).toHaveTextContent('₱1,500');
    expect(screen.getByTestId('add-item-total')).toHaveTextContent('₱1,500');

    // Confirm → addOrderItemAction(orderId, itemId, unitPrice, qty). The unit price is the
    // computed grams × rate ('1500.00'), not the '1000.00' Fixed prefill.
    fireEvent.click(screen.getByTestId('order-add-item-confirm'));
    await vi.waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('o1', 'inv-1', '1500.00', 1);
  });
});
