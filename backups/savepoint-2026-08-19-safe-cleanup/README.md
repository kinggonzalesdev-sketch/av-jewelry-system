# Save point — 2026-08-19 (safe cleanup batch)

Rollback point taken after the Historical Scrap Report + the safe DB/perf cleanup.
Two layers: code (git tag + known-good Vercel deploy) and database (in-DB snapshot).

## What this captures

| Layer | Identifier |
|-------|-----------|
| Git tag | `savepoint-2026-08-19-safe-cleanup` (annotated) |
| Commit | `e7ab817` on branch `production-ui-integration` |
| Known-good prod deploy | `av-jewelry-i1j58px6c` (aliases `avjewelry.online` / `www.avjewelry.online` / `av-jewelry.vercel.app`) |
| DB snapshot schema | `savepoint_20260819_cleanup` (Supabase `eqfddwxsmzzojuasffjx`) |
| Snapshot contents | 77 base tables (`<schema>__<table>`), `_functions` (293), `_triggers` (60), `_policies`, `_indexes` (228 — incl. the 5 new hot-path FK indexes), `_views`, `_meta` |

Verified at capture time — live == snapshot: inventory_items 3160, official_orders 847,
layaway_ledger 818, scrap_sales 470.

**State at this point (all deployed, green — typecheck / eslint / 1233 tests / build):**
- Historical Scrap Report (Req 15) — read-only `/admin/scrap/historical`.
- 5 hot-path FK indexes (migration `hotpath_fk_indexes`).
- Lazy Layaway New Entry item picker (`loadLayawayItemsAction`).
- Daily Cash 7-tab Details + durable print diagnostic (`capture_records.print_diag`) — from
  the prior save point, still current.
- 10 stale save-point snapshot schemas pruned (kept `savepoint_20260819_cash7tab` +
  `savepoint_20260818_fulfillment`, now plus this one).

## Excluded from the DB snapshot (deliberate)

Append-only logs are NOT copied — rolling them back would erase newer rows:
`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats`.

## How to roll back

### Code — fastest (no rebuild)
```bash
npx vercel promote av-jewelry-i1j58px6c --yes
```
Or rebuild from the tag:
```bash
git checkout savepoint-2026-08-19-safe-cleanup
npx vercel --prod --yes --build-env APP_COMMIT=e7ab817
```

### Database — per-table restore (apply via MCP `execute_sql`)
```sql
begin;
truncate public.<table>;
insert into public.<table>
  select * from savepoint_20260819_cleanup.public__<table>;
commit;
```
- App-private tables are `savepoint_20260819_cleanup.app_private__<table>`.
- Function / trigger / policy / index **definitions** are text in the `_functions` /
  `_triggers` / `_policies` / `_indexes` tables — re-run a definition to restore an object.
- To undo the FK indexes specifically: `drop index if exists public.idx_capture_records_official_order_id, …` (5 total, all `idx_*`).
- Do NOT restore the excluded append-only logs (not in the snapshot).

## Caveats

- The in-DB snapshot is **not off-site** — it dies with the project. Off-site = Supabase →
  Database → Backups (dashboard; Owner's responsibility).
- Drop this snapshot once the next change is confirmed safe:
  `drop schema savepoint_20260819_cleanup cascade;`
- Migrations apply via Supabase MCP `apply_migration`, never `supabase db push` (drift).
