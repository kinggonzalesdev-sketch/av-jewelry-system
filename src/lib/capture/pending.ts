import 'server-only';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
import { isConversationMediaEligible } from '@/lib/capture/media-window';
import { normalizeGrams } from '@/lib/print/order-receipt';
import type { PendingCaptureRow } from '@/lib/capture/pending-types';

const CAPTURE_BUCKET = 'attachments';

/** Read one string field off the (untyped) OCR JSON, tolerating shape/casing. */
function ocrStr(ocr: unknown, ...keys: string[]): string | null {
  if (!ocr || typeof ocr !== 'object') return null;
  const o = ocr as Record<string, unknown>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/**
 * Floating-screenshot captures waiting on the PC: uploaded but not yet turned into
 * an order (source 'floating', no linked order). RLS scopes the rows to
 * claim_capture holders; each gets a short-lived signed screenshot URL and the OCR
 * guess (name + item) so the operator can confirm/correct it into a New Order.
 * Newest first. An empty list is a normal "nothing waiting", never an error.
 */
/**
 * Lightweight COUNT of floating captures still waiting on the PC — for the compact
 * "Capture Pending" pill beside + New Order. `head: true` fetches NO rows (no
 * screenshots, no OCR), only the count. RLS scopes it to claim_capture holders, so
 * it returns 0 for anyone who cannot see captures (no throw — safe to call for any
 * Orders viewer). Realtime: capture_records is in the publication, so the shell's
 * DashboardSync router.refresh() re-runs this and the pill updates without a reload.
 */
export async function countPendingCaptures(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from('capture_records')
    .select('id', { count: 'exact', head: true })
    .eq('source', 'floating')
    .is('official_order_id', null)
    .is('confirmed', null);
  return count ?? 0;
}

export async function listPendingCaptures(): Promise<PendingCaptureRow[]> {
  await requirePermission('claim_capture');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('capture_records')
    .select(
      'id, captured_at, screenshot_path, ocr, is_test, link_status, customer_id, pancake_conversation_id, message_status, route_reason, customers ( display_name, facebook_conversation_url )',
    )
    .eq('source', 'floating')
    .is('official_order_id', null)
    .is('confirmed', null)
    .order('captured_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  type CustJoin = {
    display_name?: string | null;
    facebook_conversation_url?: string | null;
  };
  const rows = data as Array<{
    id: string;
    captured_at: string;
    screenshot_path: string | null;
    ocr: unknown;
    is_test: boolean | null;
    link_status: string | null;
    customer_id: string | null;
    pancake_conversation_id: string | null;
    message_status: string | null;
    route_reason: string | null;
    customers: CustJoin | CustJoin[] | null;
  }>;

  const signed = await Promise.all(
    rows.map((r) =>
      r.screenshot_path
        ? supabase.storage
            .from(CAPTURE_BUCKET)
            .createSignedUrl(r.screenshot_path, 600)
            .then((res) => res.data?.signedUrl ?? null)
            .catch(() => null)
        : Promise.resolve(null),
    ),
  );

  // Photo eligibility per row: only a `linked` capture whose conversation has a GENUINE
  // customer-initiated Inbox DM in the media window is "Photo ready". A comment-only `linked`
  // customer is NOT (the Bavelyn P0). Computed only for linked+conversation rows (fail-safe false
  // otherwise) so the strip can show "Photo waiting" without firing a doomed send.
  const eligible = await Promise.all(
    rows.map((r) => {
      const conv = (r.pancake_conversation_id ?? '').trim();
      return r.link_status === 'linked' && conv
        ? isConversationMediaEligible(supabase, conv).catch(() => false)
        : Promise.resolve(false);
    }),
  );

  return rows.map((r, i) => {
    const cust = Array.isArray(r.customers) ? r.customers[0] : r.customers;
    const linkStatus = (r.link_status ?? null) as PendingCaptureRow['linkStatus'];
    return {
      captureRecordId: r.id,
      capturedAt: r.captured_at,
      screenshotUrl: signed[i] ?? null,
      fbName: ocrStr(r.ocr, 'fbName', 'fb_name', 'name'),
      itemQuery: ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
      // Prefer the dedicated grams field; fall back to the mined number (older builds
      // put the pinned weight in itemQuery). normalizeGrams also rejects non-weights.
      grams: normalizeGrams(
        ocrStr(r.ocr, 'grams', 'weight') ??
          ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
      ),
      isTest: r.is_test === true,
      linkStatus,
      linkedCustomerId: r.customer_id ?? null,
      linkedCustomerName: (cust?.display_name ?? '').trim() || null,
      conversationAvailable: Boolean((r.pancake_conversation_id ?? '').trim()),
      photoEligible: eligible[i] === true,
      fbUrl: (cust?.facebook_conversation_url ?? '').trim() || null,
      messageStatus: r.message_status ?? null,
      routeReason: (r.route_reason ?? '').trim() || null,
    };
  });
}
