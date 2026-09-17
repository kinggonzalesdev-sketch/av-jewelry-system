# Attendance, Review Attendance and Payroll Template (Phases 1 and 15)

This folder is a documented, generalized extraction of a working Attendance (kiosk clocking), Review Attendance and
Payroll module, written so that systems for other clients can reuse the same architecture: Next.js App Router with
server actions, Supabase Postgres behind row-level security, SECURITY DEFINER RPCs with `set search_path = ''`, and
authorization helpers in the `app_private` schema. This README is the entry point: it states the scope, indexes the
documents, proposes a standalone module layout mapped to the real source files, records the state of the reference
implementation, and lists the defects the template must fix.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, with a `file:line` citation. |
| GENERIC | The reusable form proposed for the template. |
| PROJECT-SPECIFIC | Tied to the source business; each document lists and removes these values. |
| CONFIGURABLE | Should become a client setting (see [CONFIGURATION.md](CONFIGURATION.md)). |
| NEEDS VERIFICATION | The repository cannot settle it; the text says what would. |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository. |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation the template should fix. Never a change to production. |

Roles: the database role keys are `owner`, `selected_admin` and `staff`; the UI calls them Super Admin (role key
`owner`), Admin and Staff. Citations are repository-relative; migrations in `supabase/migrations/` are cited by their
timestamp prefix (for example `20260907160000:9-27`). Defect ids D1 to D15 are defined in section 6.

Ids are local to each document. The same letter and number can mean different things in different files (for example
README D ids and TESTING_CHECKLIST D ids; the R, V, A, S, T, P and B ids of DATABASE, IMPLEMENTATION_PROMPT, SERVER_API,
SECURITY, BUSINESS_RULES and TESTING_CHECKLIST). A reference to another document's id always names that document, for
example "IMPLEMENTATION_PROMPT.md R7" or "TESTING_CHECKLIST.md D5"; an id without a document name is local.

## 1. What this template is, and what it is not

It is: a description of a module running in production for one client, with behaviour tied to code, plus a GENERIC
model, a configuration schema, a testing checklist and an implementation prompt. A reference code folder,
`templates/attendance-payroll/`, holds generic SQL migrations `0000_prerequisites_example.sql` to `0007_payroll.sql`, a
self-test `0008_selftest.sql`, `config/attendance-payroll.config.ts.example` and `config/example.client.config.json`.
All nine SQL files were applied in order to a throwaway PostgreSQL 17 database and the self-test completed without
error. The folder implements a subset of [DATABASE.md](DATABASE.md) section 5; its `README.md` lists the choices it makes
beyond these documents (section 3) and what it does not build (section 9). Section 8 of this README lists where these
documents deliberately differ from that code.

It is not: a move or copy of production code. Nothing in `src/`, `supabase/`, `tests/` or the configuration of the source
system was changed, applied, deployed or queried. RECONSTRUCTED objects are inferred descriptions, not verified DDL.

Key facts of the reference module (CURRENT):

- Clocking is a shared kiosk, not self-service: a signed-in operator who holds `hr_attendance` picks a member from
  `list_clock_staff` and clocks that member (`src/components/hr/attendance-clock.tsx:145-150`; `20260907160000:9-27`).
- `attendance_records` holds one row per session; one open session per member is enforced by a unique partial index
  (`20260717120000:43-45`); `work_date` is the business-timezone date at clock-in (`20260907120000:40-47`).
- A day's total is the sum of its completed sessions (`src/lib/hr/sessions.ts:90-91`; `20260907160000:39-49`).
- Two different night rules: a session flag set by a BEFORE INSERT trigger when the clock-in hour is >= 22 (flat
  300.00, `20260722200000:26-49`), and a payroll count of distinct `work_date`s with a clock-out at or after 22:00,
  multiplied by `app_private.night_ot_bonus()` (`20260907160000:41`, `:53-55`).
