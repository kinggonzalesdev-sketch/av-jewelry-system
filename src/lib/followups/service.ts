import 'server-only';

import { createClient } from '@/lib/supabase/server';

/**
 * Follow-up Queue (Bible §23, §26 — operational follow-ups).
 *
 * A read-only, categorised view of what needs attention, aggregated from REAL
 * records across the workflow so nothing gets buried (the Messenger-overload
 * problem). Every count is a live query scoped by RLS — never a fabricated
 * number. A category whose read fails reports `count: null` (unavailable), never
 * a false zero. Each category links to the workspace that OWNS the action;
 * nothing here acts, so it adds no authority.
 *
 * Deposit deadline: "Deposit overdue" flags Official Orders still awaiting their
 * required payment past the shared hold (hold_expires_at). It FLAGS — it never
 * auto-cancels: cancellation is a non-delegable Owner approval (Bible §5.13), so
 * this surfaces the overdue order for a human decision rather than executing it.
 */

export type FollowUpTone = 'neutral' | 'warning' | 'danger' | 'gold';

export type FollowUpCategory = {
  key: string;
  label: string;
  description: string;
  /** Live count, or null when the read failed (unavailable — never a false 0). */
  count: number | null;
  href: string;
  tone: FollowUpTone;
};

export type FollowUpQueue = {
  categories: FollowUpCategory[];
  /** Sum of the categories that read successfully. */
  total: number;
};

/** One count query. Returns null on error so a failure is honest, not a zero. */
async function count(
  build: (supabase: Awaited<ReturnType<typeof createClient>>) => PromiseLike<{
    count: number | null;
    error: unknown;
  }>,
): Promise<number | null> {
  const supabase = await createClient();
  const { count: n, error } = await build(supabase);
  if (error) return null;
  return n ?? 0;
}

export async function getFollowUpQueue(): Promise<FollowUpQueue> {
  const nowIso = new Date().toISOString();

  const [
    invoiceNotSent,
    awaitingPayment,
    depositOverdue,
    paymentVerification,
    deliveryPending,
    failedDelivery,
    layawayDue,
  ] = await Promise.all([
    count((s) =>
      s
        .from('invoice_drafts')
        .select('id', { count: 'exact', head: true })
        .in('status', ['draft', 'in_review']),
    ),
    count((s) =>
      s
        .from('official_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_required_payment'),
    ),
    count((s) =>
      s
        .from('official_orders')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_required_payment')
        .not('hold_expires_at', 'is', null)
        .lt('hold_expires_at', nowIso),
    ),
    count((s) =>
      s
        .from('payments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'submitted_unverified'),
    ),
    count((s) =>
      s
        .from('fulfillment_records')
        .select('id', { count: 'exact', head: true })
        .in('status', ['for_shipping', 'for_pickup', 'approved_for_release']),
    ),
    count((s) =>
      s
        .from('fulfillment_records')
        .select('id', { count: 'exact', head: true })
        .in('status', ['failed_delivery', 'unclaimed_pickup', 'held']),
    ),
    count((s) =>
      s
        .from('layaway_arrangements')
        .select('id', { count: 'exact', head: true })
        .in('status', ['overdue', 'grace_period', 'forfeiture_eligible']),
    ),
  ]);

  const categories: FollowUpCategory[] = [
    {
      key: 'invoice_not_sent',
      label: 'Invoice not yet sent',
      description: 'Invoice drafts still in draft or review — send before scammers do.',
      count: invoiceNotSent,
      href: '/orders/invoice',
      tone: 'warning',
    },
    {
      key: 'deposit_overdue',
      label: 'Deposit overdue',
      description:
        'Awaiting the required payment past the hold deadline. Flag for an Owner decision — never auto-cancelled.',
      count: depositOverdue,
      href: '/orders/payments',
      tone: 'danger',
    },
    {
      key: 'awaiting_payment',
      label: 'Deposit / payment pending',
      description: 'Official Orders still awaiting their required payment.',
      count: awaitingPayment,
      href: '/orders/payments',
      tone: 'warning',
    },
    {
      key: 'payment_verification',
      label: 'Payment verification pending',
      description:
        'Submitted payment evidence awaiting verification. Counts toward no balance yet.',
      count: paymentVerification,
      href: '/orders/payments',
      tone: 'gold',
    },
    {
      key: 'delivery_pending',
      label: 'Delivery / release pending',
      description:
        'Prepared or shipping-confirmed orders not yet dispatched or picked up.',
      count: deliveryPending,
      href: '/orders',
      tone: 'neutral',
    },
    {
      key: 'failed_delivery',
      label: 'Failed delivery / to investigate',
      description:
        'Failed deliveries, unclaimed pickups, or held parcels needing a decision.',
      count: failedDelivery,
      href: '/orders',
      tone: 'danger',
    },
    {
      key: 'layaway_due',
      label: 'Layaway payment due',
      description: 'Overdue, in grace period, or forfeiture-eligible layaways.',
      count: layawayDue,
      href: '/orders/payments',
      tone: 'warning',
    },
  ];

  const total = categories.reduce((sum, c) => sum + (c.count ?? 0), 0);

  return { categories, total };
}
