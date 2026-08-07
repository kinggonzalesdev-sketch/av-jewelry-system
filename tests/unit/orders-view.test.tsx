import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OrdersView } from '@/components/orders/orders-view';
import type { OrderListRow, OrdersResult } from '@/lib/orders/service';

// OrdersView mounts the shared Order Details modal, which calls useRouter for its
// post-action refresh. The modal itself renders nothing while closed (no order
// selected), so a minimal router stub is all these list/card/filter tests need.
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

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
    waybillNumber: null,
    customerDisplayName: 'Maria Santos',
    facebookUrl: null,
    status: 'invoiced',
    createdAt: '2026-07-16T00:00:00.000Z',
    totalAmountPayable: '1000.00',
    outstandingBalance: '0.00',
    paymentStatus: 'awaiting',
    fulfillmentStatus: null,
    layawayStatus: null,
    shipDate: null,
    fulfillmentDestination: null,
    orderSource: 'online',
    convertedToLayaway: false,
    updatedAt: '2026-07-16T00:00:00.000Z',
    completedAt: null,
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
    expect(screen.getByTestId('orders-filter-flow')).toBeInTheDocument();
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
  });

  it('tags a walk-in order with a Walk-in badge (online orders show none)', () => {
    render(
      <OrdersView
        result={ok([
          row({ orderNumber: 'ORD-W', customerDisplayName: 'Walk Customer', orderSource: 'walk_in' }),
          row({ orderNumber: 'ORD-O', customerDisplayName: 'Online Customer', orderSource: 'online' }),
        ])}
      />,
    );
    expect(screen.getByText('Walk-in')).toBeInTheDocument();
    // Exactly one badge — the online order is not tagged.
    expect(screen.getAllByText('Walk-in')).toHaveLength(1);
  });
});

describe('OrdersView — the approved status cards over real data', () => {
  it('renders the remaining status cards', () => {
    render(<OrdersView result={ok(sample)} />);
    for (const key of [
      'all',
      'for_invoice',
      'ship_confirm',
      'delivery',
      'pickup',
      'for_layaway',
      'keep',
      'cancelled',
      'unverified_pay',
      'completed',
    ]) {
      expect(screen.getByTestId(`orders-card-${key}`)).toBeInTheDocument();
    }
  });

  it('no longer renders the removed cards (Owner request)', () => {
    render(<OrdersView result={ok(sample)} />);
    for (const key of ['for_reminder', 'for_prepare', 'for_shipping', 'for_cancel']) {
      expect(screen.queryByTestId(`orders-card-${key}`)).not.toBeInTheDocument();
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
      within(screen.getByTestId('orders-card-cancelled')).getByText('1'),
    ).toBeInTheDocument();
    // None of the sample orders are in a completed state → Completed shows 0.
    expect(
      within(screen.getByTestId('orders-card-completed')).getByText('0'),
    ).toBeInTheDocument();
  });

  it('shows an honest 0 for a card with no backing yet (Keep)', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(
      within(screen.getByTestId('orders-card-keep')).getByText('0'),
    ).toBeInTheDocument();
  });

  it('filters the table when a status card is clicked', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.click(screen.getByTestId('orders-card-for_invoice'));
    // Only the invoiced orders (ORD-1 Maria Santos, ORD-5 Lito Uy) remain.
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Lito Uy')).toBeInTheDocument();
    expect(screen.queryByText('Jose Cruz')).not.toBeInTheDocument();
  });
});

