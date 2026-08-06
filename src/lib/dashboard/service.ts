import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { moneyString } from '@/lib/payments/format';
import { createClient } from '@/lib/supabase/server';

/**
 * Dashboard, Search, Reports, Notifications & Audit (Bible §7, §23, §25, §26, §31).
 *
 * This module READS. It creates no business record and changes no state.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  COUNTS ARE NON-ADDITIVE (§7, §4)
 * ══════════════════════════════════════════════════════════════════════════
 *
 * An Active Layaway IS ALREADY an Official Order. A Claim is NOT an order.
 * The order buckets below are DISJOINT — the database builds them that way and
 * a pgTAP test proves they sum to the total. Queue counts overlap the buckets
 * by nature and are typed separately so nobody adds them to order figures.
 *
 * Report VISIBILITY is not action authority (§25): seeing a number here grants
 * nothing. Export is its own permission.
 */

export type DashboardCounts = {
  /** DISJOINT Official Order buckets. These sum to totalOfficialOrders. */
  ordersActiveLayaway: number;
  ordersAwaitingPayment: number;
  ordersForFulfillment: number;
  ordersClosed: number;
  ordersCancelled: number;
  totalOfficialOrders: number;

  /** Claims are NOT orders. Never add these to the buckets above. */
  pendingClaims: number;
  confirmedClaimsForInvoice: number;

  /** Advisory queues. They OVERLAP the buckets — never sum them with orders. */
  paymentsAwaitingVerification: number;
  rtsInReview: number;
  ownerApprovalsPending: number;
};

/** Reads the approved dashboard counts. RLS scopes them to the caller. */
export async function getDashboardCounts(): Promise<DashboardCounts | null> {
  const supabase = await createClient();
  const response = await supabase.rpc('dashboard_counts');

  if (response.error || response.data === null) return null;

  const c = response.data as Record<string, unknown>;
  const n = (key: string) => Number(c[key] ?? 0);

  return {
    ordersActiveLayaway: n('orders_active_layaway'),
    ordersAwaitingPayment: n('orders_awaiting_payment'),
    ordersForFulfillment: n('orders_for_fulfillment'),
    ordersClosed: n('orders_closed'),
    ordersCancelled: n('orders_cancelled'),
    totalOfficialOrders: n('total_official_orders'),
    pendingClaims: n('pending_claims'),
    confirmedClaimsForInvoice: n('confirmed_claims_for_invoice'),
    paymentsAwaitingVerification: n('payments_awaiting_verification'),
    rtsInReview: n('rts_in_review'),
    ownerApprovalsPending: n('owner_approvals_pending'),
  };
}

export type SearchResult = {
  resultKind: string;
  entityId: string;
  reference: string;
  label: string;
  detail: string;
};

/**
 * Global search (§23).
 *
 * PERMISSION-SCOPED by RLS, not by a filter written here — the function is
 * `security invoker`, so a caller can only find what they could already read.
 * Returns references only: finding a record is not authority over it, and
 * nothing here merges or reassigns anything.
 */
export async function search(query: string): Promise<SearchResult[]> {
  const trimmed = query?.trim() ?? '';
  // A one-character query would sweep the whole table for no user benefit.
  if (trimmed.length < 2) return [];

  const supabase = await createClient();
  const response = await supabase.rpc('global_search', { p_query: trimmed });

  if (response.error || !response.data) return [];

  return (
    response.data as Array<{
      result_kind: string;
      entity_id: string;
      reference: string;
      label: string;
      detail: string;
    }>
  ).map((r) => ({
    resultKind: r.result_kind,
    entityId: r.entity_id,
    reference: r.reference,
    label: r.label,
    detail: r.detail,
  }));
}

export type SalesSummary = {
  from: string;
  to: string;
  verifiedCollected: string;
  paymentsRecorded: number;
  paymentsVerified: number;
  paymentsUnverified: number;
};

/** Total order value split by how the order is fulfilled (§7). Money as strings. */
export type SalesByChannel = {
  walkIn: string;
  pickup: string;
  rider: string;
  shipment: string;
  other: string;
  walkInCount: number;
  pickupCount: number;
  riderCount: number;
  shipmentCount: number;
  otherCount: number;
};

