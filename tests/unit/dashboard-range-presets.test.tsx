import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import type { DashboardCounts, DashboardMetrics } from '@/lib/dashboard/service';

// The preset buttons navigate to /dashboard?from=…&to=…; capture where they go.
const h = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('@/lib/dashboard/actions', () => ({
  refreshDashboardAction: vi.fn(),
  acknowledgeNotificationAction: vi.fn(),
  runSalesReportAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: h.push }) }));

const zeroMetrics: DashboardMetrics = {
  orderCountValid: 0,
  totalSales: '0.00',
  verifiedCollections: '0.00',
  outstandingBalance: '0.00',
  salesToday: '0.00',
  salesWeek: '0.00',
  salesMonth: '0.00',
  averageOrderValue: '0.00',
  fullPaymentSales: '0.00',
  totalLayawaySales: '0.00',
  layawayCollections: '0.00',
  pendingPayments: '0.00',
  cancelledAmount: '0.00',
  forfeitedAmount: '0.00',
  totalOfficialOrders: 0,
  collectionTrend: [],
};

const zeroCounts: DashboardCounts = {
  ordersActiveLayaway: 0,
  ordersAwaitingPayment: 0,
  ordersForFulfillment: 0,
  ordersClosed: 0,
  ordersCancelled: 0,
  pendingClaims: 0,
  confirmedClaimsForInvoice: 0,
  paymentsAwaitingVerification: 0,
  rtsInReview: 0,
  ownerApprovalsPending: 0,
  totalOfficialOrders: 0,
};

function renderView(over: Partial<Parameters<typeof DashboardView>[0]> = {}) {
  return render(
    <DashboardView
      counts={zeroCounts}
      metrics={zeroMetrics}
      salesByChannel={null}
      scrapTotal={{ totalAmount: '0', saleCount: 0 }}
      scrapByMaterial={[]}
      layaway={{
        active: 0,
        completed: 0,
        overdue: 0,
        forfeited: 0,
        totalQty: 0,
        createdToday: 0,
        createdMonth: 0,
        dueToday: 0,
        due7d: 0,
        totalItem: '0',
        totalInterest: '0',
        grandTotal: '0',
        totalPayment: '0',
        remainingBalance: '0',
      }}
      canExport={false}
      {...over}
    />,
  );
}

/** Freeze only Date (React's scheduler keeps real timers), click a preset, return the URL. */
function clickPresetAt(iso: string, key: string): string {
  vi.setSystemTime(new Date(iso));
  renderView();
  fireEvent.click(screen.getByTestId(`dash-range-${key}`));
  expect(h.push).toHaveBeenCalledTimes(1);
  return h.push.mock.calls[0]![0] as string;
}

beforeEach(() => {
  h.push.mockClear();
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Dashboard range presets use the Manila business day', () => {
  it('"This Month" starts on the 1st (mid-month)', () => {
    // 12:00 Manila on Sep 15.
    expect(clickPresetAt('2026-09-15T04:00:00Z', 'month')).toBe(
      '/dashboard?from=2026-09-01&to=2026-09-15',
    );
  });

  it('"This Month" starts on the 1st even late in the Manila day', () => {
    // 07:30 Manila on Sep 16 (still Sep 15 in UTC).
    expect(clickPresetAt('2026-09-15T23:30:00Z', 'month')).toBe(
      '/dashboard?from=2026-09-01&to=2026-09-16',
    );
  });

  it('"This Month" is already October at 04:00 Manila on Oct 1', () => {
    // 2026-09-30T20:00Z is 2026-10-01 04:00 in Manila.
    expect(clickPresetAt('2026-09-30T20:00:00Z', 'month')).toBe(
      '/dashboard?from=2026-10-01&to=2026-10-01',
    );
  });

  it('"Today" is the Manila date before 08:00 Manila', () => {
    expect(clickPresetAt('2026-09-15T23:30:00Z', 'today')).toBe(
      '/dashboard?from=2026-09-16&to=2026-09-16',
    );
  });

  it('"Last 7 days" spans 7 Manila days ending today', () => {
    expect(clickPresetAt('2026-09-15T23:30:00Z', '7d')).toBe(
      '/dashboard?from=2026-09-10&to=2026-09-16',
    );
  });

  it('"Last 30 days" crosses the month boundary', () => {
    expect(clickPresetAt('2026-09-30T20:00:00Z', '30d')).toBe(
      '/dashboard?from=2026-09-02&to=2026-10-01',
    );
  });

  it('highlights "This Month" when the URL range is the Manila month so far', () => {
    vi.setSystemTime(new Date('2026-09-15T23:30:00Z'));
    renderView({ rangeFrom: '2026-09-01', rangeTo: '2026-09-16' });
    expect(screen.getByTestId('dash-range-month')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByTestId('dash-range-today')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
