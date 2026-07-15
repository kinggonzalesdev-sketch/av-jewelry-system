import type { Metadata } from 'next';

import { PaymentsWorkspace } from '@/components/payments/payments-workspace';
import { getGrantedPermissions } from '@/lib/authz/guard';
import {
  layawayCollectionTrend,
  layawayStatusBreakdown,
  listLayaways,
  overviewCards,
  paymentHistory,
  paymentStatusBreakdown,
  paymentVerificationQueue,
  resolveRange,
  type DateRangeKey,
} from '@/lib/payments/workspace';

export const metadata: Metadata = {
  title: 'Payments & Layaway — A.V. Jewelry Operations',
};

const VALID_RANGES: DateRangeKey[] = ['today', '7d', '14d', '30d', 'month', 'custom'];

/**
 * Payments & Layaway (Bible §16, §17). Roadmap Phase 6.
 *
 * Real, database-backed. A sub-route of the Orders group, not a sixth bottom-nav
 * item: the approved navigation is exactly five items (§8.2) and is frozen.
 *
 * The date range is resolved SERVER-SIDE from the query string and validated
 * against the approved list — a client cannot widen it to something unapproved.
 *
 * Permission flags decide what renders and nothing more: every action re-checks
 * server-side, and the money rules are enforced in the database beneath that.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requested = typeof params.range === 'string' ? params.range : '30d';
  const range: DateRangeKey = VALID_RANGES.includes(requested as DateRangeKey)
    ? (requested as DateRangeKey)
    : '30d';

  const from = typeof params.from === 'string' ? params.from : undefined;
  const to = typeof params.to === 'string' ? params.to : undefined;
  const bounds = resolveRange(range, from, to);

  const [
    cards,
    paymentBreakdown,
    layawayBreakdown,
    trend,
    queue,
    layaways,
    completed,
    history,
    permissions,
  ] = await Promise.all([
    overviewCards(bounds),
    paymentStatusBreakdown(bounds),
    layawayStatusBreakdown(),
    layawayCollectionTrend(bounds),
    paymentVerificationQueue(),
    listLayaways(['active', 'overdue', 'grace_period', 'forfeiture_eligible']),
    listLayaways(['completed']),
    paymentHistory(bounds),
    getGrantedPermissions(),
  ]);

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Payments &amp; Layaway</h1>
        <p className="text-sm text-muted-foreground">
          Payment verification and the full layaway lifecycle.
        </p>
      </header>

      <PaymentsWorkspace
        cards={cards}
        paymentBreakdown={paymentBreakdown}
        layawayBreakdown={layawayBreakdown}
        trend={trend}
        queue={queue}
        layaways={layaways}
        completed={completed}
        history={history}
        range={range}
        canVerify={permissions.has('payment_verification')}
        canMonitorLayaway={permissions.has('layaway_monitoring')}
        canRequestForfeiture={permissions.has('initiate_high_risk_action')}
      />
    </div>
  );
}
