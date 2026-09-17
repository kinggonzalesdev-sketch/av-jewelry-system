# Attendance and Payroll Template: Integration Guide (Phases 14 and 16)

This guide is for the engineer who takes the attendance, review-attendance and payroll template into a new
client's project. Part 1 (Phase 14) lists every item that belongs to the source business and says whether to
remove it, turn it into a client setting, or keep it as generic engine. Part 2 (Phase 16) is the ordered
checklist for a new project, from role setup to go-live, with a verification for every step. Parts 3 and 4
cover moving the architecture to another stack and importing a client's existing attendance data. The guide
links to the other documents in this folder instead of repeating them. It describes what a new build should
do and never proposes a change to the reference production system.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, with a `file:line` citation. |
| GENERIC | The reusable form a new build should use. |
| PROJECT-SPECIFIC | Tied to the source business. Brand, currency and timezone values are named only in sections 1.2 and 1.3. |
| CONFIGURABLE | Should become a client setting (keys as in `CONFIGURATION.md` section 2). |
| NEEDS VERIFICATION | The repository cannot settle it; the text says what would. |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository. |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template fixes. Never a production change. |

Role vocabulary: the database role keys are `owner`, `selected_admin` and `staff`. The UI calls them Super Admin
(role key owner), Admin and Staff; this guide uses those names after this sentence. Permission keys:
`hr_attendance` (open the Attendance page and read the kiosk roster), `hr_review_attendance` (open Review
Attendance and read every row), `hr_payroll` (open Payroll).

Citation shorthands (the same as `CONFIGURATION.md`):

| Shorthand | Expands to |
|---|---|
| `L/` | `src/lib/hr/` |
| `C/` | `src/components/hr/` |
| `P/` | `src/app/(app)/admin/` |
| `M/<timestamp>` | the single file in `supabase/migrations/` whose name starts with that timestamp |

Evidence is the repository itself: every claim cites the repository lines it rests on. The extraction method is
described in `README.md` section 7.

Key facts this guide relies on:

- Clocking is a shared KIOSK: a signed-in operator holding `hr_attendance` picks a member from `list_clock_staff`
  and clocks that member (`C/attendance-clock.tsx:145-150`; `M/20260907160000:9-27`). It is not self-service.
- One open session per member, enforced by the unique partial index `attendance_one_open_session_per_staff`
  (`M/20260717120000:43-45`). Each `attendance_records` row is one session.
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:40-46`). A day's total is the sum of its
  completed sessions; gaps are not counted (`L/sessions.ts:90-91`).
- Two DIFFERENT night rules exist. Session flag: clock-in hour >= 22 sets a flat 300.00 through a BEFORE INSERT
  trigger (`M/20260722200000:26-49`). Payroll: distinct `work_date`s with a clock-out at or after 22:00, times
  `app_private.night_ot_bonus()` (RECONSTRUCTED) (`M/20260907160000:41`, `:53-55`, `:85`).
- Pay = `round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2)`, NULL when no rate
  (`M/20260907160000:86-93`). Deductions are one lump sum >= 0 entered at payslip generation
  (`L/payslip-actions.ts:48-55`; `M/20260722210000:27`).
- A payslip is a frozen `payroll_snapshots` row with `payment_status` pending then paid (`M/20260722210000:29-30`;
  `L/payslip-actions.ts:124-135`). Attendance has no approval or finalization step and no period lock.
- Only the clock-out can be corrected: Super Admin or Admin by role title, reason required, in-place update, the old
  value kept only in a best-effort application audit event (`M/20260907130000:29-61`; `L/attendance.ts:447-456`).
  Delete is a hard delete through `delete_attendance_record` (RECONSTRUCTED).
- Device approval is a hashed token in an httpOnly cookie, enforced in server TypeScript only (`L/attendance.ts:28-48`).
  The live clock-in RPC has no device check; PENDING (not live) adds one for clock-in (`M/20260916120000:451-459`).
  The gate is fail-open: no registered device means no gate (`L/devices.ts:21-22`, `:38-42`).
- Super Admins and demo accounts are excluded from payroll (`M/20260907160000:98-99`). CURRENT caveats: the roster
  filters Super Admins but not demo accounts (`M/20260907160000:21-25`), the clock-in RPC refuses demo targets but not
  a Super Admin target (`M/20260907120000:30-37`).

Related documents in this folder:

| Document | Use it for |
|---|---|
| `README.md` | Entry point: scope, key facts, document index (section 3), proposed module structure and the code folder (section 4). |
| `ARCHITECTURE.md` | Request path per screen, flows by actor (section 3), cross-cutting concerns such as timezone and headers (section 5). |
| `BUSINESS_RULES.md` | Attendance rules (Part A) and the Review Attendance workflow (Part B), labelled per rule. |
| `PERMISSIONS.md` | Capability matrix, generic key model (section 4), default grants (section 5), catalog checks (section 8). |
| `SECURITY.md` | Enforcement layers, device approval (section 5), definer hygiene (section 8), adopter security checklist (section 10). |
| `SERVER_API.md` | Every server action, reader and RPC (sections 2 to 5), retry rules (section 1.4), generic interface (section 9). |
| `DATABASE.md` | Table and function DDL, drift map, generic data model (section 5), verification queries (section 8). |
| `CONFIGURATION.md` | Configuration schema (section 2), hardcoded-value map (section 4), engine rules (section 5), alignment (section 7). |
| `PAYROLL.md` | Pay period, rates, night rule, deductions, payslip lifecycle, payroll improvements (section 12). |
| `UI_UX.md` | Screens, components (section 9), breakpoints and responsive guidance (section 8). |
| `TESTING_CHECKLIST.md` | Manual scripts per role (section 3), automated plan (section 4), security regression (section 5). |
| `IMPLEMENTATION_PROMPT.md` | The brand-free prompt for an AI coding agent that builds the module in a new project. |

Some documents cite `ATTENDANCE.md` and `REVIEW_ATTENDANCE.md`. No such files exist: those names mean Part A and Part B
of `BUSINESS_RULES.md` (`BUSINESS_RULES.md:8-9`).

---

## 1. What must be removed or replaced (Phase 14)

### 1.1 Action vocabulary

| Action | Meaning |
|---|---|
| REMOVE | Do not carry into the template or a client project in any form. |
| ABSTRACT | Keep the mechanism, replace the literal with a client setting, a label or a neutral name. |
| KEEP-GENERIC | Carry over as engine; only the wording or rationale around it is project-specific. |

The only business modules the HR code imports are the approvals queue that lives in the fulfillment module (RM-27)
and the money formatter that lives in the payments module (RM-12). No HR file imports capture, live selling, orders,
inventory, printers, labels, invoicing, claims, scrap or cash code. The other business mentions
below sit in shared infrastructure around the HR screens.

### 1.2 PROJECT-SPECIFIC removal table (the only place this guide names the source business's values)

Rows are grouped: branding (RM-01 to RM-10), currency (RM-11 to RM-14), timezone (RM-15 to RM-18), pay policy (RM-19
to RM-21), people and accounts (RM-22 to RM-26), module couplings (RM-27 to RM-31), repository hygiene (RM-32 to
RM-43). Extra sites for a row are in section 1.3. `CONFIGURATION.md` section 9 (PS-1 to PS-16) covers the
value-level subset of this table.

| Id | Item (reference value) | Where | Action | Template replacement |
|---|---|---|---|---|
| RM-01 | Company name "A.V. Jewelry" on payslip screen, PDF, summary sheet, export | `L/payslip-pdf.ts:69`; `C/payslip-button.tsx:82` | ABSTRACT | `branding.companyName` |
| RM-02 | Logo text "AV" (payslip, PDF) and "A.V" (summary) in a filled circle | `L/payslip-pdf.ts:60-65`; `C/payslip-button.tsx:79` | ABSTRACT | `branding.logoText`, `logoUrl` |
| RM-03 | Accent "Soft Gold" `#b28b3f` (RGB 178,139,63) and `bg-amber-500` on documents | `L/payslip-pdf.ts:17`; `C/payslip-button.tsx:38-40` | ABSTRACT | `branding.brandColor` |
| RM-04 | Payslip PDF file name prefix "AV-Jewelry-Payslip-" | `L/payslip-pdf.ts:44-49` | ABSTRACT | `branding.documentFilePrefix` + pattern |
| RM-05 | Export names "MineFlow-Data-Export-" (server), "AV-Jewelry-Data-Export-" (browser) | `src/app/api/export/all/route.ts:74` | ABSTRACT | `branding.documentFilePrefix` |
| RM-06 | Brand-prefixed device cookie `av_att_device` | `L/devices.ts:27` | ABSTRACT | `branding.cookieNamePrefix` |
| RM-07 | Brand-prefixed privacy-mode storage key `av-privacy-mode` | `src/components/shell/privacy.tsx:33` | ABSTRACT | `branding.cookieNamePrefix` |
| RM-08 | Realtime channel name `mineflow-live-sync` | `src/components/shell/dashboard-sync.tsx:154` | ABSTRACT | neutral channel name |
| RM-09 | Realtime publication list mixing HR tables with orders, payments, inventory, layaway | `M/20260731130000:11-35` | ABSTRACT | each module registers its own tables |
| RM-10 | Refresh ignore list naming label-job, printer, messaging, capture and layaway tables | `src/components/shell/dashboard-sync.tsx:86-92` | REMOVE | the host's own list, or none |
| RM-11 | Currency symbol (the peso sign) in formatter, money input, privacy mask, messages | `src/lib/payments/format.ts:51-56` | ABSTRACT | `locale.currencySymbol` |
| RM-12 | HR money display imports the payments module's formatter | `src/components/shell/privacy.tsx:13` | ABSTRACT | shared formatter reading `locale.*` |
| RM-13 | Currency code "PHP" printed in PDFs | `L/payslip-pdf.ts:12-14`, `:21-31` | ABSTRACT | `locale.currencyCode`, `pdfUsesCode` |
| RM-14 | Night amount and peso sign inside labels ("Night shifts (... 300 each)") | `L/payslip-pdf.ts:106`; `C/payslip-button.tsx:113` | ABSTRACT | label token from the night amount |
| RM-15 | Business timezone "Asia/Manila" in TypeScript | `L/attendance-paging.ts:41`; `L/attendance.ts:133` | ABSTRACT | `locale.timezone` |
| RM-16 | Fixed UTC offset "+08:00" (exact only because the zone has no daylight saving) | `L/attendance-paging.ts:42-43`, `:77-78` | REMOVE | bounds from the IANA zone |
| RM-17 | Timezone literal in SQL bodies and the PENDING (not live) column default | `M/20260907120000:45`; `M/20260907160000:41` | ABSTRACT | SQL settings reader (Step 2) |
| RM-18 | Migration and module names embedding the city ("manila") | `supabase/migrations/`; `src/lib/format/` | REMOVE | zone-free names |
| RM-19 | Session flag: clock-in hour >= 22 sets 300.00, BEFORE INSERT trigger | `M/20260722200000:34-37` | ABSTRACT | one `payroll.nightRule` |
| RM-20 | Payroll night rule: clock-out >= 22:00, once per day, `night_ot_bonus()` (RECONSTRUCTED) | `M/20260907160000:41`, `:53-55`, `:85` | ABSTRACT | the same `payroll.nightRule` |
| RM-21 | Pay model: daily rate, weekly default frequency, 8-hour overtime display threshold | `M/20260907160000:50-51`, `:84` | ABSTRACT | `payroll.*` keys (Step 4) |
| RM-22 | Super Admin exclusion from roster, payroll and rates ("Owners are not on payroll") | `M/20260907160000:24`, `:99`; `L/rate.ts:137` | ABSTRACT | exemption decision (Step 1.6) |
| RM-23 | Real account-holder names in the exclusion migration header (not reproduced) | `M/20260907160000:1-7` | REMOVE | never copy migration comments |
| RM-24 | Demo accounts flagged once by an auth-email pattern on a test domain (not reproduced) | `M/20260722160000:10-15` | REMOVE | `is_demo` set at seed time |
| RM-25 | Primary Super Admin identified by a hard-coded email constant (not reproduced) | `src/lib/authz/guard.ts:281` | REMOVE | profile flag checked in SQL |
| RM-26 | Cap of two Super Admins; legacy "at most two Admin" trigger | `src/lib/authz/access-catalogue.ts:189-190` | ABSTRACT | a setting, or no cap |
| RM-27 | Delete requests routed through the approvals queue inside the fulfillment module | `src/lib/authz/request-deletion.ts:3` | ABSTRACT or REMOVE | own queue, or no request path |
| RM-28 | Business attachment entity types (order, payment, layaway, inventory_item, and others) | `src/lib/attachments/types.ts:9-18` | REMOVE | `attendance_record` only, or a photo table |
| RM-29 | Design tokens named `gold` (values are emerald green) and badge tone `gold` | `src/app/globals.css:108-109` | ABSTRACT | neutral `accent` token |
| RM-30 | "Shop phone" wording and default device label "Shop phone" | `L/devices.ts:14`, `:94`; `M/20260722150000:51` | ABSTRACT | `attendance.device.defaultLabel` |
| RM-31 | One approved device: registering deactivates every other device | `M/20260722150000:49` | ABSTRACT | `attendance.device.maxActiveDevices` |
| RM-32 | Person-name test fixtures, one paired with salary figures (not reproduced) | `tests/unit/payslip-button.test.tsx:16` | REMOVE | synthetic names such as `<employee-a>` |
| RM-33 | Selfie purge script: project URL in usage text, secret-key runbook, capture-folder guard | `scripts/purge-attendance-selfies.mjs:25` | REMOVE | retention job (Step 14) |
| RM-34 | Legal pages mixing attendance data with proof-of-payment and capture data, "shop device" | `src/app/(legal)/privacy/page.tsx:62-63` | ABSTRACT | client's own legal text (Step 15) |
| RM-35 | Spec references "Bible section F" and "Owner <date>" decision notes in comments | `L/actions.ts:29`; `L/payroll.ts:6` | REMOVE | client's own decision log |
| RM-36 | Provisional-policy rows with spec references | `M/20260722200000:70-73` | REMOVE or ABSTRACT | open-decisions table |
| RM-37 | Development-Bible scope text that forbids attendance features in its own section | `Development-Bible.md:3557`, `:4045` | REMOVE | not template scope |
| RM-38 | Multi-domain export: HR sheets beside inventory, layaway, orders, scrap, capture sheets | `src/lib/export/sections.ts:15-29` | ABSTRACT | per-module sheet builders |
| RM-39 | Service-worker comments and brand image allow-list | `src/lib/pwa/cache-policy.ts:4-5`, `:20` | ABSTRACT | keep "HTML never cached" |
| RM-40 | Role labels Super Admin / Admin / Staff; sidebar words "Owner" / "Team" | `src/lib/authz/access-catalogue.ts:177-182` | ABSTRACT | label map; role keys stay |
| RM-41 | Business motivation comment ("replaces the unreliable biometric") | `M/20260717120000:2-5` | REMOVE | none |
| RM-42 | Dialog primitive tied to the PWA update guard (examples: payment, invoice, walk-in) | `src/components/ui/modal.tsx:6`, `:127-131` | KEEP-GENERIC | host's unsaved-changes guard |
| RM-43 | Response headers: camera for own origin, same-origin framing, no CSP (rationale cites capture photos) | `next.config.ts:31-50` | KEEP-GENERIC | Step 8 header rule |

