# Save point — 2026-09-24 · before migrations 0913–0917 + 0924 and the screenshot-first deploy

## What this captures

- **Production web before this step:** `avjewelry.online` → deployment `dpl_2eebcrf7bZdG3Yr4bQqvDETRtmbM`
  = commit **`5546462`** (branch `feature/mineflow-pwa`, deployed 2026-09-21). Re-promoting that
  deployment in Vercel is the instant web rollback (no rebuild).
- **Git:** tag `mineflow-known-good-before-pancake-sequence` and branch
  `savepoint/mineflow-before-pancake-sequence`, both at `5546462` and both on GitHub.
- **In-DB snapshot:** schema `savepoint_20260924_premigrate`, taken 2026-09-24 12:20 UTC, before
  any migration below:
  - 79 business tables from `public` and `app_private`, copied with `create table … as table …`.
    The append-only logs `pancake_webhook_events`, `audit_events` and `capture_device_heartbeats`
    are excluded, because rolling them back would lose newer data.
  - `_functions` 298, with each function's **ACL** (`acl` column) so grants can be restored.
  - `_policies` 163, `_indexes` 240, `_triggers` 62, `_column_defaults`.
  - `_inactive_staff_sessions`: the 6 auth sessions of already-deactivated staff that 0916 ended.
  - `_meta`: row counts and a note. Inventory, orders and payments were content-hash verified
    equal to live (5,796 / 2,715 / 739 rows).

## What was applied after it

Every file was staged into the database first and applied only when its md5 matched the file in
this repo. Each was dry-run on production inside a rolled-back transaction, then applied one at a
time and verified. All eight are recorded in `supabase_migrations.schema_migrations` under their
**file versions**, so history now matches the repo for these eight.

| Version | What it does |
|---|---|
| 20260913120000 | Inventory search matches only visible fields |
| 20260913130000 | Order / Invoice Number out of search; Near Overdue honours the financer filter |
| 20260915120000 | Code-number uniqueness trigger (existing duplicates grandfathered) + code-first ranking + layaway due badge |
| 20260916120000 | Security hardening: role sentinel, definer grants, owner floor, audit read, atomic payment verification, Manila work_date, session revoke, kiosk device rule |
| 20260916130000 | 7 hot-path indexes |
| 20260917120000 | Layaway search finds every visible Unique Code (SBA-E-8413 → DAN OLLUGRAC) |
| 20260917130000 | Shared waybills (a no-op on prod: no unique waybill index existed) |
| 20260924120000 | Screenshot-first messaging setting + per-capture text state (additive) |

## Rollback

Prefer the smallest step. None of these steps needs a destructive reset.

1. **Screenshot-first behaviour only:** Settings → Messages → Private Reply Sequence →
   **Classic**. This takes effect for new captures immediately, with no deploy.
2. **Web only:** in Vercel, promote `dpl_2eebcrf7bZdG3Yr4bQqvDETRtmbM` (commit `5546462`). The
   database changes above are compatible with that code: every RPC name and parameter it calls
   exists.
3. **One function:** re-create it from the snapshot, for example
   `select def from savepoint_20260924_premigrate._functions where proname = 'layaway_page';`,
   then execute the returned definition. Re-apply the grants recorded in its `acl`.
4. **One trigger or index:** each migration's header names its rollback. For example:
   - `drop trigger inventory_items_unique_code_number on public.inventory_items;`
   - `drop trigger staff_profiles_owner_floor on public.staff_profiles;`
   - `drop index if exists <name>;`
5. **Table data:** compare against, or copy from, `savepoint_20260924_premigrate.public__<table>`.
   Only after Owner approval.

Drop the snapshot (`drop schema savepoint_20260924_premigrate cascade`) once this change is
confirmed safe in production.
