# A.V. Jewelry — System Audit and Hardening Report (2026-09-16)

**Verdict: NOT READY FOR PRODUCTION (by the stated bar).** The system is already live and in daily
use; this verdict means Critical and High items remain open, not that the live system is failing.
The largest open items need production database access or an Owner decision, both unavailable
during this audit (the Supabase connector refused every call with "You do not have permission").

**What was not possible, and therefore not claimed:** no query ran against production, no migration
was applied, no Supabase advisor report was pulled, the 29 pgTAP database suites could not run
(Docker is down on this PC), and no live role account could sign in (the UAT demo account is
deactivated). Every statement below that depends on the live database is marked **NEEDS
VERIFICATION**.

**Method.** Six read-only audit agents covered authorization, accounts and audit logging, data
integrity and workflows, application security, forms/exports/performance, and operations. Fixes were
made in small batches, each gated by typecheck, lint, the full test suite, and a production build.
An adversarial review workflow (five dimension reviewers, a skeptical verifier per finding, and a
completeness critic) then checked the fixes; it caught one serious regression in the first batch,
which was fixed before commit.

---

## 1. System architecture summary

| Layer        | What it is                                                                                                                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web app      | Next.js 16 App Router on Vercel (`sin1`), production `avjewelry.online`. Server components and server actions; the `(app)` group is `force-dynamic`.                                                                                                              |
| Database     | Supabase Postgres (`ap-southeast-1`, project `eqfddwxsmzzojuasffjx`). Row-level security on every repo-created table; business writes go through `SECURITY DEFINER` RPCs with `search_path = ''`; authorization helpers live in the private `app_private` schema. |
| Auth         | Supabase Auth, staff email and password only. No sign-up, no customer login. Persistent cookies; every request re-verifies the session and the `is_active` flag.                                                                                                  |
| Mobile       | Android capture app (in-repo, `mobile/mineflow-capture`) calling `/api/mobile/*` with a Bearer token; prints stickers over Bluetooth.                                                                                                                             |
| Integrations | Pancake (pages.fm) for Facebook messaging; tokens in server env only. Webhook authenticated by shared secret; three Vercel crons authenticated by `CRON_SECRET`.                                                                                                  |
| Storage      | One private bucket (`attachments`): payment proofs, capture screenshots, attendance selfies. Short-lived signed URLs.                                                                                                                                             |
| PWA          | Installable; the service worker caches only static assets, never HTML, API, or Supabase responses.                                                                                                                                                                |

**Modules:** Dashboard, Orders (For Invoice → Confirm → Prepare → Shipping / Pickup / Delivery →
Completed; cancellation through Owner approval), Inventory (active, completed, archive, edit/delete
approvals), Layaway ledger, Customers, Daily Cash, Scrap, Approvals, Attendance and Payroll, Live and
Capture (review queue, sticker print queue), Reports and Export, Settings (team, access, message
templates, integrations), Special Calculator.

**Size at audit time:** 180 SQL migrations, 29 pgTAP suites, about 150 Vitest files (unit plus
static "integration" sweeps), no browser end-to-end tests, and (until this audit) no CI.

**Structural risk:** the repository cannot rebuild the production schema. At least 15 tables
(including `layaway_ledger`, `layaway_ledger_payments`, the five `daily_cash_*` tables and
`deletion_requests`), 55–61 RPCs the app calls (including `create_new_order_multi`,
`add_order_payment`, `set_team_member_role`, `set_team_member_permissions`) and a pg_cron job exist
only in the live database.

---

## 2. User and role matrix

**Model.** Three roles: `owner` (Super Admin), `selected_admin`, `staff`. Authority is grant-based:
the Owner holds every permission by rule; everyone else holds only explicit grants from Settings →
Team → Manage Access (46 keys: 23 operational, plus page and action keys). A role title grants
nothing except (a) the Owner's six non-delegable approvals and staff management, and (b) a few
maintenance actions reserved to Owner or Selected Admin.

**Scope.** The generic "branch / ministry / department" scoping does not apply to this single-shop
business. The only scope concept is `staff_scope_assignments` (live-batch scopes), enforced by RLS
through `app_private.has_scope()`.

