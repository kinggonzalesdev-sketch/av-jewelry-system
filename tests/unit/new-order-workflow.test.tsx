import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';

// The capture action is transport (tested via the live/capture suites); the photo
// control is exercised by its own tests. Stub both so this focuses on the
// workflow + form structure.
vi.mock('@/lib/orders/actions', () => ({
  captureManualOrderAction: vi.fn(),
  captureWalkInOrderAction: vi.fn(),
  recordOrderPrintAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/components/attachments/photo-capture', () => ({
  PhotoCapture: () => <div data-testid="photo-capture-stub" />,
}));

const customers = [
  { id: 'c1', displayName: 'Ana Cruz' },
  { id: 'c2', displayName: 'Ben Santos' },
];
const items: CaptureItem[] = [
  {
    id: 'i1',
    itemCode: 'UAT-M01',
    itemName: 'Bangle',
    unitPrice: '8000.00',
    gramsPerPiece: '5.5',
    availabilityStatus: 'available',
  },
];

const walkInItems: WalkInItem[] = [
  { id: 'w1', itemCode: 'SBA-R-2276', facebookName: 'Ring', grams: '1.65' },
];

function renderWorkflow(canCreate = true) {
  return render(
    <NewOrderWorkflow
      customers={customers}
      items={items}
      walkInItems={walkInItems}
      canCreate={canCreate}
      shopName="A.V. Jewelry"
      salesperson="UAT Owner"
    />,
  );
}

describe('NewOrderWorkflow — the New Order control', () => {
  it('renders only New Order (the Invoice/Confirm/Layaway shortcuts were removed)', () => {
    renderWorkflow();
    expect(screen.getByTestId('orders-new-order')).toBeInTheDocument();
    // The removed shortcut buttons must not reappear — the sidebar owns that nav.
    expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Layaway' })).not.toBeInTheDocument();
  });

  it('disables New Order without the capture permission', () => {
    renderWorkflow(false);
    expect(screen.getByTestId('orders-new-order')).toBeDisabled();
  });
});

describe('NewOrderWorkflow — the New Order form', () => {
  it('opens the approved form with real customers and items', () => {
    renderWorkflow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('orders-new-order'));

    const dialog = screen.getByRole('dialog', { name: /new order/i });
    expect(dialog).toBeInTheDocument();
    // Session identity, read-only.
    expect(screen.getByDisplayValue('A.V. Jewelry')).toBeInTheDocument();
    expect(screen.getByDisplayValue('UAT Owner')).toBeInTheDocument();
    // Pick-or-type comboboxes, backed by real customer + item suggestions.
    const customerBox = screen.getByPlaceholderText(/select a customer/i);
    const itemBox = screen.getByPlaceholderText(/select an item/i);
    expect(customerBox).toBeInTheDocument();
    expect(itemBox).toBeInTheDocument();
    // Focusing a combobox reveals ALL its options (not filtered until you type) —
    // this is the fix for "the list won't reopen once a value is selected".
    fireEvent.focus(customerBox);
    expect(screen.getByRole('option', { name: 'Ana Cruz' })).toBeInTheDocument();
    fireEvent.focus(itemBox);
    expect(screen.getByRole('option', { name: 'UAT-M01 — Bangle' })).toBeInTheDocument();
    expect(screen.getByText(/saves the order to For Invoice/i)).toBeInTheDocument();
    // Confirm saves first, then prints the label (browser dialog when no BLE printer).
    expect(screen.getByText(/print dialog/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reprint last/i })).toBeInTheDocument();
  });

  it('switches to Walk In mode with an inventory selector, price, MOP, and date', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('orders-new-order'));

    // The mode toggle exists and Walk In swaps the form.
    fireEvent.click(screen.getByTestId('mode-walkin'));

    const form = document.getElementById('walkin-form');
    expect(form).toBeInTheDocument();
    // Item is a searchable inventory selector; the permanent item ID is submitted
    // (not a free-typed name). Grams is read-only (synced) — no submittable name.
    for (const name of ['customerName', 'inventoryItemId', 'price', 'paymentMethod', 'saleDate']) {
      expect(form?.querySelector(`[name="${name}"]`)).toBeInTheDocument();
    }
    expect(form?.querySelector('[name="itemName"]')).not.toBeInTheDocument();
    expect(form?.querySelector('[name="grams"]')).not.toBeInTheDocument();
    // The inventory combobox offers the available item as "CODE — Facebook Name".
    fireEvent.focus(screen.getByPlaceholderText(/Search Active Inventory/i));
    expect(screen.getByRole('option', { name: 'SBA-R-2276 — Ring' })).toBeInTheDocument();

    expect(screen.getByText(/fully-paid, Completed/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Accept — Complete Sale/i }),
    ).toBeInTheDocument();
  });

  it('syncs Grams (read-only) and stores the inventory item ID when an item is picked', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('orders-new-order'));
    fireEvent.click(screen.getByTestId('mode-walkin'));

    const item = screen.getByPlaceholderText(/Search Active Inventory/i);
    fireEvent.change(item, { target: { value: 'SBA-R-2276 — Ring' } });

    const form = document.getElementById('walkin-form');
    // Permanent inventory ID is stored (never the name).
    expect(form?.querySelector('[name="inventoryItemId"]')).toHaveValue('w1');
    // Grams synced from the item and read-only.
    expect(screen.getByDisplayValue('1.65g')).toHaveAttribute('readonly');
  });

  it('supports pick-OR-type for both customer and item', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('orders-new-order'));

    // Typing a name that is NOT an existing record marks it as a new record.
    const customer = screen.getByPlaceholderText(/select a customer/i);
    fireEvent.change(customer, { target: { value: 'Bagong Customer' } });
    expect(
      screen.getByText(/New customer — will be created on confirm/i),
    ).toBeInTheDocument();

    const item = screen.getByPlaceholderText(/select an item/i);
    fireEvent.change(item, { target: { value: 'Bagong Item' } });
    expect(screen.getByText(/New item — created on confirm/i)).toBeInTheDocument();

    // A NEW item exposes an editable Unit Price (MoneyInput): live comma format on
    // the visible field, and the RAW value submitted via the hidden unitPrice input.
    const price = screen.getByPlaceholderText(/0\.00/);
    fireEvent.change(price, { target: { value: '5000' } });
    expect(price).toHaveValue('5,000');
    const hidden = document.querySelector<HTMLInputElement>('input[name="unitPrice"]');
    expect(hidden?.value).toBe('5000');

    // Choosing an EXISTING record instead is recognised as such.
    fireEvent.change(customer, { target: { value: 'Ana Cruz' } });
    expect(screen.getByText(/Existing customer selected/i)).toBeInTheDocument();

    // An EXISTING item now PRE-FILLS the Unit Price (editable, not read-only) with
    // the item's current price — the operator can keep it or type over it, and the
    // entered price is submitted (applied to the item on confirm).
    fireEvent.change(item, { target: { value: 'UAT-M01 — Bangle' } });
    const existingPrice = screen.getByDisplayValue('8,000.00');
    expect(existingPrice).not.toHaveAttribute('readonly');
    expect(document.querySelector<HTMLInputElement>('input[name="unitPrice"]')?.value).toBe(
      '8000.00',
    );
  });

  it('closes the form on Close', () => {
    renderWorkflow();
    fireEvent.click(screen.getByTestId('orders-new-order'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
