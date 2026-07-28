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
    customerDisplayName: 'Maria Santos',
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

describe('OrdersView — the approved 11 status cards over real data', () => {
  it('renders all status cards, incl. the For-Prepare destinations', () => {
    render(<OrdersView result={ok(sample)} />);
    // Delivery, Pickup, and For Layaway were added as For-Prepare transfer
    // destinations (Orders Workflow — For Prepare).
    for (const key of [
      'all',
      'for_invoice',
      'for_reminder',
      'for_prepare',
      'for_confirm',
      'ship_confirm',
      'delivery',
      'pickup',
      'for_layaway',
      'keep',
      'for_cancel',
      'cancelled',
      'unverified_pay',
      'completed',
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
    // None of the sample orders are in a completed state → Completed shows 0.
    expect(
      within(screen.getByTestId('orders-card-completed')).getByText('0'),
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

  it('renders the approved Order Date, Ship Date, and Hide Keep filters', () => {
    render(<OrdersView result={ok(sample)} />);
    expect(screen.getByTestId('orders-filter-order-date')).toBeInTheDocument();
    expect(screen.getByTestId('orders-filter-ship-date')).toBeInTheDocument();
    expect(screen.getByTestId('orders-filter-hide-keep')).toBeInTheDocument();
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