describe('OrdersView — search and filters (existing, preserved)', () => {
  it('search narrows by customer / order / invoice text', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.change(screen.getByTestId('orders-search'), { target: { value: 'ana' } });
    expect(screen.getByText('Ana Reyes')).toBeInTheDocument();
    expect(screen.queryByText('Maria Santos')).not.toBeInTheDocument();
  });

  it('renders the approved Order Date and Ship Date filters', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(screen.getByTestId('orders-filter-order-date')).toBeInTheDocument();
    expect(screen.getByTestId('orders-filter-ship-date')).toBeInTheDocument();
  });

  it('no longer renders the Hide Keep checkbox (removed by Owner request)', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(screen.queryByTestId('orders-filter-hide-keep')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Hide Keep')).not.toBeInTheDocument();
  });

  it('Order Date filters to orders created on the selected day', () => {
    const dated: OrderListRow[] = [
      row({ customerDisplayName: 'Early Bird', createdAt: '2026-07-01T09:00:00.000Z' }),
      row({ customerDisplayName: 'Late Comer', createdAt: '2026-07-16T09:00:00.000Z' }),
    ];
    render(<OrdersView result={ok(dated)} />);
    fireEvent.change(screen.getByTestId('orders-filter-order-date'), {
      target: { value: '2026-07-01' },
    });
    expect(screen.getByText('Early Bird')).toBeInTheDocument();
    expect(screen.queryByText('Late Comer')).not.toBeInTheDocument();
  });

  /**
   * The order-flow dropdown and the status cards are ONE state. These tests pin
   * that: the options are exactly the card labels, Total is the default, and
   * driving either control moves the other. A second source of truth here would
   * let the highlighted card and the dropdown disagree about what is on screen.
   */
  it('offers exactly the status-card flows, in card order, defaulting to Total', () => {
    render(<OrdersView result={ok(sample)} />);
    const select = screen.getByTestId<HTMLSelectElement>('orders-filter-flow');
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Total',
      'For Invoice',
      'Ship Confirm',
      'For Delivery',
      'Pickup',
      'For Layaway',
      'Keep',
      'Cancelled',
      'Pending Payment',
      'Walk In',
      'Completed',
    ]);
    expect(select.value).toBe('all');
  });

  it('selecting a flow filters the list, and clicking a card updates the dropdown', () => {
    render(<OrdersView result={ok(sample)} />);
    const select = screen.getByTestId<HTMLSelectElement>('orders-filter-flow');

    // Dropdown drives the list.
    fireEvent.change(select, { target: { value: 'cancelled' } });
    expect(select.value).toBe('cancelled');

    // Card drives the dropdown — one state, so they can never disagree.
    fireEvent.click(screen.getByTestId('orders-card-for_invoice'));
    expect(select.value).toBe('for_invoice');

    fireEvent.click(screen.getByTestId('orders-card-all'));
    expect(select.value).toBe('all');
  });

  it('shows an honest "no matches" note when filters exclude everything', () => {
    render(<OrdersView result={ok(sample)} />);
    fireEvent.change(screen.getByTestId('orders-search'), {
      target: { value: 'zzz-nothing' },
    });
    expect(screen.getByText(/No orders match these filters/i)).toBeInTheDocument();
  });
});

/**
 * For Shipping vs Ship Confirm (Owner request).
 *
 * They must be DISJOINT: For Shipping is awaiting release, Ship Confirm is
 * release approved or already dispatched. If one bucket swallowed the other an
 * order would be counted twice and the cards would stop summing to the total.
 */
describe('OrdersView — For Shipping is its own flow', () => {
  const shipping: OrderListRow[] = [
    row({
      orderNumber: 'ORD-SHIP',
      customerDisplayName: 'Awaiting Release',
      status: 'for_shipping_or_pickup',
    }),
    row({
      orderNumber: 'ORD-DEST',
      customerDisplayName: 'Routed To Shipping',
      status: 'for_preparation',
      fulfillmentDestination: 'shipping',
    }),
    row({
      orderNumber: 'ORD-CONF',
      customerDisplayName: 'Released Already',
      status: 'approved_for_release',
    }),
  ];

  it('no longer offers a For Shipping card or dropdown option (Owner request)', () => {
    render(<OrdersView result={ok(shipping)} />);
    expect(screen.queryByTestId('orders-card-for_shipping')).not.toBeInTheDocument();
    const select = screen.getByTestId<HTMLSelectElement>('orders-filter-flow');
    expect(
      within(select).queryByRole('option', { name: 'For Shipping' }),
    ).not.toBeInTheDocument();
  });

  it('shows released orders under Ship Confirm', () => {
    render(<OrdersView result={ok(shipping)} />);
    fireEvent.click(screen.getByTestId('orders-card-ship_confirm'));
    expect(screen.getByText('Released Already')).toBeInTheDocument();
    expect(screen.queryByText('Awaiting Release')).not.toBeInTheDocument();
  });
});

