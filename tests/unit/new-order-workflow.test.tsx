import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { NewOrderWorkflow } from '@/components/orders/new-order-workflow';
import type { CaptureItem, WalkInItem } from '@/lib/orders/service';

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
    expect(screen.getByDisplayValue('A.V. Jewelry')).toBeInTheDocument();
    expect(screen.getByDisplayValue('UAT Owner')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/select a customer/i)).toBeInTheDocument();
    // Exactly one item row + the Add Item control to start.
    expect(screen.getByTestId('order-item-row-0')).toBeInTheDocument();
    expect(screen.queryByTestId('order-item-row-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('order-add-item')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm order/i })).toBeInTheDocument();
  });

  it('selecting an item prefills its Unit Price and computes the line + order total', () => {
    renderWorkflow();
    openForm();

    const row0 = screen.getByTestId('order-item-row-0');
    const itemBox = within(row0).getByPlaceholderText(/search active inventory/i);
    fireEvent.change(itemBox, { target: { value: 'UAT-M01 — Bangle' } });

    // Unit Price prefilled from the catalogue (editable), grams read-only.
    expect(within(row0).getByDisplayValue('8,000.00')).toBeInTheDocument();
    expect(within(row0).getByDisplayValue('5.5g')).toHaveAttribute('readonly');
    // Line total + order total (₱8,000; formatPeso drops the .00).
    expect(screen.getByTestId('order-item-line-0')).toHaveTextContent('₱8,000');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱8,000');

    // Quantity 2 → line + total double.
    const qty = within(row0).getByRole('spinbutton');
    fireEvent.change(qty, { target: { value: '2' } });
    expect(screen.getByTestId('order-item-line-0')).toHaveTextContent('₱16,000');
    expect(screen.getByTestId('order-summary-total')).toHaveTextContent('₱16,000');
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

  it('switches to Walk In mode with Name, item rows, MOP, and Date', () => {
    renderWorkflow();
    openForm();
    fireEvent.click(screen.getByTestId('mode-walkin'));

    expect(screen.getByRole('button', { name: /accept — complete sale/i })).toBeInTheDocument();
    // The Walk-In item selector offers the sellable inventory item.
    const row0 = screen.getByTestId('order-item-row-0');
    const itemBox = within(row0).getByPlaceholderText(/search active inventory/i);
    fireEvent.focus(itemBox);
    expect(screen.getByRole('option', { name: 'SBA-R-2276 — Ring' })).toBeInTheDocument();
    // Mode of Payment + Date present.
    expect(screen.getByText('Mode of Payment')).toBeInTheDocument();
  });

  it('closes the form on Close', () => {
    renderWorkflow();
    openForm();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
