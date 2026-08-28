# Save Point — 2026-08-28 · Inventory Total Grams cards

Restore playbook for the save point taken after the **Inventory Total Grams summary cards**
feature (two DB-backed cards: Active + Completed total grams, Super Admin + Admin only).

## What this save point captures
- **Code:** git tag `savepoint-2026-08-28-inventory-grams-totals` (commit on branch
  `production-ui-integration`, parent `4d5fae9`).
- **Database:** in-DB snapshot schema `savepoint_20260828_gramstotals` (all public +
  app_private base tables via `create table … as table …`, plus `_functions` / `_policies`
  / `_indexes` / `_meta`). Append-only logs EXCLUDED: `pancake_webhook_events`,
  `audit_events`, `capture_device_heartbeats` (rolling them back would lose newer data).
- **Known-good prod deployment:** `av-jewelry-k960j23ez` (aliases `avjewelry.online`,
  `www.avjewelry.online`, `av-jewelry.vercel.app` — all one deployment).

## The change in this save point (additive, low-risk)
- New RPC `public.inventory_grams_totals()` (security definer, `is_active_staff()` gated,
  anon `EXECUTE` revoked) — one aggregate returning Active + Completed total grams + counts.
  Grams are parsed from `item_code` (mirrors `code-parser.ts` GRAMS_RE) because
  `grams_per_piece` is NULL for ~every item.
- New files: `src/lib/inventory/grams-totals.ts` (role-gated reader),
  `src/lib/inventory/grams-format.ts` (`formatGrams`), 3 unit test files.
- Edited: `src/lib/inventory/actions.ts` (+`loadInventoryGramsTotalsAction`),
  `src/components/inventory/inventory-workspace.tsx` (the two cards + update logic),
  `src/app/(app)/orders/inventory/page.tsx` (`canViewTotals` gate + fetch).
- No existing table / statuses / New Entry / CSV / Export / Completed / View / Edit /
  Delete / pagination / search / filters touched. No destructive migration. No inventory
  records altered.

## Instant rollback — CODE (fastest, no rebuild)
Re-promote the previous known-good production deployment in Vercel:
```bash
npx vercel promote av-jewelry-3hzm02pfu --yes
```
(That is the prior known-good from the 2026-08-26 stable save point. Verify the 3 aliases
afterward.)

## Rollback — CODE (git)
```bash
git checkout savepoint-2026-08-28-inventory-grams-totals   # this point
# or to go BACK to before this feature:
git checkout savepoint-2026-08-26-stable
```
Then redeploy: `npx vercel deploy --prod --yes` and verify the 3 aliases.

## Rollback — DATABASE (only if needed)
The new RPC is additive; a rollback usually only needs to DROP it:
```sql
drop function if exists public.inventory_grams_totals();
```
To restore a specific business table from the snapshot (example — inventory_items):
```sql
begin;
  -- inspect first: select count(*) from savepoint_20260828_gramstotals.public__inventory_items;
  truncate public.inventory_items cascade;   -- DANGER: understand FKs first
  insert into public.inventory_items select * from savepoint_20260828_gramstotals.public__inventory_items;
commit;
```
Prefer the off-site Supabase → Database → Backups for a full restore. The in-DB snapshot is
NOT off-site — it dies with the project.

## Verification recorded at capture
See the memory `av-jewelry-savepoint-rollback.md` for the live==snapshot counts confirmed
when this point was taken.