- Pay = `round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2)`, NULL without a rate (`20260907160000:86-93`).
- Deductions are one lump sum >= 0 entered at payslip generation (`src/lib/hr/payslip-actions.ts:48-55`). A payslip is a
  frozen `payroll_snapshots` row whose `payment_status` goes pending -> paid (`20260722210000:29-30`;
  `src/lib/hr/payslip-actions.ts:124-135`).
- No approval or finalization step for attendance and no period lock (`src/components/hr/review-attendance-view.tsx:70-71`).
- Only the clock-out can be corrected: Super Admin or Admin by role, reason required, updated in place; the old value
  survives only in a best-effort application audit event (`20260907130000:29-61`; `src/lib/hr/attendance.ts:447-456`).
  Delete is a hard delete through a RECONSTRUCTED RPC (`src/lib/hr/attendance.ts:341-370`).
- Device approval stores the hash of a random token kept in an httpOnly cookie (`src/lib/hr/devices.ts:75-89`;
  `20260722150000:50-53`), is enforced only in server TypeScript (`src/lib/hr/attendance.ts:28-48`), fails open while
  no device is registered, and PENDING adds a clock-in check in the RPC.
- Super Admins are excluded from the roster and payroll (`20260907160000:24`, `:99`). Demo accounts are excluded from
  payroll and refused as a clock-in target (`20260907120000:30-37`), but the roster still lists them (D7).

## 2. Scope matrix

Cell legend: "with K", "with R", "with P" = only with an explicit grant of `hr_attendance`, `hr_review_attendance` or
`hr_payroll`; "role" = allowed by role title, no key checked; "implicit" = the Super Admin holds every key
(`20260716240000:26-44`). Each D id is carried into the template as a RECOMMENDED TEMPLATE IMPROVEMENT.

| # | Capability | Staff | Admin | Super Admin | Status |
|---|---|---|---|---|---|
| 1 | Operate the kiosk: clock a selected member in or out | with K (page, roster); the write checks only an active session | as Staff | implicit | CURRENT (D1, D3, D6) |
| 2 | Be listed on the roster and be clocked | yes, if active | yes, if active | no: excluded | CURRENT (D7) |
| 3 | Selfie at clock in and clock out | optional, uploaded after the clock action | as Staff | as Staff | CURRENT (D14) |
| 4 | View own attendance history | with K (page); own rows by RLS | as Staff | implicit, all rows | CURRENT |
| 5 | View team history, today cards, staff filter | with R; other names show blank | as Staff | implicit | CURRENT (D5) |
| 6 | Review page: day details and selfies | with R | with R | implicit | CURRENT (D5, D14) |
| 7 | Correct a clock-out, reason required | no in the app; own rows writable by REST | role (screen needs R) | role | CURRENT (D2, D10, D11) |
| 8 | Correct a clock-in or add a missed session | no | no | no | Not supported; engine rule, not a setting; a separate audited RPC if a client needs it |
| 9 | Delete a record (hard delete, type DELETE) | no | role: direct on Review, request on Attendance | role | CURRENT (D9) |
| 10 | Approve attendance or lock a period before payroll | no | no | no | Not supported; RECOMMENDED TEMPLATE IMPROVEMENT (optional) |
| 11 | Register or revoke the approved kiosk device | no | no | role | CURRENT (D3) |
| 12 | View own payroll row and own payslips | no own-pay screen; with P the Payroll page shows own row only | as Staff | not on payroll | Partial; RECOMMENDED TEMPLATE IMPROVEMENT |
| 13 | View every employee's payroll | no | no (page shows manager controls) | yes | CURRENT (D8) |
| 14 | Edit a daily salary rate (effective-dated) | no | tab shown; list self-only; RPC gate RECONSTRUCTED | yes (RPC RECONSTRUCTED) | CURRENT (D8, D13) |
| 15 | Generate a payslip with lump-sum deductions | no | no (form shown, server refuses) | role | CURRENT (D8, D12) |
| 16 | Mark a payslip paid | no | TypeScript allows; repository RLS refuses | role | CURRENT (D8); live policy NEEDS VERIFICATION |
| 17 | Void or un-pay a payslip | no | no | no | Not supported; see PAYROLL.md section 12 |
| 18 | Print the payroll summary | no | no | yes (UI-only gate) | CURRENT (D12) |
| 19 | Print or download a payslip PDF | own, with P | as Staff | all | CURRENT |
| 20 | Export attendance and payroll sheets | no (route 403) | role; rows RLS-scoped | role; all rows | CURRENT |
| 21 | Grant or revoke the three HR keys | no | no | role | CURRENT |

