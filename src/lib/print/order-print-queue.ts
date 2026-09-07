'use server';

import { requireActiveStaff } from '@/lib/authz/guard';
import { createClient } from '@/lib/supabase/server';

/**
 * Web → native print delivery for NEW ORDER stickers (Owner 2026-09-07, SAFE STAGED CUTOVER).
 *
 * The New Order Print action ADDITIONALLY enqueues a typed ORDER_STICKER job the native
 * MineFlow Capture app claims and prints over native Bluetooth — WITHOUT removing the browser
 * print fallback (kept intact until physical owner testing passes). This never touches the
 * capture-sticker queue.
 *
 * IDEMPOTENCY: each first print gets a STABLE key `order:<id>:<index>`, so a double-click, a
 * refresh, or a retry re-submitting the same sticker collides on the DB unique key and is
 * ignored — one intent = exactly one physical sticker. A deliberate Reprint mints a fresh key.
 *
 * FAITHFUL REPRODUCTION: the payload carries the AUTHORITATIVE pre-rendered sticker `lines`
 * (from stickerLineItems on the order snapshot + the device's Sticker Settings), so the native
 * app lays out the EXACT same Order sticker and never recomputes historical values.
 */

export type StickerLine = { text: string; kind: string };

export type OrderStickerPayload = {
  customerName: string;
  itemName?: string | null;
  itemCode?: string | null;
  grams?: string | null;
  quantity?: number | null;
  unitPrice?: string | null;
  pricePerGram?: string | null;
  fixedPrice?: string | null;
  date: string;
  labelSize?: string | null;
  /** Authoritative pre-rendered lines the native app prints verbatim (exact Order sticker). */
  lines: StickerLine[];
};

export type EnqueuePrintResult =
  | { ok: true; queued: number; duplicates: number; jobIds: string[] }
  | { ok: false; error: string };

/** A clean 2-decimal money string → number for the queryable (non-authoritative) column;
 *  the authoritative price stays a string inside the sticker payload. Anything odd → null. */
function priceNumber(payload: OrderStickerPayload): number | null {
  const raw = payload.unitPrice ?? payload.fixedPrice ?? null;
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d{1,12}(\.\d{1,2})?$/.test(s) ? Number(s) : null;
}

export async function enqueueOrderStickersAction(
  officialOrderId: string,
  stickers: OrderStickerPayload[],
  opts?: { reprint?: boolean; reprintNonce?: string },
): Promise<EnqueuePrintResult> {
  await requireActiveStaff();
  if (!officialOrderId) return { ok: false, error: 'Missing order.' };
  if (!Array.isArray(stickers) || stickers.length === 0) {
    return { ok: false, error: 'Nothing to print.' };
  }

  const supabase = await createClient();
  // A reprint is a NEW intended job → unique key; a first print's key is stable so re-submits
  // (double-click / refresh) dedupe on the DB unique constraint.
  const nonce = opts?.reprint ? (opts.reprintNonce ?? crypto.randomUUID()) : '';

  let queued = 0;
  let duplicates = 0;
  const jobIds: string[] = [];

  for (let i = 0; i < stickers.length; i += 1) {
    const sticker = stickers[i]!;
    const key = opts?.reprint
      ? `order:${officialOrderId}:${i}:reprint:${nonce}`
      : `order:${officialOrderId}:${i}`;

    const { data, error } = (await supabase.rpc('enqueue_order_print_job', {
      p_idempotency_key: key,
      p_official_order_id: officialOrderId,
      p_sticker: sticker,
      p_customer: sticker.customerName ?? null,
      p_item_name: sticker.itemName ?? null,
      p_item_code: sticker.itemCode ?? null,
      p_total_price: priceNumber(sticker),
      p_label_size: sticker.labelSize ?? null,
    })) as {
      data: { enqueued?: boolean; duplicate?: boolean; print_job_id?: string } | null;
      error: { message: string } | null;
    };

    if (error) {
      return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
    }
    if (data?.print_job_id) jobIds.push(data.print_job_id);
    if (data?.duplicate) duplicates += 1;
    else if (data?.enqueued) queued += 1;
  }

  return { ok: true, queued, duplicates, jobIds };
}
