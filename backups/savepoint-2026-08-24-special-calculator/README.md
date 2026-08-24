# Save point — 2026-08-24 · special-calculator

Restore point taken after the Special Calculator simplification (single 20%/30% Down Payment toggle,
Remaining Balance removed). **Code-only change — the DB schema is identical to the prior
`savepoint_20260824_reactivation` point; this snapshot just captures the current business data.**

## Identifiers
- **Git tag:** `savepoint-2026-08-24-special-calculator` (commit `9650795`)
- **In-DB snapshot schema:** `savepoint_20260824_calc`
- **Known-good prod deployment:** `av-jewelry-3hzm02pfu` (aliases `avjewelry.online`, `www.avjewelry.online`, `av-jewelry.vercel.app`)
- **Verified:** live == snapshot — inventory 3713 / orders 1172 / customers 1205; 78 base tables +
  `_functions` 276 + `_policies` 162 + `_indexes` 233 + `_meta`.

## What changed since the prior point
- `src/components/calculator/price-down-payment-calculator.tsx` only — the Down Payment Breakdown now
  shows ONE percentage at a time via a 20% / 30% segmented toggle (default 20%, green active state);
  Remaining Balance was removed from the UI and the computed breakdown. Math unchanged
  (`dp = item_price × 0.20 / × 0.30`, integer-centavo). No DB / migration change.

## Rollback — CODE (instant, no rebuild)
```bash
npx vercel promote av-jewelry-3hzm02pfu --yes
```
Or check out the tag and redeploy:
```bash
git checkout savepoint-2026-08-24-special-calculator
npx vercel deploy --prod --yes
```
To revert ONLY the calculator change (keep everything else), revert commit `9650795`.

## Rollback — DATABASE (selective, last resort)
Same mechanism as prior points — the in-DB snapshot `savepoint_20260824_calc` holds business tables
only (append-only logs `pancake_webhook_events`, `audit_events`, `capture_device_heartbeats` are
EXCLUDED). Prefer a targeted table/RPC restore over a wholesale one; live business data advances, so a
blind restore loses newer rows. Inspect: `select * from savepoint_20260824_calc.public__<table>;`.

## Off-site layer (Owner)
The true off-site backup is **Supabase → Database → Backups** (dashboard) — the Owner's responsibility.

## Cleanup / retention
Currently kept two-deep: `savepoint_20260824_reactivation` + `savepoint_20260824_calc`.
Drop when confirmed safe: `drop schema savepoint_20260824_calc cascade;`
