# Save point — 2026-09-07 · Mobile + PWA + Attendance refinement

**WEB-ONLY. NOT deployed. Production is unaffected by this save point.**

## What this captures

- **Git tag:** `savepoint-2026-09-07-mobile-pwa-attendance` at commit **`63a2800`**
  (branch `feature/mineflow-pwa` = `production-ui-integration` tip `a2fd1c4` + 12 commits
  `20b0191..63a2800`). Pushed to GitHub `origin/feature/mineflow-pwa`.
- **In-DB metadata snapshot:** schema `savepoint_20260907_mobilepwa`
  (`_functions` 284, `_policies` 162, `_indexes` 234, `_meta`).

## Why the DB snapshot is metadata-only

This branch added **zero migrations** — `git diff a2fd1c4..HEAD -- supabase/` is empty. The new
Attendance reads (`listAttendancePage`, `listTodaySessionStaff`) use **existing** tables/RPCs;
clock, device-approval and payroll (`report_payroll`) logic are untouched. So the schema is
**identical to `savepoint_20260903_golive`**, whose full 82-table copy remains the table-level
restore point. Re-copying every table here would only duplicate that. Verified equal: functions
284 / policies 162 match the golive baseline (indexes 234 vs 233 = the `20260905130000` PSID
index applied to the prod DB as part of `a2fd1c4`, unrelated to this branch).

## Contents of the code save point (all WEB/UI)

- Installable **PWA** — manifest, icons generated from the one official logo, strict-allowlist
  service worker (no business data cached), versioned update flow + multi-tab "Update now" fix.
- **Responsive foundation** — 19 data tables → labelled cards on phones, 44px tap targets,
  bottom-sheet modals, safe-area handling.
- **Mobile bottom nav** — six-slot bar (Dashboard · Orders · Inventory · Layaway · Daily Cash ·
  More) + More bottom sheet; the duplicate Light-mode control was removed (one theme button, in
  the header).
- **Attendance refinement** — compact device banner, "Attendance today" action card, team
  summary cards, and a filtered + **server-paginated** history (default last 7 days, 25/50/100
  per page). No attendance/payroll business rule changed.

Gates at save time: `tsc` 0 · `eslint` 0 · **1543** unit tests · `next build` OK.

## Rollback

**Code (local):**
```
git checkout savepoint-2026-09-07-mobile-pwa-attendance
```

**Production:** nothing to roll back — this branch was **never deployed**. The live known-good
deployment remains **`av-jewelry-aemq2trca`** (commit `ecbd512`, the 2026-09-03 save point). To
re-assert it if some *other* change went out: `npx vercel promote av-jewelry-aemq2trca --yes`
(from the correct scope `kinggonzalesdev-3478s-projects`).

**Database:** no change to undo. For a full table-level restore use the prior snapshot
`savepoint_20260903_golive` (see `backups/savepoint-2026-09-03-golive/README.md`).

## Deploying this work later (Owner action)

The deploy branch prod tracks is **`production-ui-integration`** (every recent prod deploy shows
`gitCommitRef: production-ui-integration`), currently at `a2fd1c4`. To ship this work:
1. Fast-forward it: `git checkout production-ui-integration && git merge --ff-only feature/mineflow-pwa`.
2. Deploy through the **Owner's own Vercel login** (the local CLI is signed into the wrong
   account): `npx vercel logout` → `npx vercel login` → re-link scope
   `kinggonzalesdev-3478s-projects` → `npx vercel --prod --yes --build-env APP_COMMIT=$(git rev-parse --short=7 HEAD)`.

## Snapshot housekeeping

Kept: `savepoint_20260903_golive` (full 82-table restore) + `savepoint_20260907_mobilepwa`
(this metadata record). Pruned: `savepoint_20260830_importguard`. Git tags for all earlier
points remain for code rollback.
