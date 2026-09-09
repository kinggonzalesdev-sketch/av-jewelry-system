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
 * The DB is authoritative: claim_next_print_job (migration 20260909140000) refuses to serve a job
 * outside ORDER_PRINT_WINDOW_MS. These constants only LABEL a job the DB has already abandoned, so
 * they must stay in sync with that migration.
 */

/** Eligibility window. Past this, claim_next_print_job will never serve the job again.
 *  Deliberately equal to the capture queue's AUTO_PRINT_WINDOW: one rule, one number. */
export const ORDER_PRINT_WINDOW_MS = 60_000;

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
