'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { listPendingCaptures } from '@/lib/capture/pending';
import { autoSendCaptureForOrder } from '@/lib/orders/for-invoice';
import type { PendingCaptureRow } from '@/lib/capture/pending-types';

/** Load the floating captures waiting to be turned into orders (realtime-refreshed). */
export async function loadPendingCapturesAction(): Promise<PendingCaptureRow[]> {
  return listPendingCaptures();
}

/** Attach a pending capture to the order the operator just created from it, so Send
 *  Invoice auto-attaches the mined-item screenshot. */
export async function linkCaptureToOrderAction(
  captureRecordId: string,
  orderId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!captureRecordId || !orderId) return { ok: false, error: 'Missing ids.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { error } = await supabase.rpc('link_capture_to_order', {
    p_capture_record_id: captureRecordId,
    p_order_id: orderId,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  // Deliver the mined screenshot to the buyer NOW — if the order (via inheritance) or
  // the customer already has a Pancake conversation, it sends immediately, so no Send
  // Invoice click is needed. Idempotent: a capture already sent (phone / prior link)
  // is skipped. Best-effort so linking always succeeds.
  await autoSendCaptureForOrder(orderId).catch(() => undefined);
  revalidatePath('/orders');
  return { ok: true };
}

/** Discard a junk pending capture (no order created from it). */
export async function dismissPendingCaptureAction(
  captureRecordId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!captureRecordId) return { ok: false, error: 'Missing id.' };
  await requirePermission('claim_capture');
  const supabase = await createClient();
  const { error } = await supabase.rpc('dismiss_pending_capture', {
    p_capture_record_id: captureRecordId,
  });
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  revalidatePath('/orders');
  return { ok: true };
}