Evidence per row: 1 `src/app/(app)/admin/attendance/page.tsx:43`, `src/lib/hr/attendance.ts:158`, `:211`,
`20260907120000:25-28`; 2 `20260907160000:21-25`; 3 `src/components/hr/attendance-clock.tsx:157-176`;
4 `20260804140000:8-14`; 5 `src/app/(app)/admin/attendance/page.tsx:49`, `20260821140000:21-22`;
6 `src/app/(app)/admin/attendance/review/page.tsx:22`, `src/lib/hr/actions.ts:45-50`; 7 `20260907130000:29-33`,
`src/app/(app)/admin/attendance/review/page.tsx:36`; 9 `src/lib/hr/attendance.ts:352`, `src/lib/hr/actions.ts:146-148`;
10 `20260907160000:42-44`; 11 `src/lib/hr/devices.ts:69`, `20260722150000:46-48`; 12 `src/app/(app)/admin/payroll/page.tsx:30`,
`20260907160000:100`, `20260722210000:51-55`; 13-14 `src/app/(app)/admin/payroll/page.tsx:43-44`,
`src/components/hr/attendance-view.tsx:182-196`, `src/lib/hr/rate.ts:201-231`; 15 `src/lib/hr/payslip-actions.ts:28`;
16 `src/lib/hr/payslip-actions.ts:106`, `20260722210000:62-65`; 18 `src/components/hr/attendance-view.tsx:98-105`;
19 `src/components/hr/payslip-button.tsx:223-233`; 20 `src/app/api/export/all/route.ts:15-25`;
21 `src/lib/authz/team-accounts.ts:228-236`. Full matrix per enforcement layer: [PERMISSIONS.md](PERMISSIONS.md) section 3.

Staff and their own pay: there is no self-service payroll or payslip screen. A Staff member granted `hr_payroll` opens
the manager's Payroll page and sees only their own row, because `report_payroll` returns self rows to non-owners
(`20260907160000:100`) and snapshots are readable by their employee or the Super Admin (`20260722210000:51-55`).

## 3. Document index

Phases: the template was produced in 17 phases. Phase 1 is the read-only extraction of the reference implementation
(section 7 of this README); the other phases map to the documents below.

