import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OrdersView, matchesCard } from '@/components/orders/orders-view';
import { loadOrdersPageAction } from '@/lib/orders/actions';
import type { OrderListRow, OrdersPageResult } from '@/lib/orders/service';

/**
 * Orders screen — now SERVER-PAGINATED (Owner request 2026-08-17). The card logic is the
 * canonical `matchesCard` (mirrored 1:1 by the SQL `order_matches_card`); the component
 * renders the server's page rows + exact total + full-store card counts, and drives
 * search / flow-card / date filters back to the server. These tests cover BOTH.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Only the Orders page fetch is stubbed — every other order action stays real (child
// modals wire them via useActionState but never invoke them in these tests).
const H = vi.hoisted<{ result: OrdersPageResult }>(() => ({
  result: { ok: true, rows: [], total: 0, cardCounts: {} },
}));
vi.mock('@/lib/orders/actions', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    loadOrdersPageAction: vi.fn(() => Promise.resolve(H.result)),
  };
});
const loadMock = vi.mocked(loadOrdersPageAction);

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
  row({ orderNumber: 'ORD-2', customerDisplayName: 'Jose Cruz', status: 'cancelled' }),
];

function page(
  rows: OrderListRow[],
  total?: number,
  cardCounts: Record<string, number> = {},
): OrdersPageResult {
  const t = total ?? rows.length;
  return { ok: true, rows, total: t, cardCounts: { all: t, ...cardCounts } };
}

afterEach(() => {
  vi.clearAllMocks();
  H.result = { ok: true, rows: [], total: 0, cardCounts: {} };
});

describe('matchesCard — canonical card logic (mirrored by the SQL order_matches_card)', () => {
  it('walk_in matches only walk-in source', () => {
    expect(matchesCard(row({ orderSource: 'walk_in' }), 'walk_in')).toBe(true);
    expect(matchesCard(row({ orderSource: 'online' }), 'walk_in')).toBe(false);
  });

  it('for_invoice covers invoiced + awaiting_required_payment (no destination)', () => {
    expect(matchesCard(row({ status: 'invoiced' }), 'for_invoice')).toBe(true);
    expect(matchesCard(row({ status: 'awaiting_required_payment' }), 'for_invoice')).toBe(
      true,
    );
    expect(
      matchesCard(row({ status: 'invoiced', fulfillmentDestination: 'shipping' }), 'for_invoice'),
    ).toBe(false);
    expect(matchesCard(row({ status: 'for_preparation' }), 'for_invoice')).toBe(false);
  });

  it('ship_confirm and for_shipping stay DISJOINT (no double-count)', () => {
    const released = row({ status: 'approved_for_release' });
    const awaiting = row({ status: 'for_shipping_or_pickup' });
    expect(matchesCard(released, 'ship_confirm')).toBe(true);
    expect(matchesCard(released, 'for_shipping')).toBe(false);
    expect(matchesCard(awaiting, 'for_shipping')).toBe(true);
    expect(matchesCard(awaiting, 'ship_confirm')).toBe(false);
  });

  it('a released order routed to a destination shows under the destination, not ship_confirm', () => {
    const releasedDelivery = row({
      status: 'approved_for_release',
      fulfillmentDestination: 'delivery',
    });
    expect(matchesCard(releasedDelivery, 'delivery')).toBe(true);
    expect(matchesCard(releasedDelivery, 'ship_confirm')).toBe(false);
  });

  it('a cancelled order leaves its destination card', () => {
    const cancelledDelivery = row({
      status: 'cancelled',
      fulfillmentDestination: 'delivery',
    });
    expect(matchesCard(cancelledDelivery, 'delivery')).toBe(false);
    expect(matchesCard(cancelledDelivery, 'cancelled')).toBe(true);
  });

  it('cancelled / completed / unverified_pay / all', () => {
    expect(matchesCard(row({ status: 'cancelled' }), 'cancelled')).toBe(true);
    expect(matchesCard(row({ status: 'completed' }), 'completed')).toBe(true);
    expect(matchesCard(row({ status: 'delivered' }), 'completed')).toBe(true);
    expect(matchesCard(row({ paymentStatus: 'awaiting' }), 'unverified_pay')).toBe(true);
    expect(matchesCard(row({ paymentStatus: 'paid_in_full' }), 'unverified_pay')).toBe(false);
    expect(matchesCard(row({}), 'all')).toBe(true);
  });
});

describe('OrdersView — honest states + server-driven rendering', () => {
  it('renders an explicit error when the initial read failed', () => {
    render(<OrdersView initialPage={{ ok: false, reason: 'boom' }} />);
    expect(screen.getByTestId('read-error')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an empty state when there are genuinely no orders', () => {
    render(<OrdersView initialPage={page([], 0)} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('read-error')).not.toBeInTheDocument();
  });

  it('keeps the cards + search + flow filter visible even with no orders', () => {
    render(<OrdersView initialPage={page([], 0)} />);
    expect(screen.getByTestId('orders-card-all')).toBeInTheDocument();
    expect(screen.getByTestId('orders-search')).toBeInTheDocument();
    expect(screen.getByTestId('orders-filter-flow')).toBeInTheDocument();
  });

  it('renders the 11 cards (not the removed 4) and shows the SERVER card counts', () => {
    render(
      <OrdersView
        initialPage={page(sample, 5, { for_invoice: 3, cancelled: 1, completed: 0 })}
      />,
    );
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
      'walk_in',
      'completed',
    ]) {
      expect(screen.getByTestId(`orders-card-${key}`)).toBeInTheDocument();
    }
    for (const key of ['for_reminder', 'for_prepare', 'for_shipping', 'for_cancel']) {
      expect(screen.queryByTestId(`orders-card-${key}`)).not.toBeInTheDocument();
    }
    expect(within(screen.getByTestId('orders-card-all')).getByText('5')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-for_invoice')).getByText('3'),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('orders-card-cancelled')).getByText('1'),
    ).toBeInTheDocument();
  });

  it('shows the EXACT server total, never the loaded-row count', () => {
    render(<OrdersView initialPage={page(sample, 12837)} />);
    expect(screen.getByTestId('orders-count')).toHaveTextContent('1–2');
    expect(screen.getByText('12,837')).toBeInTheDocument();
  });

  it('shows an honest "no matches" note when the current filter has no rows', () => {
    // store is non-empty (cardCounts.all=5) but this page returned no rows.
    render(<OrdersView initialPage={{ ok: true, rows: [], total: 0, cardCounts: { all: 5 } }} />);
    expect(screen.getByText(/No orders match these filters/i)).toBeInTheDocument();
  });

  it('offers exactly the status-card flows, defaulting to Total', () => {
    render(<OrdersView initialPage={page(sample, 5)} />);
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

  it('tags a walk-in order with a badge (online orders show none)', () => {
    render(
      <OrdersView
        initialPage={page(
          [
            row({ orderSource: 'walk_in', customerDisplayName: 'Walk Customer' }),
            row({ orderSource: 'online', customerDisplayName: 'Online Customer' }),
          ],
          2,
        )}
      />,
    );
    expect(screen.getAllByText('Walk-in')).toHaveLength(1);
  });
});

describe('OrdersView — server-side search / flow / date dispatch', () => {
  it('typing in search refetches with the search term (server-side, debounced)', async () => {
    render(<OrdersView initialPage={page(sample, 5)} />);
    fireEvent.change(screen.getByTestId('orders-search'), { target: { value: 'ana' } });
    await waitFor(() =>
      expect(loadMock).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' })),
    );
  });

  it('clicking a status card refetches with that card AND updates the dropdown', async () => {
    render(<OrdersView initialPage={page(sample, 5)} />);
    fireEvent.click(screen.getByTestId('orders-card-cancelled'));
    expect(screen.getByTestId<HTMLSelectElement>('orders-filter-flow').value).toBe('cancelled');
    await waitFor(() =>
      expect(loadMock).toHaveBeenCalledWith(expect.objectContaining({ card: 'cancelled' })),
    );
  });

  it('the flow dropdown refetches with the chosen card', async () => {
    render(<OrdersView initialPage={page(sample, 5)} />);
    fireEvent.change(screen.getByTestId('orders-filter-flow'), {
      target: { value: 'completed' },
    });
    await waitFor(() =>
      expect(loadMock).toHaveBeenCalledWith(expect.objectContaining({ card: 'completed' })),
    );
  });

  it('the date range refetches with dateFrom/dateTo (server-side)', async () => {
    render(<OrdersView initialPage={page(sample, 5)} />);
    fireEvent.change(screen.getByTestId('orders-filter-date-from'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByTestId('orders-filter-date-to'), {
      target: { value: '2026-07-10' },
    });
    await waitFor(() =>
      expect(loadMock).toHaveBeenCalledWith(
        expect.objectContaining({ dateFrom: '2026-07-01', dateTo: '2026-07-10' }),
      ),
    );
  });
});
