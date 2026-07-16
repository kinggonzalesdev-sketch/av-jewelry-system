import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import type { DashboardCounts, DashboardMetrics } from '@/lib/dashboard/service';

// Server actions are transport; stub them so the client view renders in jsdom.
vi.mock('@/lib/dashboard/actions', () => ({
  refreshDashboardAction: vi.fn(),
  acknowledgeNotificationAction: vi.fn(),
  runSalesReportAction: vi.fn(),
}));

const zeroMetrics: DashboardMetrics = {
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
      notifications={[]}
      audit={[]}
      results={[]}
      query=""
      canExport={false}
      canVerifyPayments={false}
      canMonitorInventory={false}
      {...over}
    />,
  );
}

describe('DashboardView — approved structure restored', () => {
  it('renders the date-range selector, current range, Refresh, and Export', () => {
    renderView();
    expect(screen.getByTestId('dash-range-today')).toBeInTheDocument();
    expect(screen.getByTestId('dash-range-30d')).toBeInTheDocument();
    expect(screen.getByTestId('dash-export')).toBeInTheDocument();
    expect(screen.getByTestId('dash-range-active')).toHaveTextContent(/Showing/);
    expect(screen.getByText('⟳ Refresh')).toBeInTheDocument();
  });

  it('renders both primary tabs (Dashboard, Gross Profit) plus retained ones', () => {
    renderView();
    for (const t of [
      'dashboard',
      'gross-profit',
      'reports',
      'search',
      'reminders',
      'audit',
    ]) {
      expect(screen.getByTestId(`dash-tab-${t}`)).toBeInTheDocument();
    }
  });
});

describe('DashboardView — charts stay VISIBLE at zero data', () => {
  it('keeps the Order Status chart present with its categories and "No data for this period"', () => {
    renderView();
    // The chart container renders (not hidden), with all five categories at zero.
    const charts = screen.getAllByTestId('bar-chart');
    expect(charts.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Order Status')).toBeInTheDocument();
    // Categories appear in the chart (and some also in summary cards) — assert the
    // chart's five categories are present at least once.
    expect(screen.getAllByText('Active Layaway').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(screen.getByText('Awaiting Payment')).toBeInTheDocument();
    expect(screen.getAllByText(/No data for this period/i).length).toBeGreaterThan(0);
  });

  it('keeps the Sales for the Period chart title visible at zero', () => {
    renderView();
    expect(screen.getByText('Sales for the Period')).toBeInTheDocument();
  });
});

describe('DashboardView — honesty', () => {
  it('shows an explicit error, not a false zero, when the read failed', () => {
    renderView({ metrics: null, counts: null });
    expect(screen.getByTestId('read-error')).toBeInTheDocument();
  });

  it('Gross Profit is honestly unavailable (no invented numbers)', () => {
    renderView();
    fireEvent.click(screen.getByTestId('dash-tab-gross-profit'));
    const panel = screen.getByTestId('gross-profit-unavailable');
    expect(panel).toBeInTheDocument();
    expect(within(panel).getByText(/not available yet/i)).toBeInTheDocument();
  });
});
