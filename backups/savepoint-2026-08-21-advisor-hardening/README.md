# Save point — 2026-08-21 (advisor pre-live hardening)

Restore point after the security/perf advisor batch. Two layers: **code** (git) + **database** (in-DB snapshot schema).

## What this captures (vs the earlier `savepoint-2026-08-21-perf-inlining`)
- **#4 anon-execute hardening** — revoked anon/PUBLIC EXECUTE on 15 public DEFINER RPCs (0 anon-executable now); authenticated + service_role keep access.
- **#7 RLS merge** — 4 RBAC tables (staff_permission_grants, staff_profiles, staff_scope_assignments, trusted_devices) merged to one SELECT policy each (`owner OR self`).
- **#5 sticker_settings** — FOR ALL write policy split to INSERT/UPDATE/DELETE; one SELECT policy. Last `multiple_permissive_policies` advisory cleared.
- **#8 inventory** — `inventory_active_ids_page` reads `inventory_items` directly (not `inventory_monitor()`); + `inventory_items_code_trgm_idx`. Browse ~30→2.5ms, search 19→8ms, byte-identical.
- **#9/#8 inlining** — thin money wrappers + inner money helpers unpinned (`RESET search_path`).
- **Pin-signal net** — `pancake_webhook_raw_diag` + `webhook_capture_raw_diag` still present; **capture OFF**, table empty. Temporary — DROP after the pin test.

**Intentionally left:** #6 pg_trgm→extensions (powers all search, high blast radius, minor advisory), #10 camera→Modal (nested modal in New Order), #7 seeded-branch stress test (superseded by analysis).

## Code rollback
- Git tag: **`savepoint-2026-08-21-advisor-hardening`** (commit `cd56e7d`).
- Instant prod rollback (no rebuild): re-promote **`av-jewelry-1vd47d5ha`** (aliases av-jewelry.vercel.app / avjewelry.online).

## Database rollback
- Snapshot schema: **`savepoint_20260821_advisor`** — 77 base tables (`<schema>__<table>`) + `_functions` (294) + `_policies` (162) + `_indexes` (233) + `_meta`.
- Excluded (append-only/temp): pancake_webhook_events, audit_events, capture_device_heartbeats, pancake_webhook_raw_diag.
- Verified live == snapshot: inventory 3538 · orders 1008 · customers 1060 · payments 337 · staff 21.
- Restore a table: `truncate public.X cascade; insert into public.X select * from savepoint_20260821_advisor.public__X;` (in a transaction). Functions/policies: read defs from `_functions` / `_policies` and re-run.

## Cleanup / retention
- Kept in-DB: `savepoint_20260821_advisor` (this) + `savepoint_20260821_perf` (prior). Older pruned; their git tags remain.
- Drop when confirmed safe: `drop schema savepoint_20260821_advisor cascade;`
- **Caveat:** in-DB snapshot is NOT off-site — the off-site layer is Supabase → Database → Backups (dashboard).
