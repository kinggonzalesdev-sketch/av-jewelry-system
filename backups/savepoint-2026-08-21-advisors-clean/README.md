# Save point — 2026-08-21 (advisors clean)

The point where **every Supabase security + performance advisor we target is resolved.** Two layers: code (git) + database (in-DB snapshot).

## Delta vs `savepoint-2026-08-21-advisor-hardening`
- **#6 pg_trgm → extensions schema** (`extension_in_public` cleared). Trigram search verified still index-backed after the move (`Bitmap Index Scan on customers_display_name_trgm_idx`). This moved pg_trgm's ~31 functions out of `public`, so the snapshot's `_functions` count is 263 (was 294) — expected.
- Go-live readiness doc (`docs/GO-LIVE-READINESS.md`).

## Advisor posture (all cleared)
anon-execute (0 public DEFINER anon-callable) · all 5 RLS `multiple_permissive_policies` · leaked-password protection · `extension_in_public`.

## Code rollback
- Git tag **`savepoint-2026-08-21-advisors-clean`** (commit `14edc80`).
- Instant prod rollback: re-promote **`av-jewelry-mnzdzzcqm`**.
- #6 alone rolls back with: `alter extension pg_trgm set schema public;` (one command).

## Database rollback
- Snapshot schema **`savepoint_20260821_advclean`** — 77 base tables (`<schema>__<table>`) + `_functions` (263, pg_trgm now in extensions) + `_policies` + `_indexes` + `_meta`.
- Excluded (append-only/temp): pancake_webhook_events, audit_events, capture_device_heartbeats, pancake_webhook_raw_diag.
- Verified live == snapshot: inventory 3471 · orders 1011.
- Restore a table: `insert into public.X select * from savepoint_20260821_advclean.public__X;` (in a transaction).

## Retention
- Kept in-DB: `savepoint_20260821_advclean` (this) + `savepoint_20260821_perf`. Dropped the redundant `savepoint_20260821_advisor` (differed only by the one-command-reversible pg_trgm move). All git tags remain.
- Drop when confirmed safe: `drop schema savepoint_20260821_advclean cascade;`
- **Caveat:** in-DB snapshot is NOT off-site — off-site is Supabase → Database → Backups (dashboard).
