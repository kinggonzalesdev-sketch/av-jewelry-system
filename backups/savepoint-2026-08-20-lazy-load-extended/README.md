# Save point — 2026-08-20 (lazy-load extended)

Rollback point after extending the Layaway New Entry lazy-load (items + customers +
financers). Two layers: code (git tag + known-good Vercel deploy) and database (in-DB snapshot).

## What this captures

| Layer | Identifier |
|-------|-----------|
| Git tag | `savepoint-2026-08-20-lazy-load-extended` (annotated) |
| Commit | `e680035` on branch `production-ui-integration` |
| Known-good prod deploy | `av-jewelry-bp2n0ts0w` (aliases `avjewelry.online` / `www.avjewelry.online` / `av-jewelry.vercel.app`) |
| DB snapshot schema | `savepoint_20260820_lazyload` (Supabase `eqfddwxsmzzojuasffjx`) |
| Snapshot contents | 77 base tables (`<schema>__<table>`), `_functions` (293), `_triggers`, `_policies`, `_indexes` (228), `_views`, `_meta` |

Verified at capture time — live == snapshot: inventory_items 3160, official_orders 847, payments 313.

**State at this point (all deployed, green — typecheck / eslint / 1233 tests / build):**
- Layaway New Entry lazy-loads its full data bundle (items + customers + financers) via
  `loadLayawayNewEntryDataAction` — the Payments/Layaway page no longer eager-fetches any of them.
- Unused-index cleanup VERIFIED + DEFERRED (no indexes dropped — the flagged ones are mostly
  trigram SEARCH indexes; unsafe to drop pre-live).
- Historical Scrap Report (Req 15), 5 hot-path FK indexes, Daily Cash 7-tab, durable print
  diagnostic — all from prior save points, still current.
- DB is unchanged vs `savepoint_20260819_cleanup` (that point's work since was code-only); this
  snapshot simply refreshes the point-in-time data copy.

## Excluded from the DB snapshot (deliberate)

`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats` (append-only logs).

## How to roll back

### Code — fastest (no rebuild)
```bash
npx vercel promote av-jewelry-bp2n0ts0w --yes
```
Or rebuild from the tag:
```bash
git checkout savepoint-2026-08-20-lazy-load-extended
npx vercel --prod --yes --build-env APP_COMMIT=e680035
```

### Database — per-table restore (apply via MCP `execute_sql`)
```sql
begin;
truncate public.<table>;
insert into public.<table> select * from savepoint_20260820_lazyload.public__<table>;
commit;
```
- App-private tables are `savepoint_20260820_lazyload.app_private__<table>`.
- Function / trigger / policy / index **definitions** are text in the `_functions` / `_triggers`
  / `_policies` / `_indexes` tables — re-run a definition to restore an object.
- Do NOT restore the excluded append-only logs (not in the snapshot).

## Caveats

- The in-DB snapshot is **not off-site** — off-site = Supabase → Database → Backups (dashboard).
- Drop this snapshot once the next change is confirmed safe:
  `drop schema savepoint_20260820_lazyload cascade;`
- Migrations apply via Supabase MCP `apply_migration`, never `supabase db push` (drift).
