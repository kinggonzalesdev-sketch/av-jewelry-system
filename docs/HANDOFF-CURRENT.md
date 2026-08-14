# Handoff — current state (2026-08-12)

Read this first in a new session. Concise pickup state. For the full system
audit (73 tables, every module's status, env vars, cron, perf), read
**`docs/HANDOFF-CURRENT-STATE-2026-08-11.md`** — this doc is the *delta on top of
it* plus what's pending.

## Branch, deploy, verify

- **Branch:** `production-ui-integration`. **Main:** `main`.
- **Production is LIVE, in daily use.** Deploy the working tree with
  `npx vercel --prod --yes` (standing instruction: auto-deploy every finished
  change without asking). App + DB co-located in Singapore
  (Vercel `sin1` / Supabase `eqfddwxsmzzojuasffjx`, `ap-southeast-1`).
- **Verify (all green as of this session):** `npm run typecheck` (tc=0) ·
  `npm run lint` (clean) · `npm run test` (**1,102 unit pass**). Latest prod
  deploys reached `READY`.
- Public demo: `av-jewelry.vercel.app` (demo login `UatPass123!`). Local
  "Invalid credentials" almost always = Docker/Supabase down, not a bad password.
- Migrations apply via Supabase MCP `apply_migration` (NOT `supabase db push` —
  blocked by pre-existing migration drift).

## ⏭️ Owner's #1 priority — TOMORROW's live test

Everything below is code-complete + deployed. The remaining work is the Owner's,
on-device:

1. **Install the freshly rebuilt APK** (image-pipeline + OCR fixes are only in the
   new build). 2. **Connect the Bluetooth thermal printer to the phone** (the
   phone prints locally now — sub-second — instead of round-tripping to the PC).
3. **Test the one-tap live flow:** pinned-comment name → print in <2s → auto-send
   the screenshot to that Facebook name. 4. Re-run **"Sync Pancake
   Conversations"** once before going live.

## ✅ What changed THIS session (2026-08-12)

**The big one — "No Facebook match" ROOT CAUSE fixed.** A real Facebook *video/Reels*
live sends comments as `data.post.type: "video"`, but the webhook parser
hard-required `"livestream"` and silently dropped **every** comment. Fix in
`src/lib/integrations/pancake-webhook.ts` (`parsePancakeLiveComment`): store ANY
messaging event that has `page_id` + `data.message.id` + `data.message.from.id`
(PSID, ≠ page) + `from.name` — covers video comments, livestream, AND inbox DMs.
Verified live: `pancake_webhook_events` went **2 → 281+**, and every recent
commenter now resolves to exactly one sendable chat. (Full write-up +
the PSID constraint is in memory `av-jewelry-capture-facebook-match`.)

- ✅ **Auto-link is now automatic** (no manual Sync needed for new commenters):
  - Real-time customer link inside `webhook_store_pancake_live_comment` RPC —
    fills `customers.pancake_conversation_id = {page_id}_{psid}` on a UNIQUE
    active-name match. Uses `(array_agg(id))[1]` (NOT `min(uuid)` — doesn't exist
    in PG) and is wrapped in `begin…exception when others then null` so it can
    NEVER roll back a stored event.
  - Order-level auto-link (pancake `/resolve` route) + **Send Invoice** dynamic
    resolve (`for-invoice.ts`) both now call `resolveConversationForName`
    (webhook fast-match) instead of the old live-API-only lookup that omitted
    video-live commenters.
  - **Two name→conversation resolvers are kept in sync** —
    `resolveConversationForName` (pancake.ts) and `resolveCaptureIdentity`
    (pending-link.ts) both call the webhook RPC tier.
- ✅ **OCR garbage fix** — `ScreenshotOcr.kt` `BLOCK` regex drops app/live chrome
  (GLIVE, "LIVE 01", MineFlow, "Capture Service", Floating Button, Open App) so
  they never print as the FB name (blank → PC review instead).
- ✅ **Android image pipeline** — removed dead `savePng` PNG round-trip; capture
  now local-prints + auto-sends the screenshot. **APK rebuilt + sent.**
- ✅ **Capture speed** — the incoming-captures engine (realtime + auto-print) was
  mounted ONLY on the Orders page → captures crawled when the operator was on
  another page. Moved to `AppShell` (`allowedPages.includes('claim_capture')`) so
  it runs app-wide + persists across nav. Removed the modal help-text; added a
  "🔄 Re-check FB" button.
- ✅ **Inventory server-side pagination** — DONE + deployed. `inventory_active_ids_page`
  RPC returns page ids + counts (its SQL group CASE mirrors `lib/inventory/group.ts`
  exactly, verified vs all 2,784 items); `listInventoryActivePage` reuses the
  proven monitor+custody row-builder so availability is identical; workspace
  rewired to `initialPage` + debounced server fetch. It's a DISPLAY screen, so
  pagination never touches stock — can't oversell.
- ✅ **Privacy Mode batch 2** — masked money in HR (payroll summary, review/attendance,
  **payslip** — print/PDF keep real values), Invoicing, Fulfillment (workspace,
  prepare form, collection controls), Layaway ledger modal, Daily Cash. Removed
  the Dashboard "Custom" range button.
- ✅ **Daily Cash** — "⋯ More" modal (Remittance / Other Cash In/Out), manual
  Trades added to CSV export.
- ✅ **Webhook secret zero-downtime rotation** — `checkSecret` accepts EITHER
  `PANCAKE_WEBHOOK_SECRET` OR `PANCAKE_WEBHOOK_SECRET_NEXT` (mechanism deployed;
  the actual cutover is deferred, see below).
- ✅ **Quick wins** — `customers` normalized-name functional index (fast real-time
  linking); `pancake_webhook_events` retention pg_cron (daily 30-day purge);
  deleted stray `av-jewelry-logo.png..png`.

## ❌ Pending / deferred (do NOT start without a green light)

- ❌ **Orders + Layaway server-side pagination** — deferred by Owner to *after the
  live*. Same light-index pattern as Inventory (a `*_ids_page` RPC + reuse the
  proven row-builder + rewire the workspace). Orders = `orders-view.tsx` /
  `orders/service.ts`; Layaway = `payments-workspace.tsx`. Orders is card-based
  and already batch-optimized (~469 rows), so it's not urgent. Details in memory
  `av-jewelry-pagination-progress`.
- ❌ **Webhook secret rotation cutover** — mechanism is live; the Owner does the
  Pancake + Vercel cutover AFTER the live (never mid-live). Steps: set
  `PANCAKE_WEBHOOK_SECRET_NEXT` in Vercel + redeploy → change Pancake `?secret=`
  to it → confirm comments flow → promote NEXT → `PANCAKE_WEBHOOK_SECRET`, clear
  NEXT, redeploy.

## House rules that must not regress

- Money is `numeric` in SQL, a **string** in TS — never a JS float; sums happen in
  RLS-scoped SQL. A failed read shows an explicit error, never a false ₱0.
- Pancake / printer are never faked as "connected".
- Report progress with **✅ done · ❌ not yet · 🔄 in-progress** markers
  (Owner preference).
- `<Money amount=…/>` is print-safe (masks screen, shows real on print);
  `usePrivacyMoney()` is a screen-only string formatter (NOT print-safe).

## Source of truth

`docs/FINAL-UI-SOURCE-OF-TRUTH.md` (Owner-decision change log) +
`docs/HANDOFF-CURRENT-STATE-2026-08-11.md` (full audit). Memory index is in
`MEMORY.md`; the most load-bearing files right now are
`av-jewelry-capture-facebook-match`, `av-jewelry-pagination-progress`, and
`av-jewelry-capture-speed`.