### 1.3 Notes to the removal table (PROJECT-SPECIFIC, continued)

- RM-01: also `C/payroll-summary-button.tsx:93` ("A.V. Jewelry - Payroll Summary", with an em dash in the source) and the workbook creator
  `src/lib/export/data-export.ts:132`.
- RM-02, RM-03: the summary sheet draws "A.V" on `bg-amber-500` at `C/payroll-summary-button.tsx:89-90`.
- RM-05: the browser download name is set at `src/components/export/export-all-button.tsx:91`.
- RM-09: the list also holds scrap sales, customers, financers, reminders, approvals and a messaging-integration
  config table. The template registers only `attendance_sessions`, `payroll_snapshots` and the employee table, and
  only if the host uses a realtime refresh. RLS still filters what a subscriber sees (KEEP-GENERIC mechanism).
- RM-11: server messages `L/attendance.ts:201`, `:298`; `L/rate.ts:242`; money input `src/components/ui/money-input.tsx:130`;
  privacy mask `src/components/shell/privacy.tsx:34`. The formatter's function name carries the currency name
  (`src/lib/payments/format.ts:51`).
- RM-13: the comment at `L/payslip-pdf.ts:12-14` says built-in PDF fonts lack the peso sign, yet `:106` prints it in
  the night label (NEEDS VERIFICATION: open a generated PDF).
- RM-14: also `C/payslip-button.tsx:290-291` ("the recorded ... 300 flat late-night overtime"), the clock-in toast
  "clock-in at/after 10 PM" at `L/attendance.ts:201`, `:298`, and the pay-rule comment `C/attendance-view.tsx:27-30`.
- RM-15: `src/lib/format/manila-date.ts:16` (`MANILA_TZ`) with helpers `manilaToday` (`:19`) and `manilaMonthStart`
  (`:24`); its tests are `tests/unit/manila-date.test.ts`.
- RM-17: also the night trigger `M/20260722200000:34` and PENDING (not live) `M/20260916120000:367-368`; the same zone
  string is pinned by the content test `tests/unit/security-hardening.test.ts:272-274`.
- RM-18: `supabase/migrations/20260907120000_kiosk_clock_in_manila_work_date.sql` and the module `src/lib/format/manila-date.ts`.
- RM-19, RM-20: the value 300 is the UI's statement of the bonus; `app_private.night_ot_bonus()` has no DDL in the
  repository, so its live value is NEEDS VERIFICATION. The provisional note at `M/20260722200000:70-73` says the
  amount and the 10 PM threshold "await Owner confirmation", and the spec that explains them is not in the repository
  (`Development-Bible.md` has no such section). Treat both as unexplained client policy.
- RM-21: frequency allow-list `L/rate.ts:213-216`; the frequency drives no computation (`M/20260907160000:84-93`).
- RM-22: the exclusion is a decision of the source client, recorded as "Owner 2026-09-07" in comments at
  `M/20260907160000:24`, `:99` and `L/rate.ts:137`. `kiosk_clock_in` does not refuse a Super Admin target
  (`M/20260907120000:30-37`); PENDING (not live) `M/20260916120000:461-468` does not either.
- RM-24: default demo emails with environment overrides at `src/lib/auth/demo.server.ts:42-46` (values not reproduced).
  The demo-login refusal `src/lib/authz/guard.ts:149-154` is KEEP-GENERIC (optional, off in production).
- RM-26: the legacy trigger is `M/20260715120100:148-182`; the UI says the cap was retired, but no repository
  migration drops the trigger (NEEDS VERIFICATION, `PERMISSIONS.md` section 1.4).
