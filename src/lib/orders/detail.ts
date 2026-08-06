import 'server-only';

import { listAttachments } from '@/lib/attachments/service';
import { getGrantedPermissions, requireActiveStaff } from '@/lib/authz/guard';
import { listFulfillments, listOwnerApprovals } from '@/lib/fulfillment/service';
import { getOrderBalance } from '@/lib/payments/balances';
import { moneyString } from '@/lib/payments/format';
import { getOrderLineItems, type PaymentStatus } from '@/lib/orders/service';
import { orderCompletionBlock } from '@/lib/orders/completion';
import { createClient } from '@/lib/supabase/server';
import type {
  OrderActivityEntry,
  OrderDetail,
  OrderDetailResult,
  OrderPaymentHistoryEntry,
} from '@/lib/orders/detail-types';

/**
 * One bundled, RLS-scoped read of everything the Order Details modal shows.
 *
 * READ-ONLY by construction: it issues no write and changes no status, so opening
 * the modal can never create a duplicate or mutate the order. Every money figure
 * comes from the tested authoritative reader (getOrderBalance → order_balance());
 * this module computes no money. RLS scopes every embedded read to what the caller
 * may already see — a section the caller cannot read comes back empty, never
 * fabricated.
 *
 * The failure of one section is not the failure of the whole: an unreadable
 * payment history or activity log degrades to an empty list rather than blanking
 * the order. The one hard failure is the order row itself being unreadable — that
 * is reported explicitly (never as an empty order), matching the honesty rule the
 * Orders list already enforces.
 */

function one<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return (value as T) ?? null;
}

type OrderRow = {
  id: string;
  order_number: string | null;
  invoice_number: string | null;
  status: string | null;
  created_at: string;
  fulfillment_destination: string | null;
  fulfillment_destination_set_at: string | null;
  destination_by: unknown;
  completed_at: string | null;
  waybill_number: string | null;
  converted_to_layaway: boolean | null;
  is_test: boolean | null;
  completed_by_staff: unknown;
  admin_staff: unknown;
  customers: unknown;
};

