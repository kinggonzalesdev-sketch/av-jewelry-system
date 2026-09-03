# Save Point — 2026-09-03 (password-reset go-live + paid-order removal + eye toggle)

A rollback point for **everything done on 2026-09-03**. Two layers: **code** (git tag + GitHub
+ Vercel deploy) and **database** (in-DB snapshot schema). Restore either independently.

## What this state contains
- ✅ **Paid-order item removal #1** — Super-Admin removes an item from a FULLY-PAID/settled order
  → same-record restock + payments kept + overpayment as CREDIT (never auto-refund) + reason + audit.
  DB fn `remove_paid_order_item` (migration `20260903094625`) + UI `PaidOrderRemovalControls`.
- ✅ **Reset-password eye toggle** — show/hide on New + Confirm fields.
- ✅ **Password reset go-live** — Supabase 6-digit OTP recovery working end-to-end via **Resend** custom
  SMTP (config only; the reset code itself was already shipped). See `docs/PASSWORD-RESET-RUNBOOK.md`.

## Code layer
| | |
|---|---|
| Git tag | `savepoint-2026-09-03-paid-removal-eye-toggle` |
| Commit | `ecbd512` (branch `production-ui-integration`) |
| GitHub | `https://github.com/kinggonzalesdev-sketch/av-jewelry-system.git` (private; branch + all tags pushed) |
| Prod deploy | `av-jewelry-aemq2trca` → avjewelry.online / www.avjewelry.online |
| Quality | 1455 web tests pass · tsc clean · next build clean |

**Restore code:**
```bash
git checkout savepoint-2026-09-03-paid-removal-eye-toggle
npx vercel --prod --yes --scope kinggonzalesdev-3478s-projects
# — OR instant, no rebuild: re-promote a prior known-good deploy in the Vercel dashboard.
```
Deploy gotcha: if the CLI says "Not authorized", re-link first:
`npx vercel link --yes --project av-jewelry --scope kinggonzalesdev-3478s-projects`.

## Database layer — in-DB snapshot schema `savepoint_20260903_golive`
Created via Supabase MCP (pg_dump / supabase CLI are NOT installed locally). Captured every base
table in `public` + `app_private` **except** the high-volume append-only logs
(`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats` — rolling those back would
lose newer data), plus metadata tables `_functions` (284 defs), `_policies` (162), `_indexes` (233),
`_meta`.

**Capture verified (live == snapshot, content-hash identical):**
inventory_items 4731 · official_orders 1769 · official_order_claims 2355 · claims 2375 ·
customers 1854 · payments 460 · layaway_ledger 818 · returned_to_stock_reviews 291.

DB change this day was **additive only** (the one new fn `remove_paid_order_item`); no destructive
migration.

**Restore ONE table (run in Supabase SQL editor / MCP, inside a transaction):**
```sql
begin;
-- disable triggers if FK/integrity guards would block a bulk reload, then re-enable after
truncate public.<table>;
insert into public.<table> select * from savepoint_20260903_golive.public__<table>;
commit;
```
Restore multiple tables in FK-safe order (parents before children), all in one transaction. For
`app_private` tables use `savepoint_20260903_golive.app_private__<table>`.

**Restore / inspect a function:**
```sql
select definition from savepoint_20260903_golive._functions
where schema='public' and name='<fn_name>';
-- paste the returned CREATE OR REPLACE FUNCTION ... to restore it.
```

**To disable the paid-removal feature entirely (targeted rollback):**
```sql
drop function if exists public.remove_paid_order_item(uuid, uuid, text);
```
(The UI then shows nothing on locked orders; no other flow is affected.)

## Retention
Kept in-DB snapshots (keep-2 convention): `savepoint_20260903_golive` (this one) +
`savepoint_20260830_importguard` (metadata-only). Pruned `savepoint_20260829_codeedit` (its DB state
was identical to importguard). Git tags for ALL earlier save points remain for code rollback.