- RM-27: kind list `src/lib/fulfillment/service.ts:33-48` mixes `attendance_delete` with order, layaway, inventory,
  scrap and customer kinds; the executor calls `delete_attendance_record` at `service.ts:735-739`; the request needs
  `initiate_high_risk_action` (`service.ts:502`), which is absent from the Manage Access catalogue
  (`src/lib/authz/access-catalogue.ts:37-129`) and never granted by a migration; DB kind check
  `M/20260817190000:9-17`; UI import `C/attendance-day-details.tsx:11`.
- RM-28: the eight business types are order, payment, layaway, inventory_item, customer, fulfillment, claim and
  live_batch. The same list is at `src/lib/attachments/upload.ts:32-42` and in the CHECK at `M/20260722200000:54-68`; the
  business purposes `payment_proof`, `evidence`, `fulfillment_proof` are at `M/20260716300000:75-80`.
- RM-29: dark values `src/app/globals.css:139-140` and the brand comment at `:46`; tone map
  `src/components/ui/page-primitives.tsx:82`, `:91`; HR usages in `C/review-attendance-view.tsx` (for example `:61`,
  `:196`), `C/attendance-clock.tsx`, `C/attendance-day-details.tsx`, `C/attendance-records.tsx`, `C/device-manager.tsx`.
- RM-30: also `L/attendance.ts:41`, `:45-46`; `C/device-manager.tsx:73-74`, `:161`, `:186`; `P/attendance/page.tsx:97-103`.
- RM-32: other name fixtures at `tests/unit/attendance-clock-out-correct.test.tsx:40`, `:57`;
  `tests/unit/attendance-clock.test.tsx:18`; `tests/unit/attendance-overtime.test.tsx:44`, `:62-74`, `:116`, `:122`;
  `tests/unit/attendance-paging.test.ts:156-157`; `tests/unit/attendance-records.test.tsx:41`, `:57-58`;
  `tests/unit/review-attendance-records.test.tsx:36`, `:50-51`. The salary figures are at
  `tests/unit/payslip-button.test.tsx:13-34`.
- RM-33: the script also documents a live-only `storage.protect_delete` trigger that blocks SQL deletes
  (`scripts/purge-attendance-selfies.mjs:7-8`), a guard for a capture-screenshot folder (`:13-16`) and a runbook for
  handling the secret key (`:21-22`, `:30-39`). Keep the lesson (Step 14), not the script.
- RM-34: also `src/app/(legal)/privacy/page.tsx:85`, `:138` and `src/app/(legal)/cookie-policy/page.tsx:32-33`. The
  source jurisdiction's data-privacy analysis (RA 10173) is in `LEGAL_COMPLIANCE_AUDIT.md:44`, `:54-65`.
- RM-35: the section-sign F reference appears 13 times across 5 migration files (`M/20260717120000`,
  `M/20260721100000`, `M/20260722200000`, `M/20260722210000` and one layaway migration, `M/20260722220000`), and in
  HR comments `L/attendance.ts:51`, `L/payslip-actions.ts:13`, `L/payslip.ts:7`, `L/rate.ts:10`,
  `C/attendance-view.tsx:23`, `C/payroll-summary-button.tsx:12`, `C/payslip-button.tsx:17`, `P/attendance/page.tsx:34`,
  `P/payroll/page.tsx:17`. `Development-Bible.md` has no section F, so the rationale cannot be recovered.
- RM-36: also `M/20260717120000:138-141` and `M/20260722210000:137-142`; the table itself is created by a
  live-claim-intake migration (`M/20260715140000:230-236`) with a column named for the spec.
- RM-37: the same text is duplicated at `SECTION-11-REVIEW.md:26`, `:549`. A template author who reads only that text
  would wrongly conclude the HR module is out of scope.
- RM-38: HR sheets `src/lib/export/data-export.ts:522-602` (attendance, payroll) and `:776-830` (team with rates).
  Business mentions also sit in the camera-header rationale (`next.config.ts:38`), the purge script (RM-33), the legal
  pages (RM-34), the realtime lists (RM-09, RM-10), the attachment types (RM-28), and the route map
  `src/components/shell/navigation.ts:83-96`, which gates many business routes beside the three HR routes.
- RM-39: `public/sw.js:1`, `:8-10` name the brand and order, payment, inventory and messaging data; the brand image
  allow-list entry is `src/lib/pwa/cache-policy.ts:20`. The rule itself (every HTML navigation is network-or-offline
  and never stored) is KEEP-GENERIC.
- RM-40: sidebar words at `src/components/shell/app-sidebar.tsx:48-52`.
- RM-41: `M/20260717120000:2` also carries the internal labels "business problem #15; solution F".
- RM-43: header block `next.config.ts:41-50`; camera rationale `:38`; no-CSP rationale `:31-35`; same-origin framing
  for print previews `:36`, `:42`.

### 1.4 Dead and legacy code: do not port

Not project-specific, but part of the removal work. Each item has no caller in `src/`.

| Item | Where | Why |
|---|---|---|
| Super-Admin-only self clock `clockIn` / `clockOut` (direct table writes) | `L/attendance.ts:252-339` | Superseded by the kiosk RPCs. |
| `getOpenSession`, `listAttendance`, `listAttendanceSelfies` | `L/attendance.ts:240-250`, `:687-700`, `:477-512` | No caller. |
| `setHourlyRate` and the legacy `staff_hourly_rates` / `set_staff_hourly_rate` (RECONSTRUCTED) | `L/rate.ts:31-109` | Daily rates replaced them. |
| `staff_profiles.hourly_rate` | `M/20260717120000:12-14` | No longer the pay basis (`L/rate.ts:146-147`). |
| `elapsedHours` | `L/attendance-paging.ts:182-185` | No caller. |
| Columns `clock_in_photo`, `clock_out_photo`, `status` on `attendance_records` | `M/20260722150000:8-9`, `:12` | Never read or written. |
| Column `payroll_snapshots.approved_by` | `M/20260722210000:32` | Never written. |
| `trusted_devices` / `role_device_limits` | `M/20260715120100:237-283` | A login-device registry, never enforced, not the attendance gate. |
| Repository `generate_payslip_snapshot` body | `M/20260722210000:75-132` | Stale: reads `hourly_rate`, which `report_payroll` no longer returns. |

### 1.5 Never include

These never go into the template, a client repository, a migration, a test fixture, a document or a chat message:

- Passwords of any kind, including demo-login passwords and temporary passwords.
- API keys and secrets: database anon or publishable key values, service-role or secret keys, hosting tokens, SMTP
  or email-provider keys, webhook signing secrets.
- Tokens: session JWTs, refresh tokens, raw device tokens (the device cookie value), signed storage URLs, one-time codes.
- Credentials inside runbooks or script usage text (RM-33 is the example to avoid).
- Production identifiers: database project refs and URLs, hosting project or deployment ids, bucket object paths that
  contain row ids, device ids, UUIDs of real rows, connection strings.
- Personal data: real names, emails (including an owner or primary-admin constant), phone numbers, selfies, and any
  salary, rate or net-pay figure tied to a person.
- Production data exports, audit rows or counts that identify people.
- Local environment and tool state: `.env*` files, linked hosting or database CLI folders, editor settings holding secrets.
- The reference repository's git history (copy files into the template; do not fork).

### 1.6 Pre-publish scan

Run before the template or a client build is shared. Record the commands and the zero-match results.

- [ ] Search the template for every reference value in the second column of section 1.2 (brand names, logo text,
  cookie and storage-key prefixes, channel name, the zone name, the fixed offset, the currency code and sign). Expected:
  matches only inside a labelled PROJECT-SPECIFIC section.
- [ ] Search for email-like text (an at-sign between word characters), `https://`, and strings that look like JWTs
  (three dot-separated base64url parts starting with `eyJ`). Expected: placeholders only, such as `<owner-email>`.