| Phase | File | Purpose |
|---|---|---|
| 1, 15 | README.md (this file) | Phase 1: extraction method and evidence (section 7). Phase 15: scope, index, module structure, status, defects, known differences from the code template (section 8). |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | Request path per screen (route, page gate, server action, domain module, RPC, RLS) and how the parts connect. |
| 3 | [PERMISSIONS.md](PERMISSIONS.md) | Role model, the three keys, the capability matrix per layer, GENERIC keys and default grant sets. |
| 4 | [DATABASE.md](DATABASE.md) | Tables, indexes, triggers, RLS, grants and SQL functions as CURRENT, the drift map, and the GENERIC data model. |
| 5, 6 | [BUSINESS_RULES.md](BUSINESS_RULES.md) | Clocking, sessions, `work_date`, device, selfie, correction and deletion rules (Part A), review workflow (Part B). |
| 7 | [PAYROLL.md](PAYROLL.md) | Pay period, rate source, hours, night bonus, deductions, gross and net, payslips, exclusions, engine interface. |
| 8, 9 | [UI_UX.md](UI_UX.md) | Screens, components, status visuals, interactions, accessibility, responsive guidance, reusable components. |
| 10 | [SERVER_API.md](SERVER_API.md) | Per server action, reader and RPC: input, authorization, action, database effect, output. |
| 11, 12 | [SECURITY.md](SECURITY.md) | Checks that must never be frontend-only, device approval, REST write exposure, selfie and audit privacy. |
| 13 | [CONFIGURATION.md](CONFIGURATION.md) | Engine versus client settings: schema, map of hardcoded values to keys, values fixed by design. |
| 14, 16 | [INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md) | Installing the module in a host app (Phase 14) and the install checklist (Phase 16). |
| 16 | [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) | Existing tests, required tests, manual scripts per role, automated plan, security regression list. |
| 17 | [IMPLEMENTATION_PROMPT.md](IMPLEMENTATION_PROMPT.md) | One copy-paste prompt for an AI agent to build the module elsewhere; free of source-business detail. |
| 15 | `templates/attendance-payroll/` | Reference SQL migrations 0000 to 0007 (0000 is an example stub the host replaces), a scratch-only self-test 0008 and the configuration schema as `config/attendance-payroll.config.ts.example`; see its `README.md`. |

The TypeScript file is shipped as `attendance-payroll.config.ts.example` on purpose: `tsconfig.json:35` includes every
`**/*.ts` and `eslint.config.mjs:51-59` does not ignore `templates/`, so a `.ts` file there would be type-checked, linted
and built with the host. Rename it to `.ts` only when copying it into an adopting project. The SQL files are not
migrations of this repository, which keeps migrations flat in `supabase/migrations/`.

## 4. Proposed standalone module structure (Phase 15)

Adapted to this stack: modules live under `src/` so the existing `@/*` alias (`tsconfig.json:29-31`) resolves them.
`server/` holds `'use server'` actions and `server-only` writes, `queries/` server-only readers, `utils/` pure helpers
without I/O, `config/` the typed settings of CONFIGURATION.md. The three route files stay in the host as thin wrappers:
`src/app/(app)/admin/attendance/page.tsx`, `src/app/(app)/admin/attendance/review/page.tsx`,
`src/app/(app)/admin/payroll/page.tsx`. The code folder keeps its migrations flat and numbered, in apply order: 0000
(replace with the host identity layer), 0001 settings, 0002 audit, 0003 sessions, 0004 devices, 0005 photos, 0006
attendance functions, 0007 payroll; 0008 runs only on a scratch database and ends in ROLLBACK.

```text
src/modules/
  attendance/          components/ server/ queries/ types/ utils/ config/
  attendance-review/   components/ server/ queries/ types/ utils/ config/   (imports attendance types, utils, queries)
  payroll/             components/ server/ queries/ types/ utils/ config/   (attendance data via SQL; shares format.ts)
templates/attendance-payroll/
  README.md
  migrations/          0000_prerequisites_example.sql ... 0008_selftest.sql (flat)
  config/              attendance-payroll.config.ts.example, example.client.config.json
```

CURRENT origin of each folder:

