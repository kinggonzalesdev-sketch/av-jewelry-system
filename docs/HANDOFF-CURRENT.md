# Handoff — current state (2026-08-19)

Read this first in a new session. Concise pickup state. For the full system
audit (tables, every module's status, env vars, cron, perf) read
**`docs/HANDOFF-CURRENT-STATE-2026-08-11.md`**. The authoritative, always-current
changelog is the memory index **`MEMORY.md`** (one line per topic, newest facts in
each linked note) — this doc is the short "what matters right now" on top of it.

## Branch, deploy, verify

- **Branch:** `production-ui-integration`. **Main:** `main`.
- **Production is LIVE, in daily use.** App + DB co-located in Singapore
  (Vercel `sin1` / Supabase `eqfddwxsmzzojuasffjx`, `ap-southeast-1`).
- **Deploy** (standing instruction — auto-deploy every finished web change):
  `npx vercel --prod --yes --build-env APP_COMMIT=$(git rev-parse --short=7 HEAD)`.
- **Verify (all green 2026-08-19):** `npm run typecheck` (0) · `npm run lint`
  (clean) · `npm run test` (**1,226 unit pass**) · `npm run build`. Latest prod
  deploy `av-jewelry-6v19gycmy` → READY.
- Migrations apply via Supabase MCP `apply_migration` (NOT `supabase db push` —
  blocked by pre-existing migration drift).
- Public demo: `av-jewelry.vercel.app` (demo login `UatPass123!`). Local
  "Invalid credentials" almost always = Docker/Supabase down, not a bad password.

## 🔖 Latest save point (rollback target)

- Git tag **`savepoint-2026-08-19-cash-7tab-print-diag`** (commit `f910f56`).
- DB snapshot schema **`savepoint_20260819_cash7tab`** (77 base tables +
  function/trigger/policy/index defs; live==snapshot verified).
- Instant code rollback (no rebuild): `npx vercel promote av-jewelry-6v19gycmy --yes`.
- Restore playbook: `backups/savepoint-2026-08-19-cash-7tab-print-diag/README.md`.

## ⏭️ Owner's #1 priority — the on-device live test

The web + DB are code-complete + deployed. The remaining work is on-device:

1. **Install the fresh APK** — `mineflow-capture-1.0.12` **build `44091c5`**
   (`mobile/mineflow-capture/app/build/outputs/apk/debug/app-debug.apk`, rebuild with
   `:app:assembleDebug`, JDK 21 + cached Gradle 8.7 — see `av-jewelry-capture-speed`).
   The two phones on the heartbeat still run OLDER builds (`b7b209d`, `3d1f144`) that
   LACK the durable print diagnostic. Confirm the heartbeat then shows `44091c5`.
2. **Pair + connect the XP-236B** to the phone → heartbeat `printer_connection_state`
   should read `connected` (currently `no_printer` / `connecting`).
3. **One controlled capture** (pinned-comment name) → sticker prints. Then read the
   durable per-capture diagnostic (query below) to prove whether the phone printed
   locally or fell back — this is the EVIDENCE gate before any Bluetooth change.
4. If direct print works → run the one-tap live flow (name → print <2s → auto-send
   screenshot to that Facebook name). 5. Click **"Sync Pancake Conversations"** once
   before going live (the webhook is already live; belt-and-suspenders).

### Read-only diagnostic query (run after that ONE capture)

```sql
select capture_id, print_status, sticker_claimed_by, sticker_printed_at, print_diag
from public.capture_records
order by captured_at desc limit 1;
```

Classify `final_print_source`:
- `print_diag->>'result' = 'success'` → **direct-local** (phone printed; poller + PC
  correctly skipped). Sub-second local print confirmed.
- `sticker_claimed_by = 'pc-web'` → **pc-web** (PC fallback printed).
- `sticker_claimed_by` = a device-id (non-null) → **mobile-poller**, i.e.
  `maybePrintDirect` FAILED → inspect `print_diag->>'error_class'` and
  `print_diag->>'socket_warm'` (cold-RFCOMM hypothesis). Only AFTER this evidence do
  we touch the Bluetooth reliability logic — never before.

## ✅ Recently shipped (see MEMORY.md for the full, dated detail)

- **Daily Cash Summary** lower area = ONE self-contained 7-tab Details section
  (tab switch = table-only, no nav/reload; per-tab lazy+cache; Add/View/Edit/Delete
  modals; Actual-Cash-Count preserved; targeted recalc; Cash Payments + Trade
  Deductions read-only). Owner-verified on prod. `av-jewelry-daily-cash-summary`.
- **Durable per-capture direct-print diagnostic** — `capture_records.print_diag`
  (technical-only, NO PII; migration `20260819100000_capture_print_diag`); Android
  `maybePrintDirect` returns a `DirectPrintDiag` passed into the capture-create.
  Awaiting the one-capture read above. `av-jewelry-capture-speed`.
- **Server-side pagination** is DONE + deployed for Inventory, Orders AND Layaway
  (scales to ~50k). `av-jewelry-pagination-progress`.
- **Fulfillment Phase A** (`official_orders` single source of truth),
  **inventory-status integrity guards**, **inventory Edit/Delete approval workflow**
  (owners = King + April), **Approvals module**, **per-item Remove / Split-to-order**,
  **media-eligibility P0 fix** — all live. See the matching memory notes.

## ❌ Pending / deferred (do NOT start without a green light)

- ❌ **Bluetooth reliability fix** — GATED on the one-capture `print_diag` evidence
  above. No connection/retry-architecture change until then.
- ❌ **Pancake photo-send** — controlled Test B (one silent retry) + Test C (genuine-DM
  photo) still UNPROVEN; v1↔v2 gap; auto-send-later. Keep the test account silent.
  `av-jewelry-pancake-test-b`, `av-jewelry-media-eligibility-fix`.
- ❌ **Webhook secret rotation cutover** — mechanism is live; the Owner does the
  Pancake + Vercel swap AFTER a live session (never mid-live).
- ❌ **Layaway "Imported (no item)" backfill** — needs the Owner's inventory
  Unique-Code file. **Historical scrap report (Req 15)** — the pre-go-live
  ₱22.1M / 468 rows, produced separately.
- ❌ **Perf tuning** (async-dropdown; advisor unindexed-FK / unused-index /
  permissive-policy cleanup) — non-blocking. **Capture Phase 2** (`order_source`).

## Watch item

- DB connections were **42 / 60** (Micro tier cap) while idle. Under a heavy live
  they can approach 60 → the old slowdown / "invalid credentials". Mitigation: a
  Supabase **restart** clears a pileup instantly. `av-jewelry-supabase-compute`.

## House rules that must not regress

- Money is `numeric` in SQL, a **string** in TS — never a JS float; sums happen in
  RLS-scoped SQL. A failed read shows an explicit error, never a false ₱0.
- Pancake / printer are never faked as "connected".
- No PII in capture diagnostics/logs (names, screenshots, FB messages, BT address,
  tokens).
- Report progress with **✅ done · ❌ not yet · 🔄 in-progress** (Owner preference).
- `<Money amount=…/>` is print-safe (masks screen, shows real on print);
  `usePrivacyMoney()` is a screen-only string formatter (NOT print-safe).
- Make a **save point** (git tag + in-DB snapshot) before risky DB/system-wide work
  — `av-jewelry-savepoint-rollback`.
