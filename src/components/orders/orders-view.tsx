'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import type { OrderListRow, OrdersResult, PaymentStatus } from '@/lib/orders/service';
import { formatPeso } from '@/lib/payments/format';
import { EmptyState } from '@/components/states/empty-state';
import { StatusBadge, ReadError, type BadgeTone } from '@/components/ui/page-primitives';
import { cn } from '@/lib/utils';

/**
 * Official Orders list — real, read-only, now with the approved status cards,
 * search, and filters (prototype-verbatim structure, REAL data).
 *
 * Honesty rules that must not regress:
 *   - A failed read shows an explicit error, never an empty table or a zero.
 *   - The status cards and the "X of Y" note count the ORDERS ACTUALLY LOADED
 *     (up to the server limit). They are not a separate aggregation and never a
 *     fabricated total — the note says so.
 *   - Every peso figure is authoritative (getOrderBalance); an order whose
 *     balance could not be read shows "—" and is surfaced as "Balance unavailable".
 *   - Row actions LINK to the workspaces that own them (Payments / Fulfillment);
 *     nothing here re-implements or bypasses a guarded action.
 *
 * "Reprint Last" is intentionally NOT here yet: it is a printer action and is
 * surfaced once the honest print-service exists (see the printer integration
 * phase). A button that cannot truthfully print would violate the honesty rule.
 */

function humanize(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid_in_full: 'Paid in Full',
  partial: 'Partially paid',
  awaiting: 'Awaiting payment',
  unavailable: 'Balance unavailable',
};

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  paid_in_full: 'gold',
  partial: 'warning',
  awaiting: 'neutral',
  unavailable: 'danger',
};

/** Order statuses that count as "Ship Confirm" (shipping / pickup confirmed). */
const SHIP_CONFIRMED = new Set([
  'for_shipping_or_pickup',
  'approved_for_release',
  'dispatched_or_picked_up',
]);

function fulfillmentTone(status: string): BadgeTone {
  if (['for_shipping', 'for_pickup'].includes(status)) return 'gold';
  if (['dispatched', 'picked_up', 'completed', 'approved_for_release'].includes(status)) {
    return 'strong';
  }
  if (['held', 'failed_delivery', 'unclaimed_pickup'].includes(status)) return 'warning';
  return 'neutral';
}

/**
 * The Owner-approved Orders status cards, in order (reference mockup):
 * Total · For Invoice · For Reminder · For Prepare · For Confirm · Ship Confirm ·
 * Keep · For Cancel · Cancelled · Unverified Payment · For Layaway.
 *
 * Each card both COUNTS and FILTERS the loaded orders. Cards map to REAL signals
 * (official_orders.status / paymentStatus / layaway). "Keep" and "For Cancel"
 * have no backing concept in the current model yet, so they show an honest 0 —
 * never a fabricated count.
 */
type CardKey =
  | 'all'
  | 'for_invoice'
  | 'for_reminder'
  | 'for_prepare'
  | 'for_confirm'
  | 'ship_confirm'
  | 'keep'
  | 'for_cancel'
  | 'cancelled'
  | 'unverified_pay'
  | 'for_layaway';

const CARD_DEFS: Array<{ key: CardKey; label: string; icon: string; tone: BadgeTone }> = [
  { key: 'all', label: 'Total', icon: '▤', tone: 'gold' },
  { key: 'for_invoice', label: 'For Invoice', icon: '▦', tone: 'warning' },
  { key: 'for_reminder', label: 'For Reminder', icon: '⏱', tone: 'neutral' },
  { key: 'for_prepare', label: 'For Prepare', icon: '◈', tone: 'neutral' },
  { key: 'for_confirm', label: 'For Confirm', icon: '▣', tone: 'gold' },
  { key: 'ship_confirm', label: 'Ship Confirm', icon: '➤', tone: 'strong' },
  { key: 'keep', label: 'Keep', icon: '❏', tone: 'neutral' },
  { key: 'for_cancel', label: 'For Cancel', icon: '⚠', tone: 'warning' },
  { key: 'cancelled', label: 'Cancelled', icon: '✕', tone: 'danger' },
  { key: 'unverified_pay', label: 'Unverified Payment', icon: '⚠', tone: 'warning' },
  { key: 'for_layaway', label: 'For Layaway', icon: '₱', tone: 'gold' },
];

/** Icon-badge tint per tone (matches the mockup's coloured card icons). */
const CARD_ICON_TONE: Record<BadgeTone, string> = {
  gold: 'bg-gold/15 text-gold-strong',
  neutral: 'bg-secondary text-muted-foreground',
  strong: 'bg-foreground/10 text-foreground',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-destructive/10 text-destructive',
};

