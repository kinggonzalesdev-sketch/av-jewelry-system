import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/page-primitives';

import { PaymentsWorkspace } from '@/components/payments/payments-workspace';
import { getGrantedPermissions, requireActiveStaff } from '@/lib/authz/guard';
import { listFinancers } from '@/lib/payments/financer';
import { listLayawayLedger } from '@/lib/payments/layaway-ledger';
import {
  listLayaways,
  listPayableOrders,
  overviewCards,
  paymentHistory,
  paymentVerificationQueue,
  resolveRange,
  type DateRangeKey,
} from '@/lib/payments/workspace';

export const metadata: Metadata = {
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
    queue,
    layaways,
    completed,
    history,
    payableOrders,
    permissions,
    financers,
    ledger,
    staff,
  ] = await Promise.all([
    overviewCards(bounds),
    paymentVerificationQueue(),
    listLayaways(['active', 'overdue', 'grace_period', 'forfeiture_eligible']),
    listLayaways(['completed']),
    paymentHistory(bounds),
    listPayableOrders(),
    getGrantedPermissions(),
    listFinancers(),
    listLayawayLedger(),
    requireActiveStaff(),
  ]);

  // Imported ledger accounts count toward the Active / Completed cards so an
  // import updates the visible summary counts immediately (§ refresh cards).
  const ledgerActive = ledger.filter((l) => l.status === 'active').length;
  const ledgerCompleted = ledger.filter((l) => l.status === 'completed').length;
  const mergedCards = {
    ...cards,
    activeLayaways: cards.activeLayaways + ledgerActive,
    completedLayaways: cards.completedLayaways + ledgerCompleted,
  };
  // Owner and Selected Admin both manage the imported ledger (upload, add payment,
  // edit, per-row delete). Clearing the WHOLE ledger is Owner-only — it is the one
  // irreversible, everything-at-once action, so an admin never sees it.
  const isOwner = staff.roleKey === 'owner';
  const canImportLayaway = isOwner || staff.roleKey === 'selected_admin';

  // Deep-link from a dashboard layaway card (?layaway=active|completed|all|…) to
  // preselect the matching section.
  const validSections = ['active', 'completed', 'all', 'overdue', 'forfeited'] as const;
  const initialSection =
    typeof params.layaway === 'string' &&
    (validSections as readonly string[]).includes(params.layaway)
      ? (params.layaway as (typeof validSections)[number])
      : undefined;

  return (
    <div>
      <PageHeader title="Layaway" />

      <PaymentsWorkspace
        cards={mergedCards}
        initialSection={initialSection}
        queue={queue.ok ? queue.rows : []}
        queueUnavailable={queue.ok ? null : queue.reason}
        layaways={layaways}
        completed={completed}
        history={history}
        range={range}
        payableOrders={payableOrders}
        financers={financers}
        ledger={ledger}
        canVerify={permissions.has('payment_verification')}
        canMonitorLayaway={permissions.has('layaway_monitoring')}
        canRequestForfeiture={permissions.has('initiate_high_risk_action')}
        canImportLayaway={canImportLayaway}
        canDeleteAllLedger={isOwner}
      />
    </div>
  );
}
