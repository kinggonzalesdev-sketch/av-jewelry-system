/**
 * Hot-path debug logging switch (Owner 2026-08-26, P0-B).
 *
 * The Pancake webhook + the routing sweeps run thousands of times/day; their routine per-webhook /
 * per-sweep console output was the top Vercel "Observability Events" cost. Production default is
 * therefore OFF — the DURABLE debugging truth lives in the database (capture_records.message_status /
 * route_reason) and `audit_events` (action 'capture_secure_link'), never only in Vercel logs. Real
 * errors and actual send FAILURES are logged unconditionally by their callers; only the routine
 * receipt / no-op traces are gated here.
 *
 * Re-enable the verbose traces (per env, no redeploy) with `CAPTURE_DEBUG_LOGS=1` (also accepts
 * true/on/yes). Callers pass masked ids only — never a token, PSID, or message body — so enabling
 * debug never exposes secrets/PII.
 */
export function captureDebugEnabled(): boolean {
  const v = (process.env.CAPTURE_DEBUG_LOGS ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/** Emit a routine hot-path trace ONLY when CAPTURE_DEBUG_LOGS is enabled. */
export function captureDebugLog(tag: string, data: unknown): void {
  if (!captureDebugEnabled()) return;
  console.info(tag, typeof data === 'string' ? data : JSON.stringify(data));
}
