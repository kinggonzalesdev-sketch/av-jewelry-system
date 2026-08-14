# MINEFLOW — COMPLETE CURRENT-STATE HANDOFF

**Audit date:** 2026-08-11 · **Type:** Read-only audit + documentation · **No code/data changed.**

> State labels used throughout: **WORKING** (full path verified) · **PARTIAL** · **IMPLEMENTED-NOT-TESTED** · **UI-ONLY** · **BACKEND-ONLY** · **BROKEN** · **NOT-IMPLEMENTED** · **DEPRECATED** · **CANNOT-VERIFY**.
> "Verified" = confirmed in code and/or DB during this audit. Auth-gated pages and the on-device Android app cannot be visually run by the auditor → marked **CANNOT-VERIFY (runtime)** where relevant. All secrets masked as `••••`.

---

## 1. EXECUTIVE SYSTEM SUMMARY

**Purpose:** Internal staff operations system for a jewelry live-selling business — order capture from Facebook Live, invoicing, payments, layaway, inventory, walk-in sales, scrap, attendance/payroll, daily cash reconciliation, and a Facebook-Messenger (Pancake) integration.
**Company served:** **A.V. Jewelry** (product name **MineFlow**). Single tenant, production.
**Main user types:** **Owner (Super Admin)**, **Selected Admin**, **Staff** (permission-driven). Plus a shared **shop kiosk device** (attendance clock) and the **MineFlow Capture Android app** operated during live selling.
**Primary workflows:** Capture → New Order → For Invoice → (payment) → For Prepare → Ship Confirm/Delivery/Pickup → Completed; Walk-in sale; Layaway setup + installments; Payment record→verify; Attendance clock in/out (multi-session "Continue Duty") → Payroll; Daily Cash Summary reconciliation; Owner Approvals for destructive actions.
**Production status:** LIVE, in daily use (395 orders, 447 customers, 2,597 active inventory items, 813 layaway ledger accounts, 7,190 audit events).
**Deployment:** Vercel (region `sin1`, Singapore) + Supabase Postgres 17 (`ap-southeast-1`, Singapore). Domain `av-jewelry.vercel.app`.
**Tech stack:** Next.js 16 (App Router, RSC + server actions), React 19, TypeScript 5.9 (strict), Tailwind v4, Supabase (Postgres + Auth + Storage + Realtime), Zod, Vitest. Native Android Kotlin Capture app.
**External integrations:** **Pancake / pages.fm** (Facebook Messenger inbox + customer + image send + webhook), Vercel Cron, `pg_cron`.

**OVERALL SYSTEM STATUS: PRODUCTION WITH OPEN ISSUES.**
Core money + operations flows are working and in live use; `npm run verify` is green (1091 tests, lint, typecheck, build). Open issues that keep it from a clean "READY": the **Pancake webhook** is armed server-side but its dashboard-side configuration and event delivery **cannot be verified**; the **Android Capture app** on-device behavior **cannot be verified**; several sub-features are UI-complete but unverifiable behind auth; a few **legacy/unused tables** remain (`fulfillment_records`, `layaway_arrangements` — 0 rows). No known money-corruption bug is open.

---

## 2. CURRENT TECH STACK (verified — package.json)

**Frontend:** Next.js **16.2.10** (App Router, `force-dynamic` pages, RSC + client components). React **19.2.7**. TypeScript **5.9.3** strict. Styling: **Tailwind CSS v4** (`@tailwindcss/postcss` 4.3.2) + `class-variance-authority` + `clsx` + `tailwind-merge`. **State:** React state + server components (NO Redux/Zustand). **Forms:** native + `useActionState` (NO react-hook-form/formik). **Validation:** Zod 4.4.3. **Tables:** custom `DataTable` (`components/ui/data-table`) + custom `Pagination` (NO table lib). **Exports:** `exceljs`, `jspdf`.
**Backend:** Next.js **server actions** (`'use server'`, transport-only) + **API routes** (`/api/*`) for mobile/webhooks/cron. Runtime Node ≥24. Authority + money math live in **domain modules** (`server-only`) and the **database** (SECURITY DEFINER/INVOKER functions). **No ORM** — raw `@supabase/supabase-js` 2.110.5 + `@supabase/ssr` 0.12.3.
**Background jobs:** Vercel Cron (1) + `pg_cron` (1). See §41.
**Database:** Supabase **Postgres 17.6**. Query layer = supabase-js (PostgREST) + RPC to SQL functions. No ORM/migrations tool in-app; DDL applied via Supabase MCP `apply_migration` (NOTE: `supabase db push` is blocked by pre-existing migration drift).
**Auth:** Supabase Auth (email/password, cookie sessions via `@supabase/ssr`). See §7.
**Storage:** Supabase Storage (private `attachments` bucket — selfies, capture screenshots, payment evidence refs). See §44.
**Deployment:** Vercel project `av-jewelry-uat` → `av-jewelry.vercel.app`. See §3.
**Realtime:** Supabase Realtime (`postgres_changes`) via `DashboardSyncProvider`. See §40.
**Mobile:** Native **Android Kotlin** app `mobile/mineflow-capture/` (floating overlay, screenshot capture, ML Kit OCR, Bluetooth thermal printer, shared print-claim). **CANNOT-VERIFY (runtime/on-device).**

---

## 3. DEPLOYMENT & ENVIRONMENTS

- **Production Vercel project:** `av-jewelry-uat` (org `kinggonzalesdev-3478s-projects`), functions pinned to **`sin1`** (Singapore) via `vercel.json`. Production URL **https://av-jewelry.vercel.app**. Latest deploy `● Ready` (verified).
- **Supabase project:** `eqfddwxsmzzojuasffjx` ("kinggonzalesdev-avjewelry"), region **ap-southeast-1**, status ACTIVE_HEALTHY, Postgres 17.6. **App + DB co-located in Singapore** (no cross-region latency).
- **Branch/deploy strategy:** working branch `production-ui-integration`; deploys via `npx vercel --prod --yes`. Main branch = `main`.
- **Dev environment:** `next dev`; local Supabase possible (memory notes: local "Invalid credentials" = Docker/Supabase down, not a bad password).
- **Staging/preview:** Vercel Preview + Production environments both hold the env vars; no dedicated seeded staging DB.
- **Cron/scheduled:** Vercel Cron `/api/cron/pancake-sync` (`0 22 * * *`); `pg_cron` `layaway-daily-interest` (`17 16 * * *` UTC). See §41.
- **Serverless functions:** all Next.js routes/actions (Vercel functions) + `/api/mobile/*`, `/api/webhooks/pancake`, `/api/cron/pancake-sync`.
- **Environment mismatch risk:** the **linked Vercel project is `av-jewelry-uat`** (name says "uat") but serves production traffic — cosmetic naming risk only. Secrets are stored per-env in Vercel (Sensitive).

**Deployment: WORKING.**

---

## 4. ENVIRONMENT VARIABLES (names only — values masked `••••`)

Confirmed **configured** in Vercel Production (from `vercel env ls`, Sensitive): `PANCAKE_WEBHOOK_SECRET`, `CRON_SECRET`, `PANCAKE_PAGE_ID`, `PANCAKE_INTEGRATION_ENABLED`, `PANCAKE_API_BASE_URL`, `PANCAKE_PAGE_ACCESS_TOKEN`, `PANCAKE_USER_ACCESS_TOKEN`. Supabase keys must be configured for the live app to function.

