import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderModal, NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';

// The order actions are transport (tested via the domain suites); the printer +
// photo controls are exercised by their own tests. Stub the actions so this focuses
// on the multi-item form structure + summary math.
vi.mock('@/lib/orders/actions', () => ({
  captureManualOrderAction: vi.fn(),
  captureWalkInOrderAction: vi.fn(),
  // Present so the lazy-load path is safe; tests inject `initialData`, so New Order
  // opens synchronously and this is never actually called.
  loadNewOrderDataAction: vi.fn(),
  recordOrderPrintAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
// Stub the camera control so the Item Photos section is inspectable without real camera APIs.
vi.mock('@/components/attachments/photo-capture', () => ({
  PhotoCapture: ({ label }: { label?: string }) => (
    <div data-testid="photo-capture">{label}</div>
  ),
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
  {
    id: 'i2',
    itemCode: 'UAT-M02',
    itemName: 'Ring',
    unitPrice: '3000.00',
    gramsPerPiece: '2.1',
    availabilityStatus: 'available',
  },
  {
    // An HK ITEM with NO catalogue price — falls back to the DB price when there is
    // no number written after "HK ITEM".
    id: 'i3',
    itemCode: 'BNA-B-2533 K18 HK ITEM',
    itemName: null,
    unitPrice: '37500.00',
    gramsPerPiece: '10.2',
    availabilityStatus: 'available',
  },
  {
    // An HK ITEM whose price is written in the name (9,600); the quoted "16" is the
    // size, and total_price_per_piece is empty.
    id: 'i4',
    itemCode: 'BNA-B-2536 K18 HK ITEM 9,600 "16"',
    itemName: null,
    unitPrice: null,
    gramsPerPiece: null,
    availabilityStatus: 'available',
  },
];

const walkInItems: WalkInItem[] = [
  { id: 'w1', itemCode: 'SBA-R-2276', facebookName: 'Ring', grams: '1.65' },
  // No stored grams — the weight is in the code (1.20g).
  { id: 'w2', itemCode: 'SBA-R-5110 1.20g 7"', facebookName: null, grams: null },
  // Walk-In HK ITEM: price written after "HK ITEM", no stored grams/price.
  {
    id: 'w3',
    itemCode: 'BNA-B-2536 K18 HK ITEM 9,600 "16"',
    facebookName: null,
    grams: null,
  },
];

// Admin Name context as a NON-Super-Admin receives it: exactly one option, so the
// field is read-only and there is no one else to record the order under.
const admins: AdminNameContext = {
  selfId: 'staff-1',
  selfName: 'UAT Owner',
  canChange: false,
  options: [{ id: 'staff-1', fullName: 'UAT Owner' }],
};

function renderWorkflow(canCreate = true) {
  return render(
    <NewOrderWorkflow
      canCreate={canCreate}
      initialData={{ customers, items, walkInItems, admins }}
    />,
  );
}

function openForm() {
  fireEvent.click(screen.getByTestId('orders-new-order'));
}

// The Walk-In sale flow now opens WALK-IN ONLY (from Daily Cash → + Add New Sale): the
// shared modal with no New Entry / Walk In toggle. Orders itself is New-Entry only.
function renderWalkIn() {
  return render(
    <NewOrderModal
      walkInOnly
      customers={customers}
      walkInItems={walkInItems}
      admins={admins}
      onClose={vi.fn()}
    />,
  );
}

describe('NewOrderWorkflow — the New Order control', () => {
  it('renders only New Order (the removed shortcuts stay gone)', () => {
    renderWorkflow();
    expect(screen.getByTestId('orders-new-order')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invoice' })).not.toBeInTheDocument();
  });

  it('disables New Order without the capture permission', () => {
    renderWorkflow(false);
    expect(screen.getByTestId('orders-new-order')).toBeDisabled();
  });
});

describe('NewOrderWorkflow — multi-item form', () => {
  it('opens New-Entry-only (no Walk In tab), a customer field, and one item row', () => {
    renderWorkflow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openForm();

    expect(screen.getByRole('dialog', { name: /new order/i })).toBeInTheDocument();
    // Orders → New Order is NEW-ENTRY ONLY (Owner 2026-08-14): the Walk In tab was removed
    // from this popup. Walk-In sales live in Daily Cash → + Add New Sale (the SAME modal,
    // opened walk-in-only). So the mode toggle must NOT render here.
    expect(screen.queryByTestId('mode-order')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mode-walkin')).not.toBeInTheDocument();
    // Shop Name was REMOVED from the entry form (§3); Admin Name replaced
    // Salesperson (§2) and shows the signed-in account, read-only for a
    // non-Super-Admin.
    expect(screen.queryByDisplayValue('A.V. Jewelry')).not.toBeInTheDocument();
    expect(screen.getByTestId('admin-name')).toHaveValue('UAT Owner');
    expect(screen.getByTestId('admin-name')).toHaveAttribute('readonly');
    expect(screen.getByPlaceholderText(/select a customer/i)).toBeInTheDocument();
    // Exactly one item row + the Add Item control to start.
    expect(screen.getByTestId('order-item-row-0')).toBeInTheDocument();
    expect(screen.queryByTestId('order-item-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-add-item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
  });

  it('Fixed Price: selecting an item prefills its Price and computes the total (no qty)', () => {
    renderWorkflow();
    openForm();

    const row0 = screen.getByTestId('order-item-row-0');
    const itemBox = within(row0).getByPlaceholderText(/search active inventory/i);
    fireEvent.change(itemBox, { target: { value: 'UAT-M01 — Bangle' } });

    // Fixed Price prefilled from the catalogue (editable), grams read-only.
    expect(within(row0).getByDisplayValue('8,000.00')).toBeInTheDocument();
    expect(within(row0).getByDisplayValue('5.5g')).toHaveAttribute('readonly');
    // No quantity field anymore.
    expect(within(row0).queryByRole('spinbutton')).not.toBeInTheDocument();
    // Line total + order total (₱8,000; formatPeso drops the .00).
    expect(screen.getByTestId('order-item-line-0')).toHaveTextContent('₱8,000');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱8,000');
  });

  it('HK ITEM: forces Fixed Price, hides Price Per Gram, and locks the catalogue price into the total', () => {
    renderWorkflow();
    openForm();

    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'BNA-B-2533 K18 HK ITEM' },
    });

    // No per-gram option — the HK badge replaces the mode toggle.
    expect(
      within(row0).queryByRole('button', { name: 'Price Per Gram' }),
    ).not.toBeInTheDocument();
    expect(within(row0).getByTestId('order-item-hk-0')).toBeInTheDocument();

    // Price is the catalogue price from Inventory, read-only, and drives the total —
    // grams are NOT multiplied in.
    const price = within(row0).getByTestId('order-item-price-0');
    expect(price).toHaveAttribute('readonly');
    expect(price).toHaveDisplayValue('₱37,500');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱37,500');
    // Grams do not apply to an HK item — the field is disabled and blank.
    const grams = within(row0).getByTestId('order-item-grams-0');
    expect(grams).toBeDisabled();
    expect(grams).toHaveValue('—');
  });

  it('HK ITEM: uses the price written after "HK ITEM" (the quoted size is ignored)', () => {
    renderWorkflow();
    openForm();

    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'BNA-B-2536 K18 HK ITEM 9,600 "16"' },
    });

    const price = within(row0).getByTestId('order-item-price-0');
    expect(price).toHaveAttribute('readonly');
    // ₱9,600 from the name — NOT the "16" size, and not the empty catalogue price.
    expect(price).toHaveDisplayValue('₱9,600');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱9,600');
  });

  it('Price Per Gram: total = grams × rate, read-only', () => {
    renderWorkflow();
    openForm();

    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'UAT-M01 — Bangle' },
    });
    // Switch this row to Price Per Gram.
    fireEvent.click(within(row0).getByRole('button', { name: 'Price Per Gram' }));

    // Grams (5.5) auto-loaded; enter ₱4,000/g → 5.5 × 4000 = ₱22,000.
    const perGram = within(row0).getByPlaceholderText('0.00');
    fireEvent.change(perGram, { target: { value: '4000' } });

    expect(within(row0).getByTestId('order-item-pergram-total-0')).toHaveDisplayValue(
      '₱22,000',
    );
    expect(screen.getByTestId('order-item-line-0')).toHaveTextContent('₱22,000');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱22,000');
  });

  it('adds and removes item rows, and the summary count follows', () => {
    renderWorkflow();
    openForm();

    expect(screen.getByTestId('order-summary-count')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('order-add-item'));
    expect(screen.getByTestId('order-item-row-1')).toBeInTheDocument();
    expect(screen.getByTestId('order-summary-count')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('order-item-remove-1'));
    expect(screen.queryByTestId('order-item-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-summary-count')).toHaveTextContent('1');
  });

  it('sums two different items into the order total', () => {
    renderWorkflow();
    openForm();

    fireEvent.change(
      within(screen.getByTestId('order-item-row-0')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'UAT-M01 — Bangle' } },
    );
    fireEvent.click(screen.getByTestId('order-add-item'));
    fireEvent.change(
      within(screen.getByTestId('order-item-row-1')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'UAT-M02 — Ring' } },
    );
    // 8,000 + 3,000 = 11,000.
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱11,000');
  });

  it('switches to Walk In mode with a Save button, item rows, payment amount, and Date', () => {
    renderWalkIn();

    // The Walk-In overhaul replaced the instant "Accept — Complete Sale" with a
    // "Save" button that opens a review before writing anything.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /accept — complete sale/i }),
    ).not.toBeInTheDocument();

    // The Walk-In item selector offers the sellable inventory item.
    const row0 = screen.getByTestId('order-item-row-0');
    const itemBox = within(row0).getByPlaceholderText(/search active inventory/i);
    fireEvent.focus(itemBox);
    expect(screen.getByRole('option', { name: 'SBA-R-2276 — Ring' })).toBeInTheDocument();

    // Payment (with an amount) + Date present.
    expect(screen.getByTestId('walkin-payments')).toBeInTheDocument();
    expect(screen.getByText('Mode of Payment')).toBeInTheDocument();
    expect(screen.getByText('Amount Paid')).toBeInTheDocument();
    expect(screen.getByTestId('walkin-balance')).toBeInTheDocument();
  });

  it('Walk In: auto-detects grams from the code when the stored weight is blank', () => {
    renderWalkIn();

    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'SBA-R-5110 1.20g 7"' },
    });
    // The editable Walk-In grams field is pre-filled with 1.20 read from the code.
    expect(within(row0).getByTestId('order-item-grams-0')).toHaveValue('1.20');
  });

  it('Walk In: HK ITEM is fixed-price at the number after "HK ITEM"', () => {
    renderWalkIn();

    const row0 = screen.getByTestId('order-item-row-0');
    fireEvent.change(within(row0).getByPlaceholderText(/search active inventory/i), {
      target: { value: 'BNA-B-2536 K18 HK ITEM 9,600 "16"' },
    });
    expect(within(row0).getByTestId('order-item-hk-0')).toBeInTheDocument();
    const price = within(row0).getByTestId('order-item-price-0');
    expect(price).toHaveDisplayValue('₱9,600');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱9,600');
    // Even in Walk In, an HK item's grams field is disabled and blank.
    expect(within(row0).getByTestId('order-item-grams-0')).toBeDisabled();
  });

  it('closes the form on Close', () => {
    renderWorkflow();
    openForm();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // Owner 2026-09-02 — the New Walk-In Sale has NO Item Photos step (payment follows totals).
  it('Walk In: shows NO Item Photos section, even after an item is added', () => {
    renderWalkIn();
    fireEvent.change(
      within(screen.getByTestId('order-item-row-0')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'BNA-B-2536 K18 HK ITEM 9,600 "16"' } },
    );
    expect(screen.queryByTestId('order-item-photos')).not.toBeInTheDocument();
    expect(screen.queryByText(/Item Photos/i)).not.toBeInTheDocument();
    // Payment section is present (immediately follows the totals).
    expect(screen.getByTestId('walkin-payments')).toBeInTheDocument();
  });

  // Regression: the regular New Order flow KEEPS Item Photos (only Walk-In dropped it).
  it('New Order: still shows Item Photos after an item is picked', () => {
    renderWorkflow();
    openForm();
    fireEvent.change(
      within(screen.getByTestId('order-item-row-0')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'UAT-M01 — Bangle' } },
    );
    expect(screen.getByTestId('order-item-photos')).toBeInTheDocument();
  });

  // Owner 2026-09-02 — cash may exceed the balance; the excess shows as Change, balance floors at 0.
  it('Walk In: cash above the total shows Change and a ₱0 balance (₱9,600 total, ₱10,000 cash)', () => {
    renderWalkIn();
    fireEvent.change(
      within(screen.getByTestId('order-item-row-0')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'BNA-B-2536 K18 HK ITEM 9,600 "16"' } },
    );
    const amount = within(screen.getByTestId('walkin-payment-0')).getByPlaceholderText('0.00');
    fireEvent.change(amount, { target: { value: '10000' } }); // Cash is the default method

    expect(screen.getByTestId('walkin-total-paid')).toHaveTextContent('₱10,000');
    expect(screen.getByTestId('walkin-change')).toHaveTextContent('₱400');
    expect(screen.getByTestId('walkin-balance')).toHaveTextContent('₱0');
  });

  it('Walk In: partial cash shows NO Change row and the remaining balance', () => {
    renderWalkIn();
    fireEvent.change(
      within(screen.getByTestId('order-item-row-0')).getByPlaceholderText(
        /search active inventory/i,
      ),
      { target: { value: 'BNA-B-2536 K18 HK ITEM 9,600 "16"' } },
    );
    const amount = within(screen.getByTestId('walkin-payment-0')).getByPlaceholderText('0.00');
    fireEvent.change(amount, { target: { value: '6000' } });

    expect(screen.queryByTestId('walkin-change')).not.toBeInTheDocument();
    expect(screen.getByTestId('walkin-balance')).toHaveTextContent('₱3,600');
  });
});

