# 🔒 SAVE POINT — 2026-08-15 (after Send Invoice text-only fix)

Second rollback point, taken after Orders → Send Invoice was fixed to send the saved
**Invoice Message template as TEXT** (not the Capture screenshot). The earlier save point
[savepoint-2026-08-14](../savepoint-2026-08-14/README.md) still exists — you can roll back to
either. Two layers: **code** (git) and **database** (in-DB snapshot).

| Layer | Where | Restore (short) |
|---|---|---|
| **Code** | git tag `savepoint-2026-08-15-send-invoice-fix` (commit `77b57f3`) | `git checkout savepoint-2026-08-15-send-invoice-fix -- <file>` |
| **Database** | schema `savepoint_20260815` (live DB) | `insert … select from savepoint_20260815.<schema>__<table>` |
| **Live prod (known-good)** | Vercel `av-jewelry-i8i0g7rt9` | Re-promote in Vercel dashboard (instant) |

Verified: every critical table live-count == snapshot-count. `capture_records` = 11
(unchanged from the 2026-08-14 baseline — Send Invoice touched no Capture records).

## What was saved
- **Code:** commit `77b57f3` on `production-ui-integration`, tagged
  `savepoint-2026-08-15-send-invoice-fix`. Includes the Send Invoice text-only fix
  (`for-invoice.ts`, `order-details-modal.tsx`, + test).
- **Database — schema `savepoint_20260815`:** 76 business tables (public + app_private, data),
  243 function/RPC defs (`_functions`), 163 RLS policies (`_policies`), indexes (`_indexes`).
  Excludes append-only logs (`pancake_webhook_events`, `audit_events`,
  `capture_device_heartbeats`).

## HOW TO ROLL BACK

### Code
```bash
git show savepoint-2026-08-15-send-invoice-fix --stat
git checkout savepoint-2026-08-15-send-invoice-fix -- src/lib/orders/for-invoice.ts   # one file
git checkout savepoint-2026-08-15-send-invoice-fix -- .                               # everything
```
To roll back ONLY the Send Invoice change (keep everything else), restore those files from
the EARLIER tag instead:
```bash
git checkout savepoint-2026-08-14 -- src/lib/orders/for-invoice.ts src/components/orders/order-details-modal.tsx
```

### Live prod (no rebuild)
Vercel dashboard → Deployments → `av-jewelry-i8i0g7rt9` → **Promote to Production**.

### Restore a broken RPC / table (see the 2026-08-14 README for the full patterns)
```sql
select def from savepoint_20260815._functions where name = 'set_layaway_term';
-- data: begin; delete from public.X; insert into public.X select * from savepoint_20260815.public__X; commit;
```

## ⚠️ Off-site layer
This schema lives INSIDE the database — it does not survive total project loss. Confirm
Supabase → Database → Backups for the off-site copy.

## Cleanup (when safe)
```sql
drop schema savepoint_20260815 cascade;   -- and/or savepoint_20260814 for the older one
```
