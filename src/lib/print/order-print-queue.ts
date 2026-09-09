'use server';

import { requireActiveStaff } from '@/lib/authz/guard';
import {
  isAwaitingPickup,
  isDeadOutcome,
  printOutcome,
  type OrderPrintOutcome,
} from '@/lib/print/print-outcome';
import { createClient } from '@/lib/supabase/server';

/**
 * Web → native print delivery for NEW ORDER stickers (Owner 2026-09-07, SAFE STAGED CUTOVER).
 *
 * The New Order Print action enqueues a typed ORDER_STICKER job the native MineFlow Capture app
 * claims and prints over native Bluetooth. This is now the ONLY path for order stickers — the
 * legacy browser/Web-Bluetooth fallback was retired once native printing passed physical
 * acceptance (Owner 2026-09-07, 35 real prints on the XP-236B). This never touches the
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

/**
 * NO SILENT LOSS (Owner 2026-09-09) — everything below exists so that a sticker a person clicked
 * either PRINTS or SAYS SO. Enqueuing used to be the end of the web's involvement: the UI showed
 * "sent to the printer" and never looked again, so 19 of 92 real order stickers died unseen in
 * status='failed' (every one of them "Turn on Bluetooth first."). The queue is now readable, so the
 * operator standing at the counter finds out while the customer is still in front of them.
 *
 * Deliberately NOT auto-retry. The Owner's rule is "nothing more nothing less": a sticker must
 * never print unless someone clicked for it. Reviving a job when the printer reconnects would be
 * the same surprise-print behaviour the capture queue was fixed to stop. Reprint is a click.
 */

export type OrderPrintJobStatus = {
  id: string;
  outcome: OrderPrintOutcome;
  /** The device's own words, e.g. "Turn on Bluetooth first." — shown verbatim; it is the fix. */
  reason: string | null;
  /** Accepted but unclaimed for too long: the phone is asleep/closed. Still printable. */
  awaitingPickup: boolean;
  orderNumber: string | null;
  customerName: string | null;
};

type PrintJobRow = {
  id: string;
  status: string;
  failed_reason: string | null;
  queued_at: string;
  claimed_at: string | null;
  customer_display_name: string | null;
};

// The outcome decision itself lives in print-outcome.ts so it is unit-testable.

/** Poll the real fate of the jobs an enqueue returned. Empty input → empty output (no query). */
export async function getPrintJobsStatusAction(
  jobIds: string[],
): Promise<OrderPrintJobStatus[]> {
  await requireActiveStaff();
  const ids = jobIds.filter((id) => typeof id === 'string' && id.length > 0);
  if (ids.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('print_jobs')
    .select('id, status, failed_reason, queued_at, claimed_at, customer_display_name')
    .in('id', ids);

  if (error || !data) return [];

  const nowMs = Date.now();
  return (data as PrintJobRow[]).map((row) => ({
    id: row.id,
    outcome: printOutcome(row, nowMs),
    reason: row.failed_reason,
    awaitingPickup: isAwaitingPickup(row, nowMs),
    orderNumber: null,
    customerName: row.customer_display_name,
  }));
}

/** The operator's explicit Retry. Re-arms the job AND restarts its window (see the RPC). */
export async function retryPrintJobAction(
  jobId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActiveStaff();
  if (!jobId) return { ok: false, error: 'Missing print job.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('requeue_print_job', { p_id: jobId });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true };
}

/** "Close it, don't reprint" — clears a sticker that is no longer needed so the outstanding list
 *  keeps meaning something. An alert nobody can dismiss is an alert everybody learns to ignore. */
export async function voidPrintJobAction(
  jobId: string,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireActiveStaff();
  if (!jobId) return { ok: false, error: 'Missing print job.' };

  const supabase = await createClient();
  const { error } = await supabase.rpc('void_print_job', {
    p_id: jobId,
    p_reason: reason ?? null,
  });
  if (error) {
    return { ok: false, error: error.message.replace(/^ERROR:\s*/i, '').trim() };
  }
  return { ok: true };
}

/** Every order sticker still owed to somebody — failed, expired, or stuck mid-claim. This is the
 *  backstop for the operator who navigated away before the failure appeared. */
export async function listUnresolvedPrintJobsAction(): Promise<OrderPrintJobStatus[]> {
  await requireActiveStaff();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('print_jobs')
    .select(
      'id, status, failed_reason, queued_at, claimed_at, customer_display_name, official_orders(order_number)',
    )
    .eq('job_type', 'ORDER_STICKER')
    .eq('is_test', false)
    .in('status', ['queued', 'claimed', 'printing', 'failed'])
    .order('queued_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const nowMs = Date.now();
  // PostgREST types an embedded relation as an ARRAY even for a to-one FK, so read the first row.
  type JoinedRow = PrintJobRow & { official_orders: { order_number: string }[] | null };
  return (data as unknown as JoinedRow[])
    .map((row) => ({
      id: row.id,
      outcome: printOutcome(row, nowMs),
      reason: row.failed_reason,
      awaitingPickup: isAwaitingPickup(row, nowMs),
      orderNumber: row.official_orders?.[0]?.order_number ?? null,
      customerName: row.customer_display_name,
    }))
    // 'queued' and 'printing' are still in flight and may yet succeed — only surface the dead.
    .filter((j) => isDeadOutcome(j.outcome));
}
