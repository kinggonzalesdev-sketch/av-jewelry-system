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
// Paid-order removal (Owner 2026-09-03). Forwards its args so a test can assert the exact
// (orderId, claimId, reason) sent, and returns a snapshot with an overpayment so the note path runs.
const paidRemove = vi.fn((..._a: unknown[]) =>
  Promise.resolve({
    ok: true as const,
    snapshot: {
      inventoryCode: 'SBA-R-2',
      previousTotal: '89908.00',
      newTotal: '63336.00',
      paid: '89908.00',
      overpaymentCredit: '26572.00',
      outstandingBalance: '0.00',
    },
  }),
);
vi.mock('@/lib/orders/actions', () => ({
  removeOrderItemAction: () => remove(),
  splitOrderItemAction: () => split(),
  addOrderItemAction: (...a: unknown[]) => add(...a),
  searchCaptureItemsAction: () => search(),
  requestOrderEditAction: () => requestEdit(),
  removePaidOrderItemAction: (...a: unknown[]) => paidRemove(...a),
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

// Paid-order item removal (Owner 2026-09-03). On a LOCKED/settled order the normal Edit-Items
// panel is gone; the Super Admin instead gets a separate "Remove Paid Item" panel that restocks
// the piece, recalculates the (derived) total, keeps payments, and surfaces any overpayment as a
// credit. A reason is mandatory. Admins/staff see nothing on a locked order.
describe('OrderItemEditControls — Remove Paid Item (locked / settled order)', () => {
  it('shows the paid-removal panel for an owner on a locked order (not the Edit-Items panel)', () => {
    renderControls({ status: 'completed' });
    expect(screen.getByTestId('order-paid-remove')).toBeInTheDocument();
    // The editable-order Edit Items / Add panel must NOT appear on a settled order.
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-paid-remove-claim-a')).toBeInTheDocument();
  });

  it('is hidden for a non-owner on a locked order', () => {
    renderControls({ status: 'completed', isOwner: false });
    expect(screen.queryByTestId('order-paid-remove')).not.toBeInTheDocument();
    expect(screen.queryByTestId('order-edit-items')).not.toBeInTheDocument();
  });

  it('on a single-item paid order, points to Cancel Order instead of offering Remove', () => {
    renderControls({ status: 'completed', items: [item()] });
    expect(screen.getByTestId('order-paid-remove')).toBeInTheDocument();
    expect(screen.getByText(/use Cancel Order/i)).toBeInTheDocument();
    expect(screen.queryByTestId('order-paid-remove-claim-a')).not.toBeInTheDocument();
  });

  it('requires a reason — confirming with an empty reason sends nothing and warns', () => {
    paidRemove.mockClear();
    renderControls({ status: 'completed' });
    fireEvent.click(screen.getByTestId('order-paid-remove-claim-a'));
    // The critical confirm modal is open; confirm with no reason.
    fireEvent.click(screen.getByTestId('order-paid-remove-confirm'));
    expect(paidRemove).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/reason is required/i);
  });

  it('with a reason: removes the item and surfaces the overpayment as a credit (never a refund)', async () => {
    paidRemove.mockClear();
    renderControls({ status: 'completed' });
    fireEvent.click(screen.getByTestId('order-paid-remove-claim-a'));
    fireEvent.change(screen.getByTestId('order-paid-remove-reason'), {
      target: { value: 'customer returned the ring' },
    });
    fireEvent.click(screen.getByTestId('order-paid-remove-confirm'));
    await vi.waitFor(() => expect(paidRemove).toHaveBeenCalledTimes(1));
    // Exact (orderId, claimId, reason) reaches the server action.
    expect(paidRemove).toHaveBeenCalledWith('o1', 'claim-a', 'customer returned the ring');
    // The success note reports the recalculated total + the overpayment CREDIT wording.
    const note = await screen.findByTestId('order-paid-remove-note');
    expect(note).toHaveTextContent(/overpaid/i);
    expect(note).toHaveTextContent(/credit/i);
    expect(note).toHaveTextContent('₱26,572');
  });
});
