# Save point — 2026-08-19 (Daily Cash 7-tab + durable print diagnostic)

A guaranteed rollback point taken **before** the next round of work. Two layers:
code (git tag + known-good Vercel deploy) and database (in-DB snapshot schema).

## What this captures

| Layer | Identifier |
|-------|-----------|
| Git tag | `savepoint-2026-08-19-cash-7tab-print-diag` (annotated) |
| Commit | `f910f56` on branch `production-ui-integration` |
| Known-good prod deploy | `av-jewelry-6v19gycmy` (aliases `avjewelry.online` / `www.avjewelry.online` / `av-jewelry.vercel.app`) |
| DB snapshot schema | `savepoint_20260819_cash7tab` (Supabase `eqfddwxsmzzojuasffjx`) |
| Snapshot contents | 77 base tables (`<schema>__<table>`), `_functions` (293 defs), `_triggers` (60), `_policies` (164), `_indexes` (223), `_views`, `_meta` |

Verified at capture time — live == snapshot: inventory_items 3160, official_orders
847, layaway_ledger 818, customers 893, payments 313. `capture_records.print_diag`
column present in the snapshot.

**State at this point (all deployed, green):** Daily Cash Summary lower area is one
self-contained 7-tab Details section; durable per-capture direct-print diagnostic
(`capture_records.print_diag`, migration `20260819100000_capture_print_diag`); web
gates green (typecheck / eslint / 1226 tests / build); prod READY.

## Excluded from the DB snapshot (deliberate)

Append-only logs are NOT copied — rolling them back would erase newer rows:
`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats`.

## How to roll back

### Code — fastest (no rebuild)
Re-promote the known-good deployment in Vercel (instant):
```bash
npx vercel promote av-jewelry-6v19gycmy --yes
```
Or rebuild from the tag:
```bash
git checkout savepoint-2026-08-19-cash-7tab-print-diag
npx vercel --prod --yes --build-env APP_COMMIT=f910f56
```
(To move the branch back: `git reset --hard savepoint-2026-08-19-cash-7tab-print-diag` — destructive to later commits; branch first if unsure.)

### Database — per-table restore (apply MCP `execute_sql`)
The snapshot holds a copy of every business table. Restore one table with:
```sql
begin;
truncate public.<table>;               -- or a scoped DELETE
insert into public.<table>
  select * from savepoint_20260819_cash7tab.public__<table>;
commit;
```
- Respect FK order (or restore inside one transaction with constraints deferred).
- App-private tables are `savepoint_20260819_cash7tab.app_private__<table>`.
- Function / trigger / policy / index **definitions** are text in the `_functions` /
  `_triggers` / `_policies` / `_indexes` tables — re-run a definition to restore an RPC.
- Do NOT blindly restore the excluded append-only logs (they are not in the snapshot).

## Caveats

- The in-DB snapshot is **not off-site** — it dies with the project. The off-site
  layer is Supabase → Database → Backups (dashboard; Owner's responsibility).
- Drop this snapshot once the next change is confirmed safe:
  `drop schema savepoint_20260819_cash7tab cascade;`
- Migrations apply via Supabase MCP `apply_migration`, never `supabase db push`
  (blocked by pre-existing migration drift).
