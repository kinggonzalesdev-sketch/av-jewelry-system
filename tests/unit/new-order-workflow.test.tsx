import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';
import type { AdminNameContext } from '@/lib/authz/admin-name';

// The order actions are transport (tested via the domain suites); the printer +
// photo controls are exercised by their own tests. Stub the actions so this focuses
// on the multi-item form structure + summary math.
vi.mock('@/lib/orders/actions', () => ({
  captureManualOrderAction: vi.fn(),
  captureWalkInOrderAction: vi.fn(),
  recordOrderPrintAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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
];

const walkInItems: WalkInItem[] = [
  { id: 'w1', itemCode: 'SBA-R-2276', facebookName: 'Ring', grams: '1.65' },
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
      customers={customers}
      items={items}
      walkInItems={walkInItems}
      canCreate={canCreate}
      admins={admins}
    />,
  );
}

function openForm() {
  fireEvent.click(screen.getByTestId('orders-new-order'));
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
  it('opens with New Entry / Walk In modes, a customer field, and one item row', () => {
    renderWorkflow();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    openForm();

    expect(screen.getByRole('dialog', { name: /new order/i })).toBeInTheDocument();
    expect(screen.getByTestId('mode-order')).toBeInTheDocument();
    expect(screen.getByTestId('mode-walkin')).toBeInTheDocument();
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
    renderWorkflow();
    openForm();
    fireEvent.click(screen.getByTestId('mode-walkin'));

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

  it('closes the form on Close', () => {
    renderWorkflow();
    openForm();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
        customers={customers}
        items={items}
        walkInItems={walkInItems}
        canCreate
        admins={ctx}
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