- attendance: components `src/components/hr/attendance-clock.tsx`, `attendance-records.tsx`, `attendance-day-details.tsx`
  (its delete control calls review actions), `attendance-summary-cards.tsx`, `device-manager.tsx`, and the banner inline
  at `src/app/(app)/admin/attendance/page.tsx:91-105`. Server: `src/lib/hr/actions.ts:57-64`, `:81-132` (clock, device,
  page loader), `src/lib/hr/attendance.ts:28-48`, `:154-237` (device gate, kiosk in and out), `src/lib/hr/devices.ts`,
  `src/lib/hr/action-state.ts`. Queries: `src/lib/hr/attendance.ts:96-146` (roster, open sessions, last clock-out),
  `:596-681` (page reader, today's staff). Types: `src/lib/hr/attendance.ts:57-88`, `src/lib/hr/attendance-paging.ts:18-38`,
  `src/lib/hr/sessions.ts:19-52`. Utils: `attendance-paging.ts`, `sessions.ts`, `format.ts` in `src/lib/hr/`. Config:
  none today; hardcoded page sizes (`src/lib/hr/attendance-paging.ts:14-16`), timezone and fixed offset (`:41-43`),
  device cookie name and lifetime (`src/lib/hr/devices.ts:27`, `:83-89`).
- attendance-review: components `src/components/hr/review-attendance-view.tsx` (workspace, day modal, selfies,
  correction and delete; 894 lines to split). Server: `src/lib/hr/actions.ts:45-50`, `:72-79`, `:139-204`;
  `src/lib/hr/attendance.ts:348-458` (delete, correct). Queries and types: `src/lib/hr/attendance.ts:463-466`, `:520-560`
  (selfie reader). Config: status tabs and default range (`src/components/hr/review-attendance-view.tsx:72-92`), the
  typed confirmation word (`src/lib/hr/actions.ts:146`).
- payroll: components `src/components/hr/payroll-tabs.tsx`, `attendance-view.tsx` (the payroll table, misnamed),
  `employee-rates-view.tsx`, `payslip-button.tsx`, `payroll-summary-button.tsx`. Server: `src/lib/hr/payslip-actions.ts`,
  `src/lib/hr/actions.ts:210-228` (sets the daily rate despite its name), `src/lib/hr/rate.ts:201-244`. Queries:
  `src/lib/hr/payroll.ts:38`, `src/lib/hr/payslip.ts:61`, `src/lib/hr/rate.ts:128`. Types and utils:
  `src/lib/hr/payslip-types.ts`, `src/lib/hr/payslip-pdf.ts`, `src/lib/hr/payslip.ts:19`. Config: frequencies
  (`src/lib/hr/rate.ts:213-216`), default period (`src/app/(app)/admin/payroll/page.tsx:32-34`), document branding and
  file name (`src/lib/hr/payslip-pdf.ts:44-49`).
- attendance migrations (code template 0003 to 0006): `20260717120000` (table, index, RLS), `20260722150000`,
  `20260722170000`, `20260722180000` (devices), `20260722200000` (night trigger, selfie entity type),
  `20260729120000:32-34` (keys), `20260804140000`, `20260805160000`, `20260806260000:17`, `:33-34`, `20260907120000`,
  `20260907130000`, `20260907160000:9-27`; plus RECONSTRUCTED `kiosk_clock_out`, `delete_attendance_record` and the
  `time_in` index.
- payroll migrations (code template 0007): `20260717120000:85-130`, `20260721100000`, `20260722160000` (earlier
  `report_payroll` bodies), `20260722210000` (snapshots), `20260907160000:29-102`; plus the RECONSTRUCTED payroll objects
  of section 5.

Not ported (no caller in `src/`): `src/lib/hr/attendance.ts:240-339`, `:477-512`, `:687-700`,
`src/lib/hr/attendance-paging.ts:182-185`, `src/lib/hr/rate.ts:31-109`. Host services stay in the host: authz guard,
the user-scoped client that never retries POST (`src/lib/supabase/server.ts:26-30`), audit writer, attachments, the
approval flow that executes deletes in `src/lib/fulfillment/service.ts:735-739`, money display, export sheets
(`src/lib/export/data-export.ts:522-602`), navigation keys (`src/components/shell/navigation.ts:91-93`), the camera
Permissions-Policy header (`next.config.ts:45-48`) and the business-date helper in `src/lib/format/`. See
[INTEGRATION_GUIDE.md](INTEGRATION_GUIDE.md).

## 5. Reference implementation status

Migration drift: of the 20 attendance and payroll migration names in the production history supplied for this
extraction, 8 have no file in `supabase/migrations/`. Their objects are RECONSTRUCTED (mapped by name and call site):

| Production name | RECONSTRUCTED objects | Evidence |
|---|---|---|
| `attendance_record_delete` | `public.delete_attendance_record(uuid)` | `src/lib/hr/attendance.ts:368-370` |
| `staff_hourly_rate_history` | `public.staff_hourly_rates`, `public.set_staff_hourly_rate(...)` (legacy, dead caller) | `src/lib/hr/rate.ts:83-88` |
| `payroll_paidby_and_kiosk_clock` | `payroll_snapshots.paid_at`, `paid_by`; by name, `public.kiosk_clock_out(uuid)` | `src/lib/hr/payslip-actions.ts:129-130` |
| `fix_payroll_grants_and_delete_all_where` | content unknown; NEEDS VERIFICATION | none in the repository |
| `salary_rate_daily_weekly_with_night_ot` | `public.staff_salary_rates`, `public.set_staff_salary_rate(...)`, `app_private.night_ot_bonus()` | `20260907160000:59-93` |
| `payslip_daily_rate_basis` | `payroll_snapshots.daily_rate`, `days_worked`, `night_shifts`, `rate_basis`; live payslip body | `src/lib/hr/payslip.ts:31-53` |
| `payroll_night_bonus_once_per_day` | an intermediate `report_payroll` body, superseded | `20260907160000:53-55` |
| `attendance_records_time_in_idx` | an index on `attendance_records`, definition unknown | `src/lib/hr/attendance.ts:615-616` |

A rebuild from the repository is expected to fail (NEEDS VERIFICATION on a scratch stack): `20260907160000:29-30`
changes the result shape of `report_payroll` with CREATE OR REPLACE and uses objects no repository migration creates;
the repository `generate_payslip_snapshot` selects a removed column (`20260722210000:97`). The live night trigger and the
attendance and snapshot policies may differ (NEEDS VERIFICATION). The rationale for 22:00, 300.00, the 8-hour display
threshold and deductions is not in the repository; `app_private.provisional_fields` rows mark them provisional
(`20260717120000:138-141`; `20260722200000:70-73`; `20260722210000:137-142`).

PENDING (not live) content that touches this module:

| Migration and section | Change | Lines |
|---|---|---|
| `20260916120000` section 1 | `current_staff_role()` returns `'inactive'` for a deactivated profile | `:46-57` |
| `20260916120000` section 2 | revoke PUBLIC and anon EXECUTE on every public SECURITY DEFINER function; grants nothing | `:76-110` |
| `20260916120000` section 6 | `audit_events` read limited to Super Admin, Admin, `view_settings` holders, plus one non-HR entity type | `:290-298` |
| `20260916120000` section 8 | `attendance_records.work_date` default becomes the business-timezone date | `:367-368` |
| `20260916120000` section 9 | `revoke_staff_sessions(uuid)` and a one-off logout of deactivated accounts | `:378-422` |
| `20260916120000` section 10 | `kiosk_clock_in` refuses a missing, unknown or revoked device id while any device is active | `:435-488` |
| `20260916130000` | `audit_events_occurred_at_idx` only | `:12-13` |
| `20260917120000` | no attendance or payroll object | n/a |

The PENDING SQL is pinned only by a file-content test (`tests/unit/security-hardening.test.ts:218-286`).

## 6. Known defects the template must fix

Each item is a RECOMMENDED TEMPLATE IMPROVEMENT; the linked documents hold the details and the fix.

1. D1 Kiosk write not permission-gated: the key gates page and roster only (`src/lib/hr/attendance.ts:158`;
   `20260907120000:25-28`). PERMISSIONS.md section 6, SECURITY.md.
2. D2 Own attendance rows, night columns included, can be inserted and updated by REST (`20260717120000:59-75`); live
   grants NEEDS VERIFICATION. SECURITY.md, DATABASE.md section 9.
3. D3 Device approval is app-only and fails open on an RPC error (`src/lib/hr/devices.ts:38-42`); clock-out has no
   device argument; PENDING binds clock-in to a device id staff can read (`20260916120000:431-432`). SECURITY.md.
4. D4 The two night rules disagree; a session ending after midnight shows the flag but earns no payroll bonus
   (`20260722200000:34-37`; `20260907160000:41`). BUSINESS_RULES.md, PAYROLL.md section 4.
5. D5 Non-owner reviewers see blank names (`src/lib/hr/attendance.ts:562-563`; `20260821140000:21-22`). PERMISSIONS.md.
6. D6 Kiosk status is RLS-limited, so operators without `hr_review_attendance` never get Clock Out for others
   (`src/lib/hr/attendance.ts:111-146`). UI_UX.md section 10, PERMISSIONS.md.
7. D7 `kiosk_clock_in` accepts a Super Admin id; the roster lists demo accounts the RPC refuses
   (`20260907160000:21-25`; `20260907120000:30-37`). BUSINESS_RULES.md, PERMISSIONS.md.
8. D8 Admin payroll controls do not match the data layer: self-only rows, generate refused, mark-paid TypeScript versus
   RLS, unguarded rate path (`src/app/(app)/admin/payroll/page.tsx:43-44`; `20260722210000:62-65`). PAYROLL.md.
9. D9 Delete differs by page; its request key is absent from the Manage Access catalogue and granted by no migration,
   grantable only on the legacy Super Admin console reachable by URL, so the Admin request fails by default on a fresh
   install (`src/components/hr/attendance-day-details.tsx:138-150`; `src/components/hr/review-attendance-view.tsx:624-629`;
   `src/components/admin/staff-console.tsx:35`); the hard delete orphans selfies. PERMISSIONS.md.
10. D10 Deactivated accounts pass role gates: `current_staff_role()` and `current_staff_id()` ignore `is_active`
    (`20260715130000:28-58`); PENDING fixes only the role helper. PERMISSIONS.md, SECURITY.md.
11. D11 Correction gaps: minute-precision input refuses or truncates an unchanged save
    (`src/components/hr/review-attendance-view.tsx:674-679`); no overlap check, row lock or period lock; only the last
    editor and reason kept. BUSINESS_RULES.md, UI_UX.md.
12. D12 No unique payslip per employee and period, no freeze trigger, no `net_salary` check (`20260722210000:15-68`);
    a negative net corrupts the printed total (`src/components/hr/payroll-summary-button.tsx:31-36`). PAYROLL.md, DATABASE.md.
13. D13 One rate per period as of its end date, a future-dated rate shown as current, a decorative pay frequency
    (`20260907160000:59-74`; `src/lib/hr/rate.ts:139-143`). PAYROLL.md section 2.
14. D14 Selfies readable by any active staff member and attachable to any record (`20260716300000:127-142`, `:159-165`),
    in and out told apart by file name (`src/lib/hr/attendance.ts:505`), no retention job; payroll money in
    `audit_events` readable by all staff until PENDING section 6 (`20260715130100:661-662`). SECURITY.md.
15. D15 Schema not rebuildable from the repository (section 5); pgTAP suite 26 asserts a removed column
    (`supabase/tests/26_hr_attendance.test.sql:142-148`); the authorization sweep ignores `.rpc(` writers
    (`tests/integration/phase11-authorization-boundary.test.ts:27-31`). DATABASE.md, TESTING_CHECKLIST.md.

## 7. Extraction method, date and verification caveat

Extracted on 2026-09-17 from the reference repository at commit `c31af2b`. Seven read-only notes covered clocking,
review, payroll, roles and security, UI and UX, the database, and configuration with coupling and tests; an eighth critic
pass corrected them and spot-checked 45 citations. The citations in this README were re-read before writing. Personal
data, production identifiers, secrets and per-person salary figures were left out; brand, currency and timezone values
appear only in the PROJECT-SPECIFIC lists of the other documents.

Caveat: documented from code, migrations, tests and the notes; no database, hosted project or deployment was queried,
so the live catalog may differ wherever a RECONSTRUCTED object or drift migration is involved. Read-only catalog queries
that settle open items: [DATABASE.md](DATABASE.md) section 8, [PERMISSIONS.md](PERMISSIONS.md) section 8 and
[TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) section 6. They settle CURRENT facts only when run against the reference
implementation's own database, read-only, by the person responsible for it; on a new client's project the same queries
serve as post-install checks of the template's own policies and grants.

## 8. Known differences between these documents and the code template

The code template (`templates/attendance-payroll/`) implements a subset of these documents; its `README.md` lists the
objects it does not build (section 9) and the choices it makes where the documents leave a detail open (section 3).
Where a document deliberately describes something the code does differently, the difference is listed here instead of
being left silent. No other deliberate difference is known. The documents also describe CURRENT behaviour of the
reference implementation and optional modules the code does not build; neither is listed here. TESTING_CHECKLIST.md
keeps some reference names in its items and maps them to the template names at the start of its section 4.

| Subject | Documents | Code template |
|---|---|---|
| Refusal audit rows | Each function takes a typed refusal (path (a)) or a raise (path (b)) (`DATABASE.md` section 5.13; `IMPLEMENTATION_PROMPT.md` B12, Q23). | Path (b) everywhere: a refused direct RPC call leaves no audit row; the server layer writes it. |
| Negative net | `IMPLEMENTATION_PROMPT.md` P12 has the install add `check (net_salary >= 0)` while `payroll.allowNegativeNet` is false; `DATABASE.md` section 5.9 leaves the CHECK to the client. | `generate_payslip_snapshot` refuses a negative net; the CHECK is a commented option, not installed. |
| Paid date | `IMPLEMENTATION_PROMPT.md` P15 and `SERVER_API.md` section 9.8 honour a chosen date only when `payroll.paidDateEditable` is true. | `mark_payslip_paid` accepts any date not after business today; the server action enforces `payroll.paidDateEditable`. |
| Night bonus on a short day | `IMPLEMENTATION_PROMPT.md` Q7 asks the client whether a night bonus counts on a day below `payroll.minHoursForDay`. | Counted on every night day. |
| Photo reads | Subject or `attendance.review` (`IMPLEMENTATION_PROMPT.md` PH5; `SECURITY.md` section 6.3). | The policy also needs `attendance.view_team` for other members' photos, because its subquery runs under the sessions RLS (`DATABASE.md` section 5.7). |
| `service_role` EXECUTE | `INTEGRATION_GUIDE.md` Step 6.5 adds `service_role` only where a server job needs it. | Every function granted to `authenticated` is also granted to `service_role`. |
| Configuration validation | `IMPLEMENTATION_PROMPT.md` V1 to V12, including V11 "logoText unless logoUrl is set". | `validateAttendancePayrollConfig` implements `CONFIGURATION.md` section 2.9 (rule 12 requires `logoText` even with `logoUrl`) plus store and engine checks; V1, V2, V6 (`maxSessionHours`), the V11 file-name tokens and V12 are not checked. |
| Optional modules | Day approval, the period lock, itemized deductions, required photos, self-service clocking and the runtime settings editor are options a build may add (`DATABASE.md` sections 5.5, 5.10, 5.12, 5.13). | Not built; the settings store and the validator refuse the values that would need them. |
| Storage | Bucket, object policies, signed upload URLs and the retention job (`DATABASE.md` section 5.7; `IMPLEMENTATION_PROMPT.md` PH4 to PH6). | Not built; `0005_attendance_photos.sql` describes them in its header. |
