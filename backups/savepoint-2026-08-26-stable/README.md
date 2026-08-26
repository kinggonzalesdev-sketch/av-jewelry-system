# Save point — 2026-08-26 · production stable (post cost-audit)

A **known-stable** restore point taken after the Vercel cost audit. The audit was **read-only — NO
functional code changed**; this point just marks "production confirmed stable as of 2026-08-26" and
captures the current business data (2 days of real activity since the prior point).

## Identifiers
- **Git tag:** `savepoint-2026-08-26-stable` (HEAD `d736fc8`; deployed code is `9650795` — the README
  commit `d736fc8` is docs-only and builds identically)
- **In-DB snapshot schema:** `savepoint_20260826_stable`
- **Known-good prod deployment:** `av-jewelry-3hzm02pfu` (aliases `avjewelry.online`, `www.avjewelry.online`, `av-jewelry.vercel.app`)
- **Verified:** live == snapshot — inventory 3486 / orders 1259 / customers 1299; 78 base tables +
  `_functions` 276 + `_policies` 162 + `_indexes` 233 + `_meta`.

## What changed since the prior point (`savepoint-2026-08-24-special-calculator`)
- **Code: nothing.** The only step was a read-only Vercel cost audit (findings delivered; nothing
  implemented). No src edit, no migration, no deploy.
- **Data:** 2 days of live selling — inventory 3713→3486, orders 1172→1259, customers 1205→1299.

## Open (not part of this save point — recommendations only, from the cost audit)
The audit identified cost drivers but implemented NOTHING. Safest first optimization (for a FUTURE
task, if approved): short-circuit `routePendingCapturesSystem` / the webhook `after()` sweep when there
are zero pending + zero recent `link_sent` captures, and trim the per-webhook/per-sweep logging. These
are NOT applied here.

## Rollback — CODE (instant, no rebuild)
```bash
npx vercel promote av-jewelry-3hzm02pfu --yes
```
Or `git checkout savepoint-2026-08-26-stable && npx vercel deploy --prod --yes`.

## Rollback — DATABASE (selective, last resort)
In-DB snapshot `savepoint_20260826_stable` holds business tables only (append-only logs
`pancake_webhook_events`, `audit_events`, `capture_device_heartbeats` are EXCLUDED). Prefer a targeted
table/RPC restore; live data advances, so a blind restore loses newer rows. Inspect:
`select * from savepoint_20260826_stable.public__<table>;`.

## Off-site layer (Owner)
True off-site backup = **Supabase → Database → Backups** (dashboard).

## Retention
Kept two-deep: `savepoint_20260824_reactivation` + `savepoint_20260826_stable`.
Drop when confirmed safe: `drop schema savepoint_20260826_stable cascade;`
