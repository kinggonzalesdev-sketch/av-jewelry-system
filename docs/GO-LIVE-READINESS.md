# A.V. Jewelry — Go-Live Readiness

**Snapshot: 2026-08-21** · prod `av-jewelry-mnzdzzcqm` (aliases `avjewelry.online` / `av-jewelry.vercel.app`) · Supabase `eqfddwxsmzzojuasffjx`
Detail refs: `docs/HANDOFF-CURRENT.md`, `backups/savepoint-2026-08-21-*/README.md`.

---

## ✅ Verified & done

**Security** (Supabase advisors clean)
- [x] Anon-execute: **0** public `SECURITY DEFINER` RPCs are anon-callable (was 15) — authenticated/service_role retain access.
- [x] RLS `multiple_permissive_policies`: **all 5** tables merged to one SELECT policy each (staff_profiles, staff_permission_grants, staff_scope_assignments, trusted_devices, sticker_settings).
- [x] Leaked-password protection **enabled**.
- [x] Service-role key confined to the server-only admin boundary; webhook gated by shared secret.

**Performance** (EXPLAIN-verified on prod; byte-identical outputs)
- [x] Orders card-counts **355ms→4ms** (~89×) → sub-second projected at 50k.
- [x] Layaway classifiers **75ms→4.5ms** (~17×).
- [x] Inventory list reads `inventory_items` directly (not `inventory_monitor()`): browse **~30→2.5ms**, search **19→8ms**; + item_code trigram index.
- [x] Webhook auto-link **O(n)→index lookup** (functional index on `normalize_name(display_name)`).
- [x] Server-side pagination on every list page (Inventory/Orders/Layaway/Customers/Payments) — scales to 50k.
- [x] Dashboard + money RPCs are set-based.

**Data integrity**
- [x] Inventory status integrity triggers (block orphan completed/committed).
- [x] Payment overpayment blocked at the DB (within-balance trigger).
- [x] One-capture-one-sticker dedup.

**Rollback safety**
- [x] Save points: `savepoint-2026-08-21-advisor-hardening` (latest) + `savepoint-2026-08-21-perf-inlining` — git tags + in-DB snapshot schemas, live==snapshot verified.
- [x] Instant rollback: re-promote a known-good Vercel deploy (no rebuild).
- [ ] **Off-site DB backup** — confirm Supabase → Database → Backups is on (Owner; the in-DB snapshot dies with the project).

---

## ⚠️ Watch during live
- **Supabase compute exhaustion** — prod slowness/timeouts + "invalid credentials" + error 57014 + connections near 60 = compute maxed. Fix: restart (temporary) + upgrade compute on Settings→Infrastructure (Nano→Micro is free on Pro). Watch connection count.
- **Migration discipline** — apply prod DDL **only** via Supabase MCP `apply_migration`. Never `supabase db push` / `migration repair` (pre-existing drift).
- **Pancake PHOTO to a silent commenter is not available** (private_replies media closed). "Photo waiting" captures correctly route to **Open FB Chat** (manual, ≤7 days). This is expected behavior, not a bug.

---

## 🔲 Before/at go-live (need Owner)
- [ ] **Android capture APK** — confirm the phone(s) run the current build (the double-print + OCR fixes require a rebuilt APK installed). CLOSED-PASS in code; verify the installed APK is current.
- [ ] **Pin-signal test** (optional feature, not a blocker) — post `PINTEST-A/B` from a **viewer** account during a live to determine whether a pinned-comment capture route is possible. Diagnostic net (`pancake_webhook_raw_diag`) is built, currently **OFF**; drop the table once decided.
- [ ] **Printer** — pair/connect the XP-236B to the capture phone; confirm ~1s direct-local print at the counter.

---

## 🎛️ Go-live operations
- **Monitor**: Supabase connections/compute; `vercel logs` CLI + Supabase MCP `get_logs` (note: `error.tsx` hides the raw message — check logs).
- **Rollback code**: re-promote known-good deploy, or `git checkout <savepoint-tag>` → `npx vercel --prod`.
- **Rollback data**: restore a table from the snapshot schema (`insert … select from savepoint_20260821_advisor.public__<table>`), in a transaction.
- **Auto-deploy**: every finished web change is deployed to prod automatically.

---

**Bottom line:** security + performance + rollback are green and verified. The remaining items are operational (APK/printer confirmation, off-site backup toggle) or optional (pin-signal feature) — none block a private go-live.
