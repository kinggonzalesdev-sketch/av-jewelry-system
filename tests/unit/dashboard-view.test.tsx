import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardView } from '@/components/dashboard/dashboard-view';
import type { DashboardCounts, DashboardMetrics } from '@/lib/dashboard/service';

// Server actions are transport; stub them so the client view renders in jsdom.
vi.mock('@/lib/dashboard/actions', () => ({
  refreshDashboardAction: vi.fn(),
  acknowledgeNotificationAction: vi.fn(),
  runSalesReportAction: vi.fn(),
}));

// The range selector navigates via the App Router; stub it for jsdom.
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
      moneyInTransit={{
        ok: true,
        data: {
          awaitingVerification: '5000.00',
          customerPending: '12000.00',
          inTransitToCollect: '8000.00',
          riderToCollect: '5000.00',
          lbcToCollect: '3000.00',
          collectedUnremitted: '2000.00',
        },
      }}
      scrapTotal={{ totalAmount: '0', saleCount: 0 }}
      scrapSales={[]}
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

describe('DashboardView — approved structure restored', () => {
  it('renders the date-range selector, current range, and Refresh', () => {
    renderView();
    expect(screen.getByTestId('dash-range-today')).toBeInTheDocument();
    expect(screen.getByTestId('dash-range-30d')).toBeInTheDocument();
    expect(screen.getByTestId('dash-range-active')).toHaveTextContent(/Showing/);
    expect(screen.getByText('⟳ Refresh')).toBeInTheDocument();
  });

  // Export Reports is not merely disabled without the permission — it is not
  // offered at all, so nobody is invited to press something that would be refused.
  it('offers Export Reports only with the export permission', () => {
    renderView();
    expect(screen.queryByTestId('dash-export')).not.toBeInTheDocument();
  });

  // Every tab was removed by Owner request, so there is no tab bar left at all —
  // one tab is a label, not a choice, and rendering the row would be dead space.
  it('renders no tab bar', () => {
    renderView();
    for (const t of [
      'dashboard',
      'reports',
      'follow-ups',
      'search',
      'reminders',
      'audit',
    ]) {
      expect(screen.queryByTestId(`dash-tab-${t}`)).not.toBeInTheDocument();
    }
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('no longer renders the Sales summary report (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByText('Sales summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Run Report')).not.toBeInTheDocument();
  });

  it('keeps Export Reports, and it performs the real export in place', () => {
    renderView({ canExport: true });
    const btn = screen.getByTestId('dash-export');
    expect(btn).toBeEnabled();
    expect(btn).toHaveTextContent('Export Reports');
  });

  it('no longer renders the Disassembly Report tab (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByTestId('dash-tab-disassembly-report')).not.toBeInTheDocument();
  });

  it('no longer renders the Gross Profit tab (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByTestId('dash-tab-gross-profit')).not.toBeInTheDocument();
  });
});

describe('DashboardView — charts stay VISIBLE at zero data', () => {
  it('no longer shows the Order Status chart (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByText('Order Status')).not.toBeInTheDocument();
  });

  it('no longer shows the Sales for the Period / Sales Snapshot / Work Queues charts (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByText('Sales for the Period')).not.toBeInTheDocument();
    expect(screen.queryByText('Sales Snapshot')).not.toBeInTheDocument();
    expect(screen.queryByText('Work Queues')).not.toBeInTheDocument();
  });

  it('shows Money in Transit from real SQL sums', () => {
    renderView();
    const mit = screen.getByTestId('money-in-transit');
    expect(mit).toBeInTheDocument();
    expect(within(mit).getByText('₱5,000')).toBeInTheDocument();
    expect(within(mit).getByText('₱12,000')).toBeInTheDocument();
    expect(within(mit).getByText('₱8,000')).toBeInTheDocument();
  });

  it('shows an explicit error, not ₱0, when money-in-transit could not be read', () => {
    renderView({ moneyInTransit: { ok: false } });
    expect(screen.getByText(/Money in Transit unavailable/i)).toBeInTheDocument();
  });
});

describe('DashboardView — honesty', () => {
  it('shows an explicit error, not a false zero, when the read failed', () => {
    renderView({ metrics: null, counts: null });
    expect(screen.getByTestId('read-error')).toBeInTheDocument();
  });

  it('no longer renders the Disassembly Report placeholder (removed by Owner request)', () => {
    renderView();
    expect(screen.queryByTestId('disassembly-unavailable')).not.toBeInTheDocument();
  });

  // Regression: the Layaway figures used to read ONLY order-derived arrangements,
  // so a shop whose layaways all live in the imported ledger saw "No data yet" and
  // ₱0 while hundreds of real accounts existed. The two sets are disjoint and must
  // be summed.
  it('Layaway money includes the imported ledger, not just derived arrangements', () => {
    renderView({
      layaway: {
        active: 554,
        completed: 197,
        overdue: 105,
        forfeited: 0,
        totalQty: 858,
        createdToday: 0,
        createdMonth: 0,
        dueToday: 19,
        due7d: 150,
        totalItem: '21037533.00',
        totalInterest: '1292142.00',
        grandTotal: '22329599.00',
        totalPayment: '5679949.00',
        remainingBalance: '16649650.00',
      },
    });
    // Derived arrangements are ₱0 here, so the ledger figures must show through.
    expect(screen.getAllByText('₱22,329,599').length).toBeGreaterThan(0);
    expect(screen.getAllByText('₱5,679,949').length).toBeGreaterThan(0);
    // Active Layaway must follow the Layaway module too — counts.ordersActiveLayaway
    // is 0 here, so a "0" card would mean it is still reading the wrong source.
    expect(screen.getAllByText('554').length).toBeGreaterThan(0);
  });
});

/**
 * The Follow-up Queue tab was REMOVED from Dashboard Profile by Owner request.
 * The queue itself (getFollowUpQueue + FollowUpCards) is untouched and still
 * covered by its own suite — only its place on this page is gone.
 */
describe('DashboardView — removed tabs', () => {
  it('no longer renders the Follow-up Queue on the dashboard', () => {
    renderView();
    expect(screen.queryByTestId('dash-tab-follow-ups')).not.toBeInTheDocument();
    expect(screen.queryByTestId('follow-up-queue')).not.toBeInTheDocument();
  });
});