/**
 * Sales split into Walk In / Pick Up / Rider / Shipment for the dashboard's date
 * range. Every peso is summed in SQL from the tested order-total function; excludes
 * cancelled + test orders. Returns null on a read failure (explicit error, never a
 * false zero).
 */
export async function getSalesByChannel(
  from: string,
  to: string,
): Promise<SalesByChannel | null> {
  const supabase = await createClient();
  const response = await supabase.rpc('sales_by_channel', { p_from: from, p_to: to });
  if (response.error || !response.data) return null;

  const r = response.data as Record<string, unknown>;
  return {
    walkIn: moneyString(r.walk_in),
    pickup: moneyString(r.pickup),
    rider: moneyString(r.rider),
    shipment: moneyString(r.shipment),
    other: moneyString(r.other),
    walkInCount: Number(r.walk_in_count ?? 0),
    pickupCount: Number(r.pickup_count ?? 0),
    riderCount: Number(r.rider_count ?? 0),
    shipmentCount: Number(r.shipment_count ?? 0),
    otherCount: Number(r.other_count ?? 0),
  };
}

/** Audited business totals (Bible §7, §25). Money fields are strings, never floats. */
export type DashboardMetrics = {
  totalOfficialOrders: number;
  orderCountValid: number;
  totalSales: string;
  verifiedCollections: string;
  outstandingBalance: string;
  fullPaymentSales: string;
  totalLayawaySales: string;
  layawayCollections: string;
  pendingPayments: string;
  cancelledAmount: string;
  forfeitedAmount: string;
  salesToday: string;
  salesWeek: string;
  salesMonth: string;
  averageOrderValue: string;
  collectionTrend: Array<{ day: string; verified: string; weight: number }>;
};

/**
 * Business totals for the dashboard (§7, §25).
 *
 * VIEWABLE BY ANY ACTIVE STAFF — the DB function is security invoker (RLS scopes
 * every row) and granted to authenticated. Every peso figure is summed from the
 * tested per-order readers in the database; nothing is recomputed here.
 *
 * Returns null on a read failure so the UI can show an explicit error, never a
 * false zero (matching getDashboardCounts).
 */
export async function getDashboardMetrics(): Promise<DashboardMetrics | null> {
  const supabase = await createClient();
  const response = await supabase.rpc('dashboard_metrics');

  return mapMetrics(response.error ? null : response.data);
}

/**
 * Range-aware business totals: the same figures as getDashboardMetrics, but the
 * Official-Order sums and the collection trend are bounded to [from, to] (by
 * created_at / recorded_at). sales_today/week/month stay as-of-now. Every peso is
 * still summed in SQL. Returns null on a read failure (explicit error, never a
 * false zero).
 */
export async function getDashboardMetricsRanged(
  from: string,
  to: string,
): Promise<DashboardMetrics | null> {
  const supabase = await createClient();
  const response = await supabase.rpc('dashboard_metrics_ranged', {
    p_from: from,
    p_to: to,
  });

  return mapMetrics(response.error ? null : response.data);
}

/** Shared mapping from the RPC jsonb to DashboardMetrics. */
function mapMetrics(data: unknown): DashboardMetrics | null {
  if (!data) return null;

  const r = data as Record<string, unknown>;
  const trend = Array.isArray(r.collection_trend) ? r.collection_trend : [];

  return {
    totalOfficialOrders: Number(r.total_official_orders ?? 0),
    orderCountValid: Number(r.order_count_valid ?? 0),
    totalSales: moneyString(r.total_sales),
    verifiedCollections: moneyString(r.verified_collections),
    outstandingBalance: moneyString(r.outstanding_balance),
    fullPaymentSales: moneyString(r.full_payment_sales),
    totalLayawaySales: moneyString(r.total_layaway_sales),
    layawayCollections: moneyString(r.layaway_collections),
    pendingPayments: moneyString(r.pending_payments),
    cancelledAmount: moneyString(r.cancelled_amount),
    forfeitedAmount: moneyString(r.forfeited_amount),
    salesToday: moneyString(r.sales_today),
    salesWeek: moneyString(r.sales_week),
    salesMonth: moneyString(r.sales_month),
    averageOrderValue: moneyString(r.average_order_value),
    collectionTrend: (trend as Array<Record<string, unknown>>).map((p) => ({
      day: String(p.day),
      verified: moneyString(p.verified),
      // Integer centavos for bar-width scaling — not money math on the display.
      weight: Number(p.weight ?? 0),
    })),
  };
}