function OrderRow({ order }: { order: OrderListRow }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-3 py-2.5">
        <StatusBadge label={humanize(order.status)} tone="neutral" />
      </td>
      <td className="px-3 py-2.5 font-mono text-xs">{order.orderNumber}</td>
      <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
        {order.invoiceNumber}
      </td>
      <td className="px-3 py-2.5 font-medium">{order.customerDisplayName}</td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {order.paymentStatus === 'unavailable'
          ? '—'
          : formatPeso(order.totalAmountPayable)}
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge
          label={PAYMENT_LABEL[order.paymentStatus]}
          tone={PAYMENT_TONE[order.paymentStatus]}
        />
        {order.paymentStatus === 'partial' ? (
          <span className="ml-1 text-xs text-muted-foreground">
            {formatPeso(order.outstandingBalance)} due
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5">
        {order.fulfillmentStatus ? (
          <StatusBadge
            label={humanize(order.fulfillmentStatus)}
            tone={fulfillmentTone(order.fulfillmentStatus)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-right">
        <div className="flex justify-end gap-1.5">
          <Link
            href="/orders/payments"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Payment
          </Link>
          <Link
            href="/orders/fulfillment"
            className="rounded-md border border-border px-2 py-1 text-xs hover:bg-accent"
          >
            Fulfillment
          </Link>
        </div>
      </td>
    </tr>
  );
}

function matchesCard(order: OrderListRow, key: CardKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'for_invoice':
      return order.status === 'invoiced';
    case 'for_reminder':
      return order.status === 'awaiting_required_payment';
    case 'for_prepare':
      return order.status === 'for_preparation';
    case 'for_confirm':
      return order.status === 'required_payment_verified';
    case 'ship_confirm':
      return SHIP_CONFIRMED.has(order.status);
    case 'cancelled':
      return order.status === 'cancelled';
    case 'unverified_pay':
      // Closest real signal: an order with no verified payment yet.
      return order.paymentStatus === 'awaiting';
    case 'for_layaway':
      return order.layawayStatus !== null;
    case 'keep':
    case 'for_cancel':
      // No backing concept in the current model — honest 0, never fabricated.
      return false;
  }
}

export function OrdersView({ result }: { result: OrdersResult }) {
  // Hooks must run unconditionally; the error/empty branches come after. Memoized
  // so the derived useMemo hooks below keep a stable dependency identity.
  const rows = useMemo(() => (result.ok ? result.rows : []), [result]);

  const [card, setCard] = useState<CardKey>('all');
  const [query, setQuery] = useState('');
  const [fulfillmentFilter, setFulfillmentFilter] = useState('all');

  // Distinct fulfillment statuses present in the loaded data — the filter only
  // offers values that actually exist, so it never implies data we do not have.
  const fulfillmentOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const o of rows) if (o.fulfillmentStatus) seen.add(o.fulfillmentStatus);
    return [...seen].sort();
  }, [rows]);

  const counts = useMemo(() => {
    const c = Object.fromEntries(CARD_DEFS.map((d) => [d.key, 0])) as Record<
      CardKey,
      number
    >;
    for (const o of rows)
      for (const d of CARD_DEFS) if (matchesCard(o, d.key)) c[d.key] += 1;
    return c;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((o) => {
      if (!matchesCard(o, card)) return false;
      if (fulfillmentFilter === 'none' && o.fulfillmentStatus !== null) return false;
      if (
        fulfillmentFilter !== 'all' &&
        fulfillmentFilter !== 'none' &&
        o.fulfillmentStatus !== fulfillmentFilter
      ) {
        return false;
      }
      if (!q) return true;
      return [o.orderNumber, o.invoiceNumber, o.customerDisplayName]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [rows, card, query, fulfillmentFilter]);

  // A FAILED read is not "no orders" — say so loudly (the session's hard rule).
  if (!result.ok) {
    return <ReadError title="Orders could not be loaded" detail={result.reason} />;
  }

  // NOTE: an empty dataset does NOT hide the screen's features. The status cards,
  // search, and filters render even at zero so the Orders screen always shows its
  // structure — the empty state lives in the TABLE region only. (Orders populate
  // from the workflow: Live → Confirm → Invoice → Approve & Send.)

  return (
    <div className="space-y-4">
      {/* Approved status cards (11) — real counts of the loaded orders; each is a
          quick filter with a coloured icon badge. Active card is ringed in the
          brand accent. "Keep" / "For Cancel" have no backing yet → honest 0. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-11">
        {CARD_DEFS.map((def) => {
          const active = card === def.key;
          return (
            <button
              key={def.key}
              type="button"
              onClick={() => setCard(def.key)}
              aria-pressed={active}
              data-testid={`orders-card-${def.key}`}
              className={cn(
                'flex min-h-[84px] flex-col items-start gap-1.5 rounded-xl border bg-card p-2.5 text-left transition-colors',
                active
                  ? 'border-gold ring-1 ring-gold'
                  : 'border-border hover:border-gold/40',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg text-sm',
                  CARD_ICON_TONE[def.tone],
                )}
              >
                {def.icon}
              </span>
              <span className="text-[10px] font-medium uppercase leading-tight tracking-wide text-muted-foreground [hyphens:auto]">
                {def.label}
              </span>
              <span className="text-xl font-bold leading-none tabular-nums text-foreground">
                {counts[def.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Search + filters — operate on the loaded set (client-side), honestly
          labelled. Search spans order no., invoice no., and customer name. */}
      <div className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order no., invoice no., or customer"
            aria-label="Search orders"
            data-testid="orders-search"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
          />
          <select
            value={fulfillmentFilter}
            onChange={(e) => setFulfillmentFilter(e.target.value)}
            aria-label="Filter by fulfillment status"
            data-testid="orders-filter-fulfillment"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          >
            <option value="all">All fulfillment</option>
            <option value="none">No fulfillment record</option>
            {fulfillmentOptions.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Showing <span className="tabular-nums">{filtered.length}</span> of{' '}
          <span className="tabular-nums">{rows.length}</span> loaded Official Orders.
          Filtering and counts apply to the orders loaded on this page.
        </p>
      </div>

      {/* Table region: honest empty state at zero, "no matches" when filters
          exclude everything, otherwise the table. */}
      {rows.length === 0 ? (
        <EmptyState
          title="No Official Orders yet"
          description="Approve & Send an Invoice to create the first Official Order. New Entry (above) starts the capture flow on Live."
        />
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
          No orders match these filters.
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Order No.</th>
                  <th className="px-3 py-2 font-medium">Invoice No.</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Fulfillment</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <OrderRow key={order.officialOrderId} order={order} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
