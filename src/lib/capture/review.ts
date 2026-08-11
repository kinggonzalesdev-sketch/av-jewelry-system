import 'server-only';

import { recordAuditEvent } from '@/lib/audit/log';
import { AuthorizationError, requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import type { CaptureReviewResult, CaptureReviewRow } from '@/lib/capture/review-types';

/**
 * Review Mode queue (live-readiness). In Review Mode a capture is enqueued instead of
 * creating an order; a reviewer approves it (creating the order via
 * create_capture_order) or rejects it. These readers/mutations back the web review
 * panel. Authority is re-checked in the SECURITY DEFINER functions; the UI gate is
 * convenience only.
 */

/** Pending captures awaiting review, oldest first (first-in, first-reviewed). */
export async function listPendingCaptureReviews(): Promise<CaptureReviewRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('capture_review_queue')
    .select(
      'id, customer_name, price, grams, screenshot_path, is_test, created_at, inventory_items ( item_code, item_name )',
    )
    .eq('status', 'pending_review')
    .order('created_at', { ascending: true })
    .limit(200);

  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => {
    const item = Array.isArray(r.inventory_items)
      ? (r.inventory_items[0] as { item_code?: string; item_name?: string } | undefined)
      : (r.inventory_items as { item_code?: string; item_name?: string } | null);
    return {
      id: r.id as string,
      customerName: (r.customer_name as string | null) ?? '—',
      itemCode: item?.item_code ?? null,
      itemName: item?.item_name ?? null,
      price:
        typeof r.price === 'number' || typeof r.price === 'string'
          ? String(r.price)
          : '0',
      grams:
        typeof r.grams === 'number' || typeof r.grams === 'string'
          ? String(r.grams)
          : null,
      screenshotPath: (r.screenshot_path as string | null) ?? null,
      isTest: r.is_test === true,
      createdAt: r.created_at as string,
    };
  });
}

/** Approve a pending review → creates the order via create_capture_order. */
export async function approveCaptureReview(
  reviewId: string,
): Promise<CaptureReviewResult> {
  if (!reviewId) return { ok: false, error: 'A capture review is required.' };
  try {
    await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const { error } = (await supabase.rpc('approve_capture_review', {
    p_review_id: reviewId,
  })) as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'capture_review.approve',
    entityType: 'capture_review',
    entityId: reviewId,
  });
  return { ok: true };
}

/** Reject a pending review — no order is created. */
export async function rejectCaptureReview(
  reviewId: string,
  reason?: string | null,
): Promise<CaptureReviewResult> {
  if (!reviewId) return { ok: false, error: 'A capture review is required.' };
  try {
    await requirePermission('claim_capture');
  } catch (cause) {
    if (cause instanceof AuthorizationError) return { ok: false, error: cause.message };
    throw cause;
  }
  const supabase = await createClient();
  const { error } = (await supabase.rpc('reject_capture_review', {
    p_review_id: reviewId,
    p_reason: reason?.trim() ? reason.trim() : null,
  })) as { error: { message: string } | null };
  if (error) return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  await recordAuditEvent({
    action: 'capture_review.reject',
    entityType: 'capture_review',
    entityId: reviewId,
  });
  return { ok: true };
}