/**
 * Admin Name is the SIGNED-IN account — always, for everyone (Owner request).
 *
 * The Super-Admin picker was removed outright rather than hidden, so these tests
 * assert the absence of any selectable option: a form that cannot offer another
 * account cannot be used to record work under someone else's name, even by a
 * Super Admin with the DOM open.
 */
describe('NewOrderWorkflow — Admin Name is read-only session identity', () => {
  const superAdmin: AdminNameContext = {
    selfId: 'staff-1',
    selfName: 'King Gonzales',
    // Even when the server says this user COULD change it, the form must not
    // offer a picker.
    canChange: true,
    options: [
      { id: 'staff-1', fullName: 'King Gonzales' },
      { id: 'staff-2', fullName: 'Lalyn De Dios' },
    ],
  };

  function openAs(ctx: AdminNameContext) {
    render(
      <NewOrderWorkflow
        canCreate
        initialData={{ customers, items, walkInItems, admins: ctx }}
      />,
    );
    fireEvent.click(screen.getByTestId('orders-new-order'));
  }

  it('shows the logged-in full name, read-only, and never a dropdown', () => {
    openAs(superAdmin);
    const field = screen.getByTestId('admin-name');
    expect(field).toHaveValue('King Gonzales');
    expect(field).toHaveAttribute('readonly');
    expect(field.tagName).toBe('INPUT');
  });

  it('offers NO other account to select, even for a Super Admin', () => {
    openAs(superAdmin);
    expect(screen.queryByText('Lalyn De Dios')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Lalyn De Dios' }),
    ).not.toBeInTheDocument();
  });

  it('posts the permanent staff id, not the display name', () => {
    openAs(superAdmin);
    const hidden = document.querySelector<HTMLInputElement>('input[name="adminId"]');
    expect(hidden).not.toBeNull();
    expect(hidden!.value).toBe('staff-1');
  });

  it('places Customer Name above Admin Name (Owner-specified order)', () => {
    openAs(superAdmin);
    const dialog = screen.getByRole('dialog');
    const text = dialog.textContent ?? '';
    expect(text.indexOf('Customer Name')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('Customer Name')).toBeLessThan(text.indexOf('Admin Name'));
  });
});
