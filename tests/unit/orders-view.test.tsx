import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrdersView } from '@/components/orders/orders-view';
import type { OrderListRow, OrdersResult } from '@/lib/orders/service';

/**
 * Orders screen — the approved status cards (11), search, and filters over REAL
 * data, plus the honest empty/error distinction. The existing search + table are
 * preserved; the cards sit above them.
 */

function row(over: Partial<OrderListRow>): OrderListRow {
  return {
    officialOrderId: crypto.randomUUID(),
    orderNumber: 'ORD-0001',
    invoiceNumber: 'INV-0001',
    customerDisplayName: 'Maria Santos',
    status: 'invoiced',
    createdAt: '2026-07-16T00:00:00.000Z',
    totalAmountPayable: '1000.00',
    outstandingBalance: '0.00',
    paymentStatus: 'awaiting',
    fulfillmentStatus: null,
    layawayStatus: null,
    ...over,
  };
}

const sample: OrderListRow[] = [
  row({ orderNumber: 'ORD-1', customerDisplayName: 'Maria Santos', status: 'invoiced' }),
  row({
    orderNumber: 'ORD-2',
    customerDisplayName: 'Jose Cruz',
    status: 'awaiting_required_payment',
  }),
  row({
    orderNumber: 'ORD-3',
    customerDisplayName: 'Ana Reyes',
    status: 'for_preparation',
    paymentStatus: 'partial',
    outstandingBalance: '250.00',
    fulfillmentStatus: 'for_shipping',
  }),
  row({
    orderNumber: 'ORD-4',
    customerDisplayName: 'Ben Tan',
    status: 'cancelled',
    paymentStatus: 'unavailable',
  }),
  row({
    orderNumber: 'ORD-5',
    customerDisplayName: 'Lito Uy',
    status: 'invoiced',
    layawayStatus: 'active',
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

  it('still shows the status cards and search when there are no orders (features never vanish)', () => {
    render(<OrdersView result={ok([])} />);
    expect(screen.getByTestId('orders-card-all')).toBeInTheDocument();
    expect(screen.getByTestId('orders-search')).toBeInTheDocument();
    expect(screen.getByTestId('orders-filter-fulfillment')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });
});

describe('OrdersView — the approved 11 status cards over real data', () => {
  it('renders all 11 cards including For Layaway', () => {
    render(<OrdersView result={ok(sample)} />);
    for (const key of [
      'all',
      'for_invoice',
      'for_reminder',
      'for_prepare',
      'for_confirm',
      'ship_confirm',
      'keep',
      'for_cancel',
      'cancelled',
      'unverified_pay',
      'for_layaway',
    ]) {
      expect(screen.getByTestId(`orders-card-${key}`)).toBeInTheDocument();
    }
  });

  it('counts each card from the real order status / layaway signals', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(
      within(screen.getByTestId('orders-card-all')).getByText('5'),
    ).toBeInTheDocument();
    // ORD-1 + ORD-5 are 'invoiced'.
    expect(
      within(screen.getByTestId('orders-card-for_invoice')).getByText('2'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-for_reminder')).getByText('1'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-cancelled')).getByText('1'),
    ).toBeInTheDocument();
    // ORD-5 has an active layaway.
    expect(
      within(screen.getByTestId('orders-card-for_layaway')).getByText('1'),
    ).toBeInTheDocument();
  });

  it('shows an honest 0 for cards with no backing yet (Keep / For Cancel)', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(
      within(screen.getByTestId('orders-card-keep')).getByText('0'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-for_cancel')).getByText('0'),
    ).toBeInTheDocument();
  });

  it('filters the table when a status card is clicked', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.click(screen.getByTestId('orders-card-for_reminder'));
    // Only ORD-2 (Jose Cruz, awaiting_required_payment) remains.
    expect(screen.getByText('Jose Cruz')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });
});

describe('OrdersView — search and filters (existing, preserved)', () => {
  it('search narrows by customer / order / invoice text', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.change(screen.getByTestId('orders-search'), { target: { value: 'ana' } });
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });

  it('the fulfillment filter offers only statuses present in the data', () => {
    render(<OrdersView result={ok(sample)} />);
    const select = screen.getByTestId('orders-filter-fulfillment');
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