### Pages (server-side gate; hiding a menu item is not the control)

| Page                                  | Gate enforced on the server                                                     | Owner        | Selected Admin | Staff |
| ------------------------------------- | ------------------------------------------------------------------------------- | ------------ | -------------- | ----- |
| Dashboard                             | `nav_dashboard`                                                                 | ✅           | grant          | grant |
| Orders, Invoice prep, Waybill         | `nav_orders` (Invoice and Waybill gates **added in this audit**)                | ✅           | grant          | grant |
| Inventory                             | `nav_inventory`                                                                 | ✅           | grant          | grant |
| Layaway                               | `nav_layaway`                                                                   | ✅           | grant          | grant |
| Customers                             | `nav_customers`                                                                 | ✅           | grant          | grant |
| Scrap, Historical scrap               | `nav_scrap`                                                                     | ✅           | grant          | grant |
| Daily Cash, Reports                   | `view_reports`                                                                  | ✅           | grant          | grant |
| Attendance / Review / Payroll         | `hr_attendance` / `hr_review_attendance` / `hr_payroll`                         | ✅           | grant          | grant |
| Settings (+ Messages, Live Ops)       | `view_settings`; Team panel Owner-only; integrations Primary Super Admin only   | ✅           | grant          | grant |
| Claim Review                          | any of `claim_capture`, `claim_review`, `confirm_claim_print_label` (**added**) | ✅           | grant          | grant |
| Live batches                          | any live permission or `claim_capture` (**added**)                              | ✅           | grant          | grant |
| Conditional capabilities              | Owner or Selected Admin (**added**)                                             | ✅           | ✅             | ❌    |
| Deletion requests                     | Owner or Selected Admin                                                         | ✅           | ✅             | ❌    |
| Approvals                             | Owner only                                                                      | ✅           | ❌             | ❌    |
| Staff accounts                        | Owner only (reader calls `requireOwner`)                                        | ✅           | ❌             | ❌    |
| Integrations                          | Primary Super Admin only                                                        | Primary only | ❌             | ❌    |
| Security (own MFA status), Calculator | any active staff                                                                | ✅           | ✅             | ✅    |

### Actions

| Capability                       | Key / rule                                                                                                                                      |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Create / edit / delete customers | `claim_capture` (create), `customer_edit`, `customer_delete` (delete goes through the approval queue)                                           |
| Inventory edit / delete          | `inventory_edit`, `inventory_delete`: Admin requests, Owner executes                                                                            |
| Layaway create / edit / delete   | `layaway_create`, `layaway_edit`, `layaway_delete`                                                                                              |
| Orders: deposit, cancel          | `order_add_deposit`; cancellation is an Owner approval                                                                                          |
| Payments: verify, correct        | `payment_verification`; correcting a verified payment needs an Owner approval request                                                           |
| Export                           | `/api/export/all`: Owner or Selected Admin; CSV exports: the page permission (see finding M-EXP)                                                |
| Approve                          | the six Owner-only actions: order cancellation, layaway forfeiture, price override, exceptional release, batch reopen, wrong-payment correction |
| Manage users and permissions     | Owner only; role changes to/from Super Admin are Primary Super Admin only (live-only RPC, **NEEDS VERIFICATION**)                               |

---

## 3. Critical issues

| ID  | Issue                                                                                                                                                                                                                      | Status                                                                                                                                                 |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | The repo cannot rebuild the production schema (15+ tables, 55–61 RPCs, a pg_cron job exist only live). A disaster rebuild, a staging copy, or the pgTAP suites cannot be run from source.                                  | **OPEN** — needs a schema-only dump of production committed as a baseline migration.                                                                   |
| C2  | No restore has ever been executed. The "save points" are table copies inside the same Supabase project; they exclude auth users, Storage files, and sequences. Off-site backup and point-in-time recovery are unconfirmed. | **OPEN** — Owner must confirm the backup tier and run one restore into a scratch project.                                                              |
| C3  | Two Pancake webhook RPCs had no authorization check but were executable by any signed-in account, which could rewrite which Facebook conversation a customer's messages go to.                                             | **FIXED in migration 20260916120000** (not yet applied).                                                                                               |
| C4  | The Completed-Inventory and Layaway CSV exports stopped after 200 and 100 rows; "Export All Data" silently cut every sheet at 1,000 rows.                                                                                  | **FIXED** (code, committed).                                                                                                                           |
| C5  | The Layaway page issued about 300 sequential database calls per render.                                                                                                                                                    | **FIXED** (batch 3): about 304 → at most 85 calls per render; the per-order item-total calls that remain run concurrently.                             |
| C6  | A seeded UAT Owner account whose password was written in tracked docs may still be a valid login on production.                                                                                                            | **MITIGATED** in app code (demo accounts refused unless demo login is enabled; password removed from docs). Live account state **NEEDS VERIFICATION**. |

