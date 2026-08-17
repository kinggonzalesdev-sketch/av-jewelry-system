# Save point — 2026-08-17 (Walk-In Scrap + Daily Cash scrap-out)

Rollback point taken **after** the P0/P1 financial batch landed and was verified live:
P0 New Order calc fix, Pickup cash (already correct), Scrap Cash-Out in Daily Cash, and
the new **Walk-In "Scrap" Mode of Payment**. Reports sub-sidebar + peso footnote removed.

Gates at capture: `tsc` clean · 1,126 unit tests pass · ESLint clean.
Test G (rolled-back real RPC): ₱30k order paid ₱20k Cash + ₱10k Scrap → **Expected +₱20,000 exact**.

## What this save point contains

| Layer | Handle |
|---|---|
| Code (git) | annotated tag **`savepoint-2026-08-17-walkin-scrap`** → commit `22837a8` |
| Prod deploy (instant re-promote) | **`dpl_9qmzZq8iVVMxJgVG2RLiPXybRTFS`** — `av-jewelry-6n8ludyxa-kinggonzalesdev-3478s-projects.vercel.app` |
| Database (in-DB snapshot) | schema **`savepoint_20260817_scrap`** |

### Snapshot contents (verified equal to live at capture)
- **76** business base tables — `savepoint_20260817_scrap.<schema>__<table>` (e.g. `public__official_orders`).
  Excludes append-only logs `pancake_webhook_events`, `audit_events`, `capture_device_heartbeats`
  (rolling those back would drop newer events).
- **`_functions`** — 274 RPC/procedure definitions (`pg_get_functiondef`).
- **`_policies`** (163 RLS), **`_indexes`** (210), **`_views`**, **`_meta`** (label + timestamp).
- Row-count checks at capture: orders 804·804, payments 293·293, scrap 468·468, items 2977·2977, customers 836·836.

## How to roll back

**Code / UI (fastest — no rebuild):** re-promote the recorded prod deployment in Vercel
(Deployments → `dpl_9qmzZq8i…` → Promote to Production), **or** locally:
```bash
git checkout savepoint-2026-08-17-walkin-scrap
npx vercel --prod --yes
```

**Database — one table (data only):**
```sql
begin;
truncate public.<table>;                      -- or a scoped delete
insert into public.<table> select * from savepoint_20260817_scrap.public__<table>;
commit;
```
Respect FK order (customers/inventory before orders/claims before payments), or defer
constraints inside the transaction. Review the diff before committing.

**A single RPC:** copy its `def` back and run it:
```sql
select def from savepoint_20260817_scrap._functions
where schema='public' and name='save_walkin_order';
-- paste the returned CREATE OR REPLACE FUNCTION ... and execute
```

## After the change is confirmed safe
Drop the snapshot to reclaim space (the git tag stays as the durable code marker):
```sql
drop schema savepoint_20260817_scrap cascade;
```

## Caveat
This in-DB snapshot dies with the project — it is **not** off-site. The off-site layer is
Supabase → Database → Backups (dashboard; Owner's responsibility).

Prior points: `savepoint-2026-08-17-after-p1core` / `savepoint_20260817_after`,
`savepoint-2026-08-17-before-cashflow` / `savepoint_20260817`, `savepoint-2026-08-15-send-invoice-fix`,
`savepoint-2026-08-14`.
