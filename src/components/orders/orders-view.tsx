'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { OrderDetailsModal } from '@/components/orders/order-details-modal';
import { OrderDelete } from '@/components/orders/cancelled-order-delete';
import { OrderEdit } from '@/components/orders/order-edit';
import { LayawayLedgerViewModal } from '@/components/payments/layaway-ledger-view-modal';

import { loadOrdersPageAction } from '@/lib/orders/actions';
import type { OrderListRow, OrdersPageResult, PaymentStatus } from '@/lib/orders/service';
import {
  CAPTURE_COUNT_EVENT,
  TOGGLE_INCOMING_CAPTURES_EVENT,
} from '@/lib/capture/pending-types';
import type { KeepLayawayRow } from '@/lib/payments/layaway-ledger';
import { Money } from '@/components/shell/privacy';
import { EmptyState } from '@/components/states/empty-state';
import {
  PageHeader,
  StatusBadge,
  ReadError,
  type BadgeTone,
} from '@/components/ui/page-primitives';
import { DataTable, Thead, Tr, Th, Td } from '@/components/ui/data-table';
import { formatDate } from '@/lib/format/date';
import { Pagination } from '@/components/ui/pagination';
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
  paid_in_full: 'success', // green — settled
  partial: 'warning', // amber — partially paid
  awaiting: 'warning', // amber — awaiting payment (pending)
  unavailable: 'danger', // red — balance unavailable
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
  | 'completed'
  | 'walk_in';

const CARD_DEFS: Array<{ key: CardKey; label: string; icon: string; tone: BadgeTone }> = [
  { key: 'all', label: 'Total', icon: '▤', tone: 'gold' },
  { key: 'for_invoice', label: 'For Invoice', icon: '▦', tone: 'warning' },
  // For Reminder / For Prepare / For Shipping / For Cancel were removed as clickable
  // cards (Owner request 2026-08-05). Their CardKeys + matchesCard rules are kept
  // (like `for_confirm`, they remain valid for status logic) — they simply no longer
  // render a card or a flow-dropdown option.
  { key: 'ship_confirm', label: 'Ship Confirm', icon: '➤', tone: 'info' },
  // For-Prepare transfer destinations (Orders Workflow).
  { key: 'delivery', label: 'For Delivery', icon: '🛵', tone: 'info' },
  { key: 'pickup', label: 'Pickup', icon: '🏬', tone: 'info' },
  { key: 'for_layaway', label: 'For Layaway', icon: '❐', tone: 'neutral' },
  { key: 'keep', label: 'Keep', icon: '❏', tone: 'neutral' },
  { key: 'cancelled', label: 'Cancelled', icon: '✕', tone: 'danger' },
  { key: 'unverified_pay', label: 'Pending Payment', icon: '⚠', tone: 'warning' },
  // Order SOURCE (not a status): filter to walk-in sales.
  { key: 'walk_in', label: 'Walk In', icon: '🚶', tone: 'gold' },
  { key: 'completed', label: 'Completed', icon: '✓', tone: 'success' },
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
  info: 'bg-blue-500/10 text-blue-600',
};

