# Save point — 2026-08-21 (perf: SQL-helper inlining + auto-link index)

Guaranteed restore point before the next batch of work. Two layers: **code** (git) and **database** (in-DB snapshot schema — `pg_dump`/`supabase` CLI are not installed locally).

## What this captures (state as of this save point)
- **SQL-helper inlining perf batch** (all `ALTER FUNCTION … RESET search_path` / recreate — body-identical, output byte-verified):
  - `order_matches_card` → Orders card-counts **355ms → 4ms (~89×)**
  - `layaway_is_overdue`, `layaway_matches_section`, `completed_item_stage`, `layaway_fee`, `layaway_interest_per_gram`, `order_items_locked` → Layaway classifiers **75ms → 4.5ms (~17×)**
  - `normalize_name`, `name_key` (byte-identical over all 1027 customers)
- **Functional index** `idx_customers_active_normalized_name` on `customers (app_private.normalize_name(display_name)) where is_active` — webhook auto-link O(n) → index lookup (verified used).
- **Dropped** duplicate `customers_display_name_trgm` (kept `_idx`).
- **Manual Incoming Captures Send respects photo eligibility** (Photo waiting → Open FB Chat, no doomed Pancake PHOTO).
- **Pin-signal temp raw-capture net**: `pancake_webhook_raw_diag` table + `webhook_capture_raw_diag` writer. **Capture is OFF** (env var removed), table empty. Temporary — DROP after the pin test concludes.

## Code rollback
- Git tag: **`savepoint-2026-08-21-perf-inlining`** (commit `8bf2e11`).
- Instant prod rollback (no rebuild): re-promote the known-good Vercel deployment **`av-jewelry-c24ol7wx0`** (aliases `av-jewelry.vercel.app` / `www.avjewelry.online` / `avjewelry.online`).
- To restore code: `git checkout savepoint-2026-08-21-perf-inlining` (or `git reset --hard` on a branch), then `npx vercel --prod`.

## Database rollback
- Snapshot schema: **`savepoint_20260821_perf`** — 77 base tables (`<schema>__<table>`), plus `_functions` (294 defs), `_indexes` (232), `_policies` (164), `_meta`.
- **Excluded** (append-only / temp — rolling back would lose newer data): `pancake_webhook_events`, `audit_events`, `capture_device_heartbeats`, `pancake_webhook_raw_diag`.
- Verified live == snapshot: inventory 3537 · orders 972 · ledger 818 · customers 1027 · payments 328 · staff 21 · capture_records 44.
- To restore one table's data (example):
  ```sql
  begin;
  truncate public.official_orders cascade;              -- CAUTION
  insert into public.official_orders select * from savepoint_20260821_perf.public__official_orders;
  commit;
  ```
  For a function: read its `def` from `savepoint_20260821_perf._functions` and re-run it.

## Cleanup
- Drop the snapshot once this change is confirmed safe: `drop schema savepoint_20260821_perf cascade;`
- **Caveat:** the in-DB snapshot is NOT off-site — it dies with the project. The off-site layer is Supabase → Database → Backups (dashboard; Owner's responsibility).

## Snapshot retention
Kept in-DB: `savepoint_20260821_perf` (this) + `savepoint_20260820_lazyload` (prior). Older in-DB snapshots pruned to save space; their **git tags remain** (code rollback intact), but DB-level restore for those points is gone.
