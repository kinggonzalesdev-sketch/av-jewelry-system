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
      notifications={[]}
      audit={[]}
      results={[]}
      query=""
      followUps={{
        total: 3,
        categories: [
          {
            key: 'deposit_overdue',
            label: 'Deposit overdue',
            description: 'past the hold',
            count: 2,
            href: '/orders/payments',
            tone: 'danger',
          },
          {
            key: 'invoice_not_sent',
            label: 'Invoice not yet sent',
            description: 'drafts',
            count: 1,
            href: '/orders/invoice',
            tone: 'warning',
          },
          {
            key: 'failed_delivery',
            label: 'Failed delivery / to investigate',
            description: 'held',
            count: null,
            href: '/orders/fulfillment',
            tone: 'danger',
          },
        ],
      }}
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

  it('renders the primary tabs', () => {
    renderView();
    for (const t of ['dashboard', 'reports', 'search', 'reminders', 'audit']) {
      expect(screen.getByTestId(`dash-tab-${t}`)).toBeInTheDocument();
    }
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
});

describe('DashboardView — Follow-up Queue tab', () => {
  it('shows categorised follow-ups from real counts, "—" for an unavailable read', () => {
    renderView();
    fireEvent.click(screen.getByTestId('dash-tab-follow-ups'));

    const queue = screen.getByTestId('follow-up-queue');
    expect(queue).toBeInTheDocument();
    // Deposit overdue is a real live count (2).
    expect(
      within(screen.getByTestId('follow-up-deposit_overdue')).getByText('2'),
    ).toBeInTheDocument();
    // A failed read shows "—", never a false zero.
    expect(
      within(screen.getByTestId('follow-up-failed_delivery')).getByText('—'),
    ).toBeInTheDocument();
    // Each category links to the workspace that owns the action.
    expect(screen.getByTestId('follow-up-invoice_not_sent')).toHaveAttribute(
      'href',
      '/orders/invoice',
    );
  });
});
