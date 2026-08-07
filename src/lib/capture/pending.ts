import 'server-only';

import { requirePermission } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';
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
export async function listPendingCaptures(): Promise<PendingCaptureRow[]> {
  await requirePermission('claim_capture');
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('capture_records')
    .select('id, captured_at, screenshot_path, ocr, is_test')
    .eq('source', 'floating')
    .is('official_order_id', null)
    .is('confirmed', null)
    .order('captured_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const rows = data as Array<{
    id: string;
    captured_at: string;
    screenshot_path: string | null;
    ocr: unknown;
    is_test: boolean | null;
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

  return rows.map((r, i) => ({
    captureRecordId: r.id,
    capturedAt: r.captured_at,
    screenshotUrl: signed[i] ?? null,
    fbName: ocrStr(r.ocr, 'fbName', 'fb_name', 'name'),
    itemQuery: ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
    // Prefer the dedicated grams field; fall back to the mined number (older builds
    // put the pinned weight in itemQuery). normalizeGrams also rejects non-weights.
    grams: normalizeGrams(
      ocrStr(r.ocr, 'grams', 'weight') ?? ocrStr(r.ocr, 'itemQuery', 'item_query', 'item'),
    ),
    isTest: r.is_test === true,
  }));
}