- [ ] Search for 36-character UUID-shaped strings. Expected: none, or zero-padded synthetic ids in test fixtures.
- [ ] Search migration comments for person names and "Owner <date>" notes. Expected: none.
- [ ] For `IMPLEMENTATION_PROMPT.md`: none of the section 1.2 values, no reference permission key, no role key
  `selected_admin`, no zone or currency name (that file's own rule).

---

## 2. New project implementation checklist (Phase 16)

### 2.0 Before Step 1

- [ ] Work on a scratch database and a non-production deployment until Step 15.
- [ ] Open a decision record (a short document in the client repository). Steps 1 to 4 fill it; Steps 5 to 9 implement
  it. Minimum entries: clock mode, authorization model, exemption rule, night rule, device gate mode, selfie mode,
  deletion mode and request path, who sees all payroll rows, who generates and marks paid, who edits rates, negative
  net, one payslip per period, reverse path for a paid payslip, period lock, selfie retention days.
- [ ] Use the agreed generic names. Permission keys: the eleven keys of `PERMISSIONS.md` section 4.2, which
  `CONFIGURATION.md` section 2.3 adopts. Settings store: `app_private.hr_settings` with its readers (including
  `business_timezone()` and `business_today()`), whose DDL of record is `DATABASE.md` section 5.12 and which
  `CONFIGURATION.md` sections 1.2 and 2.8 adopt. `CONFIGURATION.md` section 7 records the naming decisions (for
  example, no `payroll.view_own` key); where another document is found to differ from it, follow section 7. One deliberate extra remains: the optional key `attendance.delete.request`,
  outside section 4.2 and used only when a deletion-request path is kept (`PERMISSIONS.md` section 4.2; `DATABASE.md`
  section 5.1). This guide cites the reference names as CURRENT and maps them to those generic names.
- Verify: the decision record exists, names who approved each decision, and states that the build uses the names of
  `CONFIGURATION.md` section 7 (or lists each deliberate deviation).

### Step 1. Configure roles and permission keys

- [ ] 1.1 Map the host's roles to three role keys. CURRENT: a CHECK allows exactly `owner`, `selected_admin`, `staff`
  (`M/20260715120100:16`); TypeScript mirrors them (`src/lib/authz/permissions.ts:87-91`). Labels are CONFIGURABLE (RM-40).
- [ ] 1.2 Seed the eleven permission rows of `PERMISSIONS.md` section 4.2: `attendance.clock_operate`,
  `attendance.view_team`, `attendance.review`, `attendance.correct`, `attendance.delete`, `attendance.devices.manage`,
  `payroll.view_all`, `payroll.rates.edit`, `payroll.payslip.generate`, `payroll.payslip.mark_paid`, `payroll.export`;
  add `attendance.delete.request` only when the deletion-request path is kept. CURRENT seeds three page keys instead
  (`hr_attendance`, `hr_review_attendance`, `hr_payroll`; `M/20260729120000:32-34`). RECOMMENDED TEMPLATE IMPROVEMENT:
  descriptions must not promise what the key does not gate (CURRENT "review and correct" and "view and process" are
  role-gated, `PERMISSIONS.md` section 2).
- [ ] 1.3 Keep `has_permission(key) = is_owner() or an explicit grant held by an active profile`
  (`M/20260716240000:26-44`). The Super Admin holds every key implicitly.
- [ ] 1.4 Record the authorization model for the write actions in the decision record:
  - Template model: every write is gated by its own key of `PERMISSIONS.md` section 4.2 (`attendance.correct`,
    `attendance.delete`, `attendance.devices.manage`, `payroll.rates.edit`, `payroll.payslip.generate`,
    `payroll.payslip.mark_paid`), with the dependencies of its section 4.3 and the default grants per role of its
    section 5. The decision record lists any client change to the default grants, not a different key model.
  - CURRENT, for context only: correct and delete are role-gated to Super Admin and Admin (`L/attendance.ts:352`,
    `:406`; `M/20260907130000:29-33`); generate is Super Admin (`L/payslip-actions.ts:28`); mark paid is Super Admin or
    Admin in TypeScript but Super Admin in repository RLS (`L/payslip-actions.ts:106`; `M/20260722210000:62-65`); rate
    edits have no TypeScript guard and a RECONSTRUCTED SQL gate (`L/rate.ts:201-231`); devices are Super Admin.
  - The UI, the server action and the RPC or policy read the same key (RECOMMENDED TEMPLATE IMPROVEMENT: CURRENT
    offers Admin payroll controls the server refuses, `src/app/(app)/admin/payroll/page.tsx:43-44`).
- [ ] 1.5 Put every key the build checks into the access-management catalogue as an independent toggle (CURRENT
  Team Management module, `src/lib/authz/access-catalogue.ts:116-128`). If a delete-request path is kept, its key must
  be grantable from the catalogue (CURRENT it is not, RM-27); otherwise drop the request path.
- [ ] 1.6 Decide the timekeeping exemption. CURRENT excludes Super Admins by role title in the roster and payroll only
  (RM-22). GENERIC: one per-profile exemption flag checked by the roster RPC, both clock RPCs and the payroll reader
  (`DATABASE.md` section 5.2), with demo accounts treated the same way.
- [ ] 1.7 Identify a primary Super Admin, if needed, by a profile flag checked in SQL, never by an email constant (RM-25).
- Verify:
  - `select key from public.permissions where key like 'attendance.%' or key like 'payroll.%';` returns the eleven
    keys of Step 1.2 (twelve when `attendance.delete.request` is kept) and no reference page key.
  - pgTAP with simulated JWTs (the pattern used by `supabase/tests/26_hr_attendance.test.sql`): a Super Admin with no
    grant rows passes `has_permission` for each key; a Staff member with no grants fails; a deactivated profile with a
    grant fails.
  - The Manage Access screen shows each key as its own toggle; toggling one changes nothing else.

### Step 2. Configure timezone, currency and locale

- [ ] 2.1 Set `locale.timezone` to the client's IANA zone name. No fixed-offset key exists (RM-16).
- [ ] 2.2 Provide the zone to SQL through the settings store and its readers, and have every SQL rule read it (CURRENT
  literals in three function bodies, RM-17). Store `locale.timezone` as the undated row of `app_private.hr_settings`
  and read it only through `app_private.business_timezone()` and `app_private.business_today()` (`DATABASE.md`
  section 5.12; `CONFIGURATION.md` sections 1.2 and 2.8).
- [ ] 2.3 Name the business-date helpers neutrally and compute day bounds with `Intl` from the zone (CURRENT technique
  with the `en-CA` date trick, `L/attendance-paging.ts:46-48`, is KEEP-GENERIC).
- [ ] 2.4 Set `locale.currencyCode`, `locale.currencySymbol` and the display rule. Minor units stay 2 (CURRENT
  `numeric(10,2)` and `numeric(12,2)`, `M/20260722210000:20-28`). If the PDF font lacks the symbol, print the code (RM-13).
- [ ] 2.5 Set `locale.dateLocale` and decide `locale.showTimesInBusinessTimezone`. CURRENT times render in the
  viewer's browser zone (`L/attendance-paging.ts:176-179`) and the correction input is browser-local
  (`C/review-attendance-view.tsx:674-679`). RECOMMENDED TEMPLATE IMPROVEMENT: show and enter times in the business zone.
- [ ] 2.6 If the zone has daylight saving, write down how a clock-in inside the skipped or repeated hour is dated.
  The reference never needed this (RM-16), so no CURRENT behaviour exists to copy.
- Verify:
  - Test that the TypeScript business date and the SQL business date agree for instants just before and after local
    midnight. RECOMMENDED TEMPLATE IMPROVEMENT: the reference has no TypeScript-to-SQL agreement test. Its unit test
    (the file RM-15 names, lines 11-35) checks only TypeScript: one helper against fixed instants, including the
    local-midnight rollover, and against the other TypeScript helper. Keep that test (renamed) and add the SQL comparison.
  - File-content test: the SQL settings seed and the TypeScript defaults agree (`CONFIGURATION.md` section 1.3; the
    pattern exists at `tests/unit/security-hardening.test.ts:218-286`).
  - Search the build for the zone name and currency code: only the configuration module and the seed migration match.

### Step 3. Configure attendance rules

- [ ] 3.1 Clock mode: kiosk (CURRENT). RECOMMENDED TEMPLATE IMPROVEMENT: require `attendance.clock_operate` (CURRENT
  page key `hr_attendance`) in the clock server actions and inside both clock RPCs. CURRENT checks only that the operator is an active staff member
  (`L/attendance.ts:158`, `:211`; `M/20260907120000:25-28`); the key gates only the page, the roster and the
  attendance history loader action (`L/actions.ts:57-64`).
- [ ] 3.2 Keep one open session per member as engine (partial unique index, `CONFIGURATION.md` section 5).
- [ ] 3.3 Decide `attendance.allowMultipleSessionsPerDay` ("Continue Duty", CURRENT on, `C/attendance-clock.tsx:319-334`).
- [ ] 3.4 Keep `work_date` = business date at clock-in; a session that crosses midnight stays on its clock-in date
  (CURRENT `M/20260907120000:45`; `L/sessions.ts:68`).
- [ ] 3.5 Choose ONE night rule: anchor (clock-in or clock-out), start time, window end for a clock-out after
  midnight, amount, once per day. RECOMMENDED TEMPLATE IMPROVEMENT: evaluate it in one SQL place. CURRENT has two rules
  that disagree, and a shift ending after midnight earns no payroll bonus (`M/20260907160000:41`; `PAYROLL.md` section 4).
- [ ] 3.6 Choose `attendance.device.mode` (off, auto, required) and `failMode`. RECOMMENDED TEMPLATE IMPROVEMENT:
  fail closed, and check the device token inside both clock RPCs. CURRENT is app-only and fail-open; PENDING (not live)
  checks clock-in by device id only, and a member can read that id from their own rows (`M/20260916120000:431-432`).
- [ ] 3.7 Choose `attendance.selfie.mode` (off or optional) and who may view selfies. The value `required` is not built
  in the template and fails configuration validation (`CONFIGURATION.md` section 2.9 rule 8). CURRENT: optional in
  practice (a "without photo" fallback when the camera fails, `C/attendance-clock.tsx:111-127`), no server check, and
  selfie metadata and files readable by every active staff member (`M/20260716300000:127-129`, `:159-165`).
- [ ] 3.8 Corrections: clock-out only, reason required, `time_in <= new time_out <= now()` (CURRENT
  `M/20260907130000:35-53`). RECOMMENDED TEMPLATE IMPROVEMENTS: refuse an overlap with the member's next session; seed
  the input so an unchanged save is not refused or silently truncated to the minute
  (`C/review-attendance-view.tsx:674-679`): minute precision in the UI, the action and SQL, the same minute counts as
  unchanged, a value that is not a whole minute is refused, and Save stays disabled until the minute changes
  (IMPLEMENTATION_PROMPT.md R7 and R8).
- [ ] 3.9 Deletion: CURRENT hard delete with a typed `DELETE` confirmation checked on the server (`L/actions.ts:146-148`)
  and selfies left orphaned (`L/attendance.ts:340-346`). Decide hard or soft delete and whether a request path exists
  (one rule for both pages; CURRENT pages disagree, `PERMISSIONS.md` section 6 item 12).
- [ ] 3.10 Decide `attendance.maxSessionHours` (flag only; CURRENT none: a forgotten session stays open across days and
  blocks the member's next clock-in until it is clocked out or corrected).
- [ ] 3.11 Decide approval and period lock. CURRENT has neither. The optional day-review table is in `DATABASE.md`
  section 5.5.
- Verify:
  - The configuration module fails to load on an invalid value (for example an unknown anchor).
  - pgTAP: a second open session for the same member raises 23505 (CURRENT `supabase/tests/26_hr_attendance.test.sql:87-93`).
  - Unit test of the night predicate at 21:59, 22:00, 23:59 and 00:30 against the recorded decision.
  - Every item 3.1 to 3.11 has an entry in the decision record.

### Step 4. Configure payroll rules

- [ ] 4.1 Rate basis and frequencies. CURRENT: daily rate; weekly, bi-weekly, monthly stored and shown but driving no
  computation (`M/20260907160000:84-93`). Keys: `payroll.rateBasis`, `payFrequencies`, `defaultFrequency`.
- [ ] 4.2 Rate selection. CURRENT: the newest rate row with `effective_date <= period end` applies to every day of the
  period (`M/20260907160000:59-74`). Decide `payroll.rateSelection` (period end or per day).
- [ ] 4.3 Day definition. CURRENT: a distinct `work_date` with at least one completed session; open sessions count
  nothing (`M/20260907160000:43-52`). Decide `payroll.minHoursForDay`.
- [ ] 4.4 Formula. CURRENT: `round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2)`, NULL without a rate.
  RECOMMENDED TEMPLATE IMPROVEMENT: make the night amount effective-dated so a change does not rewrite past derived
  periods (`CONFIGURATION.md` section 1.4).
- [ ] 4.5 Deductions: one lump sum >= 0 at generation (CURRENT). Decide `payroll.allowNegativeNet`. RECOMMENDED
  TEMPLATE IMPROVEMENT: either a `net_salary >= 0` check or signed parsing, because CURRENT allows a negative net and the
  printed summary total then adds a positive fraction (`C/payroll-summary-button.tsx:31-36`).
- [ ] 4.6 Payslip lifecycle. CURRENT: frozen snapshot, pending then paid, no uniqueness per employee and period, no
  freeze trigger, no un-pay (`M/20260722210000:41-44`, `:62-68`). Decide one current payslip per period, the freeze
  trigger, and the reverse path (`DATABASE.md` section 5.9; `PAYROLL.md` section 12).
- [ ] 4.7 Visibility and authority. Template: `payroll.view_all` sees every payroll row and prints the summary;
  `payroll.payslip.generate`, `payroll.payslip.mark_paid` and `payroll.rates.edit` gate the writes; record which roles
  receive each key (Step 1.4). CURRENT: only the Super Admin sees every payroll row (`M/20260907160000:100`); an Admin
  with `hr_payroll` sees their own row.
- [ ] 4.8 Period presets and the default period. CURRENT: free inclusive date range, default month to date
  (`P/payroll/page.tsx:32-34`; `C/attendance-view.tsx:76-97`).
- [ ] 4.9 Payslip document: company, logo, page size, file-name pattern, labels with the night amount as a token
  (RM-01 to RM-04, RM-14).
- Verify:
  - A pgTAP fixture with known sessions and one rate gives the hand-computed `days_worked`, `night_shifts` and
    `gross_total` (use the canonical fixture T3 of `IMPLEMENTATION_PROMPT.md`, or the D0 and D10 fixture of
    `TESTING_CHECKLIST.md` section 4.2), or run `templates/attendance-payroll/migrations/0008_selftest.sql`, which
    asserts fixture T3 and its variations.
  - An employee without a rate shows "No rate set" and a NULL salary (CURRENT `C/attendance-view.tsx:202-208`).
  - Changing a rate or correcting attendance after generation leaves the generated payslip's figures unchanged.

### Step 5. Apply database migrations

Prerequisites, all present before the first attendance migration runs:

- [ ] An employee (identity) table with `id`, a unique `auth_user_id`, `full_name`, `role_key`, `is_active`,
  `deactivated_at`, `is_demo` and, if decided, the exemption flag (`DATABASE.md` section 5.2; CURRENT `staff_profiles`,
  `M/20260715120100:106-131`).
- [ ] Authentication that exposes the caller's id inside SQL (CURRENT `auth.uid()`).
- [ ] Roles, permissions and grants tables (CURRENT `M/20260715120100:15-19`, `:36-43`, `:188-206`).
- [ ] Schema `app_private` with helpers `current_staff_id`, `current_staff_role`, `is_active_staff`, `is_owner`,
  `has_permission`: SECURITY DEFINER, `set search_path = ''`, identity from the auth id only (CURRENT
  `M/20260715130000:28-161`). RECOMMENDED TEMPLATE IMPROVEMENT: every helper checks `is_active`, and the role helper
  returns a non-NULL sentinel for a deactivated profile (PENDING (not live) `M/20260916120000:46-57` does this for the
  role helper only; CURRENT `current_staff_id()` never checks it).
- [ ] The pgcrypto extension, for the sha256 of the device token (CURRENT created in schema `extensions` at
  `M/20260715120000:14`, used as `extensions.digest` at `M/20260722150000:52`, `:61`).
- [ ] An append-only `audit_events` table (CURRENT `M/20260715120000:74-137`); `0002_audit.sql` creates one only when
  the host has none.
- [ ] If selfies are on: a private storage bucket (CURRENT `M/20260716300000:35-43`, 10 MiB, jpeg, png, webp).

Sub-steps:

- [ ] 5.1 Take a backup or snapshot of the target database, and rehearse every sub-step on a scratch copy first.
- [ ] 5.2 Start from `templates/attendance-payroll/migrations/` (read its `README.md`) or author equivalents from
  `DATABASE.md` section 5, have them reviewed, and apply them in file-name order: `0000_prerequisites_example.sql` is an
  example stub that the host replaces with its own identity and permission layer; then `0001_settings`, `0002_audit`
  (before every file whose functions call the audit writer), `0003_attendance_sessions`, `0004_attendance_devices`,
  `0005_attendance_photos`, `0006_attendance_rpcs`, `0007_payroll`. `0008_selftest.sql` is not a migration: run it with
  `psql` on a scratch database only; it ends in ROLLBACK and prints `SELFTEST OK`. Do not substitute the reference
  `supabase/migrations/`.
- [ ] 5.3 Run each file in a transaction (`begin;` ... `commit;`) unless the migration runner already wraps each
  file (confirm in the runner's documentation). A statement that cannot run inside a transaction goes in its own file.
- [ ] 5.4 Do not replay the reference migrations. A repository-only build most likely fails: `M/20260907160000:29-30`
  changes the result type of `report_payroll` with `create or replace`, and nothing in the repository creates
  `staff_salary_rates`, `app_private.night_ot_bonus()`, `kiosk_clock_out`, `delete_attendance_record` or
  `set_staff_salary_rate` (NEEDS VERIFICATION with a reset on a scratch stack).
- [ ] 5.5 Name migration files without zone or brand names, and write comments without people's names (RM-18, RM-23).
- [ ] 5.6 Record every applied file in the migration history table and commit the same files to the client repository.
  CURRENT lesson: eight production migrations have no repository file.
- Verify in the catalog (read-only; `DATABASE.md` section 8 has more):

```sql
-- Tables exist with RLS enabled AND forced
select n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where (n.nspname, c.relname) in (('public', 'attendance_sessions'), ('public', 'attendance_devices'),
  ('public', 'attendance_photos'), ('public', 'employee_pay_rates'), ('public', 'payroll_snapshots'),
  ('public', 'audit_events'), ('app_private', 'hr_settings'));

-- The one-open-session index is unique and partial on an open, not deleted session
select indexname, indexdef from pg_indexes
where schemaname = 'public' and tablename = 'attendance_sessions';

-- Functions are SECURITY DEFINER with a pinned empty search_path; only report_payroll is INVOKER
select n.nspname, p.proname, p.prosecdef, p.proconfig, pg_get_function_result(p.oid) as result
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.proname in ('kiosk_clock_in', 'kiosk_clock_out', 'list_clock_staff', 'attendance_status',
                    'attach_attendance_photo', 'correct_attendance_clock_out', 'delete_attendance_record',
                    'set_staff_salary_rate', 'payroll_lines', 'report_payroll', 'generate_payslip_snapshot',
                    'mark_payslip_paid', 'void_payslip');

-- pgcrypto present
select extname, extnamespace::regnamespace from pg_extension where extname = 'pgcrypto';
```

  - Expected: `relforcerowsecurity` true on every listed table (CURRENT `attendance_devices` is not forced,
    `M/20260722150000:30`); `attendance_sessions_one_open_uq` is unique with a `where` on `time_out is null` and
    `deleted_at is null`; `prosecdef` false only for `report_payroll`; `proconfig` pins an empty `search_path` on every
    function; `app_private.hr_settings` holds one row per key of `CONFIGURATION.md` section 2.8; the pgTAP suite passes
    (`TESTING_CHECKLIST.md` section 4.2). `void_payslip` exists only when the void path is built.

### Step 6. Configure RLS and grants

`SECURITY.md` owns the security model this step implements: employee scoping (section 3), Admin and Super Admin scope
(section 4), selfie and payroll privacy (sections 6 and 7) and definer function hygiene (section 8). The sub-steps
below are the install order; the reasons and the full defect list are there.

- [ ] 6.1 Enable and force RLS on every attendance, device, rate, payslip, settings, photo and audit table.
- [ ] 6.2 Revoke all table privileges from `anon` and `authenticated`, then grant by name. GENERIC: `authenticated`
  gets SELECT only on attendance and payslip tables; every write goes through a definer function. CURRENT per the
  repository definitions: self INSERT and UPDATE policies plus a `select, insert, update` grant on `attendance_records`
  (`M/20260717120000:59-75`), so a member can insert or rewrite their own rows through the REST API and bypass the
  kiosk, the device gate, the selfie and the audit trail. NEEDS VERIFICATION against the live catalog: a production
  migration about payroll grants has no repository file, so the live grants and policies may differ
  (`SECURITY.md` section 3.3; the Verify queries below settle it). RECOMMENDED TEMPLATE IMPROVEMENT (`PERMISSIONS.md`
  section 6 item 7).
- [ ] 6.3 Read policies: attendance rows to self or `attendance.view_team` (CURRENT self, Super Admin or
  `hr_review_attendance`, `M/20260804140000:8-14`); payslips and rates to self or `payroll.view_all` (CURRENT self or
  Super Admin); devices to `attendance.devices.manage` (CURRENT Super Admin);
  selfies to the subject and reviewers (CURRENT any active staff); audit rows narrowed (PENDING (not live) form at
  `M/20260916120000:290-298`, or stricter).
- [ ] 6.4 Names for reviewers: serve employee names through a permission-scoped definer reader, as `list_clock_staff`
  already does. CURRENT non-Super-Admin reviewers see a dash, because the profile read policy is owner-or-self
  (`M/20260821140000:21-22`).
- [ ] 6.5 Every SECURITY DEFINER function, in the migration that creates it: `set search_path = ''`, caller derived
  from the auth id, an explicit `is null` refusal in every role or permission gate, then
  `revoke all on function <signature> from public, anon;` and `grant execute on function <signature> to authenticated;`
  (add `service_role` only where a server job needs it). Reason: Postgres grants EXECUTE on a new function to PUBLIC,
  and the reference's hosted database re-grants `anon` on each create (stated at `M/20260916120000:12-14`). CURRENT
  has explicit revokes for some functions only (`M/20260722170000:8-18`;
  `M/20260806260000:17`, `:33-34`; `M/20260907130000:65-68`).
- [ ] 6.6 INVOKER readers (`report_payroll`): revoke from `public` and `anon`, grant to `authenticated`; every `app_private`
  function they call either filters by the caller (the payroll row filter lives inside `app_private.payroll_lines`, which
  therefore may be granted to `authenticated`) or is not executable by end users. CURRENT live grants on `report_payroll` are unknown after an out-of-band
  re-create.
- [ ] 6.7 Schema `app_private`: `revoke all on schema app_private from anon;` and usage to `authenticated` only
  (CURRENT `M/20260715130000:246-247`).
- [ ] 6.8 Definer functions that write a FORCE RLS table need an owning role that bypasses RLS on the target stack
  (NEEDS VERIFICATION per stack).
- [ ] 6.9 Storage: the selfie bucket stays private; object policies match 6.3.
- Verify:

```sql
-- No definer function in public or app_private is executable by anon or PUBLIC (expect zero rows)
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))
  and (p.prosecdef or p.proname in ('report_payroll'));

-- Table privileges held by anon and authenticated
select table_schema, table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema in ('public', 'app_private')
  and table_name in ('attendance_sessions', 'attendance_devices', 'attendance_photos', 'employee_pay_rates',
                     'payroll_snapshots', 'audit_events', 'hr_settings')
  and grantee in ('anon', 'authenticated')
order by 1, 2, 3, 4;

-- Policies in force
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('attendance_sessions', 'attendance_devices', 'attendance_photos', 'employee_pay_rates',
                    'payroll_snapshots', 'audit_events', 'hr_settings')
   or (schemaname = 'storage' and tablename = 'objects');
```

  - Expected: zero rows from the first query; `anon` holds nothing; `authenticated` holds no privilege on
    `app_private.hr_settings` and no INSERT, UPDATE or DELETE on attendance, rate or payslip tables. As a Staff member, a REST PATCH of an own `attendance_sessions` row is refused
    (`TESTING_CHECKLIST.md` section 3.1 item S14), another member's selfie metadata is not returned (item S15), and an
    anonymous call to any HR RPC is refused.

### Step 7. Connect employee accounts

- [ ] 7.1 Create one auth user per employee through the host's invite flow. Nobody writes a password into a document,
  ticket or chat.
- [ ] 7.2 Create the employee row linked by the unique auth id, with `full_name`, `role_key` and `is_active = true`.
- [ ] 7.3 Grant keys per the decided model. CURRENT gives a new member only a dashboard key
  (`src/lib/authz/team-accounts.ts:350-354`), so nobody gets an HR key by default.
- [ ] 7.4 Set `is_demo` on test accounts at seed time (never by an email pattern, RM-24) and the exemption flag where
  Step 1.6 decided it.
- [ ] 7.5 Deactivate rather than delete. CURRENT ties `is_active` to `deactivated_at` by a check
  (`M/20260715120100:127-130`). RESTRICT foreign keys stop the member-delete function (`M/20260722120000:5-8`): the
  attendance and payslip keys restrict the member whose rows they are (`M/20260717120000:24`; `M/20260722210000:17`),
  while the attachments key restricts the uploader, which for a selfie is the kiosk operator, not the member in the
  photo (`M/20260716300000:95`). PENDING (not live) adds revoking a deactivated account's sessions
  (`M/20260916120000:378-422`).
- [ ] 7.6 Set an effective-dated rate for every employee before the first payroll period.
- Verify:
  - As a kiosk operator, the roster lists exactly the active, non-exempt, non-demo employees (GENERIC; CURRENT also
    lists demo profiles, `M/20260907160000:21-25`).
  - Each role signs in and sees only the pages its keys open; a deactivated account reaches the account-disabled page
    (CURRENT `src/lib/authz/guard.ts:145-147`).
  - Payroll for the first period shows no "No rate set" row for a real employee.

### Step 8. Register the kiosk device and set the camera header

- [ ] 8.1 If `attendance.device.mode` is off, skip 8.2 to 8.6; 8.7 still applies whenever selfies are on.
- [ ] 8.2 Serve the app over HTTPS; the device cookie is `secure` (CURRENT `L/devices.ts:83-89`).
- [ ] 8.3 On the kiosk browser, a Super Admin (or the holder of a device-management permission, if Step 1.4 created
  one) registers the device with a neutral label. CURRENT: the server mints 32 random bytes (`L/devices.ts:75`), the database stores only the sha256 hash
  (`M/20260722150000:52`), and the raw token goes into an httpOnly, secure, sameSite lax cookie on path `/`
  (`L/devices.ts:83-89`). Use a neutral cookie name and `attendance.device.cookieMaxAgeDays`.
- [ ] 8.4 More than one kiosk: raise `attendance.device.maxActiveDevices`. CURRENT registering deactivates every other
  device (RM-31).
- [ ] 8.5 Know the CURRENT gate before relying on it: it turns on only while an active device exists; an error from the
  gating RPC reads as "no gate" (`L/devices.ts:38-42`); revoking the last device switches the gate off. The cookie
  belongs to the browser, so anyone signed in on that browser passes; clearing site data or a private window loses it.
  The full mechanism, the PENDING (not live) change and the generic rules are in `SECURITY.md` section 5.
- [ ] 8.6 RECOMMENDED TEMPLATE IMPROVEMENT: a confirmation before revoke (CURRENT one tap, `C/device-manager.tsx:136-146`).
- [ ] 8.7 Set the response header `Permissions-Policy` so the camera is allowed for the app's own origin. CURRENT value:
  `camera=(self), microphone=(), geolocation=(), payment=(), usb=()` on every response (`next.config.ts:45-48`,
  `:55-56`). A header that denies the camera to the app's own origin (for example `camera=()`), or a
  cross-origin frame without `allow="camera"`, makes `getUserMedia` fail: the kiosk shows "Camera permission was denied
  or unavailable." (`C/attendance-clock.tsx:116-127`) and every clock event falls back to without photo (`:275-286`).
  Keep `camera=(self)` explicit. Whether omitting the header is harmless depends on the browser's default allowlist:
  NEEDS VERIFICATION in a browser.
- [ ] 8.8 If the host sends a Content-Security-Policy (the reference sends none, `next.config.ts:31-35`): NEEDS
  VERIFICATION in a browser that the camera preview works and signed selfie images load from the storage origin.
- Verify:
  - `curl -sI https://<app-host>/sign-in | grep -i permissions-policy` prints a value containing `camera=(self)`.
  - The kiosk browser shows the camera prompt and captures a selfie; the session row has `clock_in_device_id` set.
  - A second, unregistered browser is refused, and an `attendance.blocked_device` audit row with outcome `denied` exists
    (CURRENT `L/attendance.ts:36-42`).
  - GENERIC: a direct clock-in and clock-out RPC call with no or a wrong device token is refused (CURRENT refuses
    nothing in SQL; PENDING (not live) refuses clock-in by id, `TESTING_CHECKLIST.md` section 3.2 item K14).
  - `select label, is_active, revoked_at, length(token_hash) from public.attendance_devices;` shows only 64-character
    hex hashes (sha256), never a raw token.

### Step 9. Wire the UI and the configuration object

- [ ] 9.1 Create the configuration module and validate it at load (`CONFIGURATION.md` section 1.2 proposes
  `src/lib/hr/config.ts` exporting a frozen object). Seed the SQL-evaluated keys into the settings store; SQL is the
  source of truth for those keys (`CONFIGURATION.md` section 1.3). The code template ships this schema as
  `templates/attendance-payroll/config/attendance-payroll.config.ts.example` (type `AttendancePayrollConfig`,
  `validateAttendancePayrollConfig`, `hrSettingsSeedRows`); rename it to `.ts` when copying it into the host.
- [ ] 9.2 Pages for Attendance, Review Attendance and Payroll, each gated on the server by its key, answering
  "not found" when the key is missing (CURRENT `P/attendance/page.tsx:43`, `P/attendance/review/page.tsx:22`,
  `P/payroll/page.tsx:30`). Hiding a link is never the control.
- [ ] 9.3 Navigation: one route-to-key map used by the menu and the pages (CURRENT
  `src/components/shell/navigation.ts:91-93`).
- [ ] 9.4 Components from `UI_UX.md` section 9, built on the host's primitives (dialogs become bottom sheets on phones,
  tables become cards).
- [ ] 9.5 Server actions call domain modules, which call RPCs. Every action re-checks its key. Money stays a string
  end to end (CURRENT `L/payroll.ts:5-9`). Never retry a write: CURRENT retries only GET and HEAD
  (`src/lib/supabase/retry-fetch.ts:58-60`; `src/lib/supabase/server.ts:26-30`). Build each action, reader and RPC
  from `SERVER_API.md`: its CURRENT inventory (sections 2 to 5) gives input, authorization and database effect, and
  its GENERIC interface (section 9, with the error contract in 9.10) is the contract to implement.
- [ ] 9.6 Hide every control the server refuses for that user (CURRENT offers Generate to non-Super-Admins,
  `C/payslip-button.tsx:240-249`).
- [ ] 9.7 Printing and PDF: labels, company block, file-name pattern and page size from configuration (RM-01 to RM-04).
- [ ] 9.8 Optional realtime refresh: subscribe to the HR tables only, under RLS, with a neutral channel name (RM-08,
  RM-09).
- [ ] 9.9 If the host is a PWA: never store HTML navigations or API responses in a service-worker cache (KEEP-GENERIC
  rule, RM-39).
- [ ] 9.10 Authorization sweep test: the write detector matches `.rpc(` as well as insert, update and delete calls, and
  asserts per export, not per file (RECOMMENDED TEMPLATE IMPROVEMENT; CURRENT
  `tests/integration/phase11-authorization-boundary.test.ts:27-31`).
- Verify:
  - Type-check, lint and the unit and UI suites pass (`TESTING_CHECKLIST.md` sections 4.1 and 4.4).
  - Each page URL opened without its key gives "not found"; with the key it renders.
  - An invalid configuration value fails the build or boot.
  - The pre-publish scan (section 1.6) finds no source literal outside the configuration module.

### Step 10. Test the Staff flow

- [ ] 10.1 Run every item of `TESTING_CHECKLIST.md` section 3.1 (currently S1 to S16) on the scratch stack with
  synthetic accounts.
- [ ] 10.2 Run every item of section 3.2 (currently K1 to K18 and K18b) as a Staff member holding
  `attendance.clock_operate` and `attendance.view_team` (CURRENT `hr_attendance` and `hr_review_attendance`). Following
  the introduction of `TESTING_CHECKLIST.md` section 3.2, run K17 and K18b as an operator holding
  `attendance.clock_operate` only (CURRENT `hr_attendance` only), and repeat K5 as that operator for a member other than
  the operator. K17 is the test for the RLS-scoped kiosk status: CURRENT, without `hr_review_attendance` the kiosk shows
  another member's open session as not clocked in and never offers Clock Out for it (`L/attendance.ts:111-146`). K18
  and K18b need a real clock-in at or after 22:00 business time (the reference threshold); record them as not run if
  that hour is not available.
- [ ] 10.3 Must hold for Staff: no HR navigation without keys; direct URLs give "not found"; without
  `payroll.view_all` (CURRENT with `hr_payroll`) only the own payroll row and own payslips; no correct, delete or
  mark-paid control; a direct clock action without `attendance.clock_operate` (CURRENT `hr_attendance`) and a direct
  REST write are refused (GENERIC; the repository definitions allow both, items S13 and
  S14, the second NEEDS VERIFICATION against a live catalog); another member's selfie metadata and bucket objects are
  not readable (item S15; CURRENT readable by every active staff member); payroll money in `audit_events` is not
  readable (item S16; CURRENT readable, PENDING (not live) narrows it).
- Verify: each item recorded PASS or FAIL with evidence; every FAIL is either a build bug or a listed
  RECOMMENDED TEMPLATE IMPROVEMENT that the decision record accepts.

### Step 11. Test the Admin flow

- [ ] 11.1 Run every item of `TESTING_CHECKLIST.md` section 3.3 (currently A1 to A21 and A16b).
- [ ] 11.2 Must hold for Admin: correction validations (reason, not before clock-in, not in the future, no overlap if
  decided); one delete rule across both pages; the request path works end to end or does not exist; payroll
  visibility, mark-paid and rate edits match Step 1.4 in the UI, the action and the database.
- [ ] 11.3 After a correction, the list refreshes without changing filters, while an open details dialog keeps the old
  times until reopened (CURRENT; NEEDS VERIFICATION in a browser).
- Verify: as 10, plus the audit row `attendance.clock_out_corrected` carries old value, new value and reason for each
  correction (CURRENT `L/attendance.ts:447-456`).

### Step 12. Test the Super Admin flow

- [ ] 12.1 Run every item of `TESTING_CHECKLIST.md` section 3.4 (currently SA1 to SA17).
- [ ] 12.2 Must hold for Super Admin: device register and revoke; rate saves append rows and never edit; generate,
  deductions validation, negative-net rule, mark paid (no repeat), payroll summary total; independent key toggles;
  exemption enforced in the RPCs, not only in the roster.
- [ ] 12.3 Run a full payroll period against hand-computed figures before any real payment (see Step 15.10).
- Verify: as 10; the payslip file name and document show only configuration values.

### Step 13. Test desktop and mobile layouts

- [ ] 13.1 Widths 360, 390 and 430 px (phone), 640 px and 768 px portrait (tablet), 1024 px (desktop boundary), 1280 px
  (desktop), plus
  print preview. Follow `UI_UX.md` section 8 and `TESTING_CHECKLIST.md` section 4.5.
- [ ] 13.2 CURRENT layout to check against (computed from CSS classes, not measured; NEEDS VERIFICATION on devices):
  tables turn into cards and dialogs into bottom sheets below 640 px; the sidebar appears at 1024 px; the payroll
  table needs about 900 px and scrolls horizontally on tablets; the payslip keeps two columns at 360 px; several inputs
  are shorter than 44 px; inputs under 16 px text may zoom on iOS (`UI_UX.md` sections 7.1 to 7.4 and 8).
- [ ] 13.3 On a physical phone: the camera prompt and capture in the browser and in installed PWA mode; bottom sheets
  respect the safe area.
- Verify: screenshots at each width with no page-level horizontal scroll (a table wrapper may scroll), every action
  reachable, and a print preview of one payslip and one multi-page payroll summary.

### Step 14. Audit and retention setup

- [ ] 14.1 Keep `audit_events` append-only by trigger and self-attributed on insert (CURRENT `M/20260715120000:115-133`;
  `M/20260715130100:664-670`).
- [ ] 14.2 Event catalogue as `DATABASE.md` section 2.8 (clock in, clock out, blocked device, delete, clock-out
  corrected, device register and revoke, attachment upload, rate set, payslip generated, payslip marked paid).
  CURRENT writes them from the app only, best effort (the writer never throws, `src/lib/audit/log.ts:40-79`).
  RECOMMENDED TEMPLATE IMPROVEMENT: the SQL functions write them too (`DATABASE.md` section 5.11).
- [ ] 14.3 Audit read: narrow to the decided roles; decide whether money amounts go into audit context. CURRENT any
  active staff member reads every event, including rates and net pay (`M/20260715130100:661-662`).
- [ ] 14.4 Correction history: CURRENT keeps only the last editor and reason on the row, with no edit time, and the
  old value only in the audit context. Template: the correction function writes its own append-only audit row with the
  old and new values, reason, editor and time, and that row is the history; there is no separate edit-history table
  (`DATABASE.md` section 5.11). Decide who may read it.
- [ ] 14.5 Selfie retention: agree the number of days with the client. Deletion of stored files may be blocked in SQL
  (CURRENT note on a live-only protect trigger, `scripts/purge-attendance-selfies.mjs:7-8`), so retention is a
  scheduled server job that uses the storage API with a service-role key read from the environment. Keep the safety
  design (dry run by default, a path-prefix guard, skip files still referenced), not the script (RM-33). CURRENT has no
  scheduled job for attendance.
- [ ] 14.6 Deleting a record removes its selfie too, or the orphan is picked up by the retention job (CURRENT orphans
  it, `L/attendance.ts:340-346`).
- [ ] 14.7 Payslips have no delete grant (CURRENT `M/20260722210000:67-68`). The legal retention period for payroll
  records depends on the client's jurisdiction (NEEDS VERIFICATION with the client).
- [ ] 14.8 The service-role key lives only in the job's environment; rotate it if it was ever pasted anywhere.
- Verify:
  - As `authenticated`, an UPDATE or DELETE on `audit_events` fails.
  - Each flow in Steps 10 to 12 left the expected event rows (`TESTING_CHECKLIST.md` section 4.3).
  - The retention job's dry run lists only expired selfie files under the attendance prefix and nothing else.

### Step 15. Go-live checks

Run `SECURITY.md` section 10 (security checklist for adopters) and `TESTING_CHECKLIST.md` section 5 (security
regression) against production as part of this step; the items below are the install-specific checks they do not
repeat, plus the catalog queries of Step 6.

- [ ] 15.1 No anon or PUBLIC EXECUTE on any HR function (Step 6 first query returns zero rows on production).
- [ ] 15.2 Table privileges as in Step 6: nothing for `anon`; no INSERT, UPDATE or DELETE on attendance or payslip
  tables for `authenticated`.
- [ ] 15.3 No public storage bucket: `select id, public from storage.buckets;` shows `public = false` for the selfie
  bucket (CURRENT `M/20260716300000:35-43`).
- [ ] 15.4 Backups: automated backups or point-in-time recovery enabled on the hosting plan, one restore rehearsed on a
  scratch project, and a snapshot taken immediately before go-live (NEEDS VERIFICATION in the host's dashboard).
- [ ] 15.5 Migration history on production equals the files in the client repository; no out-of-band change.
- [ ] 15.6 CI green: type-check, lint, unit, UI, pgTAP. Where CI has no database, file-content tests pin the SQL
  decisions (pattern `tests/unit/security-hardening.test.ts:218-286`).
- [ ] 15.7 Secrets only in the hosting environment. CURRENT HR web code needs no service-role key.
- [ ] 15.8 Demo login disabled in production (CURRENT flag checked at `src/lib/authz/guard.ts:149-154`).
- [ ] 15.9 Device gate mode set as decided, kiosk registered, camera header present on production responses (Step 8).
- [ ] 15.10 Timezone sanity: a clock-in shortly after local midnight gets today's local `work_date`; a first payroll
  period matches hand-computed figures before anyone is paid.
- [ ] 15.11 Multi-factor step-up for payroll writes and access management decided (CURRENT not enforced: `requireAal2`
  exists and is never called, `src/lib/authz/guard.ts:376-392`).
- [ ] 15.12 Legal text (privacy notice, cookie notice) written for the client and naming what this module collects:
  attendance times, selfies if enabled, the device token cookie, rates and payslips (RM-34).
- Verify: every item has a dated PASS with the query output or screenshot stored outside the repository, and nothing
  in that evidence contains a secret or personal data (section 1.5).

---

## 3. Adapting to a different stack

Only the stack-neutral parts of the reference architecture carry over as written:

- Session rows. One row per session with a derived day works on any SQL engine. The one-open-session guarantee needs
  a database constraint, not application code. CURRENT uses a partial unique index; an engine without partial indexes
  needs an equivalent unique constraint (for example on a generated column that is NULL for closed sessions). Prove it
  with two concurrent clock-ins for the same member.
- RPC-first writes. Without Postgres definer functions, put every write in a trusted server layer that holds the only
  write credentials, runs in one transaction, derives the caller from the verified session, checks the key and the
  device inside that transaction, writes the audit row in it, and is never retried automatically. Client roles get read
  access only.
- Payroll computation. One privileged computation holds the pay math and applies the caller filter inside itself
  (eligible AND own row or the view-all key), as `app_private.payroll_lines` does (`DATABASE.md` section 5.13); the
  caller-facing report wraps it and adds no protection. Money stays exact decimals returned as strings, pay is computed
  from sessions at read time, and issued payslips remain frozen rows.
- Identity in SQL. RLS-style policies need the caller's id inside the database for each request. If the stack cannot
  provide it, enforce row filters in the trusted server layer and remove every direct client read path.
- Framework. Server components and server actions map to server-rendered pages plus authenticated endpoints; the page
  gate stays on the server. Check the framework's CSRF protection for form posts (NEEDS VERIFICATION per framework).
- Storage. A private bucket or object store with short-lived signed URLs (CURRENT 300 seconds, minted per read by the
  live reader `listAttendanceSelfiesFor`, `L/attendance.ts:520-560`, at `:546`).
- Realtime refresh is optional and not part of correctness.

## 4. Data migration for clients with existing attendance data

- [ ] 4.1 Inventory the source: punch events (one row per in or out), daily timesheets, or sessions. Only sessions map
  one to one; the other two must be converted.
- [ ] 4.2 Pair punches into sessions per employee in time order. An out with no preceding in goes to an exceptions
  list. Only the most recent unmatched in per employee may be imported as an open session, because the target allows
  one open session per member; older unmatched ins go to exceptions for an audited correction after import.
  Overlapping sessions go to exceptions.
- [ ] 4.3 Convert source local times to `timestamptz` using the client's IANA zone. In zones with daylight saving, list
  local times that fall in a skipped or repeated hour for a human decision.
- [ ] 4.4 Compute `work_date` explicitly as the business-zone date of `time_in`; never rely on a column default.
  CURRENT lesson: the column default was the server's UTC date (`M/20260717120000:25`), which filed early-morning
  clock-ins one day off until the kiosk stamped the business date (`M/20260907120000:3-6`). Cross-midnight sessions
  stay on the clock-in date.
- [ ] 4.5 Imports bypass the kiosk RPCs. Run them as a one-off job with elevated rights in a transaction, on a scratch
  copy first. Leave `clock_in_device_id`, `clock_out_device_id` and the edit and delete columns null. `clock_in_by` is
  NOT NULL and `clock_out_by` must be set exactly when `time_out` is set (check `attendance_sessions_out_pair`,
  `DATABASE.md` section 5.3), so record the profile id of the account that runs the import in both. Selfies, if
  imported, go into the photo store
  with an explicit in or out marker (`DATABASE.md` section 5.7). RECOMMENDED TEMPLATE IMPROVEMENT: tag imported rows
  with an import batch id so they can be found and reversed.
- [ ] 4.6 Night result: the template stores no night flag and has no night trigger; the single predicate
  `app_private.is_night_session` computes it on read (`DATABASE.md` section 5.3), so nothing is recomputed after import.
  Do not import the CURRENT flag columns; the CURRENT BEFORE INSERT trigger (`M/20260722200000:46-49`) fires on insert
  only and would not follow a later rule change.
- [ ] 4.7 Rate history: import each historical rate as its own row with its `effective_date` (append-only). CURRENT
  picks, per employee, the newest row with `effective_date <= period end` and returns a NULL salary ("No rate set")
  when none exists (`M/20260907160000:59-74`, `:86-87`; `C/attendance-view.tsx:202-208`). If only current rates exist,
  the `effective_date` chosen at import decides the outcome: a recent date (for example the import day) leaves every
  earlier period with no rate and a NULL salary; a back-dated date applies the current rate retroactively to every
  period ending on or after it. Choose the date on purpose, record it in the decision record, and do not recompute paid
  periods from imported attendance in either case.
- [ ] 4.8 Historical payslips: import them as frozen snapshots with their original figures and payment status instead
  of regenerating them; rounding and rule differences would change the numbers.
- [ ] 4.9 Reconcile per employee and period: source hours and days against `report_payroll`. CURRENT rounds hours once
  in SQL and per session on screen (`L/sessions.ts:90-91`; `M/20260907160000:79`), so small differences are expected;
  document them.
- [ ] 4.10 Write one audit event per import batch. CURRENT `audit_events.actor_kind` allows `migration`
  (`M/20260715120000:82-83`).
- [ ] 4.11 Keep source files and staging tables inside the client's environment and delete them after sign-off.
  RESTRICT foreign keys mean an employee with imported history cannot be deleted later; deactivate instead.
- Verify: exception lists reviewed and signed off; row counts per employee match the source minus exceptions; at most
  one open session per employee (`select employee_id, count(*) from public.attendance_sessions where time_out is null
  and deleted_at is null group by 1 having count(*) > 1;` returns zero rows); reconciliation report stored with the
  decision record.

## 5. NEEDS VERIFICATION items this guide depends on

| Item | Why the repository cannot settle it | What would settle it |
|---|---|---|
| Code template on the host stack | Verified only on a throwaway PostgreSQL 17 database with the 0000 stub | Replace 0000 and run 0008 on a scratch copy of the host stack |
| Live value of `app_private.night_ot_bonus()` and live night trigger | RECONSTRUCTED; UI copy says 300 | `pg_get_functiondef` on the reference's own project, run by its owner |
| Whether a repository-only schema build fails | Not run | A database reset from repository migrations on a scratch stack |
| Live EXECUTE grants on `report_payroll` | Re-created out of band | `proacl` for that function on the reference's own project |
| Live write grants and policies on `attendance_records` (Step 6.2) | A payroll-grants migration has no repo file | Step 6 Verify queries, run by the reference's owner |
| Whether the migration runner wraps each file in a transaction | Runner-specific | The runner's documentation, or a deliberate failing file on scratch |
| Definer function owner bypasses RLS on the target stack | Role attributes are not in migrations | `rolbypassrls` of each function's owner (`pg_proc.proowner` joined to `pg_roles`) |
| Camera under a Content-Security-Policy and in installed PWA mode | The reference sends no CSP; no device evidence | Browser test on the target host and a physical phone |
| Print pagination of a long payroll summary | `position: fixed` print container | Print preview with more rows than one page |
| Backup and restore capability of the hosting plan | Hosting settings are not in the repository | The host's dashboard and a restore rehearsal |
| Legal retention periods for selfies and payroll records | Jurisdiction-specific | The client's legal counsel |