---

## 4. High-priority issues

| ID  | Issue                                                                                                                                                                                           | Status                                                                                                                                                                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | 20 `SECURITY DEFINER` RPCs never had anonymous execute revoked; `order_completion_block` had no gate at all.                                                                                    | **FIXED** (migration, not applied).                                                                                                                                                                                        |
| H2  | 18 RPCs gated on the role title without checking `is_active`, so a deactivated admin's token still passed them.                                                                                 | **FIXED** (migration). Review caught that returning NULL would have _opened_ these gates; the fix returns the sentinel `'inactive'`.                                                                                       |
| H3  | An Owner could hard-delete or deactivate another Owner by calling the action directly; nothing kept at least one Owner.                                                                         | **FIXED** (migration trigger + app guards). Only-Primary-may-deactivate-an-Owner is app-side only (live-only helper).                                                                                                      |
| H4  | Staff account actions on `/admin/staff` wrote no audit event; sign-in attempts and sign-out were never audited.                                                                                 | **FIXED**. Failed sign-ins are recorded as a system event with a redacted email, bounded per email.                                                                                                                        |
| H5  | The audit trail (with member emails and permission diffs) was readable by every active staff member.                                                                                            | **FIXED** (migration): Owner, Selected Admin, and `view_settings` holders; staff keep the per-order history they already see.                                                                                              |
| H6  | An Owner-set password and a deactivation did not end the member's existing sessions.                                                                                                            | **FIXED** (`revoke_staff_sessions` RPC; one-off logout of accounts already deactivated).                                                                                                                                   |
| H7  | Payment verification was two non-atomic writes; a failure between them left verified money permanently uncounted.                                                                               | **FIXED** (migration trigger). Already-stuck payments are reported, never rewritten automatically.                                                                                                                         |
| H8  | The mobile "send to customer" endpoint let any signed-in account message any customer conversation as the shop.                                                                                 | **FIXED** (`claim_capture` required).                                                                                                                                                                                      |
| H9  | `next@16.2.10` carries critical advisories (proxy bypass, server-action DoS, response-cache confusion).                                                                                         | **FIXED**: `next` and `eslint-config-next` 16.3.5; a non-breaking `npm audit fix` also cleared the transitive brace-expansion, nanoid, postcss and baseline-browser-mapping advisories (production audit 8 → 4, no highs). |
| H10 | The attendance kiosk accepted any device id, so the approved-phone rule was app-only.                                                                                                           | **FIXED** for random or revoked ids (migration). Residual: a staff member can read a valid device id from their own attendance rows; binding to the device token needs an RPC signature change.                            |
| H11 | Every active staff member can read every file in the storage bucket, including other staff's selfies and all payment proofs.                                                                    | **OPEN** — needs an inventory of upload paths and a physical capture-phone test before changing the policy.                                                                                                                |
| H12 | Four permission groups can change `official_orders.status` directly through the REST API, skipping the payment and completion gates; the same applies to `payments.status` and `claims.status`. | **OPEN** — needs the live column lists and the live RPC bodies.                                                                                                                                                            |
| H13 | Order and layaway hard-deletes remove verified payment history, which changes already-closed Daily Cash days.                                                                                   | **OPEN — Owner decision** (refuse, soft-delete, or convert to credit).                                                                                                                                                     |
| H14 | No app-level sign-in rate limit; Supabase's per-IP limit keys on shared Vercel egress, so a brute-force burst locks out every staff member.                                                     | **OPEN** — design ready; thresholds need Owner input because the whole shop shares one public IP.                                                                                                                          |
| H15 | Sales Summary report covered 08:00→08:00 Manila (a one-day report was a single instant).                                                                                                        | **FIXED**.                                                                                                                                                                                                                 |
| H16 | Dashboard day boundaries are UTC (SQL `::date` casts and client presets), while Daily Cash and Layaway use Manila.                                                                              | Client defaults **FIXED** (batch 3: one shared Manila-date helper; "This Month" no longer starts on the previous month's last day). SQL functions **OPEN** (live bodies may be newer than the repo).                       |
| H17 | No CI, no staging environment, no monitoring or alerting.                                                                                                                                       | CI **ADDED** (`.github/workflows/ci.yml`). Staging and monitoring **OPEN** (need accounts and cost approval).                                                                                                              |
| H18 | Demo login can be switched on in production by one env flag.                                                                                                                                    | **MITIGATED**: demo accounts are refused unless the flag is set; the flag itself still has no production guard.                                                                                                            |
| H19 | `jspdf@2.5.2` has a critical advisory (ReDoS / DoS, and dompurify through it); `exceljs@4` pulls a vulnerable `uuid`. Both fixes are major upgrades.                                            | **OPEN** — low exposure (jsPDF renders internal payslip text only; exceljs runs server-side for the Owner), but each major upgrade needs a printed-PDF and workbook check before it ships.                                 |

---

## 5. Medium-priority issues

- **Unconfirmed destructive taps.** End Live Session and Reject Capture fired on one tap. **FIXED** (confirmation dialogs). Other one-tap removals remain: printer remove, attendance device revoke, permission chips, role select.
- **Deleted rows reported as saved.** Daily Cash edits and deletes reported success on a row another tab had already deleted. **FIXED**.
- **Layaway CSV dates.** Imports shifted written dates one day early, and impossible ISO dates failed the whole import. **FIXED**.
- **Unvalidated dates.** Several paths send unvalidated dates to Postgres and show its raw error: cash updates, walk-in sale date, order payment date, scrap. **OPEN**.
- **Last write wins.** Direct edits of customers, inventory, layaway, scrap and cash have no stale-edit check. **OPEN**.
- **Customer duplicates.** Customers have no uniqueness rule at all, and layaway creation auto-picks the oldest name match. **OPEN**.
- **Attendance work date.** It defaulted to the UTC date. **FIXED** (migration).
- **Security headers.** There were none; auth cookies had no `Secure` flag. **FIXED** (framing, MIME sniffing, referrer, permissions policy, HSTS, `Secure` on server and browser writes). Content-Security-Policy is **OPEN**: it needs nonces for the inline theme and print scripts.
- **Secret comparisons.** Cron and webhook secrets were compared with `===`, and the webhook secret is also accepted in the query string. Constant-time comparison is **FIXED**; the query-string fallback is **OPEN** because Pancake may require it.
- **N+1 readers and the capture poll.** Invoice drafts, Claim Review, and the Incoming Captures poll ran per-row calls. **FIXED** (batch 3; counts in section 11). The invoice "already ordered" check also no longer breaks past the 1,000-row cap.
- **Missing indexes.** Audit events, payments by date, customers sort and contact search, floating captures, unverified payments, and layaway by item lacked indexes. **FIXED** (migration 20260916130000, not applied).
- **Export gates.** The export permission checks are inconsistent (button on `export_data_reports`, route on role, CSV routes on page permission). **OPEN** (M-EXP).
- **Page with no permission.** `nav_payments` gates nothing, but turning it off strips `payment_verification`. **OPEN**.
- **Error boundary.** There is no `error.tsx` inside the app layout, so an error drops the sidebar. **OPEN**.
- **Approval requests readable by all staff.** `owner_approval_requests` is readable by every active staff member through the REST API, payload included, although the Approvals page is Owner-only. The TS readers for approval and deletion requests have no guard of their own and rely on RLS. Narrowing the policy would blank the approval state staff see on an order, so it needs a scoped policy (requester, Owner, approver). The `deletion_requests` policy is live-only. **OPEN** (NEEDS VERIFICATION for `deletion_requests`).
- **Placeholder route.** `/more` is a placeholder page with no data. The bottom navigation does not link to it. **Cleanup only**.

---

## 6. Changes implemented

### Batch 1+2 — commit `df4fbd6` (tag `savepoint-2026-09-16-audit-batch2`)

**Database (migration `20260916120000`, NOT applied):** role sentinel for deactivated accounts;
revoke-only definer EXECUTE hygiene with the webhook persisters made service-role only; gate on
`order_completion_block`; no Owner hard-delete; owner-floor trigger (demo owners excluded,
serialized); narrowed audit read; atomic payment-status trigger; Manila attendance date; Owner-gated
session revocation plus one-off logout of already-deactivated accounts; kiosk device check.

**Database (migration `20260916130000`, NOT applied):** six hot-path indexes; the trigram operator
class is resolved at apply time, and the live-only `layaway_ledger` index is guarded.

**Web:** demo-account refusal on web and mobile; audited staff-account actions; Owner accounts
protected from peer changes; session revocation on deactivation and Owner-set password; temporary
password no longer sent to the browser; sign-in and sign-out auditing (bounded); mobile send
permission; constant-time secret compare; security headers; `Secure` cookies; five page gates; CSV
and workbook export completeness with unique sort tiebreakers; Manila report bounds; CSV date fix;
cash stale-row detection; 10 MiB capture upload cap matching the bucket; confirmation dialogs; the
expired attendance test fixture.

**Tests:** new `tests/unit/security-hardening.test.ts` (secret compare, CSV dates, mobile permission,
bounded sign-in audit, and content guards that fail if any migration decision is reverted —
including dollar-quote balance); capture review dialog tests.

**Found and fixed during review, before commit:** the NULL role gate (would have opened owner-only
RPCs to deactivated accounts); a grant loop that could have widened live-only functions; session
revocation that used an API needing the member's own token; a script bug that turned `$$` into `$`
and would have aborted both migrations.

### Batch 3

Batch 3 was committed as `System audit batch 3` after `df4fbd6`, with no migrations. Four implementers worked on disjoint files; each change then got a skeptical regression review and, where needed, a fix pass.

- **Layaway page.** Balances, verified-payment lookups and correction lookups are now one batched read each, chunked at 100 ids. Item totals run concurrently and are cached per request. A failed batched balance read is logged. Output is identical to the old mapper across a 130-row fixture.
- **Claim Review and invoice drafts.** Each table is read once, with the existing `available_quantities_for` batch RPC. The eligibility reads are scoped to candidate claims.
- **Incoming Captures poll.** One `createSignedUrls` call and one batched webhook query per poll. The 5-second interval is unchanged.
- **Manila business dates.** A shared helper, `src/lib/format/manila-date.ts`, now feeds dashboard presets and the defaults on dashboard, scrap, payroll, order payment, layaway entry, employee rates, payslips, rate effective dates, and the layaway installment-due check.
- **Layaway code preview.** It runs once per first letter instead of once per keystroke.
- **CI.** `.github/workflows/ci.yml` runs typecheck, lint, tests and build on Node 24.
- **Tests.** Query-count and equality tests compare each batched reader with its old implementation. Date-helper and preset tests cover the new helper. Two static guards now assert the real calls instead of text.

### Batch 4 — dependency security

`next` and `eslint-config-next` 16.2.10 → 16.3.5 (exact pins), plus a non-breaking `npm audit fix`. Production advisories: 8 → 4, none high. The four left need major upgrades (H19). Next 16.3 adds a lint rule that warns on three `window.location` navigations: the two CSV downloads (Inventory, Layaway) and the post-reset redirect on the password-reset page. All three are intentional full-page loads, so they stay warnings, not errors, and behaviour is unchanged.

---

## 7. Permission-test results

| Test                                                                                                                                                                                          | Result                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Static sweep: every server-action module reaches the DB only through a guarded domain module; every writing module calls a guard (`tests/integration/phase11-authorization-boundary.test.ts`) | ✅ passes                                                                       |
| Page gates: every page under `(app)` checked for a server-side gate                                                                                                                           | ✅ 5 missing gates found and added; all others verified                         |
| API routes: cron (constant-time `CRON_SECRET`), webhook (shared secret), mobile (Bearer + `is_active` per request, now + permission on send), exports (session + page permission)             | ✅ by code review; unauthenticated live probes of cron and webhook returned 401 |
| RLS coverage: every public table created in a migration has RLS enabled (62/62; 50 forced); none later disabled                                                                               | ✅                                                                              |
| New security unit tests (29 cases incl. migration content guards)                                                                                                                             | ✅ pass                                                                         |
| pgTAP DB suites (29 files, incl. RLS and authority tests)                                                                                                                                     | **NEEDS VERIFICATION** — could not run (Docker down)                            |
| Live role accounts (Owner / Selected Admin / Staff) against production                                                                                                                        | **NEEDS VERIFICATION** — no active test accounts; DB unreachable                |
| Live-only RPCs `set_team_member_role`, `set_team_member_permissions`, `is_primary_super_admin`                                                                                                | **NEEDS VERIFICATION** — bodies not in the repo                                 |

---

## 8. Data-integrity findings

- **Transactions.** Most business writes run inside single RPCs. Non-atomic multi-step writes were found in:
  - payment verification (**fixed**);
  - approval execution, where the action and the "executed" stamp are separate, so a failed stamp can add an order item twice;
  - the dead `activateLayaway` path, whose form is no longer mounted (delete it);
  - evidence and grant follow-up inserts, which are detectable and low impact.
- **Duplicate submissions.** Every major form disables submit while pending, but no order, payment, scrap, or cash RPC takes an idempotency key. The `idempotency_records` table has zero callers. Two tabs, or a reload and resubmit, can create duplicates. Capture intake is idempotent.
- **Foreign keys.** They are RESTRICT by default, so staff, customers, orders, and items with history cannot be hard-deleted. The exceptions are capture-record and print-job links, which are set to null, and layaway ledger items, which cascade.
- **Soft vs hard delete.** Inventory soft-deletes through archive plus an approval queue. Orders, layaway ledger rows, and customers can be hard-deleted through Owner RPCs, taking payment history with them (H13).
- **State machines.** Most transitions are enforced in RPCs with row locks. Direct REST updates bypass them for orders, payments, and claims (H12). The repo's status CHECK lists are stale against production, which writes `for_layaway`, `keep`, `for_cancel`, `completed`, and `released`.
- **Concurrency.** Reservations and print queues lock correctly (`FOR UPDATE`, `SKIP LOCKED`). Direct edits are last-write-wins. The owner floor is now serialized.
- **Dates.** SQL business logic uses Manila, and the web now does too for reports. Dashboard SQL and several client defaults still use UTC (H16).
- **Money.** It is `numeric(14,2)` in the database and strings in TS, never floats. Layaway account edits accept negative amounts (**OPEN**).
- **Orphans.** `inventory_integrity_report()` covers orphan completed or committed items only. It does not cover payments stuck unverified, orders with no items, layaway items with no item, or closed cash days whose recomputed total differs.

---

## 9. Security findings

- **Fixed (committed code):** the mobile send permission; demo-account refusal; constant-time secrets; security headers; `Secure` cookies; audited account actions; session revocation, which takes effect once the migration is applied; sign-in auditing; the temporary password no longer reaching the browser; the five page gates.
- **Fixed (migration, not applied):** ungated webhook RPCs; anonymous execute on definer RPCs; role gates ignoring `is_active`; audit visibility; the Owner floor and Owner delete; the kiosk device check.
- **Verified solid:**
  - no secrets in the repo;
  - `.env*` never committed;
  - the service-role key is confined to server modules and each of its six call sites is gated;
  - no open redirects;
  - no XSS sinks with user data, since print HTML escapes every value;
  - no SQL built from user input;
  - server actions are protected by Next's origin check;
  - the service worker caches no private data;
  - exports send `Cache-Control: no-store`;
  - signed URLs expire in 300 seconds;
  - the bucket is private with size and type limits;
  - the Android app stores tokens in the Keystore.
- **Open:** Storage read scope (H11); direct status writes (H12); the sign-in rate limit (H14); Content-Security-Policy; the webhook secret in the query string; the Android release build being unobfuscated; the jsPDF 2.5.2 and exceljs/uuid advisories (H19).

---

## 10. Workflow-test results

| Module             | Who starts it                        | DB-enforced transitions                                                                                                       | Gap                                                   |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Orders             | `claim_capture`                      | Destination transfer and completion (paid-in-full) are enforced in RPCs; cancellation requires approval                       | Direct status PATCH (H12); status CHECK stale in repo |
| Payments           | `payment_verification`               | Overpayment blocked by trigger; verified corrections need an approval                                                         | Verification now atomic (migration)                   |
| Layaway ledger     | `layaway_create`                     | Enforced in RPCs with row locks                                                                                               | Hard delete (H13); ledger DDL live-only               |
| Inventory          | `post_live_item_entry`, Owner import | Completion/commit backed by triggers; return to stock only via approved review; edit and delete via approval with stale check | —                                                     |
| Claims             | `claim_capture`                      | Reserve-once is enforced                                                                                                      | Direct PATCH to confirmed (H12)                       |
| Approvals          | `initiate_high_risk_action`          | Owner-only decision and execute-once triggers                                                                                 | Execute and stamp are not atomic                      |
| Capture            | Mobile Bearer                        | Idempotency key; print claim with `SKIP LOCKED`                                                                               | Review Reject now confirmed                           |
| Attendance/payroll | Kiosk or Owner                       | One open session enforced                                                                                                     | Work date fixed to Manila; device check added         |

These are **code-level** results. End-to-end browser tests do not exist, and the pgTAP
lifecycle suite could not run here (**NEEDS VERIFICATION**).

---

## 11. Performance results

Live timing could not be measured (DB unreachable). Earlier EXPLAIN results from 2026-08-21 remain
the latest measurements (Orders card counts 355 ms → 4 ms; inventory browse ~30 ms → 2.5 ms).
Code-level results from this audit:

| Area                                        | Before                                      | After                                   |
| ------------------------------------------- | ------------------------------------------- | --------------------------------------- |
| CSV exports                                 | stopped at 200 / 100 rows                   | every row, fails loudly on a short page |
| Export All Data                             | 1,000 rows per sheet                        | paged to the end, unique ordering       |
| Layaway page                                | ~304 calls per render, 4 sequential per row | at most 85; one batched read per lookup |
| Claim Review, 20 claims                     | 101 calls                                   | 6                                       |
| Invoice drafts, 20 drafts                   | 18 calls                                    | 2                                       |
| Incoming Captures poll, 20 rows (every 5 s) | 18 signing + 14 eligibility calls           | 1 + 1                                   |

**Indexes added (not applied):** `audit_events(occurred_at)`, `payments(recorded_at)`,
unverified-payments partial, `customers(display_name)` and a trigram index on the contact number,
the floating-captures partial, and `layaway_ledger(inventory_item_id)`.

**Still open:**

- The realtime refresh reruns every server page on each `capture_records` change. Changing it is an Owner decision, because a test pins that table as refreshing.
- `jsPDF` is statically imported into the Payroll and Attendance bundles.
- The New Order and Layaway pickers ship about 4,500 inventory rows on first open.
- `::date` casts in dashboard SQL defeat the date indexes.

---

## 12. Backup and recovery status

| Item                                     | Status                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Restore drill executed and recorded      | ❌ Never. `docs/BACKUP-RESTORE-DRILL.md` is a blank template.                                                 |
| Off-site backup / point-in-time recovery | **NEEDS VERIFICATION** (Supabase dashboard → Database → Backups)                                              |
| In-DB save points                        | ✅ with limits: same project; exclude auth users, Storage, sequences, logs                                    |
| Git tags for every save point            | ✅ (latest `savepoint-2026-09-16-audit-batch2`)                                                               |
| Instant code rollback                    | ✅ `npx vercel promote <deployment> --yes`                                                                    |
| DB rollback                              | Documented; never exercised                                                                                   |
| Schema rebuildable from repo             | ❌ (C1)                                                                                                       |
| Storage backup                           | ❌ not in save points; only Supabase managed backups, if enabled                                              |
| Retention                                | Webhook events 30 days ✅; audit log permanent by design; attachments, screenshots, selfies have no policy ❌ |

Backups are **not** claimed to work: no restore has been verified.

---

## 13. Remaining issues

- **Small follow-ups from the batch-3 reviews:**
  - A failed batched balance read shows ₱0.00 on every Layaway row. It is now logged; a real "unavailable" row state is still needed.
  - A failed layaway code preview is not retried until the first letter changes.
  - Export filenames still carry the UTC date.
- **Needs database access:** C1 schema baseline; H12 status-write lockdown; audit of the live-only role RPCs; dashboard SQL time zones; applying the five pending migrations.
- **Needs an Owner decision:** H13 hard deletes of payment history; H14 rate-limit thresholds; the realtime refresh list; retention periods; staging and monitoring accounts.
- **Needs a physical test:** H11 Storage policy (capture-phone uploads, payment-proof display).
- **Code work, safe but not done:**
  - idempotency keys on order and payment RPCs;
  - stale-edit checks;
  - date validation on cash, walk-in, and scrap;
  - customer uniqueness;
  - a Content-Security-Policy with nonces;
  - an `error.tsx` inside the app layout;
  - consistent export gating;
  - `nav_payments` cleanup;
  - deleting the dead `activateLayaway` path;
  - keyboard support in the combobox;
  - card layout on phones for the remaining wide tables.

---

## 14. Needs verification

Run these against production (read-only) or in the Supabase dashboard:

1. **Backups:** Dashboard → Database → Backups. Record the plan, retention, point-in-time recovery status, and last backup time.
2. **Applied migrations:** `select version, name from supabase_migrations.schema_migrations order by version desc limit 15;`. Expect `20260913120000` and later to be absent.
3. **Live-only function bodies:** `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','app_private') and p.proname in ('set_team_member_role','set_team_member_permissions','is_primary_super_admin','is_service_role','resolve_admin_staff','kiosk_clock_out');`
4. **Role gates relying on NULL:** `select proname from pg_proc where prosrc ~* 'current_staff_role\(\)\s+is\s+null';` should return nothing before applying §1.
5. **Live-only `*_system` functions called by signed-in users:** `select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef and proname like '%\_system';` Confirm each is called only through the service role.
6. **Stuck payments:** see the query in the §7 comment of migration `20260916120000`.
7. **Demo accounts:** Auth → Users. Confirm no `uat-*@uat.local` user can sign in on production; confirm `DEMO_LOGIN_ENABLED` is unset in Vercel production env.
8. **Capture phone account:** confirm it holds `claim_capture`; mobile Send now needs it.
9. **pgTAP suites:** `npx supabase test db` against a local stack or a scratch project.
10. **Supabase advisors** (security and performance) after applying the migrations.

---

## 15. Pre-launch checklist

- [ ] Owner confirms the backup tier and point-in-time recovery; one restore into a scratch project is completed and recorded in `docs/BACKUP-RESTORE-DRILL.md`.
- [ ] Production schema dumped and committed as a baseline migration (closes C1; unblocks staging and pgTAP).
- [ ] Verification items 3–5 above run before migrations are applied.
- [ ] Apply, in order: `20260913120000` → `20260913130000` → `20260915120000` → `20260916120000` → `20260916130000`. Then deploy the web build (the web build calls `revoke_staff_sessions` and must not ship first).
- [ ] Supabase advisors clean after apply; pgTAP suites green.
- [ ] Demo accounts disabled on production; capture phone account holds `claim_capture`.
- [ ] Owner decisions recorded: hard-delete policy (H13), sign-in thresholds (H14), realtime refresh list, retention periods.
- [ ] Storage policy tightened after a physical capture-phone test (H11).
- [ ] Direct status writes locked down (H12) after the schema baseline.
- [x] `next` upgraded to 16.3.5 with all gates green (H9) — done in this audit.
- [ ] jsPDF 4.x and exceljs upgrade, with one printed payslip and one exported workbook checked (H19).
- [ ] CI green on the default branch.
- [ ] Only then: re-run this checklist and mark the system ready.
