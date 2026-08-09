import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { PaymentsWorkspace } from '@/components/payments/payments-workspace';
import { canOpenPage, getGrantedPermissions, requireActiveStaff } from '@/lib/authz/guard';
import { getAdminNameContext } from '@/lib/authz/admin-name';
import { listCaptureItems } from '@/lib/orders/service';
import { listCaptureCustomers } from '@/lib/live/batches';
import { listDetectedFinancers, listFinancers } from '@/lib/payments/financer';
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
// Always render fresh from Supabase (never a cached route) so every device sees
// the same official data on load. The page already reads auth cookies (dynamic);
// this makes the intent explicit and guards against future caching.
export const dynamic = 'force-dynamic';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Page access (Portal & Access). A member without this permission cannot open
  // the page — by link OR by typing the URL. A Super Admin holds it implicitly.
  if (!(await canOpenPage('nav_layaway'))) notFound();
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
    activeItems,
    captureCustomers,
    admins,
    detectedFinancers,
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
    listCaptureItems(),
    listCaptureCustomers(),
    getAdminNameContext(),
    listDetectedFinancers(),
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
  // Row-level Edit / Delete of a layaway account are now assignable in Manage
  // Access (Owner request). The Owner holds both implicitly; anyone else needs the
  // explicit grant. Gating each button by its own key means a member can be given
  // Edit without Delete (or the reverse). The RPCs re-check the same keys, so a
  // hidden button is never the control (Bible §30.3 r2).
  const canEditLayaway = permissions.has('layaway_edit');
  const canDeleteLayaway = permissions.has('layaway_delete');
  // Creating a new layaway account (New Entry) is now assignable too. Existing
  // Admins were backfilled this grant, so nothing breaks; the create RPC re-checks
  // the same key. The Owner holds it implicitly.
  const canCreateLayaway = permissions.has('layaway_create');

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
      {/* The "Layaway" title renders INSIDE the workspace's sticky top section so it
          pins with the summary cards + date filters (Owner request). */}
      <PaymentsWorkspace
        title="Layaway"
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
        canEditLayaway={canEditLayaway}
        canDeleteLayaway={canDeleteLayaway}
        canDeleteAllLedger={isOwner}
        canImportExport={isOwner}
        activeItems={activeItems}
        captureCustomers={captureCustomers.map((c) => c.displayName)}
        admins={admins}
        detectedFinancers={detectedFinancers}
        canCreateLayaway={canCreateLayaway}
      />
    </div>
  );
}
