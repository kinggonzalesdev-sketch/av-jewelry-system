/**
 * What actually happened to an order sticker — the pure decision, kept out of the `'use server'`
 * module so it can be unit-tested directly (a 'use server' file may only export async functions).
 *
 * This is the safety-critical half of the "nothing more nothing less" rule (Owner 2026-09-09):
 * it decides when a sticker is DEAD. Get it wrong in one direction and a job that will never print
 * still looks pending, so the operator walks away and the sticker is silently lost — the exact bug
 * that cost 19 real stickers. Get it wrong in the other and a live job is declared dead, inviting a
 * retry that double-prints.
 *
 * The DB is authoritative: claim_next_print_job refuses to serve a job outside
 * ORDER_PRINT_WINDOW_MS (migration 20260909140000, widened to 15 minutes by 20260909150000).
 * These constants only LABEL a job the DB has already abandoned, so they must stay in sync with
 * those migrations — if they drift, the UI declares stickers dead that the DB will still print.
 */

/**
 * Eligibility window. Past this, claim_next_print_job will never serve the job again.
 *
 * 15 minutes, and deliberately LONGER than the capture queue's 60s (Owner 2026-09-09, after this
 * shipped at 60s and production disproved it the same afternoon: the Capture app slept for 32
 * minutes and 15 clicked stickers expired with attempts = 0). The two queues differ because the
 * risks differ — a capture sticker auto-prints with no per-sticker click, so anything late is
 * unwanted paper; an order sticker is an explicit click by someone standing at the counter waiting
 * for that exact sticker, so arriving late is the thing they asked for, not a surprise.
 *
 * Must equal the interval in migration 20260909150000.
 */
export const ORDER_PRINT_WINDOW_MS = 900_000;

/** How long a claim may be held before we treat the claiming device as dead. A phone holds a claim
 *  for seconds; minutes means it crashed or was force-stopped mid-print. Matches the staleness
 *  floor in requeue_print_job, which is what prevents a retry racing a live print. */
export const ORDER_CLAIM_STALE_MS = 120_000;

/** `expired` is DERIVED, never a DB status: a job the queue will no longer serve. To the person at
 *  the counter it means the same as `failed` — it did not print. */
export type OrderPrintOutcome =
  | 'queued'
  | 'printing'
  | 'printed'
  | 'failed'
  | 'expired'
  | 'voided';

export type PrintJobTimings = {
  status: string;
  queued_at: string | null;
  claimed_at: string | null;
};

/** Age in ms of an ISO timestamp, or null when missing/unparseable. Never guess an age — a bad
 *  parse must not be what makes a live job look dead. */
function ageMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? nowMs - t : null;
}

export function printOutcome(row: PrintJobTimings, nowMs: number): OrderPrintOutcome {
  if (row.status === 'printed') return 'printed';
  if (row.status === 'failed') return 'failed';
  if (row.status === 'voided') return 'voided';

  if (row.status === 'claimed' || row.status === 'printing') {
    const held = ageMs(row.claimed_at, nowMs);
    return held !== null && held > ORDER_CLAIM_STALE_MS ? 'expired' : 'printing';
  }

  if (row.status === 'queued') {
    const waited = ageMs(row.queued_at, nowMs);
    return waited !== null && waited > ORDER_PRINT_WINDOW_MS ? 'expired' : 'queued';
  }

  // Unknown status from a newer server: report it as still in flight rather than inventing a
  // failure. Fail-safe here means "don't cry wolf", since the queue itself is the authority.
  return 'printing';
}

/** Did this sticker fail to reach paper? Both outcomes need the same thing from the operator. */
export function isDeadOutcome(outcome: OrderPrintOutcome): boolean {
  return outcome === 'failed' || outcome === 'expired';
}

/**
 * How long a job may sit unclaimed before we warn that nothing is listening.
 *
 * A polling phone claims within ~2.5s, so 30s unclaimed means the Capture app is asleep, closed,
 * or its Printer toggle is off. Without this the 15-minute window would hand back the very silence
 * it was meant to cure: on 2026-09-09 staff clicked Print 15 times over 13 minutes while the app
 * was dozing and got no signal at all. The operator should hear about it in seconds, not minutes.
 */
export const ORDER_PICKUP_WARN_MS = 30_000;

/** Job accepted but nobody has picked it up — still printable, but someone should check the phone.
 *  Distinct from dead: this one may yet succeed on its own. */
export function isAwaitingPickup(row: PrintJobTimings, nowMs: number): boolean {
  if (row.status !== 'queued') return false;
  const waited = ageMs(row.queued_at, nowMs);
  return waited !== null && waited > ORDER_PICKUP_WARN_MS;
}
