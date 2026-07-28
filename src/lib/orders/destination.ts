import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import {
  FULFILLMENT_DESTINATIONS,
  type FulfillmentDestination,
} from '@/lib/orders/destination-types';

/**
 * Transfer a For-Prepare order to a fulfillment destination (Orders Workflow —
 * For Prepare). Guarded here (permission + a denied-audit event) AND in the
 * SECURITY DEFINER function it calls — the database is the real gate, and it
 * refuses a non-For-Prepare order or a SECOND transfer (no duplicate transfers).
 * Records who transferred it and when (the audit event is the transfer history).
 */
export type TransferDestinationResult = { ok: true } | { ok: false; error: string };

export async function transferOrderDestination(
  officialOrderId: string,
  destination: string,
): Promise<TransferDestinationResult> {
  if (!officialOrderId) return { ok: false, error: 'An order is required.' };
  if (!FULFILLMENT_DESTINATIONS.includes(destination as FulfillmentDestination)) {
    return { ok: false, error: 'Select a valid destination.' };
  }

  try {
    await requirePermission('fulfillment_preparation');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'official_order.transfer_destination',
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
  const { error } = await supabase.rpc('transfer_order_destination', {
    p_order_id: officialOrderId,
    p_destination: destination,
  });

  if (error) {
    await recordAuditEvent({
      action: 'official_order.transfer_destination',
      entityType: 'official_order',
      entityId: officialOrderId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }

  await recordAuditEvent({
    action: 'official_order.transfer_destination',
    entityType: 'official_order',
    entityId: officialOrderId,
    context: { destination },
  });

  return { ok: true };
}