function OrderRow({
  order,
  onOpen,
  canManageOrders,
  isOwner,
}: {
  order: OrderListRow;
  onOpen: (order: OrderListRow) => void;
  /** Owner OR admin: whether to SHOW the Edit/Delete buttons at all. */
  canManageOrders: boolean;
  /** Owner = act directly; admin (non-owner) = the buttons submit for Owner approval. */
  isOwner: boolean;
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
        // ONLY the row's OWN Enter/Space opens it. A keydown that BUBBLED up from a nested
        // interactive element — e.g. typing a SPACE in the Admin "delete reason" / edit field of a
        // modal this row renders — must NOT open the order (that was the "For Invoice popup during
        // Delete" bug: React events bubble through the component tree, portal included, and the
        // Modal intentionally does not stop keydown so Escape keeps working). currentTarget===target
        // is true only when the <tr> itself is the focused element.
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onOpen(order);
        }
      }}
      data-testid="order-row"
      className="cursor-pointer border-b border-border last:border-0 hover:bg-accent/60 focus:bg-accent/60 focus:outline-none"
    >
      <Td kind="center" clip title={order.customerDisplayName} className="font-medium">
        {order.customerDisplayName}
        {order.orderSource === 'walk_in' ? (
          <span className="ml-1.5 rounded-full border border-gold/40 bg-gold/10 px-1.5 py-0.5 text-[10px] font-medium text-gold-strong">
            Walk-in
          </span>
        ) : null}
      </Td>
      <Td kind="num">
        {order.paymentStatus === 'unavailable' ? (
          '—'
        ) : (
          <Money amount={order.totalAmountPayable} />
        )}
      </Td>
      <Td kind="center">
        <StatusBadge
          label={PAYMENT_LABEL[order.paymentStatus]}
          tone={PAYMENT_TONE[order.paymentStatus]}
        />
        {order.paymentStatus === 'partial' ? (
          <span className="ml-1 whitespace-nowrap text-xs text-muted-foreground">
            <Money amount={order.outstandingBalance} /> due
          </span>
        ) : null}
      </Td>
      {/* Date — the order's creation date, one consistent MineFlow format
          ("August 10, 2026"). Waybill moved to the Order Details view but stays
          searchable + stored. */}
      <Td kind="center" clip className="whitespace-nowrap">
        {order.createdAt ? (
          formatDate(order.createdAt)
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Td>
      <Td kind="center">
        <StatusBadge label={humanize(order.status)} tone="neutral" />
      </Td>
      <Td kind="actions">
        <span className="inline-flex items-center gap-2">
          {/* View (everyone) opens the order detail drawer. Edit + Delete show for the
              Owner AND admins: the Owner acts directly; an admin submits the change/
              deletion for Owner approval (nothing happens until the Owner approves). */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(order);
            }}
            className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-gold-strong hover:bg-accent"
            data-testid="order-view"
          >
            View
          </button>
          {canManageOrders ? (
            <OrderEdit
              orderId={order.officialOrderId}
              currentName={order.customerDisplayName}
              currentTotal={
                order.paymentStatus === 'unavailable' ? '' : order.totalAmountPayable
              }
              isOwner={isOwner}
            />
          ) : null}
          {canManageOrders ? (
            <OrderDelete
              orderId={order.officialOrderId}
              orderLabel={
                order.invoiceNumber !== '—' ? order.invoiceNumber : order.orderNumber
              }
              customerName={order.customerDisplayName}
              orderStatus={humanize(order.status)}
              isOwner={isOwner}
            />
          ) : null}
        </span>
      </Td>
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
  return a.officialOrderId < b.officialOrderId
    ? 1
    : a.officialOrderId > b.officialOrderId
      ? -1
      : 0;
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

export function matchesCard(order: OrderListRow, key: CardKey): boolean {
  switch (key) {
    case 'all':
      return true;
    case 'walk_in':
      // Order SOURCE filter — every walk-in sale, regardless of its status.
      return order.orderSource === 'walk_in';
    case 'for_invoice':
      // "For Reminder" (awaiting_required_payment) was folded INTO For Invoice
      // (Owner request 2026-08-09 — the reminder stage is gone). Both statuses show
      // here until routed to a destination (Transfer to Destination), after which
      // the order shows under that destination.
      return (
        (order.status === 'invoiced' || order.status === 'awaiting_required_payment') &&
        !order.fulfillmentDestination
      );
    case 'for_reminder':
      // Retained CardKey (no longer a rendered card) — its orders now live under
      // For Invoice, above.
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
      // A ship-confirmed order belongs to THIS card only when it is not routed to
      // a non-shipping destination. Delivery / Pickup / For Layaway / Keep each
      // have their own card, and an order keeps its SHIP_CONFIRMED status after
      // being released — so without this guard a released delivery/pickup order
      // was counted twice (here AND under its destination), which is why the
      // cards over-counted the Total (Owner report 2026-08-09).
      return (
        SHIP_CONFIRMED.has(order.status) &&
        order.fulfillmentDestination !== 'delivery' &&
        order.fulfillmentDestination !== 'pickup' &&
        order.fulfillmentDestination !== 'layaway' &&
        order.fulfillmentDestination !== 'keep'
      );
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
  initialPage,
  initialCard = 'all',
  syncNonce = '',
  keepLayaways = [],
  newOrderAction,
  canManageOrders = false,
  isOwner = false,
  pendingCaptureCount = 0,
  title,
}: {
  /** The server-rendered FIRST page (rows + exact total + full-store card counts). */
  initialPage: OrdersPageResult;
  /** The flow card the initial page was loaded for (all | for_invoice). */
  initialCard?: string;
  /** Data-derived realtime signal — changes when orders change (via router.refresh) so the
   *  client refetches ONLY the current page, never the whole Orders table. */
  syncNonce?: string;
  /** Page title rendered INSIDE the sticky top section (so it pins with the
   *  + New Order button and status cards). When set, the page omits its own header. */
  title?: string;
  /** The + New Order control, rendered in the top action row so Send All Invoices
   *  can sit beside it — the active-card state that gates it lives HERE. */
  newOrderAction?: React.ReactNode;
  /** Count of floating captures waiting on the PC — renders a compact amber pill
   *  beside + New Order (0 hides it). Realtime via the shell's DashboardSync. */
  pendingCaptureCount?: number;
  /** Open on the For Invoice card (e.g. arriving from the old /orders/invoice). */
  openForInvoice?: boolean;
  /** Layaway accounts marked KEEP — surfaced under the Keep card (Owner request). */
  keepLayaways?: KeepLayawayRow[];
  /** Show the Edit/Delete buttons in the Actions column (Owner OR admin). The DB
   *  re-checks authority + routes an admin's action through approval. */
  canManageOrders?: boolean;
  /** Owner = the Edit/Delete buttons act directly; admin = they submit for approval. */
  isOwner?: boolean;
}) {
  const router = useRouter();
  const [card, setCard] = useState<CardKey>((initialCard as CardKey) || 'all');
  // The "Capture Pending" badge starts at the server-rendered count, then tracks the
  // Incoming Captures strip's LIVE count (same query) so the pill always matches the
  // popup's "(N)" — the strip broadcasts its count after every load.
  const [liveCaptureCount, setLiveCaptureCount] = useState(pendingCaptureCount);
  useEffect(() => {
    const onCount = (e: Event) => {
      const n = (e as CustomEvent<number>).detail;
      if (typeof n === 'number') setLiveCaptureCount(n);
    };
    window.addEventListener(CAPTURE_COUNT_EVENT, onCount);
    return () => window.removeEventListener(CAPTURE_COUNT_EVENT, onCount);
  }, []);
  // The order whose details modal is open (null = closed). Opening it navigates
  // nowhere, so search/filters/scroll are preserved automatically.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Order-date RANGE (inclusive). Empty = open-ended on that side.
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  // Render pagination — only the current page of rows goes in the DOM (default 50).
  const [ordPage, setOrdPage] = useState(1);
  const [ordPageSize, setOrdPageSize] = useState(25);

  // Server-paginated Orders (Owner request — scale to 50k+). ONE SQL RPC (`orders_page`)
  // returns the current page's rows, the EXACT filtered total, and the full-store card
  // counts; the browser never holds every order. Seeds from the server-rendered page 1.
  type OrdersPage = {
    rows: OrderListRow[];
    total: number;
    cardCounts: Record<string, number>;
  };
  const [orders, setOrders] = useState<OrdersPage>(
    initialPage.ok
      ? {
          rows: initialPage.rows,
          total: initialPage.total,
          cardCounts: initialPage.cardCounts,
        }
      : { rows: [], total: 0, cardCounts: {} },
  );
  const [ordersLoading, setOrdersLoading] = useState(false);
  const ordersError = initialPage.ok ? null : initialPage.reason;
  const [reloadToken, setReloadToken] = useState(0);
  const reloadOrders = useCallback(() => setReloadToken((t) => t + 1), []);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  // Any filter/search change starts back at page 1 so results begin at the top.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrdPage(1);
  }, [card, debouncedQuery, dateFrom, dateTo]);

  // Refetch the current page whenever the query changes. Skips the FIRST run while the
  // state still matches the server-rendered initial page (no wasted round-trip on load).
  const firstFetch = useRef(true);
  useEffect(() => {
    if (firstFetch.current) {
      firstFetch.current = false;
      if (
        card === initialCard &&
        debouncedQuery === '' &&
        dateFrom === '' &&
        dateTo === '' &&
        ordPage === 1 &&
        ordPageSize === 25
      ) {
        return;
      }
    }
    let alive = true;
    void (async () => {
      setOrdersLoading(true);
      try {
        const res = await loadOrdersPageAction({
          search: debouncedQuery,
          card,
          dateFrom,
          dateTo,
          page: ordPage,
          size: ordPageSize,
        });
        if (alive && res.ok) {
          setOrders({ rows: res.rows, total: res.total, cardCounts: res.cardCounts });
        }
      } finally {
        if (alive) setOrdersLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    card,
    debouncedQuery,
    dateFrom,
    dateTo,
    ordPage,
    ordPageSize,
    reloadToken,
    initialCard,
  ]);

  // Realtime: a router.refresh() (the shell's DashboardSync, or an in-modal mutation) bumps
  // syncNonce — refetch ONLY the current page, never the whole table. Skips the first mount.
  const firstSync = useRef(true);
  useEffect(() => {
    if (firstSync.current) {
      firstSync.current = false;
      return;
    }
    reloadOrders();
  }, [syncNonce, reloadOrders]);

  const cardCounts = orders.cardCounts;
  const storeTotal = cardCounts.all ?? 0;
  const ordPageCount = Math.max(1, Math.ceil(orders.total / ordPageSize));
  const ordPageSafe = Math.min(ordPage, ordPageCount);
  const pagedOrders = orders.rows;

  // A FAILED read is not "no orders" — say so loudly (the session's hard rule).
  if (ordersError) {
    return <ReadError title="Orders could not be loaded" detail={ordersError} />;
  }

  // NOTE: an empty dataset does NOT hide the screen's features. The status cards,
  // search, and filters render even at zero so the Orders screen always shows its
  // structure — the empty state lives in the TABLE region only. (Orders populate
  // from the workflow: Live → Confirm → Invoice → Approve & Send.)

  return (
    <div className="space-y-4">
      {/* Sticky top section (Owner request): the title, + New Order, and the status
          cards stay pinned at the top while the orders table scrolls beneath them.
          Negative margins bleed the opaque background to the content edges so rows
          pass cleanly underneath; z-20 keeps it above the table's sticky header. */}
      {/* Sticky only from `sm` up (Owner request): on mobile the whole top section —
          including the search/filter row — scrolls normally so it never eats the
          small screen; on desktop it pins as before. */}
      <div className="space-y-3 sm:sticky sm:top-0 sm:z-20 sm:-mx-5 sm:border-b sm:border-border sm:bg-background sm:px-5 sm:py-3">
        {title ? <PageHeader title={title} /> : null}
        {/* Top action row: + New Order (and the Capture Pending pill when captures are
          waiting). Hidden with no leftover gap when there is nothing to show. */}
        {newOrderAction || liveCaptureCount > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            {newOrderAction}
            {/* Compact "Capture Pending" pill — amber, only when captures are waiting.
              Lightweight COUNT only; clicking OPENS the Incoming Captures station,
              which stays hidden until then (Owner request 2026-08-09). The station is
              still mounted the whole time for its background auto-print. */}
            {liveCaptureCount > 0 ? (
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(new CustomEvent(TOGGLE_INCOMING_CAPTURES_EVENT))
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
                data-testid="capture-pending-indicator"
                title="Show or hide the pending captures"
              >
                <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
                Capture Pending
                <span className="rounded-full bg-amber-500/20 px-1.5 text-xs font-semibold tabular-nums">
                  {liveCaptureCount}
                </span>
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Status cards — real counts of the loaded orders; each is a quick filter
          with a coloured icon badge. Active card is ringed in the brand accent.
          Responsive grid (Owner request 2026-08-05, replaces the old single
          horizontally-scrolling row): auto-fit equal-width columns that STRETCH to
          fill the full width — no fixed card width, no horizontal scroll, no empty
          space on the right. It reflows on its own as statuses are added/removed
          (~2–3 per row on a phone, more as the screen widens). */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2">
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
                  // Width comes from the responsive grid; the card just fills its
                  // cell and keeps a fixed min-height so every card is equal height.
                  // Content is centered (Owner request): icon → label → value stacked
                  // and centered, vertically balanced.
                  'flex min-h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-xl border bg-card p-2.5 text-center transition-colors',
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
                  {def.key === 'keep'
                    ? (cardCounts.keep ?? 0) + keepLayaways.length
                    : (cardCounts[def.key] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search + filters — operate on the loaded set (client-side), honestly
          labelled. Search spans invoice no. and customer name. Part of
          the sticky top section (Owner request) so it pins with the cards. */}
        <div className="rounded-xl border border-border bg-card p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search waybill, invoice no., or customer"
              aria-label="Search orders"
              data-testid="orders-search"
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
              className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {CARD_DEFS.map((def) => (
                <option key={def.key} value={def.key}>
                  {def.label}
                </option>
              ))}
            </select>

            {/* Order-date RANGE (From–To, inclusive) on the order's created day. Set
              From = To for a single day; leave one side blank for an open-ended range.
              Replaces the old exact Order-date / Ship-date pair, which returned nothing
              when the two were used as a range. */}
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="sr-only">Orders from date</span>
              <span aria-hidden="true">🗓</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="Orders from date"
                data-testid="orders-filter-date-from"
                title="Orders from (order date)"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>
            <span className="text-xs text-muted-foreground" aria-hidden="true">
              –
            </span>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              <span className="sr-only">Orders to date</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="Orders to date"
                data-testid="orders-filter-date-to"
                title="Orders to (order date)"
                className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-gold focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Showing{' '}
            <span className="tabular-nums" data-testid="orders-count">
              {ordersLoading
                ? '…'
                : orders.total === 0
                  ? '0'
                  : `${((ordPageSafe - 1) * ordPageSize + 1).toLocaleString()}–${Math.min(
                      ordPageSafe * ordPageSize,
                      orders.total,
                    ).toLocaleString()}`}
            </span>{' '}
            of <span className="tabular-nums">{orders.total.toLocaleString()}</span>{' '}
            Official Orders. The status cards count every order in the store.
          </p>
        </div>
      </div>

      {/* Table region: honest empty state at zero, "no matches" when filters
          exclude everything, otherwise the table. */}
      {storeTotal === 0 ? (
        <EmptyState
          title="No Official Orders yet"
          description="Approve & Send an Invoice to create the first Official Order. New Entry (above) starts the capture flow on Live."
        />
      ) : pagedOrders.length === 0 ? (
        card === 'keep' && keepLayaways.length > 0 ? null : (
          <div className="rounded-xl border border-border bg-card px-4 py-10 text-center text-sm text-muted-foreground">
            No orders match these filters.
          </div>
        )
      ) : (
        <>
          <DataTable
            minWidth="760px"
            spacious
            columns={['18%', '16%', '16%', '16%', '16%', '18%']}
          >
            <Thead>
              <Tr plain>
                <Th kind="center">Customer Name</Th>
                <Th kind="num">Amount</Th>
                <Th kind="center">Payment</Th>
                <Th kind="center">Date</Th>
                <Th kind="center">Status</Th>
                <Th kind="actions">Actions</Th>
              </Tr>
            </Thead>
            <tbody>
              {pagedOrders.map((order) => (
                <OrderRow
                  key={order.officialOrderId}
                  order={order}
                  onOpen={(o) => setSelectedId(o.officialOrderId)}
                  canManageOrders={canManageOrders}
                  isOwner={isOwner}
                />
              ))}
            </tbody>
          </DataTable>
          {orders.total > ordPageSize ? (
            <Pagination
              page={ordPageSafe}
              pageCount={ordPageCount}
              total={orders.total}
              pageSize={ordPageSize}
              onPageChange={setOrdPage}
              onPageSizeChange={(n) => {
                setOrdPageSize(n);
                setOrdPage(1);
              }}
              sticky
            />
          ) : null}
        </>
      )}

      {/* KEEP items from Layaway — surfaced under the Keep card so every KEEP item
          shows here too (Owner request). These are imported layaway accounts flagged
          KEEP; manage them under Payments & Layaway. */}
      {card === 'keep' && keepLayaways.length > 0 ? (
        <div
          className="rounded-xl border border-border bg-card"
          data-testid="keep-layaways"
        >
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
            <table className="data-table data-table--stack w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Remarks</th>
                  <th className="px-3 py-2 text-right font-medium">Grand Total</th>
                  <th className="px-3 py-2 text-right font-medium">Balance</th>
                  <th className="px-3 py-2 font-medium">Account No.</th>
                  <th className="col-actions px-3 py-2 font-medium">Actions</th>
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
                    <td className="col-actions px-3 py-2">
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
