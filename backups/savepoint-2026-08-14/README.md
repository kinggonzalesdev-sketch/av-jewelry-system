# 🔒 SAVE POINT — 2026-08-14 (before Pancake/capture matching fix)

A guaranteed "babalikan" (rollback point) taken **before** touching the Facebook-match /
capture pipeline. Two layers: **code** (git) and **database** (in-DB snapshot).

| Layer | Where | How to restore (short) |
|---|---|---|
| **Code** | git tag `savepoint-2026-08-14` (commit `4e1a27e`) | `git checkout savepoint-2026-08-14 -- <file>` |
| **Database** | schema `savepoint_20260814` (live DB) | `insert ... select from savepoint_20260814.<schema>__<table>` |
| **Live prod (known-good)** | Vercel deployment `av-jewelry-kyo0drqe3` (`dpl_FhSMT2nenegJAHg9NZi3havYemkD`) | Re-promote in Vercel dashboard (instant, no rebuild) |

Taken: 2026-08-14 (~15:40 UTC). Verified: every critical table live-count == snapshot-count.

---

## What was saved

### Code (git)
- Commit **`4e1a27e`** on branch `production-ui-integration`, tagged **`savepoint-2026-08-14`**.
- 89 files — the full current live state (layaway Edit-Items New-Entry form, layaway
  transfer + `set_layaway_term`, single unique-code column, Daily Cash walk-in/expense,
  Orders New-Entry-only modal, Pancake webhook milestone, mobile v1.0.7, item-pricing module).

### Database (schema `savepoint_20260814`, isolated + admin-only)
- **76 business tables** copied with full data (public + app_private), verified exact:
  official_orders 653 · layaway_ledger 818 · layaway_ledger_payments 995 ·
  layaway_ledger_installments 2020 · layaway_ledger_items 116 · customers 683 ·
  inventory_items 2923 · payments 245 · claims 937 · scrap_sales 125 · (+ the rest).
- **243 function/RPC definitions** → `savepoint_20260814._functions` (this is the big one —
  many live RPCs are NOT in the repo migrations, so this is their only backup).
- **163 RLS policies** → `_policies` · **210 indexes** → `_indexes` · 0 views (none exist).
- **Intentionally excluded** (append-only logs — rolling them back would LOSE newer data,
  not restore it): `pancake_webhook_events`, `audit_events`, `capture_device_heartbeats`.

---

## HOW TO ROLL BACK

### A. Restore code
```bash
# See what the save point contained
git show savepoint-2026-08-14 --stat

# Restore ONE file to the save-point version
git checkout savepoint-2026-08-14 -- src/lib/capture/pending-link.ts

# Restore EVERYTHING (careful — discards newer working-tree changes)
git checkout savepoint-2026-08-14 -- .
```

### B. Instantly roll back LIVE prod (no rebuild)
In the Vercel dashboard → Deployments → find **`av-jewelry-kyo0drqe3`** → **Promote to
Production**. This re-points `av-jewelry.vercel.app` to the known-good build in seconds.
(Or `git checkout savepoint-2026-08-14` then `npx vercel --prod --yes` to rebuild it.)

### C. Restore a broken function / RPC (most common DB fix)
```sql
-- Read the saved definition, then run the returned CREATE OR REPLACE ... verbatim
select def from savepoint_20260814._functions where name = 'set_layaway_term';
```

### D. Restore a table's DATA (⚠️ do inside a transaction; mind FK order)
```sql
begin;
-- example: restore layaway payments to the save-point state
delete from public.layaway_ledger_payments;
insert into public.layaway_ledger_payments
  select * from savepoint_20260814.public__layaway_ledger_payments;
commit;   -- rollback; if anything looks wrong before committing
```
For interlinked tables (orders ↔ claims ↔ inventory), restore parents before children, or
restore the whole related cluster in one transaction. For a **full-DB disaster**, prefer the
Supabase managed backup (below) — it rebuilds constraints/sequences cleanly.

### E. Compare current vs save point (detect what changed)
```sql
select 'customers' t, (select count(*) from public.customers) live,
       (select count(*) from savepoint_20260814.public__customers) saved;
```

---

## ⚠️ Off-site layer (important)
The `savepoint_20260814` schema lives **inside the same database** — it protects against bad
migrations, broken RPCs, and accidental data edits, but **NOT** against total project loss.
For that, confirm **Supabase → Database → Backups** is enabled (daily backups / PITR) — that
is the off-site, whole-project restore. `pg_dump`/Supabase CLI are not installed on this PC,
so a manual external dump must be run by the Owner (needs the DB password — never entered by
the assistant).

## Cleanup (when the fix is confirmed safe)
```sql
drop schema savepoint_20260814 cascade;   -- reclaims the snapshot's storage
```
