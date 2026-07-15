import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Approve & Send Invoice (Bible §6.7–6.8, §15, §22.9).
 *
 * THE COMMIT POINT. One successful approval creates exactly one Official Order,
 * one order number, one invoice number, and one shared three-day hold, and turns
 * every provisional reservation into a committed one — WITHOUT deducting
 * anything a second time.
 *
 * The whole thing lives in public.approve_and_send_invoice() because it must be
 * one transaction: an order whose reservations stayed provisional, or a draft
 * marked sent with no order, are both states that would cost real stock.
 *
 * Idempotent by draft (UNIQUE(invoice_draft_id) is the guarantee). Concurrency
 * is settled by locking the draft row.
 *
 * SENDING IS SEPARATE. The order is created first and stands on its own; the
 * message is attempted afterwards and may fail. "Official Order created —
 * message sending failed" is a real, representable outcome, and the retry
 * re-sends the message without ever creating a second order.
 */

export type ApproveResult =
  | {
      ok: true;
      officialOrderId: string;
      orderNumber: string;
      invoiceNumber: string;
      holdExpiresAt: string;
      deduplicated: boolean;
    }
  | { ok: false; error: string; code?: 'denied' | 'invalid_state' };

export async function approveAndSendInvoice(
  invoiceDraftId: string,
): Promise<ApproveResult> {
  if (!invoiceDraftId) {
    return { ok: false, error: 'An Invoice Draft reference is required.' };
  }

  try {
    await requirePermission('invoice_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'invoice.approve_and_send',
        entityType: 'invoice_draft',
        entityId: invoiceDraftId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message, code: 'denied' };
    }
    throw cause;
  }

  const supabase = await createClient();
  const response = await supabase.rpc('approve_and_send_invoice', {
    p_invoice_draft_id: invoiceDraftId,
  });

  const error = response.error;
  const data: unknown = response.data;

  if (error) {
    const code =
      error.code === '42501' ? ('denied' as const) : ('invalid_state' as const);

    await recordAuditEvent({
      action: 'invoice.approve_and_send',
      entityType: 'invoice_draft',
      entityId: invoiceDraftId,
      outcome: code === 'denied' ? 'denied' : 'failed',
      reason: error.message,
    });

    return {
      ok: false,
      error: error.message.replace(/^ERROR:\s*/i, '').trim(),
      code,
    };
  }

  const result = data as {
    official_order_id: string;
    order_number: string;
    invoice_number: string;
    hold_expires_at: string;
    claim_count?: number;
    deduplicated: boolean;
  };

  // A deduplicated retry is not a second approval. Auditing it as one would make
  // the trail assert two orders exist.
  await recordAuditEvent({
    action: result.deduplicated
      ? 'invoice.approve_and_send.deduplicated'
      : 'invoice.approve_and_send',
    entityType: 'official_order',
    entityId: result.official_order_id,
    context: {
      invoice_draft_id: invoiceDraftId,
      order_number: result.order_number,
      invoice_number: result.invoice_number,
      hold_expires_at: result.hold_expires_at,
      claim_count: result.claim_count ?? null,
      official_order_created: !result.deduplicated,
      // Restated so the trail testifies to the invariant.
      second_deduction: false,
      message_sent: false,
    },
  });

  if (!result.deduplicated) {
    await recordAuditEvent({
      action: 'reservation.commit',
      entityType: 'official_order',
      entityId: result.official_order_id,
      context: {
        from_state: 'provisional',
        to_state: 'committed',
        quantity_changed: false,
      },
    });

    await recordAuditEvent({
      action: 'official_order.hold_created',
      entityType: 'official_order',
      entityId: result.official_order_id,
      context: { hold_expires_at: result.hold_expires_at, auto_cancel_on_expiry: false },
    });
  }

  return {
    ok: true,
    officialOrderId: result.official_order_id,
    orderNumber: result.order_number,
    invoiceNumber: result.invoice_number,
    holdExpiresAt: result.hold_expires_at,
    deduplicated: result.deduplicated,
  };
}

export type BulkApproveResult = {
  succeeded: Array<{ invoiceDraftId: string; orderNumber: string }>;
  failed: Array<{ invoiceDraftId: string; error: string }>;
};

/**
 * Approve & Send All Ready Invoices.
 *
 * Each draft is processed INDEPENDENTLY and sequentially. A failure on one never
 * rolls back an order that already succeeded — those orders are real, their
 * stock is committed, and undoing them because a different customer's draft was
 * malformed would be worse than the original problem.
 *
 * Only drafts that passed review (`in_review`) are eligible: bulk-approving raw
 * drafts would skip the review step the workflow exists to enforce.
 */
export async function approveAllReadyInvoices(): Promise<
  { ok: true; data: BulkApproveResult } | { ok: false; error: string }
> {
  try {
    await requirePermission('invoice_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'invoice.approve_all_ready',
        entityType: 'invoice_draft',
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoice_drafts')
    .select('id')
    .eq('status', 'in_review')
    .limit(100);

  if (error) {
    return { ok: false, error: 'The ready invoices could not be listed.' };
  }

  const succeeded: BulkApproveResult['succeeded'] = [];
  const failed: BulkApproveResult['failed'] = [];

  for (const row of data ?? []) {
    const draftId = row.id as string;
    const result = await approveAndSendInvoice(draftId);

    if (result.ok) {
      succeeded.push({ invoiceDraftId: draftId, orderNumber: result.orderNumber });
    } else {
      failed.push({ invoiceDraftId: draftId, error: result.error });
    }
  }

  await recordAuditEvent({
    action: 'invoice.approve_all_ready',
    entityType: 'invoice_draft',
    context: {
      succeeded: succeeded.length,
      failed: failed.length,
      // Stated explicitly: a partial failure is a partial result, not a rollback.
      rolled_back_successful_orders: false,
    },
  });

  return { ok: true, data: { succeeded, failed } };
}

/** Marks a draft as reviewed, making it eligible for bulk approval. */
export async function markDraftReviewed(
  invoiceDraftId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requirePermission('invoice_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoice_drafts')
    .update({ status: 'in_review' })
    .eq('id', invoiceDraftId)
    .eq('status', 'draft')
    .select('id');

  if (error || !data || data.length === 0) {
    return {
      ok: false,
      error:
        'That draft could not be marked reviewed. It may already be reviewed or sent.',
    };
  }

  await recordAuditEvent({
    action: 'invoice_draft.reviewed',
    entityType: 'invoice_draft',
    entityId: invoiceDraftId,
    context: { from_status: 'draft', to_status: 'in_review' },
  });

  return { ok: true };
}