/**
 * Sales summary report (§25).
 *
 * VIEWING is broad: any active staff may see the on-screen summary (the DB
 * function enforces active-staff and security invoker keeps it within the
 * caller's RLS scope). Only actual export/download is gated by
 * `export_data_reports` — added when a download feature exists.
 */
export async function getSalesSummary(
  from: string,
  to: string,
): Promise<{ ok: true; data: SalesSummary } | { ok: false; error: string }> {
  const supabase = await createClient();
  const response = await supabase.rpc('report_sales_summary', { p_from: from, p_to: to });

  if (response.error) {
    return { ok: false, error: response.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const r = (response.data ?? {}) as Record<string, unknown>;

  await recordAuditEvent({
    action: 'report.sales_summary',
    entityType: 'report',
    context: {
      from,
      to,
      // The trail states the boundary: a report grants no authority.
      grants_action_authority: false,
      limited_to_visible_records: true,
    },
  });

  return {
    ok: true,
    data: {
      from,
      to,
      verifiedCollected: moneyString(r.verified_collected),
      paymentsRecorded: Number(r.payments_recorded ?? 0),
      paymentsVerified: Number(r.payments_verified ?? 0),
      paymentsUnverified: Number(r.payments_unverified ?? 0),
    },
  };
}

export type NotificationRow = {
  id: string;
  kind: string;
  body: string;
  dueAt: string | null;
  acknowledgedAt: string | null;
};

/** The caller's own reminders. RLS scopes these to them. */
export async function listNotifications(): Promise<NotificationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('notifications')
    .select('id, kind, body, due_at, acknowledged_at')
    .order('created_at', { ascending: false })
    .limit(50);

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      kind: r.kind as string,
      body: r.body as string,
      dueAt: (r.due_at as string | null) ?? null,
      acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
    };
  });
}

/**
 * Acknowledges a reminder.
 *
 * Changes NO business record — the database freezes everything but the
 * acknowledgement. Acknowledging a "layaway due" note does not touch the
 * layaway.
 */
export async function acknowledgeNotification(
  notificationId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let staff;
  try {
    staff = await requirePermission('layaway_monitoring');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      // Any active staff member may hold reminders; the permission above is the
      // narrowest that fits V1's reminder kinds. Fall through to a plain denial.
      await recordAuditEvent({
        action: 'notification.acknowledge',
        entityType: 'notification',
        entityId: notificationId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notifications')
    .update({
      acknowledged_at: new Date().toISOString(),
      acknowledged_by: staff.staffProfileId,
    })
    .eq('id', notificationId)
    .is('acknowledged_at', null)
    .select('id');

  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error: 'That reminder could not be acknowledged. It may already be acknowledged.',
    };
  }

  await recordAuditEvent({
    action: 'notification.acknowledge',
    entityType: 'notification',
    entityId: notificationId,
    context: {
      // A reminder is a note. The trail says what it did not do.
      business_record_changed: false,
      customer_notified: false,
      delivered: false,
      read: false,
    },
  });

  return { ok: true };
}

export type AuditRow = {
  id: string;
  occurredAt: string;
  actorLabel: string | null;
  action: string;
  entityType: string;
  outcome: string;
  reason: string | null;
};

/**
 * Audit visibility (§31).
 *
 * Append-only and role-scoped by RLS. The `context` payload is deliberately NOT
 * surfaced: it can carry operational detail, and §31 r12 forbids exposing
 * secrets through the trail. Only the attributed facts are shown.
 */
export async function listAuditEvents(entityId?: string): Promise<AuditRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from('audit_events')
    .select('id, occurred_at, actor_label, action, entity_type, outcome, reason')
    .order('occurred_at', { ascending: false })
    .limit(100);

  if (entityId) query = query.eq('entity_id', entityId);

  const { data } = await query;

  return ((data ?? []) as unknown[]).map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      occurredAt: r.occurred_at as string,
      actorLabel: (r.actor_label as string | null) ?? null,
      action: r.action as string,
      entityType: r.entity_type as string,
      outcome: r.outcome as string,
      reason: (r.reason as string | null) ?? null,
    };
  });
}