export async function getOrderDetail(officialOrderId: string): Promise<OrderDetailResult> {
  const staff = await requireActiveStaff();
  const supabase = await createClient();

  // The order row itself is the one section whose failure is fatal — an
  // unreadable order must say so, never render as an empty order.
  const { data: orderRow, error: orderError } = await supabase
    .from('official_orders')
    .select(
      `id, order_number, invoice_number, status, created_at,
       fulfillment_destination, fulfillment_destination_set_at, completed_at, waybill_number,
       converted_to_layaway, is_test,
       fb_pancake_conversation_id, fb_conversation_url, fb_link_status,
       destination_by:staff_profiles!fulfillment_destination_set_by ( full_name ),
       completed_by_staff:staff_profiles!completed_by ( full_name ),
       admin_staff:staff_profiles!admin_staff_profile_id ( full_name ),
       customers ( id, display_name, contact_number, address, facebook_conversation_url, pancake_conversation_id )`,
    )
    .eq('id', officialOrderId)
    .maybeSingle();

  if (orderError) {
    return { ok: false, reason: orderError.message };
  }
  if (!orderRow) {
    return {
      ok: false,
      reason: 'This order does not exist or is not visible to you.',
    };
  }

  const order = orderRow as unknown as OrderRow;
  const customer = one<{
    id: string;
    display_name: string;
    contact_number: string | null;
    address: string | null;
    facebook_conversation_url: string | null;
    pancake_conversation_id: string | null;
  }>(order.customers);

  // Everything else loads in parallel; each degrades gracefully on its own.
  const [
    balanceResult,
    items,
    permissions,
    paymentRows,
    fulfillmentRow,
    layawayRow,
    activityRows,
    attachments,
    fulfillmentList,
    approvalList,
  ] = await Promise.all([
    getOrderBalance(officialOrderId),
    getOrderLineItems(officialOrderId),
    getGrantedPermissions(),
    supabase
      .from('payments')
      .select(
        `id, amount, status, payment_method, reference_number, recorded_at, transacted_at,
         voided_at, reversed_at, correction_pending,
         payment_verifications ( verified_amount )`,
      )
      .eq('official_order_id', officialOrderId)
      .order('recorded_at', { ascending: false })
      .then((r) => (r.data ?? []) as unknown[]),
    supabase
      .from('fulfillment_records')
      .select('status, collection_channel, tracking_number, dispatched_at, collected_at')
      .eq('official_order_id', officialOrderId)
      .maybeSingle()
      .then((r) => r.data as Record<string, unknown> | null),
    supabase
      .from('layaway_arrangements')
      .select(
        `status, months, layaway_fee, final_due_date,
         layaway_installments ( installment_number, due_date, amount_due, payment_id )`,
      )
      .eq('official_order_id', officialOrderId)
      .maybeSingle()
      .then((r) => r.data as Record<string, unknown> | null),
    supabase
      .from('audit_events')
      .select('id, action, actor_label, outcome, reason, occurred_at')
      .eq('entity_type', 'official_order')
      .eq('entity_id', officialOrderId)
      .order('occurred_at', { ascending: false })
      .limit(50)
      .then((r) => (r.data ?? []) as unknown[]),
    listAttachments('order', officialOrderId),
    // Reuse the tested fulfillment readers, then narrow to THIS order — no drift
    // from the queue's own computation of balance/COD/deposit-floor.
    listFulfillments(),
    listOwnerApprovals(),
  ]);

  const fulfillmentQueueRow =
    (fulfillmentList.ok
      ? fulfillmentList.rows.find((f) => f.officialOrderId === officialOrderId)
      : null) ?? null;
  const orderApprovals = approvalList.filter(
    (a) => a.entityType === 'official_order' && a.entityId === officialOrderId,
  );

  // --- Money + payment status (all authoritative strings) --------------------
  let paymentStatus: PaymentStatus;
  let totalAmountPayable = '';
  let verifiedNetPayments = '';
  let outstandingBalance = '';
  let overpaymentCredit = '';
  let requiredDownPayment = '';
  let paidInFull = false;
  let unavailable: string | null = null;

  if (!balanceResult.ok) {
    paymentStatus = 'unavailable';
    unavailable = balanceResult.reason;
  } else {
    const b = balanceResult.balance;
    totalAmountPayable = b.totalAmountPayable;
    verifiedNetPayments = b.verifiedNetPayments;
    outstandingBalance = b.outstandingBalance;
    overpaymentCredit = b.overpaymentCredit;
    requiredDownPayment = b.requiredDownPayment;
    paidInFull = b.paidInFull;
    if (b.paidInFull) paymentStatus = 'paid_in_full';
    else if (Number(b.verifiedNetPayments) > 0) paymentStatus = 'partial';
    else paymentStatus = 'awaiting';
  }

  // --- Payment history for THIS order ---------------------------------------
  const paymentHistory: OrderPaymentHistoryEntry[] = paymentRows.map((row) => {
    const r = row as Record<string, unknown>;
    const verification = one<{ verified_amount: string | null }>(r.payment_verifications);
    return {
      paymentId: r.id as string,
      amount: moneyString(r.amount),
      verifiedAmount: verification?.verified_amount
        ? moneyString(verification.verified_amount)
        : null,
      status: r.status as string,
      paymentMethod: (r.payment_method as string | null) ?? null,
      referenceNumber: (r.reference_number as string | null) ?? null,
      recordedAt: r.recorded_at as string,
      transactedAt: (r.transacted_at as string | null) ?? null,
      voided: r.voided_at !== null,
      reversed: r.reversed_at !== null,
      correctionPending: r.correction_pending === true,
    };
  });

  // --- Fulfillment ----------------------------------------------------------
  const fulfillment = fulfillmentRow
    ? {
        status: fulfillmentRow.status as string,
        collectionChannel: (fulfillmentRow.collection_channel as string | null) ?? null,
        trackingNumber: (fulfillmentRow.tracking_number as string | null) ?? null,
        dispatchedAt: (fulfillmentRow.dispatched_at as string | null) ?? null,
        collectedAt: (fulfillmentRow.collected_at as string | null) ?? null,
      }
    : null;

  // --- Layaway --------------------------------------------------------------
  const layaway = layawayRow
    ? {
        status: layawayRow.status as string,
        months: (layawayRow.months as number | null) ?? null,
        layawayFee:
          layawayRow.layaway_fee !== null && layawayRow.layaway_fee !== undefined
            ? moneyString(layawayRow.layaway_fee)
            : null,
        finalDueDate: (layawayRow.final_due_date as string | null) ?? null,
        installments: (
          ((layawayRow.layaway_installments as unknown[]) ?? []) as Array<{
            installment_number: number;
            due_date: string;
            amount_due: string | number;
            payment_id: string | null;
          }>
        )
          .sort((a, z) => a.installment_number - z.installment_number)
          .map((i) => ({
            number: i.installment_number,
            dueDate: i.due_date,
            amountDue: moneyString(i.amount_due),
            paid: i.payment_id !== null,
          })),
      }
    : null;

  // --- Activity (audit events for this order) -------------------------------
  const activity: OrderActivityEntry[] = activityRows.map((row) => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      action: r.action as string,
      actorLabel: (r.actor_label as string | null) ?? 'Unknown',
      outcome: (r.outcome as string | null) ?? 'succeeded',
      reason: (r.reason as string | null) ?? null,
      occurredAt: r.occurred_at as string,
    };
  });

  const isOwner = staff.roleKey === 'owner';

  // Completion eligibility (§5) comes from the database, not from re-deriving the
  // rules here — the modal must never offer Done / Transfer to Completed on an
  // order SQL would refuse. A read failure leaves the order INELIGIBLE.
  const completionBlock = await orderCompletionBlock(officialOrderId);

  const detail: OrderDetail = {
    officialOrderId: order.id,
    orderNumber: order.order_number ?? '—',
    invoiceNumber: order.invoice_number ?? '—',
    status: order.status ?? 'unknown',
    createdAt: order.created_at,
    fulfillmentDestination: order.fulfillment_destination ?? null,
    destinationSetAt: order.fulfillment_destination_set_at ?? null,
    destinationSetByName:
      one<{ full_name: string }>(order.destination_by)?.full_name ?? null,
    completionBlock,
    waybillNumber: order.waybill_number ?? null,
    convertedToLayaway: order.converted_to_layaway === true,
    isTest: order.is_test === true,
    adminName: one<{ full_name: string }>(order.admin_staff)?.full_name ?? null,
    completedAt: order.completed_at ?? null,
    completedByName:
      one<{ full_name: string }>(order.completed_by_staff)?.full_name ?? null,
    customer: {
      id: customer?.id ?? '',
      displayName: customer?.display_name ?? 'Unknown',
      contactNumber: customer?.contact_number ?? null,
      address: customer?.address ?? null,
      facebookConversationUrl: customer?.facebook_conversation_url ?? null,
      pancakeConversationId: customer?.pancake_conversation_id ?? null,
    },
    // The ORDER's own confirmed Facebook/Pancake link (spec §6/§7). When set, Send
    // Invoice + Open FB Chat use exactly this, ahead of the customer's default link.
    orderFacebook: {
      conversationId:
        ((order as unknown as { fb_pancake_conversation_id?: string | null })
          .fb_pancake_conversation_id) ?? null,
      url:
        ((order as unknown as { fb_conversation_url?: string | null }).fb_conversation_url) ??
        null,
      status:
        ((order as unknown as { fb_link_status?: string | null }).fb_link_status) ?? null,
    },
    items,
    amounts: {
      unavailable,
      totalAmountPayable,
      verifiedNetPayments,
      outstandingBalance,
      overpaymentCredit,
      requiredDownPayment,
      paidInFull,
    },
    paymentStatus,
    paymentHistory,
    fulfillment,
    fulfillmentRow: fulfillmentQueueRow,
    approvals: orderApprovals,
    layaway,
    attachments,
    activity,
    permissions: {
      isOwner,
      canRecordPayment: permissions.has('payment_verification'),
      canPrepareFulfillment: permissions.has('fulfillment_preparation'),
      canReleaseFulfillment: permissions.has('fulfillment_release'),
      canPrepareInvoice: permissions.has('invoice_preparation'),
      canRequestApproval: permissions.has('initiate_high_risk_action'),
    },
    // Shaped for the inline Record Payment form. Null when the balance is
    // unreadable — the form must not offer to record against a phantom zero.
    payable: balanceResult.ok
      ? {
          officialOrderId: order.id,
          orderNumber: order.order_number ?? '—',
          invoiceNumber: order.invoice_number ?? '—',
          customerDisplayName: customer?.display_name ?? 'Unknown',
          status: order.status ?? 'unknown',
          totalAmountPayable,
          verifiedNetPayments,
          outstandingBalance,
          overpaymentCredit,
          paidInFull,
          balanceUnavailable: null,
        }
      : null,
  };

  return { ok: true, detail };
}
