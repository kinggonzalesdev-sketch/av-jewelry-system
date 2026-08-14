import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requireOwner } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { requestOwnerApproval } from '@/lib/fulfillment/service';

/**
 * SUPER ADMIN (Owner) deletion of a CANCELLED order — removes the order + its records
 * and returns any still-reserved item(s) to Active Inventory. The DB function is the
 * real gate: it re-checks Owner AND refuses anything whose status is not 'cancelled',
 * so a live/active order can never be deleted here. Sibling of the test-order delete.
 */
export type DeleteCancelledOrderResult =
  | { ok: true; returnedItems: number; paymentsRemoved: number }
  | { ok: false; error: string };

export type AdminEditOrderResult = { ok: true } | { ok: false; error: string };

/**
 * SUPER ADMIN (Owner) correction of an order's Customer Name and/or Total Amount.
 * Owner-only in the DB. Total is set on the (single) item's price; a multi-item order
 * is rejected server-side. Money is passed as an authoritative string.
 */
export async function adminEditOrder(
  officialOrderId: string,
  input: { customerName?: string | null; totalAmount?: string | null },
): Promise<AdminEditOrderResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.admin_edit',
        entityType: 'official_order',
        entityId: officialOrderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('admin_edit_order', {
    p_order_id: officialOrderId,
    p_customer_name: input.customerName ?? null,
    p_total_amount: input.totalAmount ?? null,
  })) as { data: unknown; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.admin_edit',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'order.admin_edit',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: {
      owner_approved: true,
      customer_name: input.customerName ?? null,
      total_amount: input.totalAmount ?? null,
    },
  });
  return { ok: true };
}

export async function deleteCancelledOrder(
  officialOrderId: string,
): Promise<DeleteCancelledOrderResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.delete_cancelled',
        entityType: 'official_order',
        entityId: officialOrderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('delete_cancelled_order', {
    p_order_id: officialOrderId,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.delete_cancelled',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const returnedItems = Number(res.data?.returned_items ?? 0);
  const paymentsRemoved = Number(res.data?.payments_removed ?? 0);
  await recordAuditEvent({
    action: 'order.delete_cancelled',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: {
      owner_approved: true,
      returned_items: returnedItems,
      payments_removed: paymentsRemoved,
    },
  });
  return { ok: true, returnedItems, paymentsRemoved };
}

/**
 * SUPER ADMIN (Owner) deletion of ANY order (Owner request: Delete on every row).
 * Same cleanup + item return as the cancelled variant, but the DB gates on Owner ONLY
 * (no status restriction). Destructive: removes the order + all its records, including
 * payment history — use for corrections/cleanup only.
 */
export async function deleteOrder(
  officialOrderId: string,
): Promise<DeleteCancelledOrderResult> {
  try {
    await requireOwner();
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'order.delete',
        entityType: 'official_order',
        entityId: officialOrderId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const res = (await supabase.rpc('delete_order', {
    p_order_id: officialOrderId,
  })) as { data: Record<string, unknown> | null; error: { message: string } | null };

  if (res.error) {
    await recordAuditEvent({
      action: 'order.delete',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: res.error.message,
    });
    return { ok: false, error: res.error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  const returnedItems = Number(res.data?.returned_items ?? 0);
  const paymentsRemoved = Number(res.data?.payments_removed ?? 0);
  await recordAuditEvent({
    action: 'order.delete',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: {
      owner_approved: true,
      returned_items: returnedItems,
      payments_removed: paymentsRemoved,
    },
  });
  return { ok: true, returnedItems, paymentsRemoved };
}

export type RequestOrderAdminResult = { ok: true } | { ok: false; error: string };

/**
 * A non-owner admin's "Request edit" of an order's Customer Name and/or Total → Owner
 * approval (2026-08-13). The requested NEW values are written into the request text so the
 * Owner sees exactly what they are approving; the payload carries them for the execute
 * step (admin_edit_order). Requires initiate_high_risk_action (checked in
 * requestOwnerApproval). Changes nothing until the Owner approves.
 */
export async function requestOrderDetailsEdit(
  officialOrderId: string,
  input: { customerName?: string | null; totalAmount?: string | null },
  reason: string,
): Promise<RequestOrderAdminResult> {
  const name = (input.customerName ?? '').trim();
  const total = (input.totalAmount ?? '').trim();
  if (!name && !total) return { ok: false, error: 'Change the name or the total first.' };
  const trimmed = (reason ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Add a reason for the Owner.' };
  const detail =
    'Edit order' +
    (name ? ` · name → "${name}"` : '') +
    (total ? ` · total → ₱${total}` : '') +
    `. ${trimmed}`;
  const res = await requestOwnerApproval(
    'order_details_edit',
    'official_order',
    officialOrderId,
    detail,
    { customer_name: name || null, total_amount: total || null },
  );
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}

/**
 * A non-owner admin's "Request delete" of an order → Owner approval (2026-08-13). The
 * order label + reason go into the request text so the Owner knows exactly which order is
 * being removed; the execute step replays delete_order. Changes nothing until approved.
 */
export async function requestOrderDelete(
  officialOrderId: string,
  orderLabel: string,
  reason: string,
): Promise<RequestOrderAdminResult> {
  const trimmed = (reason ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Add a reason for the Owner.' };
  const res = await requestOwnerApproval(
    'official_order_delete',
    'official_order',
    officialOrderId,
    `Delete order ${orderLabel}. ${trimmed}`,
  );
  return res.ok ? { ok: true } : { ok: false, error: res.error };
}
