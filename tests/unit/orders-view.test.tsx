import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrdersView } from '@/components/orders/orders-view';
import type { OrderListRow, OrdersResult } from '@/lib/orders/service';

/**
 * Orders screen — completeness beyond a bare table (status cards, search,
 * filters) over REAL data, plus the honest empty/error distinction.
 */

function row(over: Partial<OrderListRow>): OrderListRow {
  return {
    officialOrderId: crypto.randomUUID(),
    orderNumber: 'ORD-0001',
    invoiceNumber: 'INV-0001',
    customerDisplayName: 'Maria Santos',
    status: 'official_order',
    createdAt: '2026-07-16T00:00:00.000Z',
    totalAmountPayable: '1000.00',
    outstandingBalance: '0.00',
    paymentStatus: 'paid_in_full',
    fulfillmentStatus: null,
    ...over,
  };
}

const sample: OrderListRow[] = [
  row({
    orderNumber: 'ORD-1',
    customerDisplayName: 'Maria Santos',
    paymentStatus: 'paid_in_full',
  }),
  row({
    orderNumber: 'ORD-2',
    customerDisplayName: 'Jose Cruz',
    paymentStatus: 'awaiting',
  }),
  row({
    orderNumber: 'ORD-3',
    customerDisplayName: 'Ana Reyes',
    paymentStatus: 'partial',
    outstandingBalance: '250.00',
    fulfillmentStatus: 'for_shipping',
  }),
  row({
    orderNumber: 'ORD-4',
    customerDisplayName: 'Ben Tan',
    paymentStatus: 'unavailable',
  }),
];

const ok = (rows: OrderListRow[]): OrdersResult => ({ ok: true, rows });

describe('OrdersView — honest states', () => {
  it('renders an explicit error (not an empty table) when the read fails', () => {
    render(<OrdersView result={{ ok: false, reason: 'boom' }} />);
    expect(screen.getByTestId('read-error')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an empty state (not an error) when there are genuinely no orders', () => {
    render(<OrdersView result={ok([])} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('read-error')).not.toBeInTheDocument();
  });
});

describe('OrdersView — status cards count real data', () => {
  it('shows the correct counts per payment bucket', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(
      within(screen.getByTestId('orders-card-all')).getByText('4'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-awaiting')).getByText('1'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-partial')).getByText('1'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-paid_in_full')).getByText('1'),
    ).toBeInTheDocument();
    // Only ORD-3 has an open (non-terminal) fulfillment record.
    expect(
      within(screen.getByTestId('orders-card-for_fulfillment')).getByText('1'),
    ).toBeInTheDocument();
  });

  it('filters the table when a status card is clicked', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.click(screen.getByTestId('orders-card-awaiting'));
    // Only the awaiting order (Jose Cruz) remains.
    expect(screen.getByText('Jose Cruz')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });
});

describe('OrdersView — search and filters', () => {
  it('search narrows by customer / order / invoice text', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.change(screen.getByTestId('orders-search'), { target: { value: 'ana' } });
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });

  it('the fulfillment filter offers only statuses present in the data', () => {
    render(<OrdersView result={ok(sample)} />);
    const select = screen.getByTestId('orders-filter-fulfillment');
    // "for_shipping" is present (ORD-3); "dispatched" is not.
    expect(
      within(select).getByRole('option', { name: /For Shipping/i }),
    ).toBeInTheDocument();
    expect(
      within(select).queryByRole('option', { name: /Dispatched/i }),
    ).not.toBeInTheDocument();
  });

  it('shows an honest "no matches" note when filters exclude everything', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.change(screen.getByTestId('orders-search'), {
      target: { value: 'zzz-nothing' },
    });
    expect(screen.getByText(/No orders match these filters/i)).toBeInTheDocument();
  });
});