| Name                                                                                                                                                                                                           | Purpose                                     | Side   | Status                                              | Used in                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------ | --------------------------------------------------- | ------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`                                                                                                                                                                                     | Supabase project URL                        | client | configured (app runs)                               | `lib/env.ts`, all clients             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                                                                                                                                                | anon API key                                | client | configured                                          | server/mobile clients                 |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                                                                                                                    | privileged admin client (bypasses RLS)      | server | configured (used by cron/webhook/admin paths)       | `lib/env.ts:113`, `supabase/admin.ts` |
| `PANCAKE_PAGE_ID`                                                                                                                                                                                              | A.V. Jewelry FB page id (`588622885161430`) | server | **configured**                                      | `pancake.ts`                          |
| `PANCAKE_PAGE_ACCESS_TOKEN`                                                                                                                                                                                    | pages.fm page token                         | server | **configured**                                      | `pancake.ts`                          |
| `PANCAKE_USER_ACCESS_TOKEN`                                                                                                                                                                                    | pages.fm user token                         | server | **configured**                                      | `pancake.ts`                          |
| `PANCAKE_API_BASE_URL`                                                                                                                                                                                         | pages.fm base (`/api/public_api/v1`)        | server | **configured**                                      | `pancake.ts`                          |
| `PANCAKE_INTEGRATION_ENABLED`                                                                                                                                                                                  | integration on/off                          | server | **configured**                                      | integration gate                      |
| `PANCAKE_WEBHOOK_SECRET`                                                                                                                                                                                       | inbound webhook shared secret               | server | **configured** (~17h ago)                           | `api/webhooks/pancake`                |
| `CRON_SECRET`                                                                                                                                                                                                  | Vercel Cron bearer auth                     | server | **configured**                                      | `api/cron/pancake-sync`               |
| `PANCAKE_SEND_BASE`, `PANCAKE_SEND_PATH`, `PANCAKE_SEND_TOKEN_PARAM`, `PANCAKE_MESSAGE_TAG`, `PANCAKE_MESSAGES_PATH`, `PANCAKE_CONVERSATIONS_PATH`, `PANCAKE_CONVERSATIONS_MONTHS`, `PANCAKE_REQUEST_DELAY_MS` | optional Pancake path/behavior overrides    | server | **CANNOT-VERIFY** (fallback defaults used if unset) | `pancake.ts`                          |
| `DEMO_LOGIN_ENABLED`, `DEMO_LOGIN_PASSWORD`, `DEMO_OWNER_EMAIL`, `DEMO_ADMIN_EMAIL`, `DEMO_STAFF_EMAIL`                                                                                                        | UAT/demo login shortcut                     | server | **CANNOT-VERIFY** (demo path)                       | `lib/auth/demo.server.ts`             |
| `SHOP_PAYMENT_DETAILS`                                                                                                                                                                                         | invoice footer payment details              | server | **CANNOT-VERIFY**                                   | `lib/invoicing/shop.ts`               |
| `VERCEL_GIT_COMMIT_SHA`                                                                                                                                                                                        | app version in System Check                 | server | auto (Vercel)                                       | `lib/live/system-check.ts`            |

---

## 5. DATABASE SCHEMA (real — 73 public tables, ALL RLS-enabled)

Row counts are exact where headline, else pg_stat estimates. Full column detail is in the live schema; key tables below.

**Identity / RBAC**

- `staff_profiles` (21 rows; PK id; auth_user_id, full_name, role_key, is_active, is_demo) — team members; realtime.
- `roles` (3: owner, selected_admin, staff), `permissions` (47), `staff_permission_grants` (330; staff_profile_id+permission_key) — realtime; `role_device_limits` (3), `staff_scope_assignments` (0), `scopes` (0), `staff_hourly_rates` (1), `staff_salary_rates` (3).
- `trusted_devices` (0), `attendance_devices` (4; kiosk device tokens), `printers` (1), `capture_device_heartbeats` (3).

**Orders / fulfillment**

- `official_orders` (395; PK id; order_number, invoice_number, status, fulfillment_destination, order_source, converted_to_layaway, waybill_number, cancellation_* cols, fb_link_status) — realtime; FKs → customers.
- `official_order_claims` (555) link orders↔claims; `claims` (559; source_kind pending/confirmed; inventory_item_id, quantity); `inventory_reservations` (0).
- `fulfillment_records` (**0 rows — effectively unused**; routing is via `official_orders.fulfillment_destination`). `returned_to_stock_reviews` (35), `order_reminders` (1).
- `invoice_drafts` (0), `invoice_draft_claims` (0), `official_order_charges` (0), `price_overrides` (0).

**Inventory**

- `inventory_items` (2,597 active; PK id; item_code, item_name, facebook_name, total_price_per_piece, grams_per_piece, availability_status, is_archived) — realtime; `item_photos` (0), `supplier_codes` (0).

**Customers / Pancake**

- `customers` (447; display_name, contact_number, is_active, pancake_conversation_id, avatar_url; 265 linked to a conversation) — realtime; `customer_aliases` (2), `customer_duplicate_references` (0), `customer_messages` (0; realtime), `message_send_attempts` (0), `waitlist_entries` (0).
- `pancake_integration_config` (1; DB fallback for page id/token) — realtime.

**Payments**

- `payments` (107; official_order_id, amount, status, voided_at/reversed_at, is_test, method) — realtime; `payment_verifications` (107; verified_amount, outcome) — realtime; `payment_evidence` (0), `claim_evidence` (0).

**Layaway** — TWO models coexist:

- `layaway_ledger` (**813 — the ACTIVE model**; flat imported/from-order accounts; item_amount, interest, monthly_interest, total_installment_interest, grand_total, payment, balance, layaway_term, grams, status) — realtime; `layaway_ledger_installments` (1,990), `layaway_ledger_payments` (1,020), `layaway_ledger_items` (107), `layaway_interest_charges` (321 — realtime), `layaway_code_pool` (812; A1–Z200; **RLS on, 0 policies = DEFINER-only**).
- `layaway_arrangements` (**0 — legacy order-derived model, unused**), `layaway_installments` (0), `financers` (3).

**Daily Cash Summary** (new; 0 rows so far)

- `daily_cash_expenses`, `daily_cash_remittances`, `daily_cash_movements`, `daily_cash_closes` — all RLS `for all` gated owner/selected_admin.

**Attendance / Payroll**

- `attendance_records` (22; staff_profile_id, work_date, time_in, time_out, clock_in_photo, clock_out_photo, device_id, is_overtime, overtime_amount; **each row = one work session**, one open session enforced by a partial unique index) — realtime; `payroll_snapshots` (0; realtime).

**Scrap** — `scrap_sales` (125; material, karat, grams, amount, buyer, sold_on, note).

**Approvals / audit / misc**

- `owner_approval_requests` (18; action_kind[11], status, entity_type/id) — realtime; `deletion_requests` (182 — the older `/admin/deletions` register) — realtime; `audit_events` (7,190; action, entity_type/id, context jsonb); `notifications` (0), `idempotency_records` (0), `capability_validations` (0), `conditional_capabilities` (5).
- Capture/live: `capture_records` (5; realtime), `capture_review_queue` (0; realtime), `live_sessions` (1; realtime), `live_test_state` (1; realtime), `live_batches`/`live_batch_items`/`miner_positions` (0), `label_jobs` (0; realtime — print queue), `print_attempts` (0), `attachments` (43).
- Migration/history: `migration_batches`/`migration_source_records` (0), `message_templates` (2; realtime `message_template_history` 2).

Do NOT treat `fulfillment_records`, `layaway_arrangements`, `live_batches`, `miner_positions`, `invoice_drafts`, `scopes`, `staff_scope_assignments` as active — they are 0-row legacy/parallel structures (see §55).

---

## 6. DATABASE SIZE / SCALE (verified counts)

Orders **395** · Active customers **443** (447 total) · Active inventory **2,597** · Payments **107** · Payment verifications **107** · Layaway ledger **813** (installments 1,990, payments 1,020) · Attendance rows **22** · Scrap **125** · Active staff **19** (21 profiles) · Audit events **7,190** · Customers linked to a Pancake conversation **265**. Total DB size / egress / storage bytes: **CANNOT-VERIFY** (not exposed via the audit tooling).
**Likely future bottlenecks:** `inventory_items` (2.6k now, target 20k) and the New-Order/Layaway item picker; `official_orders` list (loads all rows client-side); `audit_events` (grows unbounded, 7k already). Balances are now fast (§42).

---

## 7. AUTHENTICATION — **WORKING**

Supabase Auth, email + password, cookie-based sessions via `@supabase/ssr`. `createClient()` (server) reads the session cookie; sessions are **session-only cookies** (`toSessionCookie` strips maxAge/expires) with a **30-min idle logout** (`IdleLogout` in app-shell). Session verified with `auth.getUser()` (never the unverified `getSession()`) — locked by a test. The edge **proxy** (`src/proxy.ts` → `lib/supabase/proxy.ts`) refreshes the session and redirects unauthenticated page requests to `/sign-in`; it **excludes** `api/mobile`, `api/cron`, `api/webhooks`, static assets, and the `preview` prototype. Public routes = `['/', '/sign-in', '/account-disabled']` only.

- **Temp passwords / set-password:** staff onboarding uses a temp password + forced change (Team Management). Password entry itself is done by the user (never by the system).
- **Demo login:** a `DEMO_*`-gated shortcut exists (`demo.server.ts`) for UAT (owner/admin/staff demo emails). Configured state CANNOT-VERIFY.
- **Account protection:** deactivated accounts → `/account-disabled`; MFA is **recorded-only, NOT enforced** (`MFA_ENFORCEMENT_IMPLEMENTED = false`, TOTP method noted; SMS/phone disabled in Supabase config).
- **Known issue:** leaked-password (HaveIBeenPwned) protection is an **Owner toggle in the Supabase Auth dashboard — status CANNOT-VERIFY** (advisor previously flagged it WARN).

---

## 8. USER ROLES — server + DB enforced

Three roles: **owner** (Super Admin), **selected_admin**, **staff**.

- **Owner:** highest authority. `app_private.has_permission()` **short-circuits to true** for the owner (`is_owner()`), so the Owner implicitly holds every permission. Non-delegable approvals require `requireOwnerApprovalAuthority()` (owner only).
- **Selected Admin:** elevated; many DEFINER functions gate `current_staff_role() in ('owner','selected_admin')` (delete customer/inventory/scrap/attendance/layaway-ledger, cancellation finalize, cash edits, layaway create).
- **Staff:** permission-driven only (explicit grants).
  Enforcement is **NOT UI-only:** every page re-checks its permission server-side (`canOpenPage`), every domain module re-checks (`requirePermission`/`requireOwnerOrAdmin`), and **RLS + SECURITY DEFINER role checks** back it at the DB. Nav hiding is explicitly documented as convenience, not control (Bible §30.3 r2).
- **Max Super Admin rule:** enforced in SQL (`is_owner()` in `has_permission`, `requireOwnerApprovalAuthority`), not just UI. **WORKING.**

---

## 9. MANAGE ACCESS / PERMISSIONS — **WORKING (with documented hardcoded exceptions)**

- Tables: `permissions` (47 keys), `roles` (3), `staff_permission_grants` (330 per-user grants; realtime), `role_device_limits`. Module-based parent→child catalogue drives the Manage Access UI; saves **preserve non-catalogue grants**.
- **Page auth:** `PAGE_PERMISSION` map (nav_dashboard/nav_orders/nav_customers/nav_inventory/nav_layaway/nav_scrap/hr_attendance/hr_review_attendance/hr_payroll/view_reports/view_settings) — sidebar hides + page re-checks the same key.
- **Action/button auth:** server actions call `requirePermission(...)`; DB functions re-check. Realtime: grant changes propagate via `staff_permission_grants` in the realtime publication → `router.refresh()`.
- **Flow (Enable → Save → sidebar → page → buttons → refresh → re-login → another device):** grants are stored server-side + RLS-scoped, so it holds across refresh/re-login/devices. **WORKING** (live UI verification is the Owner's; logic + persistence verified).
- **Hardcoded role checks that bypass Manage Access (documented, intentional):** the **time clock is Owner-gated in `clockIn`/`clockOut`** (self-service) though the kiosk is permission-gated; **Approvals `/approvals` is `ownerOnly`**; **Review Attendance** was Owner-only by RLS and is now permission-gated (`hr_review_attendance`) but **its "see all staff" RLS still keys on owner** — broadening a Selected Admin needs an RLS change first. `canManage` (owner||selected_admin) is used directly for several destructive UIs.

---

## 10. COMPLETE SIDEBAR / MODULE LIST (from `navigation.ts`)

| Module              | Status                            | Route                      | Purpose                  | Access                                  | Backend     | DB       | Notes                                         |
| ------------------- | --------------------------------- | -------------------------- | ------------------------ | --------------------------------------- | ----------- | -------- | --------------------------------------------- |
| Dashboard Profile   | WORKING                           | `/dashboard`               | KPIs/profile             | nav_dashboard                           | ✓           | ✓        | trimmed cards (§11)                           |
| Orders              | WORKING                           | `/orders`                  | order lifecycle          | nav_orders                              | ✓           | ✓        | balances now fast                             |
| Inventory           | WORKING                           | `/orders/inventory`        | items                    | nav_inventory                           | ✓           | ✓        | loads all client-side                         |
| Layaway             | WORKING                           | `/orders/payments`         | layaway + payment verify | nav_layaway                             | ✓           | ✓        | ledger model                                  |
| Scrap               | WORKING                           | `/admin/scrap`             | scrap sales              | nav_scrap                               | ✓           | ✓        |                                               |
| Approvals           | WORKING                           | `/approvals`               | owner approval queue     | ownerOnly                               | ✓           | ✓        | live pending badge                            |
| Daily Cash Summary  | WORKING (no data yet)             | `/cash/daily`              | cash reconciliation      | view_reports                            | ✓           | ✓        | §21                                           |
| Reports             | PARTIAL / CANNOT-FULLY-VERIFY     | `/reports`                 | reports                  | view_reports                            | ✓           | ✓        | §38                                           |
| Attendance          | WORKING                           | `/admin/attendance`        | clock + history          | hr_attendance                           | ✓           | ✓        | Continue Duty                                 |
| Review Attendance   | WORKING                           | `/admin/attendance/review` | all-staff review         | hr_review_attendance (RLS owner-scoped) | ✓           | ✓        | §28                                           |
| Payroll             | WORKING                           | `/admin/payroll`           | derived payroll          | hr_payroll                              | ✓           | ✓        | §29                                           |
| Special Calculator  | UI-ONLY (by design)               | `/calculator`              | price/DP calculator      | active staff                            | client-only | none     | §24                                           |
| Settings            | WORKING                           | `/settings`                | admin/config             | view_settings                           | ✓           | ✓        | §32                                           |
| Customers           | WORKING (route only, off-sidebar) | `/customers`               | customer records         | nav_customers                           | ✓           | ✓        | reached from orders/layaway                   |
| Invoice workspace   | WORKING (folded in)               | `/orders/invoice`          | invoice prep             | nav_orders                              | ✓           | ✓        | redirects into Orders→For Invoice             |
| Fulfillment         | DEPRECATED (fallback route)       | `/orders/fulfillment`      | old fulfillment          | perm-gated                              | ✓           | 0 rows   | replaced by destination routing               |
| Deletion register   | LEGACY (still writes)             | `/admin/deletions`         | direct-delete audit      | owner/admin                             | ✓           | 182 rows | older register; requests now go to /approvals |
| Live/Capture strips | PARTIAL                           | (in Orders)                | incoming captures        | claim_capture                           | ✓           | ✓        | §14                                           |

---

## 11. DASHBOARD — **WORKING**

`/dashboard` (nav_dashboard). Server-rendered KPI cards from aggregate SQL RPCs (dashboard metrics/range-aware), realtime via `DashboardSyncProvider` (router.refresh on DB change — no client-side totals). Owner trimmed several cards (removed Sales·Layaway·Scrap combined, Order Status, Sales for the Period, Sales Snapshot, Work Queues, Scrap details table, Money in Transit card). Remaining includes an Income-mix slice + scrap gold/silver chart. Test Mode isolates test data from reports. **No known placeholder/inaccurate metric** (money summed in SQL). Range filter present.

---

## 12. ORDERS MODULE — **WORKING** (routing via destination, not fulfillment_records)

**Status enum (official_orders.status):** `invoiced` (For Invoice) · `awaiting_required_payment` (For Reminder — folded into For Invoice) · `required_payment_verified` (For Confirm) · `for_preparation` (For Prepare) · `for_shipping_or_pickup` · `approved_for_release` (Ship Confirm) · `exceptional_release_pending` · `dispatched_or_picked_up` (Delivery/Pickup) · `for_layaway` · `keep` · `completed` · `cancelled` · `for_cancel` · `expired_overdue`.
Current live distribution: approved_for_release 193, for_preparation 64, completed 47, for_layaway 44, cancelled 10, invoiced 6, awaiting_required_payment 1, keep 1.

- **ACTIVE:** invoiced, awaiting_required_payment (folded), required_payment_verified, for_preparation, for_shipping_or_pickup, approved_for_release, dispatched_or_picked_up, for_layaway, keep, completed, cancelled, for_cancel.
- **HISTORICAL/derived cards:** For Delivery/Pickup are **`fulfillment_destination`**-driven (shipping/delivery/pickup), not separate statuses.
- **REMOVED from new flow:** "For Reminder" as a distinct stage (Owner 2026-08-09) — still exists in DB, presented as For Invoice.
- **New Order:** multi-item, creates a For-Invoice order (invoiced) via `create_new_order_multi` (per-item Fixed/Per-gram; prints slip; reserves items). Walk-In mode = separate (§22).
- **Cancel:** two-step (`request_order_cancellation` → for_cancel + owner-approval request → `finalize_order_cancellation` → cancelled + returns eligible stock via RTS review). Now **owner/selected_admin OR invoice_preparation** can request (fixed 2026-08-11). **WORKING.**
- **Payment status per row** derived from `order_balances()` (now set-based, fast §42). **Search:** by order_number/invoice/customer/**waybill** (waybill searchable but its column was replaced by Date; waybill shown in Order Details). Date column added. **Add Payment** available in every live stage incl. Pickup.
- **Send Invoice / FB link:** `advance_order_to_reminder`, `set_customer_facebook_url`, "Open FB Chat", View Message; per-order FB conversation link. Pancake send is page-aware (§15).
- **Known bug (data):** `fulfillment_records` is **0 rows** while 395 orders exist — the old `prepareFulfillment`/`releaseFulfillment` path (which updates that table) would no-op for current orders; the live flow instead routes via `official_orders.fulfillment_destination` + status. Treat fulfillment_records-based code as DEPRECATED. **Flagged, not fixed.**

## 13. ORDER TABLE DESIGN — **WORKING**

Component: custom `OrdersView` + `DataTable`. Columns: Staff/customer · **Date** (replaced Waybill) · Order/Invoice no. · payment status + Money · status badge · Actions/View. Sticky top section (title + New Order + status cards) — `sm:sticky` (mobile scrolls). **Pagination: RENDER-side only** (windows to 50/page client-side); the full order list is **loaded client-side** (all 395 rows) — payload not yet server-paginated (see §42). Waybill = hidden-but-searchable. Latest-activity-first sort (updated_at → created_at → id).

---

## 14. MINEFLOW CAPTURE (Android) — **IMPLEMENTED-NOT-TESTED / CANNOT-VERIFY (on-device)**

Code exists under `mobile/mineflow-capture/`. Auditor cannot run the APK. Server side is verified.

| Step                                                                                                                                                                                                                                                                                                                                                                                | Status                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Floating overlay + screenshot capture                                                                                                                                                                                                                                                                                                                                               | code present — CANNOT-VERIFY on-device                                                                                                        |
| Facebook Live use / pinned-name detection                                                                                                                                                                                                                                                                                                                                           | via OCR of the captured screenshot — CANNOT-VERIFY                                                                                            |
| OCR / vision                                                                                                                                                                                                                                                                                                                                                                        | **ML Kit** on-device OCR (Kotlin) — code present                                                                                              |
| Grams / price extraction                                                                                                                                                                                                                                                                                                                                                            | parser present (`normalizeGrams`, code parser) — CANNOT-VERIFY accuracy                                                                       |
| Pending order creation                                                                                                                                                                                                                                                                                                                                                              | POSTs to `/api/mobile/capture/*` → `capture_records` (5 rows exist) — **BACKEND WORKING**                                                     |
| Screenshot storage                                                                                                                                                                                                                                                                                                                                                                  | Supabase Storage `attachments` — server WORKING                                                                                               |
| Customer linking / Pancake matching                                                                                                                                                                                                                                                                                                                                                 | name-based; `set_capture_customer_link`, psid→pancake_customer_id — server present                                                            |
| Printer integration                                                                                                                                                                                                                                                                                                                                                                 | native **Bluetooth** ESC/POS + TSPL; shared exactly-once print claim (`claim_next_capture_sticker`) — server WORKING; on-device CANNOT-VERIFY |
| App/device registration + permissions                                                                                                                                                                                                                                                                                                                                               | Bearer-token mobile auth (`authenticateMobile`), BT/camera perms in manifest — server WORKING                                                 |
| **Current server flow (verified):** phone captures → `/api/mobile/capture/*` creates a `capture_records` (floating, pending, confidence gated) → appears in the PC **Incoming Captures** strip (realtime) → operator "Use" → pre-filled New Order → print + reserve + For Invoice; Send Invoice attaches the screenshot. Stage-3 (full on-device Android loop) = **CANNOT-VERIFY**. |

---

## 15. PANCAKE INTEGRATION — **PARTIAL** (send pipeline verified; webhook armed, delivery unverifiable)

Token config: **configured** (`PANCAKE_PAGE_ACCESS_TOKEN`/`USER_ACCESS_TOKEN`/`PANCAKE_PAGE_ID=588622885161430`/`PANCAKE_API_BASE_URL`). Base `pages.fm/api/public_api/v1`, `page_access_token` query param; conversation id = `{page_id}_{psid}`. The client (`lib/integrations/pancake.ts`) uses **configurable paths** (env overrides) with v1 defaults; the auditor confirmed the **send pipeline works end-to-end** earlier in the project (HTTP 200 on the A.V. Jewelry page).

| Capability                                                                                                                                                                                                                                                             | Status                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public API token / Page ID                                                                                                                                                                                                                                             | **configured / available**                                                                                                                                                                                                                                                                                                                                                                                      |
| Conversation sync                                                                                                                                                                                                                                                      | **PARTIAL** — implemented (page-aware, `since`/`until`), correctness depends on token/plan                                                                                                                                                                                                                                                                                                                      |
| Customer sync                                                                                                                                                                                                                                                          | **PARTIAL** — implemented; 265 customers linked to a conversation                                                                                                                                                                                                                                                                                                                                               |
| Exact conversation linking                                                                                                                                                                                                                                             | **WORKING** — page-aware (`conversationBelongsToPage`, `getActivePancakePageId`); skips wrong-page links (fixes error_code 120)                                                                                                                                                                                                                                                                                 |
| Image upload                                                                                                                                                                                                                                                           | **IMPLEMENTED** — `content_url` on reply (no separate media endpoint used)                                                                                                                                                                                                                                                                                                                                      |
| Image send                                                                                                                                                                                                                                                             | **WORKING (pipeline)** — reply_inbox form POST with `content_url`                                                                                                                                                                                                                                                                                                                                               |
| Send Invoice                                                                                                                                                                                                                                                           | **WORKING (pipeline)** — attaches captured screenshot                                                                                                                                                                                                                                                                                                                                                           |
| Open Conversation                                                                                                                                                                                                                                                      | **WORKING** — stored Messenger URL opens in new tab                                                                                                                                                                                                                                                                                                                                                             |
| Webhook                                                                                                                                                                                                                                                                | **PARTIAL / CANNOT-VERIFY** — endpoint `/api/webhooks/pancake` is armed (secret configured; returns 401 without secret, echoes challenge with it; **proxy 307 bug fixed** so it's reachable) but **pages.fm dashboard configuration + actual event delivery CANNOT be verified**. Do NOT claim webhook works. Note: memory says webhook is supplementary — the Capture action is the intended realtime trigger. |
| 7-day messaging window                                                                                                                                                                                                                                                 | **CANNOT-VERIFY** — no explicit window handling found; message-tag env exists (`PANCAKE_MESSAGE_TAG`) but enforcement unverified                                                                                                                                                                                                                                                                                |
| Note: the user-provided **v2** endpoints (`/api/public_api/v2/.../conversations`, `.../page_customers`, `.../upload_contents`) are the newer confirmed Pancake surface; the current code defaults to **v1**-style paths (overridable via env) — a reconciliation item. |

## 16. CUSTOMER LINKING

Stored on `customers`: `id` (mineflow_customer_id), `pancake_conversation_id` (= `{page_id}_{psid}`), `avatar_url`, `display_name`, `contact_number`; `customer_aliases` for name variants; `customer_duplicate_references` for dup review. **Matching:** name-based against pages.fm inbox conversations, **page-scoped** to A.V. Jewelry (588622885161430); psid derived → pancake_customer_id. **Priority:** exact confirmed link → same-page conversation → candidate pick (clickable match hint) → no match. **Duplicate names:** operator picks the correct customer (avoid creating dups); Owner **Merge** tool (`merge_customers`, owner-only) reassigns FKs + dedups aliases + soft-deactivates. **CANNOT-VERIFY:** live Pancake API results (token redacted to auditor).

---

## 17. INVENTORY — **WORKING** (scale not yet optimized)

`inventory_items`: unique `item_code` (case-insensitive index), `item_name`, `facebook_name`, `total_price_per_piece`, `grams_per_piece`, `availability_status` (available/returned_to_available/provisionally_reserved/committed/completed/released), `is_archived`. Code parser tolerant of separators/leading-dot grams/EF flag; supplier map. Tabs: **Active Inventory · Completed Items** (Archived/RTS/Duplicate tabs removed from UI; data + fns remain). New Entry = Item Code (unique) + Price + Date Encoded. Edit = descriptive fields only (price is Owner override). Delete = type-DELETE (Owner/Admin) blocked if dependencies; Super-Admin `delete_inventory_item_force`. **Search:** server-side `searchCaptureItems` exists (for the picker) + trigram indexes. **Scale:** list page **loads ALL items client-side** with **render**-pagination (50/page); the New-Order **dropdown** uses server search + a 500-most-recent bound. **10k–20k supported? NOT YET** — the list-page payload is still fetch-all (documented pending server pagination). **CANNOT report as optimized.**

## 18. HK ITEM LOGIC — **WORKING**

HK items are fixed-price pieces. Price comes from the item's stored `total_price_per_piece` (catalogue). **Grams do NOT affect an HK/Fixed item's price** — the New Order per-item toggle Fixed vs Per-gram controls this; Fixed uses catalogue price, Per-gram = grams × rate. Detection is by the item code/type parser (HK ITEM group) + the Fixed pricing path. No known HK pricing bug open.

---

## 19. LAYAWAY — **WORKING** (term-interest bug fixed 2026-08-10)

Active model = `layaway_ledger` (813) + installments/payments/items/interest_charges. Setup Layaway (Orders → For Layaway) creates a ledger account from the order (customer, item total, summed grams). Auto **Assigned Layaway Code** (A1–Z200 pool, released on completion). Terms 1/2/3 months. Monthly interest = grams × ₱150. Payment + MOP + reference; balance = grand_total − payments; auto-complete + code release when paid; overdue via `pg_cron` daily interest. Forfeiture/keep flows present; Add Info / Edit Items (add/remove/split) present.
**Interest calculation (verified fixed):** `monthly = grams × ₱150`; **`total = monthly × term`**; `grand = item + total`.

- 1 month: **WORKS** (₱9,940 + ₱213 = ₱10,153)
- 2 months: **WORKS** (+₱426 = ₱10,366)
- 3 months: **WORKS** (+₱639 = ₱10,579)
  Shared formula `lib/payments/layaway-math.ts` + DB `create_layaway_from_order`, proven-equivalent unit-tested. NOTE: **19 historical accounts were undercharged and were corrected 2026-08-10 (+₱38,226)** — do not re-flag.

## 20. PAYMENTS — **WORKING**

`payments` (107) + `payment_verifications` (107). Record = born `submitted_unverified` (no card data; reference only). Verify = separate authority; **strict block**: a verification cannot exceed remaining balance (DB trigger). Auto-complete order on paid-in-full (retires inventory). Methods = canonical `PAYMENT_METHODS` (Cash/GCash/BPI/BDO/BDO NEW/BDO UNIBANK/Credit Card) — one shared constant drives every dropdown + the DB check. Partial + full supported; layaway payments via ledger fns (`add_layaway_ledger_payment`). Duplicate-reference **flagged** (not auto-rejected). **GCash fraud/verification detection: NOT-IMPLEMENTED** (manual verify only; duplicate-reference flagging is the only automated check).

---

## 21. DAILY CASH SUMMARY — **WORKING (UI+backend complete; 0 data yet)**

Route `/cash/daily`, sidebar section "Cash & Reports", gated `view_reports`. Cards (Cash Sales/Previous/Other In/Expenses) + Cash Breakdown + End-of-Day (Expected, Actual count, **Balanced/Short/Over**, Save & Close). **Date selector is client-side (no navigation)** and **Export** builds a multi-section CSV (summary + all detail tabs). Details is a **self-contained mini-workspace** (verified this session): tab switch, Add/View/Edit/Delete, and date change never navigate or full-reload; Actual Cash Count is never reset on interaction; totals recalc in place.

| Tab                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Status                         | Source                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| Sales Walk-ins                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | WORKING                        | order_source='walk_in' orders                     |
| Cash Payments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | WORKING                        | payments method='Cash' (not voided/reversed/test) |
| Trade Deductions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | WORKING                        | trade deduction rows                              |
| Expenses                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | WORKING (Add/View/Edit/Delete) | `daily_cash_expenses`                             |
| Remittance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | WORKING                        | `daily_cash_remittances`                          |
| Other Cash In                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | WORKING                        | `daily_cash_movements` (in)                       |
| Other Cash Out                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | WORKING                        | `daily_cash_movements` (out)                      |
| Add/View/Edit modals = in-section popups; Delete = confirm modal (cash records are owner/admin direct, not owner-approval). **Server-side aggregation** via `daily_cash_summary(date)` (Cash Sales = verified cash payments; Previous = prior CLOSED day's actual count; Expected = (CashSales+Prev+In) − (Exp+Remit+Out)). Detail readers paginated server-side. **Cash Sales chosen = payments method='Cash' to avoid walk-in double-count.** Add-New-Sale opens an in-section walk-in modal with **partial/down-payment** support. Tables have 0 rows (module new). **New-in-prod; live totals CANNOT-VERIFY yet** but logic validated at DB level (this session). |

## 22. WALK-IN SALES — **WORKING**

Two paths: (a) fully-paid completed sale — `create_walkin_order_multi` (customer + Active-Inventory items + price + one MOP → completed order, item retired, one verified full payment, `order_source='walk_in'`); (b) **down-payment** — `save_walkin_order` (records partial payment, leaves balance, order in For Invoice). Inventory impact: items locked (FOR UPDATE), availability→completed on full sale; prevents double-sell. Customer resolved/inserted by name. Surfaces in Orders (Walk-in badge) + Daily Cash "Sales Walk-ins" + Cash Payments. Uses `MoneyInput` (string money). **WORKING.**

## 23. SCRAP — **WORKING**

`scrap_sales` (125): material, karat, grams, amount, buyer, sold_on, note. UI (`/admin/scrap`): fixed-column table (Material/Grams/Amount/Buyer/Sold On/Note/Actions), grouping/contact/search, header-preserving empty state; Actions incl. delete (owner direct / non-owner → owner-approval `scrap_sale_delete`). Feeds Dashboard scrap chart + Income mix. No known issue.

## 24. SPECIAL CALCULATOR — **UI-ONLY (by design)**

`/calculator`, sidebar last item, available to any **active** account (no special permission; Owner request 2026-08-01). Computes fixed/per-gram item price + 10/20/30% down payment + remaining balance. **Changes no record** (pure calculator). No DB, no backend. Correct classification: UI-ONLY intentionally.

---

## 25. ATTENDANCE — **WORKING** (multi-session)

Kiosk model: select staff → Clock In/Out with a **selfie** (stored in `attachments`, RLS-scoped). Device gate: once a shop phone is registered (`attendance_devices`), only that device may clock. **Each `attendance_records` row = one work session** (no unique-per-day constraint); a **partial unique index** enforces **one open session per staff** (concurrency-safe). First-In/Final-Out/Sessions-count/Total-Worked/View-Details are **derived** by a pure grouping helper (`lib/hr/sessions.ts`). History + Review are grouped one-row-per-day. **WORKING** (logic verified; live selfie capture behind auth = Owner's to eyeball).

## 26. CONTINUE DUTY — **WORKING**

One staff + one `work_date` = one attendance day; multiple sessions inside. After clocking out **today**, the clock shows **Continue Duty** (confirmation → same selfie → same clock-in RPC = a new session row). Active-session protection = the one-open-session unique index (server-side, blocks double-tap/retry/multi-device). Off-duty gaps computed + shown but **not counted**. Realtime via the attendance realtime table + router.refresh. Cross-device state = DB-backed. **No known bug.** (Note: reader `listLastClockOutToday` is RLS-scoped like `listOpenSessions` — non-owner kiosk operators see own state; Owner sees all.)

## 27. TODAY'S DUTY SESSIONS — **PARTIAL**

There is **no dedicated separate "Today's Duty Sessions" table component** with columns Session/Clock In/Clock Out/Duration/Status filtered by selected staff. Equivalent info exists in: (a) the **clock card** (shows "Clocked out at X"/Continue Duty per selected staff), and (b) the **Attendance History day-detail modal** (per-session in→out, duration, Continued-Duty badge, off-duty gaps, total). A distinct live "today's sessions for the selected staff" mini-table = **NOT-IMPLEMENTED as its own element** → **PARTIAL**.

## 28. REVIEW ATTENDANCE — **WORKING**

`/admin/attendance/review` (hr_review_attendance). Grouped one-row-per-day (Employee/Date/First In/Final Out/Sessions/Total Worked/Status/Overtime/Details) + a day-detail modal (per session: in→out, duration, **selfies**, off-duty gaps, per-session delete). Filters: employee/date/status. Admin correction = per-session delete (owner direct / non-owner → owner-approval `attendance_delete`); payroll is derived so it recomputes. Audit via `audit_events`. **RLS returns all staff only for the Owner** (documented follow-up to broaden to Selected Admin).

## 29. PAYROLL — **WORKING** (multi-session correct)

`/admin/payroll` (hr_payroll). Derived from `attendance_records` via `report_payroll(from,to)`. **Worked hours = SUM(session durations)** (`sum(time_out−time_in)` per row), NOT final_out−first_in — verified. `days_worked = COUNT(DISTINCT work_date)`. **Overtime = a flat ₱300 night bonus, now capped once per day** (`COUNT(DISTINCT work_date) FILTER (WHERE night_out)`, fixed 2026-08-11, validated on prod). Daily rate on a weekly/bi-weekly/monthly cycle (`staff_salary_rates`); salary = days_worked × rate + night_bonus. Payslip snapshots (`payroll_snapshots`, 0 rows). **CORRECT** for multi-session days.

## 30. TEAM MANAGEMENT — **WORKING**

Staff/Admin list from `staff_profiles` (21). Account creation + temp password + set-password + role assignment + Manage Access (grants). Delete = permanent (Owner/Admin) blocked if linked records (owner-approval for non-owner via `customer_delete`-style flow); attendance/inventory/scrap deletes route through approvals. Surfaced under Settings.

## 31. APPROVALS — **WORKING**

`/approvals` (ownerOnly), unified `owner_approval_requests` (18; realtime). **11 action_kinds:** official_order_cancellation, layaway_forfeiture, price_override, exceptional_fulfillment_release, live_batch_reopen, wrong_payment_to_order_correction, customer_delete, inventory_item_delete, scrap_sale_delete, attendance_delete, **layaway_ledger_delete** (unified 2026-08-11). Tabs Pending/Approved/Rejected/All; View→Approve/Reject (1-step for cancellation Accept/Reject; others Approve→Execute 2-step; execute performs the delete then marks executed; re-validated + execute-once). Live **pending badge** in sidebar (realtime). Audit on request/decide/execute.

- **Void / Refund: NOT-IMPLEMENTED** (no void_payment or refund function/UI exists — only display labels `· voided`/`· reversed`). **Delete/Cancel: WORKING** through approvals.
- **Two registers coexist:** `owner_approval_requests` (new, /approvals) and `deletion_requests` (182, older `/admin/deletions` — now only Owner _direct_ deletes log there). See §55.

## 32. SETTINGS — **WORKING**

`/settings` (view_settings). Minimalist: summary cards + **Team Members** (member drawer/modal, Add Member modal) + accordions: **System Diagnostics** (§33), **Live Operations** (§34), **Message Templates** (§39), and the bottom **Integration** accordion. Bottom section is named **"Integration"** (verified — not "Administration"). Device manager (registered shop phone) shown to Owner on the Attendance page.

## 33. SYSTEM DIAGNOSTICS — **WORKING**

`lib/live/system-check.ts`: deployment env, Supabase project, account id, live sync status, commit/app version (`VERCEL_GIT_COMMIT_SHA`), business name, "Official refresh", **Run System Check**. Reports live status. (Values are read-only diagnostics.)

## 34. LIVE OPERATIONS — **PARTIAL**

`live_sessions` (1), `live_test_state` (1). **Test Mode / Production Mode** = WORKING (test data isolated from reports via `is_test`). **Review Mode** (capture approval queue `capture_review_queue`) = present. **Automatic Mode / operator selection / full Live Session state machine** = **PARTIAL / legacy** — `live_batches`/`live_batch_items`/`miner_positions` are 0-row (the older "Live Selling" module was removed from the sidebar 2026-07-22; Capture-driven flow replaced it). Live Session controls exist but the full live-selling batch flow is not the active path.

## 35. PRINTER SYSTEM — **PARTIAL / CANNOT-VERIFY (on-device)**

Two print surfaces, shared exactly-once queue: (a) **PC/browser** auto-print of incoming capture stickers via a server **claim** (`claim_next_capture_sticker` / `mark_capture_sticker_printed` / `release_capture_sticker`) — server WORKING; (b) **Android Bluetooth** ESC/POS + TSPL (native, `BluetoothPrinterManager` + `PrintJobPoller`) — code present, **CANNOT-VERIFY on-device**. `printers` (1), `label_jobs` (0, realtime print queue), `print_attempts` (0). Test Print, active-printer selection, TSPL/ESC-POS toggle, price-per-gram = in the Android Settings screen (code). Duplicate-print prevention = the shared server claim (`FOR UPDATE SKIP LOCKED`). Job statuses reported back (Printed/Failed). **Server WORKING; physical printing CANNOT-VERIFY.**

## 36. STICKER FORMAT — **WORKING (current spec)**

Current auto-print sticker shows **Facebook Name + Date ONLY** (Owner forced item/price/pricePerGram off — `readStickerFields()`). Centered, size hierarchy, 2-line word wrap; ESC/POS + TSPL + HTML all centered. Price-per-gram source = per-device setting (Android) / sticker settings; grams normalized. Snapshot: the sticker is generated from the capture's mined name/grams; reprints via manual print (also marks the shared claim). Long date format ("August 6, 2026"). This differs from older specs that included item/price — **the current version is name+date**.

## 37. DEVICE REGISTRATION — **WORKING (kiosk) / CANNOT-VERIFY (mobile on-device)**

Device types: **attendance kiosk** (`attendance_devices`, 4; httpOnly cookie token, one approved shop phone gates clock in/out), **printer** (`printers`, 1), **MineFlow Capture device** (Bearer-token mobile auth + `capture_device_heartbeats`, 3), `trusted_devices` (0), `role_device_limits` (3). Owner registers/revokes the shop phone (Device Manager). One-time registration + active/inactive (revoked_at). **Server WORKING.**

## 38. REPORTS — **PARTIAL / CANNOT-FULLY-VERIFY**

`/reports` (view_reports) exists (`reports-view`) + `lib/export/data-export.ts` (CSV export incl. payroll). Dashboard range-aware metrics + Daily Cash export cover most reporting. A full enumeration of individual report types/filters was **not deep-audited** this pass → **CANNOT-FULLY-VERIFY** the complete report list. Export uses UTF-8-BOM CSV (Excel-friendly, ₱-safe). Performance: aggregate RPCs (good). **Status: present, PARTIAL verification.**

## 39. MESSAGE TEMPLATES — **WORKING**

`message_templates` (2) + `message_template_history` (2, realtime). Edited in Settings → Message Templates accordion. Used for customer messaging / invoice text (`customer_messages` + Pancake send). Permission = Settings/admin. **WORKING** (small dataset).

## 40. NOTIFICATIONS / REALTIME — **WORKING (broad)**

Provider: Supabase Realtime `postgres_changes {event:'*',schema:'public'}` via `DashboardSyncProvider` → `router.refresh()`. **31 tables in the `supabase_realtime` publication** (orders, order claims/charges, customers, customer_messages, inventory, reservations, payments, verifications, layaway ledger+installments+payments+interest, capture records+review queue, label_jobs, live_sessions/test_state, owner_approval_requests, deletion_requests, attendance_records, staff_profiles/permission_grants, payroll_snapshots, printers, scrap_sales, financers, order_reminders, pancake_integration_config). `notifications` table exists (0 rows — not actively used). **Reconnect:** Supabase client default. **Risk:** the single wildcard subscription + `router.refresh()` on ANY change is simple but **coarse** — a busy table refreshes every open page; **potential over-refresh at scale** (MEDIUM perf note). No per-channel scoping.

## 41. CRON JOBS

| Name                                                                      | Schedule                         | Purpose                           | Endpoint/Fn                                      | Status                                                     |
| ------------------------------------------------------------------------- | -------------------------------- | --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| pancake-sync (Vercel Cron)                                                | `0 22 * * *` (daily 22:00 UTC)   | Pancake auto-sync / auto-link     | `/api/cron/pancake-sync` (CRON_SECRET bearer)    | configured — runtime effect CANNOT-VERIFY (token redacted) |
| layaway-daily-interest (pg_cron)                                          | `17 16 * * *` UTC (00:17 Manila) | post due layaway monthly interest | `app_private.post_due_layaway_interest_system()` | active (ran successfully in logs)                          |
| No other cron. No automated DB backup job in-app (Supabase-managed, §58). |

## 42. PERFORMANCE — **ACCEPTABLE** (one big win applied this session; list payloads pending)

- **Server-side pagination:** NOT on the main list pages (Orders/Inventory/Layaway/Customers still **fetch-all client-side** + render-paginate to 50/page). This is the main remaining payload risk at 20k scale.
- **Search:** server-side exists for the New-Order item dropdown (`searchCaptureItems` + trigram indexes); other lists filter client-side.
- **Indexing:** FK/query-critical indexes present (payments/charges/claims/layaway on official_order_id; trigram on names; partial on availability; created_at). Remaining unindexed-FK advisors are INFO-level over-indexing suggestions — intentionally **not** applied.
- **Balances (fixed 2026-08-11):** `order_balances()` rewritten **per-order loop → single set-based pass = 1,758ms → 29ms (~60×)**, proven byte-identical across all 395 orders. This was the dominant Orders cost; Owner confirmed "fast enough."
- **App + DB co-located** in Singapore (no latency). Realtime is broad (§40).
- **Pages still loading too much client-side:** Orders, Inventory, Layaway, Customers (full lists). **Classification: ACCEPTABLE now, NEEDS-WORK at 20k+.**

## 43. SUPABASE USAGE — **CANNOT-VERIFY**

DB size / egress / storage bytes / MAU / current plan are **not exposed** to the audit tooling. Compute is **shared-tier** (inferred: `order_balances` was CPU-bound under concurrent load pre-fix; upgrading compute would help — recommended, not required). Whether any plan limit is near = **CANNOT-VERIFY**. Region ap-southeast-1, Postgres 17, ACTIVE_HEALTHY.

## 44. FILE STORAGE — Supabase Storage (private)

| File                                                                                                                                                        | Location                                                         | Public?     | Signed URL                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ----------- | ------------------------------------------- |
| Attendance selfies                                                                                                                                          | `attachments` bucket (`related_entity_type='attendance_record'`) | **private** | minted per-read, 300s, download disposition |
| Capture screenshots                                                                                                                                         | `attachments` (capture)                                          | private     | signed on demand                            |
| Payment evidence                                                                                                                                            | reference only (V1 — no file upload wired)                       | n/a         | `payment_evidence` table 0 rows             |
| Invoices/receipts                                                                                                                                           | generated client-side (jsPDF) at print time                      | n/a         | not persisted                               |
| `attachments` table = 43 rows. **Retention:** none automated (files persist; a deleted attendance record leaves an orphaned selfie — documented, harmless). |

## 45. SECURITY — findings by severity

- **CRITICAL:** none found.
- **HIGH:** none open. (Webhook lacks HMAC-signature validation — uses a **shared secret** via header/query; acceptable for this model but weaker than signature verification → borderline HIGH/MEDIUM. Ensure the secret is not placed in a logged URL.)
- **MEDIUM:** (a) `SUPABASE_SERVICE_ROLE_KEY` used server-side in cron/webhook/admin paths — correct, but any RLS-bypass path must be audited on change; (b) leaked-password protection toggle **CANNOT-VERIFY**; (c) MFA recorded but **not enforced**; (d) no explicit **rate limiting** on `/api/mobile/*` or `/api/webhooks/*` (relies on Bearer/secret) ; (e) broad realtime publication (info-exposure only within RLS).
- **LOW:** 133 "authenticated can execute DEFINER function" advisories (expected — functions gate internally); `pg_trgm` in public schema (cosmetic); `layaway_code_pool` RLS-enabled-no-policy (intentionally DEFINER-only).
- **Positives (verified):** ALL 73 tables RLS-enabled; **anon EXECUTE revoked** on all DEFINER functions (0 anon-executable, hardened 2026-08-11); money math only in SQL; server-side re-checks on every action; Zod validation; no card data captured; secrets Sensitive in Vercel; webhook fails closed (503) if secret unset. **No exposed secret found in the client bundle** (only `NEXT_PUBLIC_*` anon values, which are public by design).

## 46. ROW LEVEL SECURITY — **WORKING** (all tables enabled)

Every one of the 73 public tables has **RLS enabled**. Policy counts range 1–4 per table (e.g., staff_profiles 4, staff_permission_grants 4, orders/customers/inventory/payments 3). Pattern: SELECT scoped to active staff / own-records / Owner-sees-all; INSERT/UPDATE/DELETE gated by role or permission; many writes go through **SECURITY DEFINER** functions (RLS-independent, role-checked internally). **Flags:** `layaway_code_pool` (RLS on, **0 policies** — locked to DEFINER-only, intentional); a full per-table SELECT/INSERT/UPDATE/DELETE matrix was **not exhaustively enumerated** this pass (spot-checked) → treat individual policy bodies as **verify-before-relying**. No table found with RLS disabled.

## 47. AUDIT LOGGING — **WORKING (broad)**

`audit_events` (7,190) via `recordAuditEvent`. Covers: order lifecycle, payments/verifications, layaway, **owner approvals (request/decide/execute)**, deletions (customer/inventory/scrap/attendance/layaway), attendance clock/delete, walk-in, inventory grams edits, cash record add/edit/delete, cancellation. **Gaps / no explicit audit:** permission-grant changes (Manage Access saves) — **CANNOT-VERIFY** a dedicated audit row; realtime/read actions (by design); Special Calculator (no state). Money changes generally audited. Attendance edits = delete-only (audited).

## 48. ERROR HANDLING — **PARTIAL/GOOD**

Server actions return typed `{ok,error}`; UI surfaces inline `role="alert"` messages + honest empty/`ReadError` states (no fake content). Money reads use **"unavailable, never zero"** (deliberate — a denied balance never renders ₱0). Selfie/print failures are **soft** (never fail the clock/order). Pancake failures reported honestly (never fabricated success). Webhook fails closed. **Missing/CANNOT-VERIFY:** global toast system (uses inline alerts), offline handling, explicit realtime-reconnect UX, retry/backoff on failed Pancake/print (print uses shared claim + report). No global error boundary audited this pass.

## 49. MOBILE RESPONSIVENESS — **CANNOT-VERIFY (visual) / code shows intent**

Sticky headers gated to `sm:` (mobile scrolls the whole top section). Mobile bottom nav (Orders·Customers primary + More). Modals/tables use `overflow-x-auto`. Daily Cash/Attendance/Orders built responsive. **Actual device rendering CANNOT-VERIFY** (auth-gated; auditor didn't run a device). Best guess from code: **PARTIAL→GOOD**; the item-picker datalists + wide tables are the likely rough spots on small screens.

## 50. LIGHT / DARK MODE — **GOOD (mostly)**

Global theme via CSS variables + `.badge-*`/`--st-*` status tokens (globals.css, light solid / dark translucent). Privacy mode masks. **Known non-theme spots:** the **Daily Cash view uses inline hex colors** (`C = {green,#16A34A,...}`) for card accents/amounts (works both themes but bypasses tokens); the full neutral light/dark **palette swap** per the Owner mockup was **NOT applied** (deferred). Status colors standardized across Orders/Inventory/Layaway/Customers/Fulfillment via `<StatusBadge tone>`. No unreadable-Light-Mode page found in this pass (CANNOT-VERIFY visually).

## 51. GLOBAL DESIGN SYSTEM — **WORKING (adoption incomplete)**

Shared `src/components/ui`: `Button`, `Card`, `Modal`(+FormGrid/FieldFull), `Input`, `MoneyInput`, `Combobox`, `Label`, `DataTable`(+Th/Td/Thead/Tr/EmptyRow), `Pagination`, `StatusBadge`+`PageHeader`, `EmptyState`/`LoadingState`, `select`, `search-input`, `alert`, `tabs`, `skeleton`. Colors: gold brand accent + green/amber/blue/red/gray status tokens. **Bypass:** Daily Cash inline hex; some pages still use raw `<select>`/inline alerts (incremental migration pending, not a fix). Library is **complete**; ~20 pages composing it is ongoing polish.

---

## 52. KNOWN BUGS (verified)

| Bug                                                                                                                                       | Module             | Severity        | Status                 | Impact                                                       | Repro                                                        | Likely cause                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | --------------- | ---------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------- |
| `fulfillment_records` empty for all 395 orders                                                                                            | Orders/Fulfillment | MEDIUM          | OPEN (deprecated path) | old prepare/release UI no-ops; routing works via destination | inspect table                                                | fresh-start wipe + destination-based flow replaced it |
| Pancake webhook delivery unverifiable                                                                                                     | Pancake            | MEDIUM          | OPEN (config)          | realtime identity sync may not fire                          | GET/POST /api/webhooks/pancake works; dashboard side unknown | pages.fm webhook config not verifiable                |
| v1 vs v2 Pancake endpoints                                                                                                                | Pancake            | LOW             | OPEN                   | code uses v1 defaults; Pancake confirms v2 surface           | code inspection                                              | endpoints predate v2 confirmation                     |
| Review Attendance "see all" RLS owner-only                                                                                                | Attendance         | LOW             | OPEN (by design)       | Selected Admin can't see all staff yet                       | grant hr_review_attendance to admin                          | RLS keys on owner                                     |
| Daily Cash inline hex colors                                                                                                              | Daily Cash         | LOW             | OPEN                   | bypasses theme tokens (still readable)                       | inspect daily-cash-view                                      | expedient styling                                     |
| No Void/Refund in Approvals                                                                                                               | Approvals/Payments | LOW             | NOT-IMPLEMENTED        | can't void/refund a payment                                  | —                                                            | feature never built                                   |
| MFA not enforced                                                                                                                          | Auth               | LOW             | OPEN (by design)       | no 2FA                                                       | —                                                            | Phase-0 hook only                                     |
| **Suspected:** 7-day Pancake messaging window not handled                                                                                 | Pancake            | LOW (suspected) | UNVERIFIED             | sends outside window may fail                                | —                                                            | no explicit window logic found                        |
| No open **money-corruption** bug (the layaway term-interest bug was fixed + 19 records corrected; the payment-over-verify bug was fixed). |

## 53. INCOMPLETE FEATURES

| Feature                     | State                  | What exists                             | Still missing                                             | Blocker                        | Priority      |
| --------------------------- | ---------------------- | --------------------------------------- | --------------------------------------------------------- | ------------------------------ | ------------- |
| Pancake webhook             | PARTIAL                | server endpoint armed, secret set       | dashboard config + verified event delivery + 7-day window | pages.fm access                | P1            |
| MineFlow Capture (Android)  | IMPLEMENTED-NOT-TESTED | Kotlin app, server APIs, print claim    | on-device verification, Stage-3 loop, APK distribution    | physical device                | P1            |
| Server-side list pagination | NOT-IMPLEMENTED        | render-pagination + one dropdown search | Orders/Inventory/Layaway/Customers server pagination      | Owner "show all" rule reversal | P1 (at scale) |
| Void / Refund               | NOT-IMPLEMENTED        | display labels only                     | void_payment/refund fn + UI + approval                    | product decision               | P2            |
| Today's Duty Sessions table | PARTIAL                | clock card + day-detail modal           | dedicated live per-staff sessions mini-table              | —                              | P3            |
| Live Selling batch flow     | DEPRECATED/PARTIAL     | schema + Test Mode                      | active live-batch workflow                                | replaced by Capture            | P3            |
| Full theme palette swap     | PARTIAL                | tokens + StatusBadge                    | neutral light/dark surface swap per mockup                | live review                    | P3            |
| MFA enforcement             | NOT-IMPLEMENTED        | recorded method only                    | enforcement                                               | Owner decision                 | P2            |

## 54. NOT YET IMPLEMENTED (planned/discussed, absent in prod)

Void/Refund payment flow; GCash fraud/auto-verification; server-side list pagination for list pages; MFA enforcement; POS→MineFlow contact import (**permanently dropped** by Owner 2026-08-10 — do not build); 7-day messaging window handling; automated permission-grant audit rows; a dedicated "Today's Duty Sessions" table; profile-photo sync (Pancake Public API has none).

## 55. DEPRECATED / OLD CODE (document only — do NOT delete)

- **Tables (0-row/legacy):** `fulfillment_records`, `layaway_arrangements` + `layaway_installments` (superseded by `layaway_ledger*`), `live_batches`/`live_batch_items`/`miner_positions` (old Live Selling), `invoice_drafts`/`invoice_draft_claims` (invoice-prep path largely folded into Orders), `scopes`/`staff_scope_assignments` (scope system unused).
- **Registers:** `deletion_requests` (`/admin/deletions`) — the OLDER deletion register; requests now go to `owner_approval_requests`; only Owner _direct_ deletes still log there (dual-write).
- **Routes:** `/orders/fulfillment` (fallback), `/orders/invoice` (redirect into Orders→For Invoice).
- **Statuses:** `awaiting_required_payment` ("For Reminder") presented as For Invoice; `exceptional_release_pending` rarely used.
- **Fields:** legacy payment method machine keys (bank_transfer/e_wallet/cash/card/other) accepted alongside canonical labels; `overpayment_credit` effectively always 0 under the strict over-verify block; `keep_note` was dropped.

## 56. TECHNICAL DEBT

- **P0:** none (no production-risk debt open; money paths sound).
- **P1:** server-side pagination for list pages before 20k scale; verify/complete the Pancake webhook + reconcile v1/v2 endpoints; verify the Android Capture loop end-to-end on a device; broaden Review-Attendance RLS to Selected Admin.
- **P2:** Void/Refund; MFA enforcement; audit rows for permission-grant changes; consider a real toast/error-boundary system; consider a Supabase compute upgrade for headroom.
- **P3:** retire/annotate the legacy tables/registers; move Daily Cash inline hex to tokens; finish shared-component adoption; the theme palette swap; migration-drift cleanup (db push blocked).

## 57. DATA INTEGRITY RISKS

- **Duplicate orders/payments:** idempotency (`idempotency_records`, confirmed-claim attribution, `create_new_order_multi` guards); duplicate payment references **flagged** (not blocked) → manual review needed.
- **Duplicate attendance:** prevented by the one-open-session unique index; multi-session is intentional (not a dup).
- **Duplicate Pancake customers:** possible (name-based matching); mitigated by alias table + Owner Merge + duplicate-reference review. 447 customers, 265 linked — some dups likely exist.
- **Double-counted Daily Cash:** mitigated by Cash Sales = payments method='Cash' (not walk-in totals) — validated.
- **Inconsistent status / orphans:** `fulfillment_records` = 0 while orders exist (routing moved to destination column) — an inconsistency vs. old code, not a live break. Orphaned selfies after record delete (harmless). `layaway_arrangements` empty while `layaway_ledger` holds live data (two models).
- **Broken FKs:** none found (RLS + FK constraints enforced). Pre-launch data-health audit previously reported 0 issues.

## 58. BACKUP / RECOVERY — **CANNOT-VERIFY (Supabase-managed)**

No in-app backup job. Supabase provides managed backups (PITR/daily depending on plan) — **plan/backup status CANNOT-VERIFY** via the audit tooling. **Migration safety:** DDL applied via MCP `apply_migration` (tracked); `supabase db push` is BLOCKED by pre-existing migration drift — do NOT `migration repair`/force-push. **Production-data protection:** standing rule — only additive/non-destructive migrations to prod; validate money DDL via self-aborting rollback DO-blocks before apply. **Recommend:** confirm Supabase backup cadence + document a restore runbook (currently undocumented).

## 59. TEST COVERAGE — **GOOD (unit)**

**1,091 unit tests passing** (Vitest, 87 files) + `npm run verify` green (format/lint/typecheck/test/build). Coverage: domain logic (layaway math, sessions/payroll grouping, order stage actions, balances parsing, permission boundaries, server-only/transport-only invariants, cash view behavior, attendance clock states, walk-in, approvals kinds). pgTAP SQL tests exist for some phases. **No automated integration or E2E tests.** **Critical workflows WITHOUT automated coverage:** live New-Order creation end-to-end, Pancake send/webhook, Android Capture, physical printing, RLS policy behavior per role (only spot pgTAP), real payment→verify→complete against the DB. Many money DB functions are validated via **manual rollback DO-block proofs** (not automated).

---

## 60. FINAL CURRENT-STATE MATRIX

| Module            | FE      | BE  | DB  | Real data  | Perms | Mobile    | Tested   | Overall                  |
| ----------------- | ------- | --- | --- | ---------- | ----- | --------- | -------- | ------------------------ |
| Dashboard         | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | WORKING                  |
| Orders            | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | WORKING                  |
| Inventory         | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | WORKING (scale pending)  |
| Layaway           | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓ (math) | WORKING                  |
| Payments          | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING                  |
| Walk-in           | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | WORKING                  |
| Daily Cash        | ✓       | ✓   | ✓   | ✕ (0 rows) | ✓     | UNKNOWN   | ✓        | WORKING (unproven live)  |
| Scrap             | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING                  |
| Attendance        | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING                  |
| Payroll           | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING                  |
| Approvals         | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING (no void/refund) |
| Capture (Android) | PARTIAL | ✓   | ✓   | PARTIAL    | ✓     | ✓(native) | ✕        | IMPLEMENTED-NOT-TESTED   |
| Pancake           | ✓       | ✓   | ✓   | PARTIAL    | ✓     | n/a       | ✕        | PARTIAL                  |
| Printing          | PARTIAL | ✓   | ✓   | ✕          | ✓     | ✓(native) | ✕        | PARTIAL                  |
| Settings          | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | WORKING                  |
| Reports           | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | PARTIAL  | PARTIAL                  |
| Permissions       | ✓       | ✓   | ✓   | ✓          | ✓     | UNKNOWN   | ✓        | WORKING                  |

## 61. TOP 20 REMAINING TASKS (ranked)

1. **P0** — Confirm Supabase **backup cadence + restore runbook** (currently undocumented). _Risk if ignored:_ unrecoverable data loss. Low complexity. Dep: Supabase dashboard.
2. **P1** — **Verify Pancake webhook** end-to-end (dashboard config, event delivery, secret placement). _Risk:_ silent identity-sync failure. Med. Dep: pages.fm access.
3. **P1** — **Reconcile Pancake v1→v2** endpoints (conversations/page_customers/upload_contents). _Risk:_ future API breakage. Med.
4. **P1** — **Verify Android Capture** loop on a real device + APK distribution. _Risk:_ core capture unproven. Med-High. Dep: device.
5. **P1** — **Server-side pagination** for Orders/Inventory/Layaway/Customers. _Risk:_ slowdowns at 20k. High. Dep: reverse "show all" rule.
6. **P1** — Broaden **Review-Attendance RLS** to Selected Admin. _Risk:_ admins blind to staff attendance. Low-Med.
7. **P1** — Resolve **fulfillment_records** deprecation (confirm destination flow is complete; retire old prepare/release UI). _Risk:_ confusing dead path. Low-Med.
8. **P2** — Build **Void/Refund** with approval. _Risk:_ no correction path for bad payments. Med.
9. **P2** — **MFA enforcement** for Owner/Admin. _Risk:_ account takeover. Med.
10. **P2** — **Audit rows for permission-grant changes**. _Risk:_ no trail for access changes. Low.
11. **P2** — **Rate limiting** on `/api/mobile/*` and `/api/webhooks/*`. _Risk:_ abuse. Med.
12. **P2** — Confirm **leaked-password protection** toggle ON. _Risk:_ weak passwords. Trivial.
13. **P2** — Integration/E2E tests for **New Order → pay → complete**. _Risk:_ regressions. Med-High.
14. **P2** — Consider **Supabase compute** upgrade for headroom. _Risk:_ slow under load. Trivial (billing).
15. **P3** — Retire/annotate **legacy tables** (`layaway_arrangements`, `live_batches`, `scopes`, invoice_drafts). _Risk:_ confusion. Low.
16. **P3** — Unify **deletion_requests** into `owner_approval_requests` (drop `/admin/deletions`). _Risk:_ two registers. Low-Med.
17. **P3** — Move **Daily Cash inline hex** to theme tokens. _Risk:_ theme drift. Low.
18. **P3** — Dedicated **Today's Duty Sessions** table. _Risk:_ minor UX gap. Low.
19. **P3** — **Migration-drift** cleanup so `db push` works. _Risk:_ DDL friction. Med.
20. **P3** — Finish **shared-component adoption** + theme palette swap. _Risk:_ inconsistency. Low.

## 62. GO-LIVE READINESS

| Area               | Rating                                               |
| ------------------ | ---------------------------------------------------- |
| Orders             | READY                                                |
| Inventory          | CONDITIONAL (scale pagination pending)               |
| Layaway            | READY                                                |
| Payments           | READY                                                |
| Capture            | CONDITIONAL (on-device unverified)                   |
| Pancake            | CONDITIONAL (webhook/v2 unverified)                  |
| Printing           | CONDITIONAL (physical print unverified)              |
| Attendance         | READY                                                |
| Payroll            | READY                                                |
| Daily Cash Summary | CONDITIONAL (new; no live data yet)                  |
| Permissions        | READY                                                |
| Security           | CONDITIONAL (MFA off, rate limiting, backup runbook) |
| Performance        | CONDITIONAL (list payloads at scale)                 |
| Backups            | NOT READY (unverified/undocumented)                  |

**Overall Production Readiness: CONDITIONAL GO.**
It is **already live and functioning** for core operations (this is really "conditional continuation," not a first launch). **Exact blockers to a clean GO:** (1) **backup/restore unverified** (P0), (2) **Pancake webhook + Android Capture unverified** (P1 — the two "smart capture" pillars), (3) **no server-side pagination** (P1 at scale), (4) **security hardening** (MFA, rate limiting, leaked-password toggle). None block day-to-day money operations; all block a "clean, verified, scale-ready" sign-off.

---

# MINEFLOW CURRENT SYSTEM HANDOFF

**1. Fully working:** Orders lifecycle (create→invoice→pay→prepare→ship/pickup/deliver→complete; cancel via 2-step approval; admins can now cancel); Payments (record→verify, strict over-verify block, auto-complete, canonical methods); Layaway (ledger model, **term-based interest correct**, installments, codes, forfeiture/keep); Walk-in (full + down-payment); Scrap; Attendance (multi-session **Continue Duty**, one-open-session guard, selfies); Payroll (SUM-of-sessions, night bonus once/day); Approvals (11 kinds, unified queue, pending badge, execute-once); Manage Access (permission-driven, server+RLS enforced); Daily Cash Summary (self-contained module, logic validated); Dashboard; Settings; Merge/dup tools. **1,091 tests + full verify green. Balances 60× faster.**
**2. Partially working:** Pancake (send pipeline works; **webhook + v2 endpoints unverified**; customer/convo sync depends on live token); MineFlow Capture (server side works; **on-device unverified**); Printing (server claim works; **physical print unverified**); Reports (present, not deep-audited); Live Operations (Test Mode works; full live-batch flow legacy); mobile responsiveness (code-intent good, visually unverified).
**3. Broken / inconsistent:** `fulfillment_records` empty for all orders (old prepare/release path dead — routing moved to `fulfillment_destination`); two coexisting deletion registers; two coexisting layaway models (ledger active, arrangements empty).
**4. Not implemented:** Void/Refund; GCash fraud detection; server-side list pagination; MFA enforcement; 7-day messaging window; dedicated Today's-Duty-Sessions table; POS import (permanently dropped).
**5. Architecture:** Next.js 16 (App Router, RSC + server actions, transport-only actions) on Vercel `sin1`; Supabase Postgres 17 in `ap-southeast-1` (co-located); authority + money math in `server-only` domain modules + SECURITY DEFINER/INVOKER SQL; RLS on all 73 tables; broad Supabase Realtime → router.refresh; native Android Kotlin Capture app; Pancake/pages.fm integration.
**6. Database state:** 73 RLS-enabled tables; 395 orders, 447 customers (265 FB-linked), 2,597 active items, 107 payments, 813 layaway ledger accounts, 22 attendance rows, 125 scrap, 19 active staff, 7,190 audit events; several 0-row legacy tables; Daily Cash tables empty (new).
**7. Integrations:** Pancake (configured; send verified; webhook armed-unverified; v1 defaults vs confirmed v2); Vercel Cron (pancake-sync) + pg_cron (layaway daily interest).
**8. Permissions:** owner/selected_admin/staff; `has_permission` short-circuits for owner; 47 permissions, 330 grants; enforced at page + domain + RLS + DEFINER; documented hardcoded exceptions (clock owner-only, /approvals owner-only, review-attendance RLS owner-scoped).
**9. Performance risks:** list pages fetch-all client-side (20k risk); broad realtime over-refresh; shared compute tier. Balances fixed. **10. Security risks:** MFA off; no rate limiting; leaked-password toggle unverified; webhook shared-secret (not HMAC); service-role usage (correct but sensitive). No exposed secret; anon DEFINER execute revoked; RLS everywhere.
**11. Highest-priority next tasks:** (P0) verify/ document Supabase backups; (P1) verify Pancake webhook + Android Capture, reconcile v2, add server-side pagination, broaden review-attendance RLS; (P2) Void/Refund, MFA, rate limiting, integration tests.

_Prepared read-only. No code, schema, or production data was modified during this audit._
