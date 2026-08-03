'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { SendAllInvoices } from '@/components/orders/send-all-invoices';
import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';

import type { OrderListRow, OrdersResult, PaymentStatus } from '@/lib/orders/service';
import type { KeepLayawayRow } from '@/lib/payments/layaway-ledger';
import { Money } from '@/components/shell/privacy';
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
  paid_in_full: 'success',
  partial: 'warning',
  awaiting: 'neutral',
  unavailable: 'danger',
};

/**
 * Order statuses that count as "Ship Confirm" — release APPROVED or already
 * dispatched. `for_shipping_or_pickup` deliberately moved OUT: it is the
 * awaiting-release stage and now has its own For Shipping card, and the two
 * buckets must stay disjoint or an order would be counted twice.
 */
const SHIP_CONFIRMED = new Set([
  'approved_for_release',
  'exceptional_release_pending',
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
 * The Owner-approved Orders status cards, in order:
 * Total · For Invoice · For Reminder · For Prepare · For Confirm · For Shipping ·
 * Ship Confirm · Delivery · Pickup · For Layaway · Keep · For Cancel · Cancelled ·
 * Unverified Payment · Completed.
 *
 * These same definitions drive the order-flow dropdown, which is why the labels
 * are written once here rather than repeated there.
 *
 * Each card both COUNTS and FILTERS the loaded orders. Cards map to REAL signals
 * (official_orders.status / paymentStatus / layaway). For Layaway, Keep, and For
 * Cancel are now real order statuses (set when a For-Prepare order is transferred
 * to that destination), each with its own card.
 */
type CardKey =
  | 'all'
  | 'for_invoice'
  | 'for_reminder'
  | 'for_prepare'
  | 'for_confirm'
  | 'for_shipping'
  | 'ship_confirm'
  | 'delivery'
  | 'pickup'
  | 'for_layaway'
  | 'keep'
  | 'for_cancel'
  | 'cancelled'
  | 'unverified_pay'
  | 'completed';

const CARD_DEFS: Array<{ key: CardKey; label: string; icon: string; tone: BadgeTone }> = [
  { key: 'all', label: 'Total', icon: '▤', tone: 'gold' },
  { key: 'for_invoice', label: 'For Invoice', icon: '▦', tone: 'warning' },
  { key: 'for_reminder', label: 'For Reminder', icon: '⏱', tone: 'neutral' },
  { key: 'for_prepare', label: 'For Prepare', icon: '◈', tone: 'neutral' },
  { key: 'for_shipping', label: 'For Shipping', icon: '📦', tone: 'neutral' },
  { key: 'ship_confirm', label: 'Ship Confirm', icon: '➤', tone: 'strong' },
  // For-Prepare transfer destinations (Orders Workflow).
  { key: 'delivery', label: 'For Delivery', icon: '🛵', tone: 'gold' },
  { key: 'pickup', label: 'Pickup', icon: '🏬', tone: 'gold' },
  { key: 'for_layaway', label: 'For Layaway', icon: '❐', tone: 'neutral' },
  { key: 'keep', label: 'Keep', icon: '❏', tone: 'neutral' },
  { key: 'for_cancel', label: 'For Cancel', icon: '⚠', tone: 'warning' },
  { key: 'cancelled', label: 'Cancelled', icon: '✕', tone: 'danger' },
  { key: 'unverified_pay', label: 'Pending Payment', icon: '⚠', tone: 'warning' },
  { key: 'completed', label: 'Completed', icon: '✓', tone: 'strong' },
];

/** Order statuses that count as GENUINELY completed — the final item handoff is
 *  confirmed (delivered / picked up / released), or the order is closed. The
 *  conflated `dispatched_or_picked_up` is deliberately EXCLUDED: shipped ≠
 *  completed (spec §7). Layaway lives under Payments & Layaway, not here. */
const COMPLETED_STATUSES = new Set([
  'completed',
  'closed',
  'delivered',
  'picked_up',
  'released',
]);

/**
 * Statuses that OVERRIDE a fulfillment destination: a cancelled, awaiting-cancel,
 * or completed order must leave its destination card (Delivery / Pickup / For
 * Shipping / For Layaway / Keep) and show under its true card — so the modal's
 * status badge always matches the section the order sits in.
 */
const DESTINATION_OVERRIDDEN = new Set([
  'cancelled',
  'for_cancel',
  ...COMPLETED_STATUSES,
]);

/** Icon-badge tint per tone (matches the mockup's coloured card icons). */
const CARD_ICON_TONE: Record<BadgeTone, string> = {
  gold: 'bg-gold/15 text-gold-strong',
  neutral: 'bg-secondary text-muted-foreground',
  strong: 'bg-foreground/10 text-foreground',
  warning: 'bg-amber-100 text-amber-800',
  danger: 'bg-destructive/10 text-destructive',
  success: 'bg-green-600/10 text-green-700',
};

function OrderRow({
  order,
  onOpen,
}: {
  order: OrderListRow;
  onOpen: (order: OrderListRow) => void;
}) {
  // The whole row opens the in-page Order Details drawer (no navigation). Keyboard
  // accessible: focusable with Enter/Space. The cells hold only text/badges (no
  // nested interactive elements), so the row-level handler is unambiguous.
  return (
    <tr
      role="button"
      tabIndex={0}
      onClick={() => onOpen(order)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(order);
        }
      }}
      data-testid="order-row"
      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/60 focus:bg-accent/60 focus:outline-none"
    >
      <td className="px-3 py-2.5">
        <StatusBadge label={humanize(order.status)} tone="neutral" />
      </td>
      <td
        className="truncate px-3 py-2.5 font-mono text-xs"
        title={order.waybillNumber || order.orderNumber}
      >
        {order.waybillNumber || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="truncate px-3 py-2.5 font-mono text-xs" title={order.invoiceNumber || undefined}>
        {order.invoiceNumber || <span className="text-muted-foreground">—</span>}
      </td>
      <td className="truncate px-3 py-2.5 font-medium" title={order.customerDisplayName}>
        {order.customerDisplayName}
        {order.orderSource === 'walk_in' ? (
          <span className="ml-1.5 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold-strong">
            Walk-in
          </span>
        ) : null}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 pr-6 text-right tabular-nums">
        {order.paymentStatus === 'unavailable' ? (
          '—'
        ) : (
          <Money amount={order.totalAmountPayable} />
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-center">
        <StatusBadge
          label={PAYMENT_LABEL[order.paymentStatus]}
          tone={PAYMENT_TONE[order.paymentStatus]}
        />
        {order.paymentStatus === 'partial' ? (
          <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
            <Money amount={order.outstandingBalance} /> due
          </span>
        ) : null}
      </td>
      <td className="px-3 py-2.5 text-center">
        {order.fulfillmentStatus ? (
          <StatusBadge
            label={humanize(order.fulfillmentStatus)}
            tone={fulfillmentTone(order.fulfillmentStatus)}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs font-medium text-gold-strong">
        View ›
      </td>
    </tr>
  );
}

/** ms since epoch for an ISO string, or 0 when null/blank. */
function ts(s: string | null): number {
  if (!s) return 0;
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * ONE latest-first comparator for every Orders result list (Owner request).
 *
 * The backend already returns rows in updated_at-first order; this mirrors that
 * precedence exactly so the client never re-sorts by order number and never
 * contradicts the query: latest `updated_at` → latest `created_at` → permanent id
 * as the only stable tie-breaker. The Completed card overrides the primary key with
 * `completed_at` (a viewed order must not jump above a more recently completed one).
 */
function latestFirst(a: OrderListRow, b: OrderListRow): number {
  const au = ts(a.updatedAt) || ts(a.createdAt);
  const bu = ts(b.updatedAt) || ts(b.createdAt);
  if (bu !== au) return bu - au;
  const ac = ts(a.createdAt);
  const bc = ts(b.createdAt);
  if (bc !== ac) return bc - ac;
  // Permanent id, descending — the final stable tie-breaker.
  return a.officialOrderId < b.officialOrderId ? 1 : a.officialOrderId > b.officialOrderId ? -1 : 0;
}

function completedFirst(a: OrderListRow, b: OrderListRow): number {
  const ac = ts(a.completedAt);
  const bc = ts(b.completedAt);
  if (bc !== ac) return bc - ac;
  return latestFirst(a, b);
}

/** Sort a card's rows latest-first — Completed by completed_at, everything else by
 *  the shared updated_at-first order. */
export function sortOrdersForCard(rows: OrderListRow[], card: CardKey): OrderListRow[] {
  return [...rows].sort(card === 'completed' ? completedFirst : latestFirst);
}

function matchesCard(order: OrderListRow, key: CardKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'for_invoice':
      // Leaves this card once routed to a destination (Transfer to Destination is
      // now available from For Invoice) — it then shows under that destination.
      return order.status === 'invoiced' && !order.fulfillmentDestination;
    case 'for_reminder':
      return (
        order.status === 'awaiting_required_payment' && !order.fulfillmentDestination
      );
    case 'for_prepare':
      // A For-Prepare order LEAVES this card once it is transferred to a
      // destination (Orders Workflow) — it then shows under that destination.
      return order.status === 'for_preparation' && !order.fulfillmentDestination;
    case 'for_confirm':
      return order.status === 'required_payment_verified';
    case 'for_shipping':
      // Awaiting release: routed to shipping, or sitting at the shipping stage.
      // Once the order is Ship-Confirmed (status approved_for_release) — or closed /
      // cancelled — it LEAVES this card even though it keeps
      // fulfillment_destination = 'shipping', so it never shows "Ship Confirm",
      // "Cancelled", etc. here.
      return (
        !SHIP_CONFIRMED.has(order.status) &&
        !DESTINATION_OVERRIDDEN.has(order.status) &&
        (order.status === 'for_shipping_or_pickup' ||
          order.fulfillmentDestination === 'shipping')
      );
    case 'ship_confirm':
      return SHIP_CONFIRMED.has(order.status);
    case 'delivery':
      // A cancelled / for-cancel / completed order leaves the Delivery card and
      // shows under its true status, matching the modal's status badge.
      return (
        !DESTINATION_OVERRIDDEN.has(order.status) &&
        order.fulfillmentDestination === 'delivery'
      );
    case 'pickup':
      return (
        !DESTINATION_OVERRIDDEN.has(order.status) &&
        order.fulfillmentDestination === 'pickup'
      );
    case 'for_layaway':
      // Real status now; also match legacy rows tagged only by destination. Once an
      // order is Set Up as a layaway it leaves this card — it now lives in the
      // Layaway ledger (Payments & Layaway).
      return (
        !order.convertedToLayaway &&
        !DESTINATION_OVERRIDDEN.has(order.status) &&
        (order.status === 'for_layaway' || order.fulfillmentDestination === 'layaway')
      );
    case 'keep':
      return (
        !DESTINATION_OVERRIDDEN.has(order.status) &&
        (order.status === 'keep' || order.fulfillmentDestination === 'keep')
      );
    case 'cancelled':
      return order.status === 'cancelled';
    case 'unverified_pay':
      // Closest real signal: an order with no verified payment yet.
      return order.paymentStatus === 'awaiting';
    case 'completed':
      // Genuinely completed — final handoff confirmed (not merely shipped).
      return COMPLETED_STATUSES.has(order.status);
    case 'for_cancel':
      // Awaiting a cancellation decision: a Cancel Order request parks the order
      // here (status 'for_cancel'). Once the cancellation is APPROVED (status
      // 'cancelled') it LEAVES this card — even though it keeps
      // fulfillment_destination = 'cancelled' — and shows only under Cancelled.
      return (
        order.status !== 'cancelled' &&
        (order.status === 'for_cancel' || order.fulfillmentDestination === 'cancelled')
      );
  }
}

export function OrdersView({
  result,
  openForInvoice = false,
  keepLayaways = [],
  newOrderAction,
}: {
  result: OrdersResult;
  /** The + New Order control, rendered in the top action row so Send All Invoices
   *  can sit beside it — the active-card state that gates it lives HERE. */
  newOrderAction?: React.ReactNode;
  /** Open on the For Invoice card (e.g. arriving from the old /orders/invoice). */
  openForInvoice?: boolean;
  /** Layaway accounts marked KEEP — surfaced under the Keep card (Owner request). */
  keepLayaways?: KeepLayawayRow[];
}) {
  // Hooks must run unconditionally; the error/empty branches come after. Memoized
  // so the derived useMemo hooks below keep a stable dependency identity.
  const rows = useMemo(() => (result.ok ? result.rows : []), [result]);

  const router = useRouter();
  const [card, setCard] = useState<CardKey>(openForInvoice ? 'for_invoice' : 'all');
  // The order whose details modal is open (null = closed). Opening it navigates
  // nowhere, so search/filters/scroll are preserved automatically.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [shipDate, setShipDate] = useState('');

  /**
   * Fulfillment status — a SECOND, independent filter alongside the order-flow
   * dropdown (restored by Owner request).
   *
   * The two are orthogonal, not duplicates: order flow says which section an
   * order sits in, fulfillment status says how far the physical handover has got.
   * They narrow the list together, and only the flow dropdown is tied to the
   * status cards, so the cards and the dropdown still cannot disagree.
   */
  const counts = useMemo(() => {
    const c = Object.fromEntries(CARD_DEFS.map((d) => [d.key, 0])) as Record<
      CardKey,
      number
    >;
    for (const o of rows)
      for (const d of CARD_DEFS) if (matchesCard(o, d.key)) c[d.key] += 1;
    // KEEP layaway accounts also count under the Keep card (Owner request).
    c.keep += keepLayaways.length;
    return c;
  }, [rows, keepLayaways.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = rows.filter((o) => {
      if (!matchesCard(o, card)) return false;
      if (orderDate && o.createdAt.slice(0, 10) !== orderDate) return false;
      if (shipDate && (o.shipDate?.slice(0, 10) ?? '') !== shipDate) return false;
      if (!q) return true;
      return [o.orderNumber, o.invoiceNumber, o.waybillNumber ?? '', o.customerDisplayName]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
    // Latest activity first (Completed by completed_at); filters/search above are
    // untouched — only the display order is applied here.
    return sortOrdersForCard(matched, card);
  }, [rows, card, query, orderDate, shipDate]);

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
      {/* Top action row: + New Order, then Send All Invoices while For Invoice is
          the active card. Hidden otherwise, with no leftover gap. */}
      {newOrderAction || card === 'for_invoice' ? (
        <div className="flex flex-wrap items-center gap-2">
          {newOrderAction}
          {card === 'for_invoice' ? <SendAllInvoices /> : null}
        </div>
      ) : null}

      {/* Status cards — real counts of the loaded orders; each is a quick filter
          with a coloured icon badge. Active card is ringed in the brand accent.
          Kept on ONE line: a single horizontally-scrollable row (Owner request),
          so every stage stays visible in order without wrapping. */}
      <div className="flex gap-2 overflow-x-auto pb-1">
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
                'flex min-h-[92px] min-w-[100px] flex-1 flex-col items-start gap-1.5 rounded-xl border bg-card p-2.5 text-left transition-colors',
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
              <span className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted-foreground [hyphens:auto]">
                {def.label}
              </span>
              <span className="text-2xl font-bold leading-none tabular-nums text-foreground">
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
            placeholder="Search waybill, order no., invoice no., or customer"
            aria-label="Search orders"
            data-testid="orders-search"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold"
          />
          {/* Order flow — the SAME state the status cards drive, so the dropdown
              and the highlighted card can never disagree. Its options are derived
              from CARD_DEFS rather than written out again, which is what keeps the
              labels identical and stops a flow existing in one place but not the
              other. Selecting filters in place; nothing navigates. */}
          <select
            value={card}
            onChange={(e) => setCard(e.target.value as CardKey)}
            aria-label="Filter by order flow"
            data-testid="orders-filter-flow"
            className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
          >
            {CARD_DEFS.map((def) => (
              <option key={def.key} value={def.key}>
                {def.label}
              </option>
            ))}
          </select>

          {/* Approved date filters. Order Date filters on the order's created day,
              Ship Date on the fulfillment dispatch day. */}
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="sr-only">Order date</span>
            <span aria-hidden="true">🗓</span>
            <input
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              aria-label="Filter by order date"
              data-testid="orders-filter-order-date"
              title="Order date"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="sr-only">Ship date</span>
            <span aria-hidden="true">🚚</span>
            <input
              type="date"
              value={shipDate}
              onChange={(e) => setShipDate(e.target.value)}
              aria-label="Filter by ship date"
              data-testid="orders-filter-ship-date"
              title="Ship date"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold"
            />
          </label>
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
        card === 'keep' && keepLayaways.length > 0 ? null : (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No orders match these filters.
          </div>
        )
      ) : (
        <div className="rounded-xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="data-table w-full min-w-[860px] table-fixed text-left text-sm">
              <colgroup>
                <col style={{ width: '12%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '10%' }} />
              </colgroup>
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2.5 text-left font-medium">Status</th>
                  <th className="px-3 py-2.5 text-left font-medium">Waybill Number</th>
                  <th className="px-3 py-2.5 text-left font-medium">Invoice No.</th>
                  <th className="px-3 py-2.5 text-left font-medium">Customer</th>
                  <th className="px-3 py-2.5 pr-6 text-right font-medium">Amount</th>
                  <th className="px-3 py-2.5 text-center font-medium">Payment</th>
                  <th className="px-3 py-2.5 text-center font-medium">Fulfillment</th>
                  <th className="px-3 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((order) => (
                  <OrderRow
                    key={order.officialOrderId}
                    order={order}
                    onOpen={(o) => setSelectedId(o.officialOrderId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* KEEP items from Layaway — surfaced under the Keep card so every KEEP item
          shows here too (Owner request). These are imported layaway accounts flagged
          KEEP; manage them under Payments & Layaway. */}
      {card === 'keep' && keepLayaways.length > 0 ? (
        <div className="rounded-xl border border-border bg-card" data-testid="keep-layaways">
          <div className="flex items-center justify-between px-4 py-2.5">
            <p className="text-sm font-semibold">
              From Layaway — KEEP{' '}
              <span className="text-muted-foreground">({keepLayaways.length})</span>
            </p>
            <a
              href="/orders/payments?layaway=all"
              className="text-xs font-medium text-gold-strong hover:underline"
            >
              Manage in Payments ›
            </a>
          </div>
          <div className="overflow-x-auto border-t border-border">
            <table className="data-table w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Remarks</th>
                  <th className="px-3 py-2 text-right font-medium">Grand Total</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Account No.</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keepLayaways.map((k) => (
                  <tr key={k.id} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{k.code ?? '—'}</td>
                    <td className="px-3 py-2">{k.customerName}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {k.remarks ?? '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {k.grandTotal ? <Money amount={k.grandTotal} /> : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {k.balance ? <Money amount={k.balance} /> : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{k.accountNo}</td>
                    <td className="px-3 py-2 text-right">
                      {/* View opens the layaway account (these KEEP rows are layaway
                          ledger records, not official orders). From here it can be
                          transferred to Completed, which removes it from Keep. */}
                      <LayawayLedgerViewModal ledgerId={k.id} allowComplete />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* In-page order details — the list stays mounted behind it, so search,
          filters, selected status, and scroll are preserved on close. After an
          in-modal action, only this order's data + the counts refresh. */}
      <OrderDetailsModal
        orderId={selectedId}
        // The active card decides the tab structure: only Total keeps a separate
        // Overview (§8).
        section={card}
        onClose={() => setSelectedId(null)}
        onMutated={() => router.refresh()}
      />
    </div>
  );
}
