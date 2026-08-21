# Save point — 2026-08-21 (pin test closed + net torn down)

The state after the pinned-comment investigation concluded and the temporary diagnostic was fully removed. Everything from this session is resolved, deployed, and clean.

## What this captures
- **Pin test result: PIN SIGNAL NOT EXPOSED IN OBSERVED PANCAKE WEBHOOKS.** Pinning/unpinning a Facebook Page Live comment produced no webhook event, field, or re-send (diag net live, captured 15 unrelated INBOX events; 0 on the test post; production 0 after pins; each PINTEST comment received exactly once). → Pinned-comment Capture stays on local pinned-area OCR (Priority 2) + Needs Review (Priority 3); **no server pin route exists** — nothing new to build.
- **Temp raw-capture net fully torn down** — dropped `pancake_webhook_raw_diag` + `webhook_capture_raw_diag`; removed `captureWebhookRawDiag` + helpers from `pancake-webhook.ts` and the webhook route; deleted the unit test; removed the Vercel flag + tag env vars. Snapshot `_functions` = 262 (−1 vs advclean's 263 = the dropped writer). `diag_table_still_exists = false` verified. Production webhook is back to its exact pre-instrumentation state; 1241 tests green, build passes.
- Sits on top of the full advisor-clean state (anon-execute · all 5 RLS · leaked-password · pg_trgm moved) + perf verified to 50k.

## Code rollback
- Git tag **`savepoint-2026-08-21-pin-test-closed`** (commit `3bec452`).
- Instant prod rollback: re-promote **`av-jewelry-1bq2e74t3`**.

## Database rollback
- Snapshot schema **`savepoint_20260821_pinclosed`** — 77 base tables + `_functions` (262) + `_policies` + `_indexes` + `_meta`.
- Excluded (append-only): pancake_webhook_events, audit_events, capture_device_heartbeats.
- Verified live == snapshot: inventory 3414 · orders 1012.
- Restore a table: `insert into public.X select * from savepoint_20260821_pinclosed.public__X;` (in a transaction).

## Retention
- Kept in-DB: `savepoint_20260821_pinclosed` (this) + `savepoint_20260821_perf`. Dropped the superseded `savepoint_20260821_advclean` (pinclosed = advclean + teardown). All git tags remain.
- Drop when confirmed safe: `drop schema savepoint_20260821_pinclosed cascade;`
- **Caveat:** in-DB snapshot is NOT off-site — off-site is Supabase → Database → Backups (dashboard).
