import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { setCurrentFlexItemSchema } from '@/lib/validation/live';

/**
 * Current Flex Item control (Bible §12).
 *
 * THE RULE: switching the Current Flex Item affects FUTURE capture only.
 *
 * That rule is upheld structurally, not by convention: a claim stores
 * `live_batch_item_id` and `captured_against_flex_item` AT CAPTURE TIME. Nothing
 * here touches existing claims, and nothing anywhere re-derives "which item was
 * flex" by looking at the batch's current pointer. Claims already taken keep
 * pointing where they pointed.
 *
 * At most one item per batch can be flex — enforced by the Phase 1 partial
 * unique index `live_batch_items_one_flex_per_batch`, not by this code.
 */

export type FlexResult = { ok: true } | { ok: false; error: string };

/**
 * Sets, switches, or clears the Current Flex Item for a batch.
 *
 * Pass `liveBatchItemId: null` to clear without selecting another.
 */
export async function setCurrentFlexItem(input: unknown): Promise<FlexResult> {
  const parsed = setCurrentFlexItemSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid selection.' };
  }

  const { liveBatchId, liveBatchItemId } = parsed.data;

  try {
    await requirePermission('current_flex_item_control');
  } catch (cause) {
    if (cause instanceof AuthorizationError) {
      await recordAuditEvent({
        action: 'live_batch.set_current_flex_item',
        entityType: 'live_batch',
        entityId: liveBatchId,
        outcome: 'denied',
        reason: cause.message,
      });
      return { ok: false, error: cause.message };
    }
    throw cause;
  }

  const supabase = await createClient();

  // A closed batch has no "current" anything.
  const { data: batch } = await supabase
    .from('live_batches')
    .select('id, status')
    .eq('id', liveBatchId)
    .maybeSingle();

  if (!batch) {
    return { ok: false, error: 'That Live Batch could not be found.' };
  }

  if (!['draft', 'active', 'paused', 'reopened'].includes(batch.status as string)) {
    const error = 'The Current Flex Item cannot be changed once the Live has ended.';
    await recordAuditEvent({
      action: 'live_batch.set_current_flex_item',
      entityType: 'live_batch',
      entityId: liveBatchId,
      outcome: 'failed',
      reason: error,
      context: { status: batch.status },
    });
    return { ok: false, error };
  }

  // Clear the old pointer first. Done as two statements because the unique index
  // permits only one flex row per batch — setting the new one first would
  // collide with the old one.
  const { error: clearError } = await supabase
    .from('live_batch_items')
    .update({ is_current_flex_item: false })
    .eq('live_batch_id', liveBatchId)
    .eq('is_current_flex_item', true);

  if (clearError) {
    await recordAuditEvent({
      action: 'live_batch.set_current_flex_item',
      entityType: 'live_batch',
      entityId: liveBatchId,
      outcome: 'failed',
      reason: clearError.message,
    });
    return { ok: false, error: 'The Current Flex Item could not be changed.' };
  }

  if (liveBatchItemId === null) {
    await recordAuditEvent({
      action: 'live_batch.clear_current_flex_item',
      entityType: 'live_batch',
      entityId: liveBatchId,
      context: { cleared: true },
    });
    return { ok: true };
  }

  const { data: updated, error } = await supabase
    .from('live_batch_items')
    .update({ is_current_flex_item: true })
    .eq('id', liveBatchItemId)
    .eq('live_batch_id', liveBatchId)
    .is('withdrawn_at', null)
    .select('id');

  if (error) {
    await recordAuditEvent({
      action: 'live_batch.set_current_flex_item',
      entityType: 'live_batch_item',
      entityId: liveBatchItemId,
      outcome: 'failed',
      reason: error.message,
    });
    return { ok: false, error: 'The Current Flex Item could not be changed.' };
  }

  if (!updated || updated.length === 0) {
    return {
      ok: false,
      error: 'That item is not available in this Live Batch. It may have been withdrawn.',
    };
  }

  await recordAuditEvent({
    action: 'live_batch.set_current_flex_item',
    entityType: 'live_batch_item',
    entityId: liveBatchItemId,
    context: { live_batch_id: liveBatchId, affects: 'future_capture_only' },
  });

  return { ok: true };
}

/**
 * Reads the Current Flex Item for a batch, if any.
 *
 * Used to pre-fill the capture form. It is a CONVENIENCE: the capture path
 * records whatever item it was actually given, so a flex switch mid-capture
 * cannot retarget a claim behind the capturer's back.
 */
export async function getCurrentFlexItem(
  liveBatchId: string,
): Promise<{ liveBatchItemId: string; inventoryItemId: string } | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('live_batch_items')
    .select('id, inventory_item_id')
    .eq('live_batch_id', liveBatchId)
    .eq('is_current_flex_item', true)
    .is('withdrawn_at', null)
    .maybeSingle();

  if (error || !data) return null;

  return {
    liveBatchItemId: data.id as string,
    inventoryItemId: data.inventory_item_id as string,
  };
}
