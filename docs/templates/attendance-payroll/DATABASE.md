# Attendance and Payroll Template: Database (Phase 4)

This document is Phase 4 of the attendance and payroll template. It records the database layer of the
reference implementation (tables, columns, keys, indexes, triggers, row-level security, grants and SQL
functions) as far as the repository can establish it, maps which live objects were never captured in a
migration file, separates the reusable parts from the parts tied to the source business, and proposes a
generic data model that keeps the same architecture. The audience is a team building Attendance, Review
Attendance and Payroll for another client on Next.js (App Router, server actions) and Supabase Postgres
(RLS, SECURITY DEFINER functions with `set search_path = ''`, helpers in schema `app_private`).

## How to read this

Every statement carries one of these labels.

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, cited as `file:line` against the repository. |
| GENERIC | The reusable form of a rule or object. |
| PROJECT-SPECIFIC | Tied to the source business. Concrete values are named only in section 11 (one exception below the table). |
| CONFIGURABLE | Should become a client setting. Setting keys and defaults are defined in `CONFIGURATION.md`. |
| NEEDS VERIFICATION | The repository cannot settle it. The text names the query or run that would (section 8). |
| RECONSTRUCTED | A live object whose DDL is missing from the repository; its shape is inferred from its callers. |
| PENDING (not live) | Content of migrations `20260916120000`, `20260916130000` or `20260917120000`: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template should fix. Never a production change. |

Exception to the PROJECT-SPECIFIC rule: the shared key facts and some CURRENT descriptions also quote the session night
flag's 22 hour threshold and 300.00 amount and the payroll night rule's 22:00 threshold, because every document of this
set states them; they are PROJECT-SPECIFIC in those places too.

Conventions:

- `M/<prefix>` abbreviates a file in `supabase/migrations/`; section 1.2 gives every full file name. One
  basename embeds a business value, so that file is cited only as `M/20260907120000` (the kiosk clock-in
  migration) and its basename appears in section 11.
- A citation such as `M/20260717120000:43-45` means lines 43 to 45 of that migration. Application
  citations are repository-relative, for example `src/lib/hr/attendance.ts:28-48`.
- Roles. Database role keys are `owner`, `selected_admin` and `staff`. The user interface calls them
  Super Admin (role key owner), Admin (role key selected_admin) and Staff (role key staff). After this
  paragraph the text says Super Admin, Admin and Staff, and uses the raw key only inside SQL.
- CURRENT permission keys: `hr_attendance` (open the Attendance clock page and read the clock roster),
  `hr_review_attendance` (open Review Attendance and read every attendance row), `hr_payroll` (open
  Payroll). The generic model uses the template keys of `PERMISSIONS.md` section 4.2; the mapping is in
  section 5.1.
- SQL is quoted verbatim except that comments are omitted and the business-timezone literal is written
  `<business-tz>`. Amounts are written without a currency.
- `R1` to `R16` identify RECONSTRUCTED objects (section 1.3) and `V1` to `V20` identify verification
  queries (section 8). Both id sets are local to this document.
- Section 5 is a proposal. Nothing in it exists in the reference implementation unless the text says so.
- This file contains no backslash character. Regular expressions are described in words.

Key facts (CURRENT). Every document in this folder states these the same way:

- Clocking is a shared kiosk, not self-service: a signed-in operator who holds `hr_attendance` picks a
  member from `list_clock_staff()` and clocks that member in or out through `kiosk_clock_in` /
  `kiosk_clock_out`. The SQL write itself checks only that the operator is active staff (section 3.2).
- One row of `attendance_records` is one session. A member has at most one open session, enforced by the
  partial unique index `attendance_one_open_session_per_staff` (section 2.1).
- `work_date` is the business-timezone date at clock-in, stamped by `kiosk_clock_in` (`M/20260907120000:45`).
  A day's total is the sum of its completed sessions; a day is not stored.
- Two different night rules exist. Session flag: clock-in hour at or after 22 gives a flat 300, set by a
  BEFORE INSERT trigger (`M/20260722200000:26-49`). Payroll: the count of distinct `work_date` values with a
  clock-out at or after 22:00, times `app_private.night_ot_bonus()` (`M/20260907160000:41, 53-55, 85-93`).
- Pay is `round(days_worked x daily_rate + night_shifts x night_ot_bonus(), 2)`, or null when no rate
  exists (`M/20260907160000:86-93`).
- Deductions are one lump sum, at least 0, entered when the payslip is generated. A payslip is a frozen
  `payroll_snapshots` row whose `payment_status` moves from `pending` to `paid`.
- There is no attendance approval or finalization step and no period lock.
- Only the clock-out can be corrected: by Super Admin or Admin (a role-title gate), with a required
  reason, as an in-place update. The old value survives only in a best-effort application audit event
  (section 3.5). Deleting a session is a hard delete (section 3.6).
- Device approval is a random token kept in an httpOnly cookie and stored as a sha256 hash. It is enforced
  in server TypeScript only (`src/lib/hr/attendance.ts:28-48`); the live database has no check, and the
  PENDING migration adds a clock-in check. The gate is fail-open while no device is registered.
- Super Admins are excluded from the clock roster, from payroll and from rates, but `kiosk_clock_in` still
  accepts a Super Admin target. Demo accounts are excluded from payroll and rates and refused as a clock-in
  target, but `list_clock_staff()` still lists them (RECOMMENDED TEMPLATE IMPROVEMENT, section 9).

Related documents in this folder: `PAYROLL.md` (payroll behaviour and formulas), `PERMISSIONS.md` (who may
do what, by layer, and the template permission keys), `CONFIGURATION.md` (settings schema of record),
`UI_UX.md`, `TESTING_CHECKLIST.md` and `IMPLEMENTATION_PROMPT.md`. Where a subject belongs to one of those,
this file states the database fact and points there.

---

## 1. Migration drift map

### 1.1 The twenty production migration names

CURRENT. The production migration history for this feature holds twenty names. The list was supplied with
the extraction brief for this template (it is not recorded in the repository; query V11 re-reads it). Twelve
names have a repository file; eight do not. The order below is the order of that list; exact versions are
NEEDS VERIFICATION (V11).

The last column has two kinds of content. For a row with a repository file it lists what that file defines. For
the eight rows without a file (8 to 13, 16, 17) it lists only what the migration name suggests. Those rows are
inferred, not established: the repository proves that each listed object exists live (section 1.3), but not which
migration created it. For example, no migration name is known for `kiosk_clock_out`, and
`M/20260907120000:10-12` says `kiosk_clock_in` was applied out of band without naming a migration. Which object
belongs to which of those rows is NEEDS VERIFICATION (V1 for the bodies, V11 for the names and versions).

| # | Production migration name | Repository file | Objects defined by the file, or (no file) suggested by the name only |
|---|---|---|---|
| 1 | `hr_attendance` | `M/20260717120000_hr_attendance.sql` | `staff_profiles.hourly_rate`; `attendance_records` with RLS, grants, indexes; `report_payroll` v1 |
| 2 | `payroll_hourly_rate_editor` | `M/20260721100000_payroll_hourly_rate_editor.sql` | `report_payroll` v2 (DROP and CREATE, adds `hourly_rate`) |
| 3 | `team_management_phase2_devices` | `M/20260722150000_team_management_phase2_devices.sql` | session columns; `attendance_devices`; four device RPCs |
| 4 | `payroll_exclude_demo_accounts` | `M/20260722160000_payroll_exclude_demo_accounts.sql` | `staff_profiles.is_demo`; `report_payroll` v3 |
| 5 | `optimize_attendance_devices_rls` | `M/20260722180000_optimize_attendance_devices_rls.sql` | policy `attendance_devices_owner_read` (current form) |
| 6 | `attendance_overtime_and_selfie` | `M/20260722200000_attendance_overtime_and_selfie.sql` | night columns and insert trigger; selfie entity type |
| 7 | `payroll_payslip_snapshots` | `M/20260722210000_payroll_payslip_snapshots.sql` | `payroll_snapshots` with RLS; repository `generate_payslip_snapshot` |
| 8 | `attendance_record_delete` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): `delete_attendance_record(uuid)` (R2) |
| 9 | `staff_hourly_rate_history` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): `staff_hourly_rates` (R6); `set_staff_hourly_rate(...)` (R7), both legacy |
| 10 | `payroll_paidby_and_kiosk_clock` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): `paid_at`, `paid_by` (R8); possibly kiosk clock functions (R1) |
| 11 | `fix_payroll_grants_and_delete_all_where` | none | inferred from the name, NEEDS VERIFICATION (V1, V5, V9, V11): payroll grants plus a `DELETE ... WHERE` fix |
| 12 | `salary_rate_daily_weekly_with_night_ot` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): `staff_salary_rates` (R3); `set_staff_salary_rate` (R4); `night_ot_bonus()` (R5) |
| 13 | `payslip_daily_rate_basis` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): four `payroll_snapshots` columns (R8); live `generate_payslip_snapshot` body (R9) |
| 14 | `attendance_review_by_permission` | `M/20260804140000_attendance_review_by_permission.sql` | policy `attendance_read` (current form) |
| 15 | `list_clock_staff` | `M/20260805160000_list_clock_staff.sql` | `list_clock_staff()` v1 |
| 16 | `payroll_night_bonus_once_per_day` | none | inferred from the name, NEEDS VERIFICATION (V1, V11): an intermediate `report_payroll` body; its rule survives in `M/20260907160000:53-55` |
| 17 | `attendance_records_time_in_idx` | none | inferred from the name, NEEDS VERIFICATION (V8, V11): an index on `attendance_records` involving `time_in` (R10) |
| 18 | `kiosk_clock_in_<zone>_work_date` (real name in section 11) | `M/20260907120000` | `kiosk_clock_in(uuid, uuid, text)`, first time in the repository |
| 19 | `correct_attendance_clock_out` | `M/20260907130000_correct_attendance_clock_out.sql` | `correct_attendance_clock_out(uuid, timestamptz, text)` |
| 20 | `exclude_owners_from_timekeeping` | `M/20260907160000_exclude_owners_from_timekeeping.sql` | `list_clock_staff()` v2; `report_payroll` v4 (current) |

Evidence that the drift is real, not a naming gap:

- `M/20260907120000:10-12` says `kiosk_clock_in` "was applied to production out-of-band" and "was not
  previously in the repo"; the file captures the corrected body with `create or replace`.
- `M/20260907160000:29-30` uses `create or replace` to define `report_payroll` with eleven output columns,
  while the previous repository body (`M/20260722160000:20-24`) returns seven. `create or replace` cannot
  change a RETURNS TABLE shape, as `M/20260721100000:10-12` states itself, so the eleven-column function
  must already have existed live (by name, most likely production name 12 or 16; NEEDS VERIFICATION, V11).
- `M/20260907160000:62, 68` read `public.staff_salary_rates` and `:85, 90` call `app_private.night_ot_bonus()`;
  no SQL file in `supabase/` creates either (repository search).
- The application reads `payroll_snapshots` columns the repository DDL does not declare
  (`src/lib/hr/payslip.ts:52-53`; `src/lib/hr/payslip-actions.ts:79, 126-131`).

Consequence, NEEDS VERIFICATION: a database built only from `supabase/migrations` most likely stops before it
reaches any HR drift, at the first migration that references a live-only object. The earliest such file found is
`M/20260731120000`, a non-HR integration migration outside this feature: its policy at `:20-21` calls
`app_private.is_primary_super_admin()`, which no repository file defines (R16). Whether an even earlier file fails
is not established. The first failure inside this feature is `M/20260907160000`: it reads
`public.staff_salary_rates` and calls `app_private.night_ot_bonus()`, neither of which any repository file creates, and
its `create or replace` changes the RETURNS TABLE shape of `report_payroll`, which Postgres refuses. Even with those
fixed, the result would lack `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate` and six
`payroll_snapshots` columns. Running `npx supabase db reset` on a scratch stack would confirm the stopping point.
The template must ship complete DDL for every object in section 1.3.

### 1.2 Repository migrations that define objects used by this feature

| Repository file | What it contributes |
|---|---|
| `M/20260715120000_phase1_foundation.sql` | `audit_events`, append-only triggers, RLS (`:74-137`) |
| `M/20260715120100_phase1_identity_access.sql` | `roles`, `permissions`, `staff_profiles`, `staff_permission_grants` (`:15-206`) |
| `M/20260715120600_phase1_approvals_rts_migration.sql` | `owner_approval_requests` (`:17-81`) |
| `M/20260715130000_phase2_authz_helpers.sql` | `app_private` helpers (`:28-161`); EXECUTE and schema grants (`:233-247`) |
| `M/20260715130100_phase2_rls_policies.sql` | blanket table grants (`:27-28`); identity, approvals and audit policies |
| `M/20260715130200_phase2_device_and_owner_guards.sql` | `staff_profiles` triggers for Admin management and login devices (`:98-172`) |
| `M/20260715130300_phase2_fix_integrity_triggers_under_rls.sql` | Admin-cap trigger function redefined as SECURITY DEFINER (`:104-139`) |
| `M/20260715140000_phase3_live_claim_intake.sql` | `app_private.provisional_fields` (`:230-236`) |
| `M/20260716200000_phase11_audit_privilege_hardening.sql` | re-revokes UPDATE on `audit_events` (`:55`, `:59`) |
| `M/20260716240000_owner_holds_all_permissions.sql` | `has_permission` = `is_owner()` or explicit grant (`:26-44`) |
| `M/20260716300000_attachments_storage.sql` | bucket and table `attachments`, RLS, storage policies (`:35-169`) |
| `M/20260722120000_delete_team_member.sql` | `delete_team_member(uuid)` and its RESTRICT interplay (`:1-57`) |
| `M/20260722170000_harden_definer_function_grants.sql` | EXECUTE grants on the four device RPCs (`:8-18`) |
| `M/20260729120000_portal_access_permissions.sql` | permission rows `hr_attendance`, `hr_review_attendance`, `hr_payroll` (`:32-34`) |
| `M/20260731130000_enable_realtime_dashboard_tables.sql` | realtime publication and REPLICA IDENTITY FULL (`:11-49`) |
| `M/20260804150000_realtime_permission_grants.sql` | realtime for `staff_permission_grants` (`:16-17`) |
| `M/20260806260000_harden_anon_executable_rpcs.sql` | EXECUTE grants on `list_clock_staff` (`:17`, `:33-34`) |
| `M/20260817190000_owner_approval_action_kind_add_inventory_item_edit.sql` | `action_kind` check including `attendance_delete` (`:9-17`) |
| `M/20260821120000_revoke_anon_execute_public_definer_rpcs.sql` | anon revokes on non-HR RPCs; dated claim about anon state (`:1-15`) |
| `M/20260821140000_merge_permissive_select_policies.sql` | current SELECT policies on `staff_profiles` and grants (`:15-22`) |
| `M/20260916120000_security_hardening_definer_grants_owner_guards.sql` | PENDING (not live); section 7 |
| `M/20260916130000_hotpath_indexes_audit_payments_customers.sql` | PENDING (not live): `audit_events_occurred_at_idx` (`:12-13`) |
| `M/20260917120000` (a non-HR migration) | PENDING (not live); no attendance or payroll object |

### 1.3 RECONSTRUCTED objects: the complete list

Each object exists on production (application code or a repository migration depends on it) but has no
DDL in the repository. Section 10 maps each to its verification query.

Format: object; Proof (why it must exist); Known (what callers and later migrations prove); Unknown.

- R1 `public.kiosk_clock_out(p_staff_id uuid)`.
  Proof: called at `src/lib/hr/attendance.ts:218-220`; listed as a live-only body in
  `docs/SYSTEM-AUDIT-2026-09-16.md:357`. Known: one argument; returns the closed record id (`attendance.ts:229`);
  must bypass RLS to close another member's session. Unknown: body, security mode, gate, messages, grants,
  whether it refuses demo or inactive targets, whether it writes `device_id`.
- R2 `public.delete_attendance_record(p_record_id uuid)`.
  Proof: called at `attendance.ts:368-370` and `src/lib/fulfillment/service.ts:735-739`. Known: comments
  describe the gate as `current_staff_role() in ('owner','selected_admin')` (`src/lib/authz/guard.ts:322-323`;
  `M/20260907130000:7`); it must be a definer function because `authenticated` holds no DELETE on the table
  (`M/20260715130100:28`; `M/20260717120000:75`). Unknown: body, return type, NULL-role handling, whether it
  removes selfie rows, grants.
- R3 table `public.staff_salary_rates`.
  Proof: read by `report_payroll` (`M/20260907160000:59-74`), `src/lib/hr/rate.ts:139-143` and
  `src/lib/export/data-export.ts:787`. Known: columns `staff_profile_id`, `daily_rate`, `pay_frequency`,
  `effective_date`, `created_at`. Unknown: `id`, `created_by`, FK and its ON DELETE rule, types and precision,
  checks, indexes, RLS, grants.
- R4 `public.set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective)`.
  Proof: called at `rate.ts:223-228`. Known: appends a rate row (`rate.ts:193-199`); a comment says
  "Super Admin only", enforced "again in the database function" (`rate.ts:198-199`). Unknown: security mode,
  the actual role gate, validation, grants.
- R5 `app_private.night_ot_bonus()`.
  Proof: called at `M/20260907160000:85, 90`. Known: no arguments; returns a value multiplied by an integer
  count; user-facing copy says 300. Unknown: language, security mode, volatility, EXECUTE grant, actual value.
- R6 table `public.staff_hourly_rates` (legacy).
  Proof: named at `rate.ts:26`; a row count only in `docs/HANDOFF-CURRENT-STATE-2026-08-11.md:85`.
  Known: written only through R7. Unknown: every column.
- R7 `public.set_staff_hourly_rate(p_staff, p_rate, p_effective)` (legacy).
  Proof: called at `rate.ts:83-88` from `setHourlyRate`, which has no caller in `src/`. Known: a comment says
  Super Admin or Admin (`rate.ts:24-29`). Unknown: everything else.
- R8 six `payroll_snapshots` columns: `daily_rate`, `days_worked`, `night_shifts`, `rate_basis`, `paid_at`, `paid_by`.
  Proof: selected by the list reader (`payslip.ts:52-53`) and the read-back (`payslip-actions.ts:79`);
  `paid_at` and `paid_by` written at `payslip-actions.ts:126-131`. The list reader returns an empty map on
  any error (`payslip.ts:73`), so a missing column would hide every payslip rather than fail loudly.
  Known: `rate_basis` values `hourly` and `daily` (`src/lib/hr/payslip-types.ts:21-22`). Unknown: types,
  nullability, defaults, checks, the FK on `paid_by`.
- R9 live body of `public.generate_payslip_snapshot(uuid, date, date, numeric)`.
  Proof: the repository body selects `hourly_rate` from `report_payroll` (`M/20260722210000:97-100`), a column
  the current function does not return (`M/20260907160000:30`). Known: the columns the application reads back
  (`payslip-actions.ts:76-82`). Unknown: formulas, security mode, guards, grants.
- R10 index `attendance_records_time_in_idx`.
  Proof: production name 17 only. Known: list reads filter and order on `time_in` (`attendance.ts:615-616, 633`).
  Unknown: columns, order, predicate.
- R11 live EXECUTE grants on `report_payroll`.
  Proof: the return-type change of section 1.1 requires a DROP and CREATE, which discards earlier grants.
  Known: v1 and v2 revoked PUBLIC and granted `authenticated` (`M/20260717120000:135-136`;
  `M/20260721100000:73-74`). Unknown: what the out-of-band CREATE left; whether `anon` holds EXECUTE (Supabase
  default privileges re-grant it on each create, `M/20260821120000:1-2`). For `anon` the row filter returns
  nothing and `anon` has no usage on `app_private` (`M/20260715130000:246`), so the bonus call would fail.
- R12 a possibly widened `payroll_snapshots` UPDATE (and SELECT) policy.
  Proof: the application lets an Admin mark a payslip paid (`payslip-actions.ts:103-106`), which the
  repository policy refuses (`M/20260722210000:62-65`). Unknown: whether production widened it (the names of
  production migrations 10 and 11 suggest a change; V5, V11).
- R13 a possibly altered `attendance_apply_overtime()` or trigger set.
  Proof: the names of production migrations 12 and 16 suggest the night rule changed. Known: repository body
  `M/20260722200000:26-49`. Unknown: whether a drift migration replaced it.
- R14 `owner_approval_requests.payload`.
  Proof: written at `src/lib/fulfillment/service.ts:531`; absent from the DDL `M/20260715120600:17-68`.
  Known: JSON-like by usage. Unknown: type, default; outside the HR tables.
- R15 storage trigger `storage.protect_delete`.
  Proof: described at `scripts/purge-attendance-selfies.mjs:7-9`. Known: it blocks deleting
  `storage.objects` rows through SQL. Unknown: its definition.
- R16 identity objects the HR layer depends on indirectly: the cap of two active Super Admins and the
  primary Super Admin check.
  Proof: the application says the Super Admin cap "is separate and still enforced"
  (`src/app/(app)/admin/staff/page.tsx:75-77`; constant at `src/lib/authz/access-catalogue.ts:188-190`) and is
  re-checked inside the RPC `set_team_member_role` (`src/lib/authz/team-accounts.ts:167-171, 189`); repository
  migrations call `app_private.is_primary_super_admin()` without defining it; both are listed as live-only in
  `docs/SYSTEM-AUDIT-2026-09-16.md:220`. Unknown: whether the cap lives in a trigger on `staff_profiles` or in
  the RPC. Outside the attendance and payroll feature; listed because `staff_profiles` triggers are in scope.

R6 and R7 are legacy and the template omits them. R14 and R16 belong to other modules. Every other entry
must be present in the template's migrations, written from the verified live definition or from the generic
proposal in section 5.

### 1.4 Authoritative definition per object

The authoritative file is the latest repository file that defines the object, unless the object is
RECONSTRUCTED or a PENDING file would change it.

| Object | Kind | Authoritative definition | Status |
|---|---|---|---|
| `attendance_records` | table | created `M/20260717120000:22-45`; columns `M/20260722150000:6-28`, `M/20260722200000:12-15` | live; PENDING default `M/20260916120000:367-368` |
| `attendance_read` | policy | `M/20260804140000:7-14` | live |
| `attendance_insert`, `attendance_update` | policies | `M/20260717120000:59-72` | live |
| `attendance_apply_overtime_biu` | trigger | `M/20260722200000:26-49` | live in repository; R13 |
| `attendance_records_time_in_idx` | index | none | R10 |
| `attendance_devices` | table | `M/20260722150000:14-30` | live |
| `attendance_devices_owner_read` | policy | `M/20260722180000:5-14` | live |
| device RPCs (four) | functions | bodies `M/20260722150000:42-80`; grants `M/20260722170000:8-18` | live |
| `attachments` | table | `M/20260716300000:48-148`; entity check `M/20260722200000:54-68` | live |
| `staff_profiles` | table | `M/20260715120100:106-182`; `is_demo` `M/20260722160000:7-8`; read policy `M/20260821140000:18-22` | live; PENDING trigger |
| `staff_salary_rates` | table | none | R3 |
| `staff_hourly_rates` | table | none | R6, legacy |
| `payroll_snapshots` | table | `M/20260722210000:15-68` plus six columns | live base; R8; R12 |
| `audit_events` | table | `M/20260715120000:74-137`; policies `M/20260715130100:661-670` | live; PENDING read policy |
| `roles`, `permissions`, `staff_permission_grants` | tables | `M/20260715120100:15-206`; HR rows `M/20260729120000:32-34` | live |
| `owner_approval_requests` | table | `M/20260715120600:17-81`; kind check `M/20260817190000:9-17` | live; R14 |
| `app_private` helpers | functions | `M/20260715130000:28-161`; `has_permission` `M/20260716240000:26-44` | live; PENDING role helper |
| `kiosk_clock_in` | function | `M/20260907120000:14-54` | live; PENDING `M/20260916120000:435-488` |
| `kiosk_clock_out` | function | none | R1 |
| `list_clock_staff` | function | `M/20260907160000:9-27`; grants `M/20260806260000:17, 33-34` | live |
| `correct_attendance_clock_out` | function | `M/20260907130000:13-68` | live |
| `delete_attendance_record` | function | none | R2 |
| `report_payroll` | function | `M/20260907160000:29-102` | live body in repository; grants R11 |
| `generate_payslip_snapshot` | function | repository `M/20260722210000:75-135` is STALE | live body R9 |
| `set_staff_salary_rate` | function | none | R4 |
| `night_ot_bonus` | function | none | R5 |
| `delete_team_member` | function | `M/20260722120000:14-57` | live; PENDING `M/20260916120000:169-222` |

---

## 2. Tables

### 2.1 `public.attendance_records` (one row per session)

CURRENT. Purpose: each row is one clock-in to clock-out session. A day is not stored; it is the group of
rows sharing `(staff_profile_id, work_date)`, computed at read time in TypeScript (`src/lib/hr/sessions.ts:4-17`)
and in `report_payroll` (`M/20260907160000:52-55`). Payroll is derived from these rows and never hand-entered
(`M/20260717120000:35-36`). Created `M/20260717120000:22-33`; altered `M/20260722150000:6-12, 24-28` and
`M/20260722200000:12-15`.

| Column | Type | Null | Default | Check or FK | Authoritative |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | `M/20260717120000:23` |
| `staff_profile_id` | uuid | NOT NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT | `:24` |
| `work_date` | date | NOT NULL | `current_date` (server UTC date) | none | `:25`; PENDING default in section 7 |
| `time_in` | timestamptz | NOT NULL | `now()` | none | `:26` |
| `time_out` | timestamptz | NULL | none | table check `attendance_time_out_after_in` | `:27`, `:32` |
| `note` | text | NULL | none | `note is null or length(trim(note)) <= 500` | `:28` |
| `created_at` | timestamptz | NOT NULL | `now()` | none | `:29` |
| `device_id` | uuid | NULL | none | FK `attendance_device_fk` to `attendance_devices(id)` ON DELETE SET NULL | `M/20260722150000:7, 24-28` |
| `clock_in_photo` | uuid | NULL | none | no FK; unused by the application | `:8` |
| `clock_out_photo` | uuid | NULL | none | no FK; unused by the application | `:9` |
| `edited_by` | uuid | NULL | none | FK `staff_profiles(id)`, no ON DELETE clause (NO ACTION) | `:10` |
| `edit_reason` | text | NULL | none | none; non-blank enforced by the correction RPC | `:11` |
| `status` | text | NULL | none | no check; unused by the application | `:12` |
| `is_overtime` | boolean | NOT NULL | `false` | overwritten by the insert trigger | `M/20260722200000:13` |
| `overtime_amount` | numeric(10,2) | NOT NULL | `0` | `overtime_amount >= 0`; overwritten by the insert trigger | `:14-15` |

- The table check is `time_out is null or time_out >= time_in` (`M/20260717120000:32`): a zero-length
  session is allowed.
- PK: `id`. FKs: `staff_profile_id` RESTRICT, `device_id` SET NULL, `edited_by` NO ACTION.
- Timestamps: `time_in`, `time_out`, `created_at`. There is no `updated_at`, no `edited_at` and no column
  recording which operator clocked the member (the operator exists only as the audit actor).
- Status fields: none in use. Open versus completed is derived from `time_out is null`
  (`src/lib/hr/attendance.ts:618-619`). The `status` column was added for a deferred approval feature
  (`docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212`) and has no check and no reader.
- "Unused" means a search of `src/` finds no reference to `clock_in_photo`, `clock_out_photo` or the
  `status` column; `edited_by` and `edit_reason` are written by SQL and never displayed.

Indexes

| Name | Definition | What it enforces | Authoritative |
|---|---|---|---|
| primary key | `(id)` | identity | `M/20260717120000:23` |
| `attendance_staff_date_idx` | `(staff_profile_id, work_date desc)` | nothing; per-member day lookups | `:38-39` |
| `attendance_one_open_session_per_staff` | UNIQUE `(staff_profile_id) WHERE time_out IS NULL` | at most one open session per member | `:43-45` |
| `attendance_records_time_in_idx` | RECONSTRUCTED (R10) | nothing known; `time_in` paging | production name 17 |

What the partial unique index enforces: it covers only rows with `time_out is null`, so a member can have
any number of completed sessions but at most one open session, across all dates. A second clock-in while a
session is open raises SQLSTATE 23505, which `kiosk_clock_in` converts to "That team member is already clocked
in. Clock out first." (`M/20260907120000:48-49`). "Continue Duty" is another clock-in after a clock-out on the
same `work_date`. A forgotten open session from an earlier day blocks every later clock-in until it is closed
by a clock-out or by `correct_attendance_clock_out` (`M/20260907130000:3-5`). Nothing closes a session
automatically.

Triggers

| Trigger | Timing | Function | Effect | Authoritative |
|---|---|---|---|---|
| `attendance_apply_overtime_biu` | BEFORE INSERT, FOR EACH ROW | `public.attendance_apply_overtime()` | sets the two night columns from the clock-in hour | `M/20260722200000:46-49` |

The rule (section 3.7): the clock-in hour in `<business-tz>` at or after 22 sets `true` and `300.00`, any
other hour sets `false` and `0`, overwriting whatever the caller sent. The trigger does not fire on UPDATE, so
a corrected `time_out` never changes these columns and a direct UPDATE of `time_in` would not recompute them.
Whether production replaced the function is R13. The threshold and the flat amount are PROJECT-SPECIFIC and
CONFIGURABLE; the amount is registered as provisional (`M/20260722200000:70-73`).

Row-level security: ENABLED and FORCED (`M/20260717120000:47-48`); `revoke all ... from anon, authenticated` (`:49`).

| Policy | Command | Role | USING | WITH CHECK | Authoritative |
|---|---|---|---|---|---|
| `attendance_read` | SELECT | `authenticated` | expression A | n/a | `M/20260804140000:8-14` (replaced `M/20260717120000:52-56`) |
| `attendance_insert` | INSERT | `authenticated` | n/a | `staff_profile_id = app_private.current_staff_id()` | `M/20260717120000:59-61` |
| `attendance_update` | UPDATE | `authenticated` | expression B | expression B | `M/20260717120000:65-72` |
| none | DELETE | none | none | none | `:63-64` comment "Never a delete" |

- Expression A (`M/20260804140000:11-13`): `staff_profile_id = app_private.current_staff_id() or
  app_private.is_owner() or app_private.has_permission('hr_review_attendance')`. The `is_owner()` branch is
  redundant, because `has_permission` already returns true for a Super Admin (`M/20260716240000:34`).
- Expression B (`M/20260717120000:67-72`): `staff_profile_id = app_private.current_staff_id() or app_private.is_owner()`.

Grants: `grant select, insert, update on public.attendance_records to authenticated` (`M/20260717120000:75`).
No DELETE grant; the pgTAP suite asserts DELETE stays revoked (`supabase/tests/26_hr_attendance.test.sql:50-51`).
Hard deletes run only inside `delete_attendance_record` (R2).

Realtime: in `supabase_realtime` with REPLICA IDENTITY FULL (`M/20260731130000:27, 41-47`).

Integrity observations the template must act on:

1. CURRENT: the application writes sessions only through `kiosk_clock_in`, `kiosk_clock_out`,
   `correct_attendance_clock_out` and `delete_attendance_record`. The direct-table `clockIn` and `clockOut`
   functions (`src/lib/hr/attendance.ts:252-339`, Super Admin only) have no caller in `src/`.
2. CURRENT: `attendance_insert` and `attendance_update` still let any authenticated member INSERT a session
   for themselves and UPDATE any column of their own rows through PostgREST, including `time_in`, `time_out`,
   `is_overtime` and `overtime_amount`. No column-level grant or UPDATE trigger exists in the repository. Such
   a write bypasses the kiosk, the device gate, the selfie and the audit log, and feeds payroll directly.
   Whether production narrowed it is NEEDS VERIFICATION (V4, V5). RECOMMENDED TEMPLATE IMPROVEMENT: no direct
   write grants or policies; definer functions only (section 5.3).
3. CURRENT: `attendance_insert` checks `current_staff_id()`, which ignores `is_active`
   (`M/20260715130000:35-38`), so a deactivated account with an unexpired JWT could still insert its own rows.
4. CURRENT: the definer functions write a FORCE RLS table. That works only when the function-owning database role
   bypasses RLS (NEEDS VERIFICATION, V13). The template must state the function-owning role explicitly.
5. CURRENT: rows written before the kiosk fix may carry the UTC date in `work_date` (`M/20260907120000:3-8`).
   The list reader filters `time_in` within business-day bounds for that reason (`attendance.ts:588-590`), while
   payroll filters `work_date`; the two can place an early-morning legacy session on different days.

### 2.2 `public.attendance_devices` (approved kiosk devices)

CURRENT. Purpose: registry of approved time-clock devices. Only the sha256 hash of the device token is stored
(`M/20260722150000:4, 52`); the raw token lives in an httpOnly cookie on the device (`src/lib/hr/devices.ts:75-89`).
Created `M/20260722150000:14-22`.

| Column | Type | Null | Default | Check or FK |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `label` | text | NOT NULL | none | none; the register RPC substitutes a default label for a blank value (section 11) |
| `token_hash` | text | NOT NULL | none | none; value `encode(extensions.digest(p_token, 'sha256'), 'hex')` (`:52`) |
| `is_active` | boolean | NOT NULL | `true` | none |
| `registered_by` | uuid | NULL | none | FK `staff_profiles(id)`, NO ACTION |
| `created_at` | timestamptz | NOT NULL | `now()` | none |
| `revoked_at` | timestamptz | NULL | none | none |

- PK: `id`. Timestamps: `created_at`, `revoked_at`. Status field: `is_active` (true = approved, false =
  revoked). Register and revoke set `revoked_at` together with `is_active = false` (`:49`, `:78`), but no
  check ties the two columns.
- Indexes: primary key only. No unique index on `token_hash` and no constraint on the number of active
  devices. The "one active device" rule exists only inside `register_attendance_device`, which deactivates
  every active device before inserting (`:49`).
- Triggers: none in the repository.
- RLS: ENABLED but NOT FORCED (`:30`).

| Policy | Command | Role | USING | Authoritative |
|---|---|---|---|---|
| `attendance_devices_owner_read` | SELECT | `authenticated` | expression C | `M/20260722180000:5-14` (replaced `M/20260722150000:32-40`) |

- Expression C (`M/20260722180000:8-13`): `exists (select 1 from public.staff_profiles sp where
  sp.auth_user_id = (select auth.uid()) and sp.role_key = 'owner' and sp.is_active)`, an inline copy of
  `app_private.is_owner()`.
- No INSERT, UPDATE or DELETE policy: all writes go through the definer RPCs (section 3.8).
- Grants: no GRANT or REVOKE for this table appears in the repository, and the Phase 2 blanket grant
  (`M/20260715130100:27`) covered only tables that already existed. Every other HR table revokes all
  privileges from `anon` and `authenticated` right after creation; this one does not. Live table privileges
  are NEEDS VERIFICATION (V6). RLS still refuses writes because no write policy exists.
- Realtime: not added by any repository migration.

Enforcement (CURRENT): the device rule is checked in server TypeScript (`src/lib/hr/attendance.ts:28-48`,
called at `:161` and `:214`). `kiosk_clock_in` stores `p_device_id` without validating it
(`M/20260907120000:40-47`) and `kiosk_clock_out` takes no device argument. The gate is fail-open: with no
active device it is a no-op (`attendance.ts:32`), and an RPC error while reading the gating state also reads
as "off" (`devices.ts:40-41`). `verify_attendance_device` checks `is_active` only (`M/20260722150000:60-61`),
while the PENDING clock-in check requires `is_active and revoked_at is null` (`M/20260916120000:454`).
`PERMISSIONS.md` covers the layer-by-layer view.

### 2.3 `public.attachments` (as used for clock-in and clock-out selfies)

CURRENT. A polymorphic metadata table; the bytes live in a private storage bucket. Created
`M/20260716300000:48-101`; the entity-type check was extended with `attendance_record` by
`M/20260722200000:54-68`, which is authoritative for that constraint.

| Column | Type | Null | Default | Check or FK | Authoritative |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | `M/20260716300000:49` |
| `storage_bucket` | text | NOT NULL | `'attachments'` | `storage_bucket = 'attachments'` | `:53-54` |
| `storage_path` | text | NOT NULL | none | trimmed length 1 to 400 | `:55-56` |
| `related_entity_type` | text | NOT NULL | none | fixed list that includes `attendance_record` | `M/20260722200000:56-68` |
| `related_entity_id` | uuid | NOT NULL | none | no FK (polymorphic) | `M/20260716300000:71` |
| `purpose` | text | NOT NULL | none | in (`photo`, `payment_proof`, `evidence`, `fulfillment_proof`) | `:75-80` |
| `file_name` | text | NULL | none | null or trimmed length 1 to 260 | `:83` |
| `content_type` | text | NOT NULL | none | in (`image/jpeg`, `image/png`, `image/webp`) | `:84` |
| `byte_size` | bigint | NOT NULL | none | 0 to 10 MiB | `:85` |
| `image_width`, `image_height` | integer | NULL | none | null or greater than 0 | `:86-87` |
| `source` | text | NOT NULL | none | in (`camera`, `file_upload`) | `:91` |
| `uploaded_by` | uuid | NOT NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT | `:95` |
| `uploaded_at`, `created_at` | timestamptz | NOT NULL | `now()` | none | `:96-97` |

- PK: `id`. Unique: `attachments_unique_path (storage_bucket, storage_path)` (`:100`). Status fields: none.
- Timestamps: `uploaded_at`, `created_at`.
- Indexes: `attachments_entity_idx (related_entity_type, related_entity_id, uploaded_at desc)` (`:112-113`);
  `attachments_uploaded_by_idx (uploaded_by, uploaded_at desc)` (`:114-115`). Triggers: none.
- RLS: ENABLED and FORCED; `revoke all ... from anon, authenticated` (`:120-122`).

| Policy | Command | Role | USING or WITH CHECK | Authoritative |
|---|---|---|---|---|
| `attachments_read` | SELECT | `authenticated` | USING `app_private.is_active_staff()` | `:127-129` |
| `attachments_insert` | INSERT | `authenticated` | WITH CHECK `app_private.is_active_staff() and uploaded_by = app_private.current_staff_id()` | `:137-142` |
| none | UPDATE, DELETE | none | "attachments are immutable once recorded" | `:144-145` |

- Grants: `grant select, insert on public.attachments to authenticated` (`:148`).
- Storage: private bucket `attachments`, 10 MiB, jpeg, png and webp only (`:35-43`). Policies on
  `storage.objects`: `attachments_objects_read` (SELECT) and `attachments_objects_insert` (INSERT), both
  `bucket_id = 'attachments' and app_private.is_active_staff()` (`:159-165`); no update or delete policy
  (`:167-169`). The live trigger `storage.protect_delete` blocks deleting objects through SQL (R15), so
  retention must use the Storage API with the service-role key from a server-side job
  (`scripts/purge-attendance-selfies.mjs:7-9`). No scheduled job touches attendance.

How attendance uses it (CURRENT):

- After a successful clock-in or clock-out the kiosk uploads with `related_entity_type = 'attendance_record'`,
  `related_entity_id = <record id>`, `purpose = 'photo'`, `source = 'camera'` and file name
  `clock-in-selfie-<ms>.jpg` or `clock-out-selfie-<ms>.jpg` (`src/components/hr/attendance-clock.tsx:157-166`).
  The object path is `<entityType>/<entityId>/<uuid>.<ext>` (`src/lib/attachments/upload.ts:105-107`).
- In versus out is told apart only by the substring `clock-out` in the file name (`attendance.ts:505, 553`).
- Selfies are read through 300-second signed URLs with a download disposition (`attendance.ts:496-500`).
- No FK links a selfie to its record, so deleting a record orphans the selfie (`attendance.ts:341-347`).
- `attachments_read` and the object read policy are wider than `attendance_read`: every active staff member
  can read every selfie's metadata and object, and any active member can attach an image to any record id
  (`upload.ts:72` checks only active staff). The reader comment claiming the selfies are "RLS-scoped exactly
  like the records" (`attendance.ts:468-470`) is inaccurate.

### 2.4 `public.staff_profiles` (columns and rules used by attendance and payroll)

CURRENT. Created `M/20260715120100:106-131`. Only the columns this feature reads are listed.

| Column | Type | Null | Default or check | Used by | Authoritative |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | PK, `gen_random_uuid()` | every FK in this feature | `:107` |
| `auth_user_id` | uuid | NOT NULL | UNIQUE; FK `auth.users(id)` ON DELETE RESTRICT | the helpers resolve the caller | `:110` |
| `full_name` | text | NOT NULL | trimmed length 1 to 120 | roster, payroll rows | `:112` |
| `role_key` | text | NOT NULL | FK `roles(key)` ON UPDATE CASCADE | Super Admin exclusion; role gates | `:113` |
| `is_active` | boolean | NOT NULL | `true` | roster, payroll, kiosk target, helpers | `:117` |
| `deactivated_at`, `deactivated_reason` | timestamptz, text | NULL | check ties `is_active` to `deactivated_at` | not read by HR | `:118-119, 127-130` |
| `is_demo` | boolean | NOT NULL | `false`; back-filled once from a test-domain email pattern | payroll, rates, kiosk target | `M/20260722160000:7-15` |
| `hourly_rate` | numeric(10,2) | NULL | null or `>= 0` | LEGACY; read at `rate.ts:134`, written by dead code | `M/20260717120000:12-14` |
| `created_at`, `updated_at` | timestamptz | NOT NULL | `now()`; trigger `staff_profiles_updated_at` | not read by HR | `:124-125, 138-139` |

- PK: `id`. Status fields: `is_active` with `deactivated_at` (check `staff_profiles_deactivation_ck`, `:127-130`).
- Index: `staff_profiles_role_idx (role_key) where is_active` (`:136`).
- Triggers:
  - `staff_profiles_updated_at` (`:138-139`).
  - `staff_profiles_selected_admin_limit`, at most two active Admins (`:180-182`; function body authoritative
    at `M/20260715130300:104-139`, SECURITY DEFINER). The application says this cap "was retired"
    (`src/app/(app)/admin/staff/page.tsx:75-76`), yet no repository migration drops the trigger and
    `src/lib/authz/account-management.ts:306-311` still maps its SQLSTATE; NEEDS VERIFICATION (V14).
  - `staff_profiles_owner_only_admin_mgmt` (`M/20260715130200:98-139`) and `staff_profiles_revoke_devices`
    (`:148-172`); the latter acts on the login-device table `trusted_devices`, not on `attendance_devices`.
  - PENDING: `staff_profiles_owner_floor` (`M/20260916120000:230-279`). Possible live-only cap trigger: R16.
- RLS: ENABLED and FORCED (`M/20260715120100:141-143`).

| Policy | Command | Role | Expression | Authoritative |
|---|---|---|---|---|
| `staff_profiles_read` | SELECT | `authenticated` | USING `app_private.is_owner() or auth_user_id = (select auth.uid())` | `M/20260821140000:21-22` |
| `staff_profiles_insert_owner` | INSERT | `authenticated` | WITH CHECK `app_private.is_owner()` | `M/20260715130100:72-73` |
| `staff_profiles_update_owner` | UPDATE | `authenticated` | USING and WITH CHECK `app_private.is_owner()` | `M/20260715130100:75-78` |

- Grants: `select, insert, update` to `authenticated` by the blanket grant; DELETE revoked
  (`M/20260715130100:27-28`). Realtime: yes, REPLICA IDENTITY FULL (`M/20260731130000:33`).

Consequences for this feature (CURRENT):

- A caller who is not a Super Admin cannot read other members' profiles. The kiosk and Review rosters
  therefore come from the definer RPC `list_clock_staff()` (`M/20260805160000:1-10`).
- The list readers embed `staff:staff_profiles!staff_profile_id ( full_name )` (`src/lib/hr/attendance.ts:562-563`).
  For an `hr_review_attendance` holder who is not a Super Admin that embed is null for every other member, so
  names render as a dash. `M/20260821140000:8-9` records that on 2026-08-21 production had exactly one SELECT
  policy on this table; a later live-only policy is NEEDS VERIFICATION (V7). RECOMMENDED TEMPLATE IMPROVEMENT:
  a permission-scoped definer reader (section 5.13).
- Super Admin accounts are excluded from the clock roster (`M/20260907160000:24`), from payroll (`:99`) and from
  the rates list (`rate.ts:137`), but `kiosk_clock_in` does not refuse a Super Admin target
  (`M/20260907120000:30-37`). PROJECT-SPECIFIC decision; CONFIGURABLE.
- Demo accounts are refused as kiosk targets (`M/20260907120000:35-37`) and excluded from payroll
  (`M/20260907160000:98`) and rates (`rate.ts:136`), but not from `list_clock_staff` (`M/20260907160000:21-25`).

### 2.5 `public.staff_salary_rates` (RECONSTRUCTED, R3)

Purpose (CURRENT, by usage): effective-dated salary rate history and the current pay basis
(`src/lib/hr/rate.ts:146-147`). Each save appends a row, so a period computed earlier keeps the rate that
applied then (`rate.ts:193-199`). No repository file creates the table (by name, probably production name 12;
NEEDS VERIFICATION, V11).

| Column | Inferred type | Null | Default | Check | Evidence |
|---|---|---|---|---|---|
| `staff_profile_id` | uuid | unknown | unknown | FK to `staff_profiles` and ON DELETE rule unknown | `M/20260907160000:63, 69`; `rate.ts:141`; `data-export.ts:787` |
| `daily_rate` | numeric, precision unknown | unknown | unknown | unknown; the app allows 1 to 10 digits and up to 2 decimals | `M/20260907160000:62, 83`; `rate.ts:163-166, 209-212` |
| `pay_frequency` | text | probably NULL (readers coalesce to `weekly`) | unknown | unknown; the app allows `weekly`, `bi_weekly`, `monthly` | `M/20260907160000:68, 84`; `rate.ts:167, 213-216` |
| `effective_date` | date | unknown | unknown | unknown; the app requires a YYYY-MM-DD string | `M/20260907160000:63-64, 69-70`; `rate.ts:217-220` |
| `created_at` | timestamptz | unknown | unknown | none known; used as tie-breaker | `M/20260907160000:64, 70`; `rate.ts:141, 143` |

- PK, `id`, `created_by`, unique constraints, indexes, triggers, RLS mode, policies, grants and realtime
  membership: NEEDS VERIFICATION (V2, V3, V5, V6, V8, V10, V12).
- The tie-breaker `order by r.effective_date desc, r.created_at desc limit 1` (`M/20260907160000:64`) implies
  several rows per `(staff_profile_id, effective_date)` are allowed.
- Status fields: none known.
- RLS requirement implied by callers: a Super Admin must read every row (Employee Rates tab, `rate.ts:139-143`;
  Team export), and because `report_payroll` runs with invoker rights a member must read their own rows or
  their payroll row shows "No rate set". NEEDS VERIFICATION (V5).
- Writers: only `set_staff_salary_rate` (R4) as far as the repository shows.
- GENERIC form: `employee_pay_rates` (section 5.8).

### 2.6 `public.staff_hourly_rates` (RECONSTRUCTED, legacy, R6)

Named at `src/lib/hr/rate.ts:26` and written only by `set_staff_hourly_rate` (`rate.ts:83-88`), whose caller
`setHourlyRate` has no call site in `src/`. Columns, keys, RLS and grants: NEEDS VERIFICATION (V2). The
template does not port it.

### 2.7 `public.payroll_snapshots` (payslips)

CURRENT. Purpose: a snapshot of payslip figures at generation time; later rate or attendance edits never
change an issued payslip (`M/20260722210000:1-13, 38-39`). Created `M/20260722210000:15-36`. Six live
columns are RECONSTRUCTED (R8).

| Column | Type | Null | Default | Check or FK | Authoritative |
|---|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK | `M/20260722210000:16` |
| `employee_id` | uuid | NOT NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT | `:17` |
| `payroll_start_date` | date | NOT NULL | none | check `payroll_period_valid`: `payroll_end_date >= payroll_start_date` | `:18`, `:35` |
| `payroll_end_date` | date | NOT NULL | none | same check | `:19` |
| `regular_hours` | numeric(10,2) | NOT NULL | `0` | none | `:20` |
| `overtime_hours` | numeric(10,2) | NOT NULL | `0` | none | `:21` |
| `hourly_rate` | numeric(10,2) | NULL | none | none; LEGACY basis | `:23` |
| `regular_salary` | numeric(12,2) | NOT NULL | `0` | none | `:24` |
| `overtime_pay` | numeric(12,2) | NOT NULL | `0` | none | `:25` |
| `gross_salary` | numeric(12,2) | NOT NULL | `0` | none | `:26` |
| `deductions` | numeric(12,2) | NOT NULL | `0` | `deductions >= 0` | `:27` |
| `net_salary` | numeric(12,2) | NOT NULL | `0` | no check; can go negative | `:28` |
| `payment_status` | text | NOT NULL | `'pending'` | in (`pending`, `paid`) | `:29-30` |
| `payment_date` | date | NULL | none | none | `:31` |
| `approved_by` | uuid | NULL | none | FK `staff_profiles(id)`, NO ACTION; never written by the app | `:32` |
| `generated_by` | uuid | NULL | none | FK `staff_profiles(id)`, NO ACTION | `:33` |
| `generated_at` | timestamptz | NOT NULL | `now()` | none | `:34` |
| `daily_rate` | RECONSTRUCTED, numeric by usage | unknown | unknown | unknown | read `src/lib/hr/payslip.ts:32-34, 53` |
| `days_worked` | RECONSTRUCTED, integer by usage | unknown | unknown | unknown | `payslip.ts:39, 53` |
| `night_shifts` | RECONSTRUCTED, integer by usage | unknown | unknown | unknown | `payslip.ts:40, 53` |
| `rate_basis` | RECONSTRUCTED, text with values `hourly`, `daily` | unknown; the app treats null as `hourly` | unknown | unknown | `payslip.ts:38`; `payslip-types.ts:21-22` |
| `paid_at` | RECONSTRUCTED, timestamptz by usage | unknown | unknown | unknown | written `src/lib/hr/payslip-actions.ts:129` |
| `paid_by` | RECONSTRUCTED, uuid by usage | unknown | unknown | FK unknown | written `payslip-actions.ts:130` |

- PK: `id`. Timestamps: `generated_at`, `payment_date`, and the reconstructed `paid_at`.
- Status field: `payment_status`, allowed values `pending` and `paid`, transition `pending` to `paid` only.
  Mark-paid is a direct UPDATE from the application that flips only a still-pending row
  (`.eq('payment_status', 'pending')`, `payslip-actions.ts:121-135`). There is no mark-paid function, no
  unpay and no void.
- `regular_hours` receives `report_payroll.total_hours` in the repository body (`M/20260722210000:97-100, 123`),
  so the name is misleading: it holds all hours.
- Uniqueness: none on `(employee_id, payroll_start_date, payroll_end_date)`. Regenerations add rows and the
  reader keeps the newest per employee (`payslip.ts:55-82`), so a newer pending row can hide an older paid one.
- Indexes: `payroll_snapshots_employee_idx (employee_id, generated_at desc)` (`:41-42`);
  `payroll_snapshots_period_idx (payroll_start_date, payroll_end_date)` (`:43-44`).
- Triggers: none in the repository. Immutability is a convention: the UPDATE policy lets a Super Admin change
  any column and nothing freezes the money columns.
- RLS: ENABLED and FORCED; `revoke all ... from anon, authenticated` (`:46-48`).

| Policy | Command | Role | Expression | Authoritative (repository) |
|---|---|---|---|---|
| `payroll_snapshots_read` | SELECT | `authenticated` | USING `employee_id = app_private.current_staff_id() or app_private.is_owner()` | `M/20260722210000:51-55` |
| `payroll_snapshots_insert` | INSERT | `authenticated` | WITH CHECK `app_private.is_owner()` | `:58-60` |
| `payroll_snapshots_update` | UPDATE | `authenticated` | USING and WITH CHECK `app_private.is_owner()` | `:62-65` |
| none | DELETE | none | none | `:67` comment "No delete" |

- Grants: `grant select, insert, update on public.payroll_snapshots to authenticated` (`:68`).
- Realtime: yes, REPLICA IDENTITY FULL (`M/20260731130000:28`).
- Drift conflict (R12, NEEDS VERIFICATION, V5): the application lets an Admin mark a payslip paid
  (`payslip-actions.ts:103-106`). Under the repository policy that UPDATE matches no row and the action
  answers "Could not mark the payslip as paid. It may already be paid." (`:137-142`). Either production
  widened the policy (the names of production migrations 10 or 11 suggest it) or the Admin path always fails. `PAYROLL.md` describes the behaviour.
- A negative `net_salary` is possible and corrupts the printed Payroll Summary total, whose parser drops the
  sign of the whole part (`src/components/hr/payroll-summary-button.tsx:32-36`).

### 2.8 `public.audit_events` (event types used by this feature)

CURRENT. Created `M/20260715120000:74-106`.

| Column | Type | Null | Default | Check |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `occurred_at` | timestamptz | NOT NULL | `now()` | none |
| `actor_auth_uid` | uuid | NULL | none | `audit_events_system_actor_ck`: a `system` actor must have a null uid (`:102-105`) |
| `actor_kind` | text | NOT NULL | `'staff'` | in (`staff`, `system`, `migration`) |
| `actor_label` | text | NULL | none | none; snapshot of the actor label at event time |
| `action` | text | NOT NULL | none | length 1 to 120 |
| `entity_type` | text | NOT NULL | none | length 1 to 80 |
| `entity_id` | uuid | NULL | none | no FK |
| `outcome` | text | NOT NULL | `'succeeded'` | in (`succeeded`, `failed`, `denied`) |
| `reason` | text | NULL | none | none |
| `context` | jsonb | NOT NULL | `'{}'::jsonb` | none; must never hold secrets (`:99`) |

- PK: `id`. Timestamp: `occurred_at`. Status field: `outcome`.
- Indexes: `audit_events_entity_idx (entity_type, entity_id, occurred_at desc)` and
  `audit_events_actor_idx (actor_auth_uid, occurred_at desc)` (`:111-112`). PENDING:
  `audit_events_occurred_at_idx (occurred_at desc)` (`M/20260916130000:12-13`).
- Triggers: `audit_events_no_update` and `audit_events_no_delete`, both calling
  `app_private.deny_audit_mutation()`, which raises (`:115-133`).
- RLS: ENABLED and FORCED (`:135-137`).

| Policy | Command | Role | Expression | Authoritative |
|---|---|---|---|---|
| `audit_read` (live) | SELECT | `authenticated` | USING `app_private.is_active_staff()` | `M/20260715130100:661-662` |
| `audit_read` (PENDING) | SELECT | `authenticated` | USING expression D | `M/20260916120000:290-298` |
| `audit_insert_self_attributed` | INSERT | `authenticated` | WITH CHECK expression E | `M/20260715130100:664-670` |

- Expression E (`M/20260715130100:666-670`): `app_private.is_active_staff() and actor_auth_uid = (select auth.uid())
  and actor_kind = 'staff'`.
- Expression D (`M/20260916120000:293-297`): `app_private.is_owner() or app_private.current_staff_role() =
  'selected_admin' or app_private.has_permission('view_settings') or (app_private.is_active_staff() and
  entity_type = 'official_order')`.
- Grants: `select, insert` to `authenticated`. The Phase 2 blanket grant re-granted UPDATE
  (`M/20260715130100:27`), which was revoked again (`M/20260716200000:55`); `anon` holds nothing (`:59`).
- The application writer never throws (`src/lib/audit/log.ts:75-78`), so an action can succeed without an audit
  row: audit is best-effort. No SQL function of this feature with a repository body inserts an audit row; whether
  the RECONSTRUCTED functions (R1, R2, R4, R5, R9) do is NEEDS VERIFICATION (V1).
- Privacy (CURRENT): payroll contexts carry money (`daily_rate`, `net_salary`) and every active staff member can
  read them under the live policy. PENDING section 6 narrows reads to Super Admin, Admin and `view_settings`.

Event catalogue written by this feature (all written by application code):

| `action` | `entity_type` (entity_id) | Outcomes | Context keys | Written at |
|---|---|---|---|---|
| `attendance.blocked_device` | `attendance_record` (the member's profile id, not a record id) | denied | none; reason text | `src/lib/hr/attendance.ts:36-42` |
| `attendance.clock_in` | `attendance_record` (new record id) | succeeded | `for_staff`; `overtime_amount` when flagged | `attendance.ts:188-196` |
| `attendance.clock_out` | `attendance_record` (closed record id) | succeeded | `for_staff` | `attendance.ts:230-235` |
| `attendance.delete` | `attendance_record` | denied, failed, succeeded | `permanent: true` on success | `attendance.ts:355-388` |
| `attendance.clock_out_corrected` | `attendance_record` | denied, failed, succeeded | `old_time_out`, `new_time_out`, `reason` | `attendance.ts:409-456` |
| `attendance.device_register` | `attendance_device` (no id) | succeeded | `label` | `src/lib/hr/devices.ts:91-95` |
| `attendance.device_revoke` | `attendance_device` | succeeded | none | `devices.ts:113-117` |
| `attachment.upload` | `attendance_record` | failed, succeeded | purpose, source, size, path | `src/lib/attachments/upload.ts:119-177` |
| `payroll.set_salary_rate` | `staff_profile` | succeeded only | `daily_rate`, `pay_frequency`, `effective_date` | `src/lib/hr/rate.ts:233-238` |
| `payroll.set_hourly_rate` | `staff_profile` | denied, failed, succeeded | rate, effective date | `rate.ts:58-106` (dead path) |
| `payroll.payslip_generated` | `payroll_snapshot` | succeeded | `from`, `to`, `net_salary` | `src/lib/hr/payslip-actions.ts:88-93` |
| `payroll.payslip_marked_paid` | `payroll_snapshot` | succeeded | `payment_date`, `paid_by` | `payslip-actions.ts:145-150` |
| `owner_approval.request` and later steps | request or target | all | action kind `attendance_delete` | `src/lib/fulfillment/service.ts:505-553` and later |

The previous value of a corrected clock-out exists only in `context.old_time_out` of a best-effort event;
the values of a deleted session are retained nowhere.

### 2.9 Permission tables used by the gates

`public.roles` (`M/20260715120100:15-31`): `key text primary key check (key in ('owner', 'selected_admin',
'staff'))`, `label text not null`, `description text not null`; three seeded rows. RLS ENABLED and FORCED,
all revoked from `anon` and `authenticated` (`:24-26`); policy `roles_read_active_staff` SELECT USING
`app_private.is_active_staff()` (`M/20260715130100:38-39`); SELECT, INSERT and UPDATE granted by the blanket
grant, but with no write policy the catalogue is read-only at runtime. The role set is PROJECT-SPECIFIC
vocabulary (section 11).

`public.permissions` (`M/20260715120100:36-50`): `key text primary key`, `label text not null`,
`description text not null`, `is_request_only boolean not null default false`. RLS ENABLED and FORCED
(`:48-50`); policy `permissions_read_active_staff` SELECT USING `app_private.is_active_staff()`
(`M/20260715130100:41-42`). Rows for this feature (`M/20260729120000:32-34`):

| Key | Label | Where it gates (CURRENT) |
|---|---|---|
| `hr_attendance` | Attendance | page `/admin/attendance` (`src/app/(app)/admin/attendance/page.tsx:43`); `list_clock_staff` (`M/20260907160000:16-19`); paging action (`src/lib/hr/actions.ts:62`) |
| `hr_review_attendance` | Review Attendance | page `/admin/attendance/review` (`review/page.tsx:22`); RLS `attendance_read` (`M/20260804140000:13`); selfie and review actions (`actions.ts:48, 77`) |
| `hr_payroll` | Payroll | page `/admin/payroll` only (`src/app/(app)/admin/payroll/page.tsx:30`); no SQL object references it |

- The seeded description of `hr_review_attendance` is "Review and correct attendance records."
  (`M/20260729120000:33`), but correction is gated by role title, not by this key (section 3.5).
- `initiate_high_risk_action` (`M/20260715120100:78-80`, `is_request_only = true`) is required to create an
  `attendance_delete` approval request (`src/lib/fulfillment/service.ts:502`; policy `approvals_insert`,
  `M/20260715130100:566-571`). It is absent from the Manage Access catalogue and granted by no migration; it is
  grantable only on the legacy Super Admin console reachable by URL (`src/components/admin/staff-console.tsx:35`;
  `src/lib/authz/actions.ts:38-60`; `src/app/(app)/admin/staff/page.tsx:34-41`), so the Admin request fails by
  default on a fresh install. Whether a live grant exists is NEEDS VERIFICATION (count-only query, V15).

`public.staff_permission_grants` (`M/20260715120100:188-206`):

| Column | Type | Null | Default | Check or FK |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `staff_profile_id` | uuid | NOT NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT |
| `permission_key` | text | NOT NULL | none | FK `permissions(key)` ON UPDATE CASCADE |
| `granted_at` | timestamptz | NOT NULL | `now()` | none |
| `granted_by` | uuid | NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT |

- Unique `staff_permission_grants_unique (staff_profile_id, permission_key)` (`:196`); index
  `staff_permission_grants_profile_idx (staff_profile_id)` (`:202`). RLS ENABLED and FORCED (`:204-206`).
- Policies: `grants_read` SELECT USING `app_private.is_owner() or staff_profile_id = app_private.current_staff_id()`
  (`M/20260821140000:15-16`); `grants_insert_owner` WITH CHECK `app_private.is_owner()` and `grants_update_owner`
  USING and WITH CHECK `app_private.is_owner()` (`M/20260715130100:90-95`). No DELETE policy; deletions run inside
  definer functions such as `delete_team_member`.
- Grants: blanket `select, insert, update`. Realtime: yes, REPLICA IDENTITY FULL (`M/20260804150000:16-17`).

Authority composition (CURRENT): `has_permission(key)` is `is_owner()` or an explicit grant held by an active
profile (`M/20260716240000:34-43`). Role-title gates (`owner`, `selected_admin`) are a separate mechanism used
by the correction and delete functions (section 3). `PERMISSIONS.md` holds the full matrix.

### 2.10 `public.owner_approval_requests` (kind `attendance_delete` only)

CURRENT. Created `M/20260715120600:17-68`.

| Column | Type | Null | Default | Check or FK |
|---|---|---|---|---|
| `id` | uuid | NOT NULL | `gen_random_uuid()` | PK |
| `action_kind` | text | NOT NULL | none | fixed list; authoritative `M/20260817190000:9-17`, includes `attendance_delete` (`:14`) |
| `status` | text | NOT NULL | `'pending_owner_approval'` | in (`pending_owner_approval`, `approved`, `rejected`) (`:29-33`) |
| `entity_type` | text | NOT NULL | none | length 1 to 80 |
| `entity_id` | uuid | NOT NULL | none | no FK |
| `reason` | text | NOT NULL | none | trimmed length greater than 0 |
| `evidence_note`, `decision_note` | text | NULL | none | none |
| `requested_at` | timestamptz | NOT NULL | `now()` | none |
| `requested_by` | uuid | NOT NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT |
| `decided_at`, `executed_at` | timestamptz | NULL | none | see checks |
| `decided_by`, `executed_by` | uuid | NULL | none | FK `staff_profiles(id)` ON DELETE RESTRICT |
| `created_at`, `updated_at` | timestamptz | NOT NULL | `now()` | trigger `owner_approval_updated_at` |
| `payload` | RECONSTRUCTED (R14) | unknown | unknown | written at `service.ts:531` |

- Checks: `owner_approval_decided_ck` (a non-pending row carries `decided_at` and `decided_by`, `:59-62`);
  `owner_approval_execution_ck` (`executed_at` only when `status = 'approved'`, `:65-67`).
- Indexes: `owner_approval_pending_idx (status, requested_at)`, `owner_approval_entity_idx (entity_type, entity_id)`
  (`:73-74`). Triggers: `owner_approval_updated_at` (`:76-77`) and a decider-role trigger from
  `app_private.enforce_owner_only_decision()` (`:87` onward).
- RLS ENABLED and FORCED (`:79-81`). Policies (`M/20260715130100:560-579`): `approvals_read` SELECT USING
  `app_private.is_active_staff()`; `approvals_insert` WITH CHECK
  `(app_private.has_permission('initiate_high_risk_action') or app_private.is_owner()) and requested_by =
  app_private.current_staff_id()`; `approvals_decide_owner_only` UPDATE USING and WITH CHECK
  `app_private.can_decide_owner_only_action()`, which is `is_owner()` (`M/20260715130000:194-202`). No DELETE policy.
- Grants: the creating migration revokes all from `anon` and `authenticated` (`M/20260715120600:81`); the later
  Phase 2 blanket grant gives `authenticated` SELECT, INSERT and UPDATE and revokes DELETE (`M/20260715130100:27-28`).
  `anon` holds nothing. Rows are governed by the policies above.
- Flow for this kind: a non-Super-Admin requests (`src/lib/hr/actions.ts:190-204`, entity type
  `attendance_record`), the Super Admin decides, and a separate execute step calls `delete_attendance_record`
  (`service.ts:735-739`). Realtime: yes (`M/20260731130000:30`).
- Every other action kind is PROJECT-SPECIFIC. `approvals_read` lets every active member read request reasons,
  which for attendance name a member and a date.

### 2.11 `app_private.provisional_fields`

CURRENT. Primary key `(table_name, column_name)`, a not-null specification-reference text column and a
not-null `note` (`M/20260715140000:230-236`). Rows for this feature: `attendance_records.time_out` (overtime
rule provisional, `M/20260717120000:138-141`), `attendance_records.overtime_amount` (flat amount and threshold
provisional, `M/20260722200000:70-73`), `payroll_snapshots.overtime_pay` and `payroll_snapshots.deductions`
(`M/20260722210000:137-142`). The specification section these rows cite is not in the repository, so the reason
behind the night rule, the amount and the deduction model cannot be recovered. The template treats them as
client policy to decide (CONFIGURABLE), not as inherited defaults.

### 2.12 Realtime publication membership

CURRENT. `M/20260731130000:37-48` sets REPLICA IDENTITY FULL and adds each listed table to `supabase_realtime`
when it exists.

| Table | In `supabase_realtime` | Authoritative |
|---|---|---|
| `attendance_records` | yes | `M/20260731130000:27` |
| `payroll_snapshots` | yes | `:28` |
| `owner_approval_requests` | yes | `:30` |
| `staff_profiles` | yes | `:33` |
| `staff_permission_grants` | yes | `M/20260804150000:16-17` |
| `attendance_devices`, `attachments`, `staff_salary_rates`, `staff_hourly_rates`, `audit_events` | not added by the repository | NEEDS VERIFICATION (V12) |

Realtime delivery is filtered by RLS, so it exposes no row the reader could not already select. `UI_UX.md`
covers the client refresh behaviour.

---

## 3. Functions

### 3.0 Summary matrices

Matrix A: definition.

| Function | Language | Security | search_path | Volatility | Authoritative |
|---|---|---|---|---|---|
| `app_private.current_staff_id() returns uuid` | sql | DEFINER | `''` | STABLE | `M/20260715130000:28-39` |
| `app_private.current_staff_role() returns text` | sql | DEFINER | `''` | STABLE | live `:47-58`; PENDING `M/20260916120000:46-57` |
| `app_private.is_active_staff() returns boolean` | sql | DEFINER | `''` | STABLE | `M/20260715130000:68-81` |
| `app_private.is_owner() returns boolean` | sql | DEFINER | `''` | STABLE | `M/20260715130000:147-161` |
| `app_private.has_permission(text) returns boolean` | sql | DEFINER | `''` | STABLE | `M/20260716240000:26-44` |
| `app_private.night_ot_bonus()` | unknown | unknown | unknown | unknown | RECONSTRUCTED (R5) |
| `public.kiosk_clock_in(uuid, uuid, text) returns uuid` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260907120000:14-54` |
| `public.kiosk_clock_out(uuid) returns uuid` | unknown | DEFINER (inferred) | unknown | unknown | RECONSTRUCTED (R1) |
| `public.list_clock_staff() returns table(id uuid, full_name text, role_key text)` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260907160000:9-27` |
| `public.correct_attendance_clock_out(uuid, timestamptz, text) returns timestamptz` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260907130000:13-63` |
| `public.delete_attendance_record(uuid)` | unknown | DEFINER (inferred) | unknown | unknown | RECONSTRUCTED (R2) |
| `public.attendance_apply_overtime() returns trigger` | plpgsql | INVOKER (no clause) | `''` | VOLATILE (default) | `M/20260722200000:26-44` |
| `public.register_attendance_device(text, text) returns uuid` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260722150000:42-55` |
| `public.verify_attendance_device(text) returns uuid` | sql | DEFINER | `''` | STABLE | `M/20260722150000:58-63` |
| `public.attendance_gating_active() returns boolean` | sql | DEFINER | `''` | STABLE | `M/20260722150000:66-69` |
| `public.revoke_attendance_device(uuid) returns void` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260722150000:72-79` |
| `public.report_payroll(date, date) returns table(...)` | sql | INVOKER (no clause) | `''` | STABLE | `M/20260907160000:29-102` |
| `public.generate_payslip_snapshot(uuid, date, date, numeric) returns payroll_snapshots` | plpgsql | INVOKER | `''` | VOLATILE (default) | repository `M/20260722210000:75-132` (STALE); live R9 |
| `public.set_staff_salary_rate(...)` | unknown | unknown | unknown | unknown | RECONSTRUCTED (R4) |
| `public.set_staff_hourly_rate(...)` (legacy) | unknown | unknown | unknown | unknown | RECONSTRUCTED (R7) |
| `public.delete_team_member(uuid) returns void` | plpgsql | DEFINER | `''` | VOLATILE (default) | `M/20260722120000:14-54`; PENDING `M/20260916120000:174-219` |

Matrix B: grants and data access. "Grants" is the latest statement in the repository; live ACLs are V9.

| Function | EXECUTE grants (repository) | Reads | Writes |
|---|---|---|---|
| the five `app_private` helpers | `authenticated` (`M/20260715130000:233-243`); `anon` has no schema usage (`:246-247`) | `staff_profiles`; `has_permission` also `staff_permission_grants` | none |
| `night_ot_bonus` | unknown (R5) | unknown | none expected |
| `kiosk_clock_in` | none in the live file (note a); PENDING: public and anon revoked, `authenticated` and `service_role` granted | `staff_profiles` | `attendance_records` INSERT |
| `kiosk_clock_out` | unknown (R1) | `attendance_records` (inferred) | `attendance_records` UPDATE (inferred) |
| `list_clock_staff` | public and anon revoked; `authenticated`, `service_role` (`M/20260806260000:17, 33-34`) | `staff_profiles` | none |
| `correct_attendance_clock_out` | anon and public revoked; `authenticated`, `service_role` (`M/20260907130000:65-68`) | `attendance_records` | `attendance_records` UPDATE |
| `delete_attendance_record` | unknown (R2) | unknown | `attendance_records` DELETE (inferred) |
| `attendance_apply_overtime` | none (trigger function) | the NEW row | the NEW row |
| `register_attendance_device` | public and anon revoked; `authenticated` (`M/20260722170000:14-15`) | `staff_profiles` | `attendance_devices` UPDATE and INSERT |
| `verify_attendance_device` | public and anon revoked; `authenticated` (`M/20260722170000:11-12`) | `attendance_devices` | none |
| `attendance_gating_active` | public and anon revoked; `authenticated` (`M/20260722170000:8-9`) | `attendance_devices` | none |
| `revoke_attendance_device` | public and anon revoked; `authenticated` (`M/20260722170000:17-18`) | `staff_profiles` | `attendance_devices` UPDATE |
| `report_payroll` | v1, v2: public revoked, `authenticated` (`M/20260717120000:135-136`); live R11 | sessions, profiles, rates, bonus | none |
| `generate_payslip_snapshot` | `authenticated`, no PUBLIC revoke (`M/20260722210000:134-135`); live unknown | `report_payroll`, `attendance_records` | `payroll_snapshots` INSERT |
| `set_staff_salary_rate` | unknown (R4) | unknown | `staff_salary_rates` INSERT (by comment) |
| `delete_team_member` | public and anon revoked; `authenticated` (`M/20260722120000:56-57`) | `staff_profiles` | the member's account rows |

Note a: the kiosk clock-in file has no GRANT or REVOKE. The function was first created out of band and the
file uses `create or replace`, which keeps whatever ACL existed, so its live grants are NEEDS VERIFICATION (V9).

Grant hygiene (CURRENT, NEEDS VERIFICATION): Supabase default privileges grant EXECUTE to `anon`,
`authenticated` and `service_role` on every function a migration creates (`M/20260821120000:1-2`;
`M/20260916120000:12-14, 70-73`). The repository holds two dated statements about live state:
`M/20260821120000:14` says that after it no public definer function was anon-executable (2026-08-21), and
`M/20260916120000:12-14` says 20 functions had never been revoked (2026-09-16), because each CREATE re-applies
the default grant. V9 settles the current state. What limits the exposure differs by function:

- Six `public` definer functions of this feature with a repository body check the caller before acting:
  `kiosk_clock_in` (active staff, section 3.2), `list_clock_staff` (`hr_attendance`, 3.4),
  `correct_attendance_clock_out` (role title, 3.5), `register_attendance_device` and `revoke_attendance_device`
  (active Super Admin, 3.8) and `delete_team_member` (active Super Admin, `M/20260722120000:24-30`).
- The two device read helpers, `verify_attendance_device` and `attendance_gating_active`, are the exceptions: they
  have no caller check and answer any role that holds EXECUTE (3.8). They return only a device id for a presented
  token and a boolean.
- The `app_private` helpers describe only the caller, and `anon` has no usage on that schema (3.1).
- The bodies, and therefore the caller checks, of the RECONSTRUCTED functions `kiosk_clock_out`,
  `delete_attendance_record` (both definer by inference, sections 3.3 and 3.6) and `set_staff_salary_rate` (security
  mode unknown) are NEEDS VERIFICATION (R1, R2, R4; V1).

For the functions with a repository gate, an extra `anon` grant is a defence-in-depth gap rather than a data leak.

Retry semantics that matter to these functions (CURRENT): the server client retries only GET and HEAD on 429,
502, 503 and 504; POST, which carries every RPC call, is never retried (`src/lib/supabase/server.ts:26-30`;
`src/lib/supabase/retry-fetch.ts:58-60, 82`). A failed clock-in is never silently applied twice, and the
partial unique index remains the only guard against a human double tap.

### 3.1 `app_private` authorization helpers

CURRENT. Each helper resolves the caller from `auth.uid()` alone, pins `search_path = ''` and returns false or
null rather than raising (`M/20260715130000:12-18`). All are `language sql stable security definer`.

| Helper | Body (quoted) | Checks `is_active` | Authoritative |
|---|---|---|---|
| `current_staff_id()` | `select sp.id from public.staff_profiles sp where sp.auth_user_id = (select auth.uid()) limit 1` | no | `M/20260715130000:35-38` |
| `current_staff_role()` (live) | `select sp.role_key from public.staff_profiles sp where sp.auth_user_id = (select auth.uid()) limit 1` | no | `:54-57` |
| `current_staff_role()` (PENDING) | `select case when sp.is_active then sp.role_key else 'inactive' end from ... limit 1` | yes, via the sentinel | `M/20260916120000:53-56` |
| `is_active_staff()` | `select exists (select 1 from public.staff_profiles sp where sp.auth_user_id = (select auth.uid()) and sp.is_active)` | yes | `M/20260715130000:75-80` |
| `is_owner()` | same exists query plus `and sp.role_key = 'owner'` | yes | `:154-160` |
| `has_permission(p_permission_key)` | `select app_private.is_owner() or exists (...)`: a grant held by the caller's active profile | yes | `M/20260716240000:34-43` |

Grants: EXECUTE to `authenticated` (`M/20260715130000:233-243`; `create or replace` in later files keeps it).
Schema: `revoke all on schema app_private from anon; grant usage on schema app_private to authenticated`
(`:246-247`). Reads: `staff_profiles`, `staff_permission_grants`. Writes: none.

Consequences the template must keep:

- A role-title gate written as `if current_staff_role() not in (...) then raise` evaluates to NULL for a
  signed-in user with no profile and skips the raise. `correct_attendance_clock_out` guards this with
  `v_role is null or ...` (`M/20260907130000:30`). The PENDING sentinel keeps NULL for the no-profile case
  (`M/20260916120000:40-43`), so every role gate still needs an explicit `is null` branch.
- `current_staff_id()` never checks `is_active`, so the self branches of `attendance_read`, `attendance_insert`,
  `attendance_update` and `payroll_snapshots_read` still match for a deactivated account whose JWT has not expired.
  The self branch of `report_payroll` matches too, but its row filter also requires `sp.is_active`
  (`M/20260907160000:97-100`), so a deactivated caller receives no row. PENDING section 1 does not change this helper.

### 3.2 `public.kiosk_clock_in(p_staff_id uuid, p_device_id uuid, p_note text) returns uuid`

CURRENT (`M/20260907120000:14-54`). plpgsql, SECURITY DEFINER, `set search_path to ''`, volatility not
declared (VOLATILE). Grants: note a in section 3.0. Reads `staff_profiles`; writes `attendance_records`.

1. Gate (`:25-28`): `if not app_private.is_active_staff() then raise exception 'Not authorized: only active staff
   may operate the time clock.' using errcode = 'insufficient_privilege'`. Any active member may clock any
   target. There is no `hr_attendance` check in SQL; that key gates only the page (`src/app/(app)/admin/attendance/page.tsx:43`)
   and the roster RPC, while the server action checks only active staff (`src/lib/hr/attendance.ts:158`).
2. Target (`:30-37`): `select sp.is_active, sp.is_demo into v_active, v_demo from public.staff_profiles sp where
   sp.id = p_staff_id`; no row raises "That team member could not be found."; `not v_active or v_demo` raises
   "That team member is inactive and cannot clock in.". A Super Admin target is not refused.
3. Insert (`:39-47`): `insert into public.attendance_records (staff_profile_id, note, device_id, work_date) values
   (p_staff_id, nullif(btrim(p_note), ''), p_device_id, (now() at time zone '<business-tz>')::date) returning id`.
   `time_in` takes its default `now()`; the insert trigger sets the night columns.
4. `exception when unique_violation then raise exception 'That team member is already clocked in. Clock out
   first.'` (`:48-49`).
5. Device: `p_device_id` is stored, not validated. The server action resolves it from the cookie first
   (`attendance.ts:161-169`). PENDING section 10 adds the database check (section 7).
6. Returns the new record id, which the kiosk uses to attach the selfie (`src/components/hr/attendance-clock.tsx:157-166`).

The kiosk form never sends a note. The file exists because the column default filed an early-morning clock-in
under the previous UTC date and could miscount `days_worked` (`:3-8`).

### 3.3 `public.kiosk_clock_out(p_staff_id uuid) returns uuid` (RECONSTRUCTED, R1)

- Signature: called with `{ p_staff_id }` only; the returned value is used as the closed record id for the
  audit event and the clock-out selfie (`src/lib/hr/attendance.ts:218-236`).
- SECURITY DEFINER is inferred: `M/20260805160000:2-4` says the kiosk clock "already allows any active staff on
  the approved device", while `attendance_update` allows only own rows or a Super Admin, so closing another
  member's session must bypass RLS.
- Expected effect: set `time_out` on the target's single open session and return its id, as the dead direct path
  does for the caller (`attendance.ts:318-323`). Gate, messages, target checks and whether it writes a device
  are NEEDS VERIFICATION (V1).
- It has no device argument, so the database cannot tie a clock-out to a device; the PENDING migration does not
  change that.
- Language, volatility, search_path and grants: NEEDS VERIFICATION (V1, V9, V13).

### 3.4 `public.list_clock_staff() returns table(id uuid, full_name text, role_key text)`

CURRENT (`M/20260907160000:9-27`). plpgsql, SECURITY DEFINER, `set search_path to ''`, VOLATILE by default.
Grants: `M/20260806260000:17, 33-34`, kept by `create or replace`. Reads `staff_profiles`; writes none.

- Gate (`:16-19`): `if not app_private.has_permission('hr_attendance') then raise exception 'Not authorized:
  attendance access is required to view the clock roster.' using errcode = 'insufficient_privilege'`.
- Body (`:20-25`): `return query select sp.id, sp.full_name, sp.role_key from public.staff_profiles sp where
  sp.is_active and sp.role_key <> 'owner' order by sp.full_name`. Name and role only, no email or other
  personal data (`M/20260805160000:7-9`).
- Not filtered: `is_demo`. A demo profile appears in the kiosk list and is then refused by `kiosk_clock_in`.
- Callers: kiosk roster (`src/app/(app)/admin/attendance/page.tsx:73`) and the Review employee filter
  (`src/app/(app)/admin/attendance/review/page.tsx:32`). A reviewer who holds `hr_review_attendance` but not
  `hr_attendance` gets the exception, which the reader turns into an empty roster (`attendance.ts:102`).

### 3.5 `public.correct_attendance_clock_out(p_record_id uuid, p_time_out timestamptz, p_reason text) returns timestamptz`

CURRENT (`M/20260907130000:13-63`). plpgsql, SECURITY DEFINER, `set search_path to ''`, VOLATILE by default.
Grants: `revoke execute ... from anon, public; grant execute ... to authenticated, service_role` (`:65-68`).
Reads and writes `attendance_records`.

1. Gate by role title, not permission (`:29-33`): `v_role := app_private.current_staff_role(); if v_role is null
   or v_role not in ('owner', 'selected_admin') then raise exception 'Not authorized: only the Owner or Selected
   Admin may correct attendance.' using errcode = 'insufficient_privilege'`.
2. Validation: reason non-blank after trim (`:27, 35-37`); record exists (`:39-43`); `p_time_out` not null
   (`:45-47`), not before `time_in` (`:48-50`), not after `now()` (`:51-53`). There is no check against the
   member's next session and no age limit.
3. Write (`:55-59`): `update public.attendance_records set time_out = p_time_out, edited_by =
   app_private.current_staff_id(), edit_reason = v_reason where id = p_record_id`. In place: an earlier editor
   and reason are overwritten. Applied to an open session it closes that session.
4. Returns the OLD `time_out` (`:61`). The server action stores it in the audit context
   (`src/lib/hr/attendance.ts:447-456`); the function itself writes no audit row.
5. PENDING section 1 makes the gate refuse a deactivated Super Admin or Admin.

Only the clock-out can be corrected; there is no clock-in correction, no note edit and no "add a missed
session" path. The file comment says the night bonus "keys off clock-in" (`:9-10`); that holds for the trigger
columns but not for `report_payroll`, whose night rule reads `time_out` (`M/20260907160000:41`), so a correction
can add or remove a paid night shift (`PAYROLL.md`). The Review modal seeds the input from `time_out`, or from
`time_in` for an open session, truncated to the minute and shown in the browser's local timezone; the value is
converted back to an ISO instant on submit (`src/components/hr/review-attendance-view.tsx:674-679, 707, 713`). An
unchanged save on an open session is therefore usually refused by rule 2 ("Clock-out cannot be before clock-in.",
`M/20260907130000:48-50`), because `time_in` normally carries seconds from `now()`; when `time_in` lies exactly on a
whole minute, the save is accepted and closes the session at zero length. An unchanged save on a completed session
rewrites `time_out` to the start of its minute and stamps `edited_by` and `edit_reason` (`M/20260907130000:55-59`).

### 3.6 `public.delete_attendance_record(p_record_id uuid)` (RECONSTRUCTED, R2)

- Callers: `src/lib/hr/attendance.ts:367-370` (direct, after `requireOwnerOrAdmin()` at `:352`) and
  `src/lib/fulfillment/service.ts:735-739` (execution of an approved `attendance_delete` request). The return
  value is ignored.
- Gate per comments: `current_staff_role() in ('owner','selected_admin')` (`src/lib/authz/guard.ts:322-323`;
  `M/20260907130000:7`). Whether it handles the NULL role (section 3.1) is unknown.
- It must be SECURITY DEFINER or run as a bypass role: `authenticated` holds no DELETE on the table.
- Effect: permanent deletion of one session (`attendance.ts:341-347`). Whether it also deletes selfie metadata,
  refuses open sessions or sessions inside an issued payslip period, or writes an audit row is NEEDS VERIFICATION
  (V1).
- The server action requires the typed word `DELETE` before calling (`src/lib/hr/actions.ts:143-148`).
- Language, volatility and grants: NEEDS VERIFICATION (V1, V9, V13).

### 3.7 `public.attendance_apply_overtime() returns trigger`

CURRENT (`M/20260722200000:26-44`). plpgsql, no SECURITY clause (INVOKER), `set search_path to ''`. Attached
as `attendance_apply_overtime_biu` BEFORE INSERT FOR EACH ROW (`:46-49`). Reads and writes only the NEW row.

Body (`:31-43`): `v_hour := extract(hour from (coalesce(new.time_in, now()) at time zone '<business-tz>'));
if v_hour >= 22 then new.is_overtime := true; new.overtime_amount := 300.00; else new.is_overtime := false;
new.overtime_amount := 0; end if; return new;`

This is the first of the two night rules (section 3.9 has the second). Whether production replaced it is R13.

### 3.8 Device functions

CURRENT (`M/20260722150000:42-80`; grants `M/20260722170000:8-18`). All SECURITY DEFINER with
`set search_path = ''`.

| Function | Language, volatility | Gate | Reads | Writes | Lines |
|---|---|---|---|---|---|
| `register_attendance_device(p_label text, p_token text) returns uuid` | plpgsql, VOLATILE | active Super Admin, inline | `staff_profiles` | `attendance_devices` | `:42-55` |
| `verify_attendance_device(p_token text) returns uuid` | sql, STABLE | none (any `authenticated`) | `attendance_devices` | none | `:58-63` |
| `attendance_gating_active() returns boolean` | sql, STABLE | none (any `authenticated`) | `attendance_devices` | none | `:66-69` |
| `revoke_attendance_device(p_id uuid) returns void` | plpgsql, VOLATILE | active Super Admin, inline | `staff_profiles` | `attendance_devices` | `:72-79` |

Bodies, quoted:

- Register gate (`:46-48`): `select sp.id into v_owner from public.staff_profiles sp where sp.auth_user_id =
  auth.uid() and sp.role_key = 'owner' and sp.is_active; if v_owner is null then raise exception 'Not authorized';`
- Register writes (`:49-53`): `update public.attendance_devices set is_active = false, revoked_at = now() where
  is_active;` then `insert into public.attendance_devices (label, token_hash, registered_by) values
  (coalesce(nullif(trim(p_label), ''), <default label>), encode(extensions.digest(p_token, 'sha256'), 'hex'), v_owner)`.
- Verify (`:60-62`): `select id from public.attendance_devices where is_active and token_hash =
  encode(extensions.digest(p_token, 'sha256'), 'hex') limit 1`.
- Gating (`:68`): `select exists (select 1 from public.attendance_devices where is_active)`.
- Revoke (`:75-78`): the same inline Super Admin check, then `update public.attendance_devices set is_active =
  false, revoked_at = now() where id = p_id`.

Application side (CURRENT): the token is 32 random bytes as hex (`src/lib/hr/devices.ts:75`), stored in an
httpOnly, secure, `sameSite = lax` cookie with a 365-day max age (`:83-89`); the cookie name is brand-prefixed
(section 11). `isAttendanceGatingActive()` returns `response.data === true` (`:40-41`), so an RPC error reads as
"gating off". Hashing needs pgcrypto reachable as `extensions.digest` (V16). Register and revoke are also
guarded by `requireOwner()` in TypeScript (`:69`, `:104`).

### 3.9 `public.report_payroll(p_from date, p_to date)`

CURRENT (`M/20260907160000:29-102`). `language sql`, `stable`, `set search_path to ''`, no SECURITY clause,
so INVOKER: the caller's RLS applies to every table it reads. Grants: R11. Reads `attendance_records` (under
`attendance_read`), `staff_profiles` (under `staff_profiles_read`), `staff_salary_rates` (under its unknown RLS)
and `app_private.night_ot_bonus()`. Writes nothing.

Version history: v1 hours times `staff_profiles.hourly_rate`, explicitly `security invoker`
(`M/20260717120000:85-136`); v2 DROP and CREATE adding an `hourly_rate` output, grants re-applied
(`M/20260721100000:18-74`); v3 adds `and not sp.is_demo` (`M/20260722160000:20-62`); an out-of-band daily-model
rewrite (by name, production migrations 12 and 16; NEEDS VERIFICATION, V11); v4, the current body, excludes Super
Admins. Its header claims `create or replace` "preserves existing grants" (`M/20260907160000:6-7`), which is true
only relative to the out-of-band version.

The body, quoted with comments omitted, the timezone literal replaced and the RETURNS line wrapped:

```sql
create or replace function public.report_payroll(p_from date, p_to date)
 returns table(staff_profile_id uuid, full_name text, role_key text, total_hours numeric,
   overtime_hours numeric, days_worked integer, night_shifts integer, daily_rate text,
   pay_frequency text, overtime_pay text, computed_salary text)
 language sql
 stable
 set search_path to ''
as $function$
  with sessions as (
    select
      a.staff_profile_id,
      a.work_date,
      extract(epoch from (a.time_out - a.time_in)) / 3600.0 as hours,
      ((a.time_out at time zone '<business-tz>')::time >= time '22:00') as night_out
    from public.attendance_records a
    where a.time_out is not null
      and a.work_date between p_from and p_to
  ),
  totals as (
    select
      staff_profile_id,
      sum(hours) as total_hours,
      sum(greatest(hours - 8, 0)) as overtime_hours,
      count(distinct work_date)::int as days_worked,
      count(distinct work_date) filter (where night_out)::int as night_shifts
    from sessions
    group by staff_profile_id
  ),
  effective_rate as (
    select sp.id as staff_profile_id,
      (
        select r.daily_rate from public.staff_salary_rates r
        where r.staff_profile_id = sp.id and r.effective_date <= p_to
        order by r.effective_date desc, r.created_at desc
        limit 1
      ) as rate,
      (
        select r.pay_frequency from public.staff_salary_rates r
        where r.staff_profile_id = sp.id and r.effective_date <= p_to
        order by r.effective_date desc, r.created_at desc
        limit 1
      ) as frequency
    from public.staff_profiles sp
  )
  select
    sp.id,
    sp.full_name,
    sp.role_key,
    round(coalesce(t.total_hours, 0), 2) as total_hours,
    round(coalesce(t.overtime_hours, 0), 2) as overtime_hours,
    coalesce(t.days_worked, 0) as days_worked,
    coalesce(t.night_shifts, 0) as night_shifts,
    er.rate::text as daily_rate,
    coalesce(er.frequency, 'weekly') as pay_frequency,
    (coalesce(t.night_shifts, 0) * app_private.night_ot_bonus())::text as overtime_pay,
    case
      when er.rate is null then null
      else round(
        coalesce(t.days_worked, 0) * er.rate
        + coalesce(t.night_shifts, 0) * app_private.night_ot_bonus(),
        2
      )::text
    end as computed_salary
  from public.staff_profiles sp
  left join totals t on t.staff_profile_id = sp.id
  left join effective_rate er on er.staff_profile_id = sp.id
  where sp.is_active
    and not sp.is_demo
    and sp.role_key <> 'owner'
    and (sp.id = app_private.current_staff_id() or app_private.is_owner())
  order by sp.full_name;
$function$;
```

What the formula means (CURRENT):

- Pay: `computed_salary = round(days_worked x daily_rate + night_shifts x night_ot_bonus(), 2)`, or null when no
  rate row is effective on `p_to` (`:86-93`). Salary is never invented.
- Hours: each completed session's duration in hours, unrounded, summed; totals rounded to 2 decimals (`:39, 49, 79`).
  Open sessions are excluded (`:43`). A session belongs entirely to its stored `work_date`; it is never split at
  midnight or at a period boundary (`:44`, inclusive on both ends).
- `overtime_hours`: `greatest(hours - 8, 0)` per session, summed, reported only; pay never uses it (`:50-51`).
- `days_worked`: distinct `work_date` values with at least one completed session; no minimum duration (`:52`).
- `night_shifts`: distinct `work_date` values with at least one session whose clock-out time of day in
  `<business-tz>` is at or after 22:00, so at most one bonus per day (`:41, 53-55`). A clock-out after midnight
  is not night (00:30 is before 22:00).
- Rate: one rate for the whole period, the newest row effective on the period END; no proration (`:59-74`).
  `pay_frequency` defaults to `weekly` when null and drives nothing (`:84`).
- `overtime_pay` is `night_shifts x night_ot_bonus()` as text, not rounded (`:85`).
- Row filter (`:97-100`): active, not demo, not a Super Admin, and either the caller's own row or any row for a
  Super Admin. An Admin holding `hr_payroll` receives only their own row.
- Money leaves SQL as text and is never parsed to a float (`src/lib/hr/payroll.ts:38-68`).

Consequences (CURRENT):

- The two night rules disagree. A 14:00 to 22:30 shift earns the payroll bonus but carries no session flag; a
  22:15 to 00:30 shift carries the flag but earns no payroll bonus. `PAYROLL.md` section 4 covers the behaviour.
- Because the function runs with invoker rights, `night_ot_bonus()` must be executable by `authenticated` and
  `staff_salary_rates` must be readable by the caller for their own row (R5, R3).
- The pgTAP suite asserts `prosecdef = false` and that `anon` cannot execute it
  (`supabase/tests/26_hr_attendance.test.sql:66-76`), but it still expects an `hourly_rate` output column
  (`:142-148`), so the suite is stale against the current body.

### 3.10 `public.generate_payslip_snapshot(p_employee uuid, p_from date, p_to date, p_deductions numeric default 0) returns public.payroll_snapshots`

Repository version: CURRENT text but STALE (`M/20260722210000:75-132`). plpgsql, `security invoker`,
`set search_path to ''`, VOLATILE by default. Grants: `grant execute ... to authenticated` (`:134-135`), no PUBLIC
revoke. Reads `report_payroll` and `attendance_records`; writes `payroll_snapshots`.

1. `select total_hours, overtime_hours, nullif(hourly_rate, '')::numeric into v_reg_hours, v_ot_hours, v_rate
   from public.report_payroll(p_from, p_to) where staff_profile_id = p_employee`; no row raises "No payroll row
   for this employee in the selected period." (`:97-104`). The current `report_payroll` has no `hourly_rate`
   column, so this body cannot be the one running on production.
2. `select coalesce(sum(overtime_amount), 0) into v_ot_pay from public.attendance_records where
   staff_profile_id = p_employee and time_out is not null and work_date between p_from and p_to` (`:107-111`):
   the session flag amounts, not capped per day.
3. `v_regular_salary := round(coalesce(v_reg_hours, 0) * coalesce(v_rate, 0), 2)`; `v_gross := v_regular_salary +
   coalesce(v_ot_pay, 0)` (`:113-114`); `v_deductions := greatest(coalesce(p_deductions, 0), 0)` (`:93`). With no
   rate this stores a zero salary, unlike `report_payroll`, which returns null.
4. Insert with `net_salary = v_gross - v_deductions` and `generated_by = app_private.current_staff_id()`
   (`:116-128`). The Super-Admin-only INSERT policy is the real gate (`:71-73`).

Live version (RECONSTRUCTED, R9; by name, probably production name 13, NEEDS VERIFICATION, V11):

- Evidence that the live table has `daily_rate`, `days_worked`, `night_shifts` and `rate_basis`: the list reader
  and the read-back select them by name (`src/lib/hr/payslip.ts:52-53`; `src/lib/hr/payslip-actions.ts:78-80`),
  the type comment calls `daily` the current basis (`src/lib/hr/payslip-types.ts:21-22`), and production name 13
  points the same way. No repository SQL writes these columns.
- Presumed, consistent with `report_payroll` but NEEDS VERIFICATION (V1): `regular_salary = days_worked x daily_rate`;
  `overtime_pay` either `night_shifts x night_ot_bonus()` or `sum(overtime_amount)`; `gross = regular_salary +
  overtime_pay`; `net = gross - greatest(coalesce(p_deductions, 0), 0)`. The unit-test fixture is not evidence
  (`tests/unit/payslip-button.test.tsx:13-34` pairs a daily basis with an hourly-looking figure).
- Security mode, the no-row guard, a no-rate guard, a duplicate-period guard and grants: NEEDS VERIFICATION (V1, V9).

Deductions (CURRENT): one amount supplied at generation, validated in TypeScript as digits with up to two
decimals (`payslip-actions.ts:48-55`), clamped to at least 0 in SQL and checked by the column. No line items, no
reason, no statutory rules, no later edit. Because `net_salary` has no check, deductions above gross give a
negative net. Generation is gated by `requireOwner()` in TypeScript (`payslip-actions.ts:28`).

### 3.11 `public.set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective)` (RECONSTRUCTED, R4)

- Parameters as named by the call (`src/lib/hr/rate.ts:223-228`); `p_daily_rate` is sent as a string and cast by
  Postgres. Effect by comment: append a `staff_salary_rates` row (`rate.ts:193-199`).
- Authority: neither `setHourlyRateAction` (`src/lib/hr/actions.ts:210-228`) nor `setSalaryRate` (`rate.ts:201-244`)
  checks the caller, so the function is the only gate. Its comment says "Super Admin only"; the UI offers the
  editor to Super Admin and Admin (`src/app/(app)/admin/payroll/page.tsx:43-44`). Which roles the database
  allows, and whether a NULL role is refused: NEEDS VERIFICATION (V1).
- Validation known only on the application side: amount of 1 to 10 digits with up to 2 decimals, frequency in
  (`weekly`, `bi_weekly`, `monthly`), effective date required (`rate.ts:209-220`).
- Audit: `payroll.set_salary_rate` on success only (`rate.ts:233-238`).
- PENDING section 2 revokes PUBLIC and anon EXECUTE if the live function is a definer function.

### 3.12 `public.set_staff_hourly_rate(p_staff, p_rate, p_effective)` (RECONSTRUCTED, legacy, R7)

Called only from `setHourlyRate` (`rate.ts:83-88`), which has no caller. It appends to `staff_hourly_rates`.
The template does not port it.

### 3.13 `app_private.night_ot_bonus()` (RECONSTRUCTED, R5)

- Called with no arguments and multiplied by an integer count (`M/20260907160000:85, 90`).
- Every user-facing string says 300 and the trigger literal is `300.00` (`M/20260722200000:37`); the function's
  actual return value, return type, language, security mode, volatility and EXECUTE grant are NEEDS VERIFICATION
  (V1, V9, V17).
- GENERIC form: a settings accessor (section 5.12).

### 3.14 `public.delete_team_member(p_staff_profile_id uuid)` and attendance history

CURRENT (`M/20260722120000:14-57`). Super Admin only; deletes the member's notifications, login devices, scope
assignments, grants, profile and auth user. Because `attendance_records.staff_profile_id`,
`payroll_snapshots.employee_id` and `attachments.uploaded_by` are ON DELETE RESTRICT, a member with attendance,
payslips or uploads cannot be deleted: the transaction aborts and the caller is told to deactivate instead
(`:5-8`). This history-preserving rule is GENERIC. PENDING section 4 also refuses a Super Admin target
(`M/20260916120000:206-208`).

### 3.15 Mark paid: no function

CURRENT. Marking paid is a direct UPDATE from the server action: `payment_status = 'paid'`, `payment_date` =
the posted date or the business date, `paid_at = now`, `paid_by = <actor>`, `where id = ? and payment_status =
'pending'` (`src/lib/hr/payslip-actions.ts:114-135`). The client never posts a date. The action allows Super
Admin or Admin (`:106`) while the repository policy allows only Super Admin (section 2.7).

---

## 4. Per table: GENERIC REQUIRED FIELDS versus CURRENT PROJECT-SPECIFIC FIELDS

GENERIC REQUIRED FIELDS are the engine and must exist in any client's schema (under the generic names of
section 5). CURRENT PROJECT-SPECIFIC FIELDS are tied to the source business or are legacy; each is dropped,
renamed or made CONFIGURABLE.

`attendance_records` (GENERIC name `attendance_sessions`)

- GENERIC REQUIRED FIELDS: `id`; `staff_profile_id` (FK RESTRICT); `work_date` defaulting to the business date;
  `time_in`; `time_out`; `note`; `device_id` (FK SET NULL); `edited_by`; `edit_reason`; `created_at`; check
  `time_out >= time_in`; the one-open-session partial unique index; the `(member, work_date desc)` index; a
  `time_in` index; RLS read for self or a team-read permission; no direct writes.
- CURRENT PROJECT-SPECIFIC FIELDS: `is_overtime` and `overtime_amount` with the clock-in hour 22 and flat 300
  trigger (CONFIGURABLE rule); the timezone literal; unused `clock_in_photo`, `clock_out_photo`, `status`; the
  `provisional_fields` rows.

`attendance_devices`

- GENERIC REQUIRED FIELDS: `id`, `label`, `token_hash` (sha256 hex), `is_active`, `registered_by`, `created_at`,
  `revoked_at`; a read policy for device managers; register, verify, gating and revoke functions.
- CURRENT PROJECT-SPECIFIC FIELDS: "registering revokes every other device" (CONFIGURABLE maximum); the default
  label wording; the brand-prefixed cookie name.

`attachments` (selfie use; GENERIC name `attendance_photos`)

- GENERIC REQUIRED FIELDS: a photo row tied to one session with a clock-in or clock-out kind, `storage_path`,
  `content_type`, `byte_size`, `uploaded_by` RESTRICT, `uploaded_at`; a private bucket; short-lived signed URLs.
- CURRENT PROJECT-SPECIFIC FIELDS: the business entity types and purposes of the polymorphic table; the
  file-name convention that tells in from out; `source`, `image_width`, `image_height` (optional metadata).

`staff_profiles` (GENERIC name `employees`, provided by the host identity module)

- GENERIC REQUIRED FIELDS: `id`, `auth_user_id`, `full_name`, `role_key`, `is_active`, `deactivated_at`,
  `deactivated_reason`, `created_at`, `updated_at`; a "not a real employee" flag (`is_demo`).
- CURRENT PROJECT-SPECIFIC FIELDS: the three-role vocabulary; the Admin cap trigger and the Super Admin cap (R16);
  "Super Admins are not clocked or paid" as a role-title rule; the test-domain email back-fill behind `is_demo`;
  legacy `hourly_rate`; `mfa_enrolled` (not HR).

`staff_salary_rates` (R3; GENERIC name `employee_pay_rates`)

- GENERIC REQUIRED FIELDS: `id`, member FK RESTRICT, rate amount, rate basis, `pay_frequency`, `effective_date`,
  `created_by`, `created_at`; index on `(member, effective_date desc, created_at desc)`; append-only writes.
- CURRENT PROJECT-SPECIFIC FIELDS: the daily-only basis stored as `daily_rate`; the default frequency `weekly`;
  the frequency list.

`staff_hourly_rates` (R6)

- GENERIC REQUIRED FIELDS: none.
- CURRENT PROJECT-SPECIFIC FIELDS: the whole table (legacy).

`payroll_snapshots`

- GENERIC REQUIRED FIELDS: `id`, `employee_id` RESTRICT, `payroll_start_date`, `payroll_end_date` with the period
  check, total hours, `days_worked`, the rate and its basis, `regular_salary`, `overtime_pay`, `gross_salary`,
  `deductions` (at least 0), `net_salary`, `payment_status`, `payment_date`, `paid_at`, `paid_by`, `generated_by`,
  `generated_at`; self or all-rows read; no direct writes.
- CURRENT PROJECT-SPECIFIC FIELDS: `night_shifts` (the flat night-bonus model, CONFIGURABLE); the dual
  `hourly_rate` and `daily_rate` columns; the misnamed `regular_hours`; unused `approved_by`; currency and branding
  on the rendered document (`UI_UX.md`).

`audit_events`

- GENERIC REQUIRED FIELDS: the whole table, the append-only triggers, the self-attributed insert policy, the
  `attendance.*` and `payroll.*` action names.
- CURRENT PROJECT-SPECIFIC FIELDS: specification references in comments; the PENDING read exception for one
  business entity type.

`roles`, `permissions`, `staff_permission_grants`

- GENERIC REQUIRED FIELDS: the grants table with its unique pair, `has_permission`, the attendance and payroll
  keys (renamed in section 5.1).
- CURRENT PROJECT-SPECIFIC FIELDS: every other permission row; `is_request_only` semantics of the business
  approval catalogue.

`owner_approval_requests`

- GENERIC REQUIRED FIELDS (only if the client wants request-then-approve deletion): request, decide and execute
  columns with the kind `attendance_delete` and a request permission present in the access catalogue.
- CURRENT PROJECT-SPECIFIC FIELDS: every other action kind; hosting the executor inside the fulfilment module.

Functions

- GENERIC REQUIRED: the `app_private` helpers, `kiosk_clock_in`, `kiosk_clock_out`, `correct_attendance_clock_out`,
  `delete_attendance_record`, `list_clock_staff`, the device functions, `report_payroll`,
  `generate_payslip_snapshot`, `set_staff_salary_rate`.
- CURRENT PROJECT-SPECIFIC: `night_ot_bonus()` returning a fixed amount; the 22:00 thresholds; the timezone literal;
  the 8-hour display threshold; the role-title gates; `set_staff_hourly_rate`.

---

## 5. GENERIC data model (proposal)

Everything in this section is a proposal. It keeps the architecture that works in the reference
implementation (sessions as rows, days derived by grouping, one SQL computation for payroll, frozen payslip
snapshots, definer functions behind forced RLS, an append-only audit table) and changes only what sections 2 and
3 show to be missing, hard-coded or unsafe. Function names that already exist in the reference implementation
are kept so the other documents in this folder keep referring to the same objects; tables get neutral names and
section 5.14 maps them. Types are Postgres types. Setting keys and their recommended defaults are those of
`CONFIGURATION.md` section 2; this section never restates a default.

### 5.1 Design principles and permission keys

1. One row per session; a day is `group by (employee_id, work_date)` (section 5.4).
2. Every write to attendance or payroll goes through a SECURITY DEFINER function with `set search_path = ''`
   that derives the caller from `auth.uid()`. Tables keep RLS enabled and forced, with SELECT policies only and no
   INSERT, UPDATE or DELETE grant to `authenticated`. This closes the direct-write gap of section 2.1.
3. Every gate is `app_private.has_permission(<key>)` inside the function or policy; TypeScript guards mirror the
   same key for messages only (`PERMISSIONS.md` sections 4.1 and 4.3). No role-title gate remains.
4. Helper names stay as in the reference implementation, with two changes. `current_staff_id()` returns null for an
   inactive profile (`PERMISSIONS.md` section 4.1 principle 5; PENDING section 1 does not change this helper, see
   sections 3.1 and 7). `current_staff_role()` returns the `'inactive'` sentinel, carried from PENDING section 1
   (`M/20260916120000:46-57`). Every comparison treats NULL as refusal.
5. Payroll money is computed in exactly one SQL function (section 5.13) and rounded once; money crosses to the
   application as text.
6. Timezone, night rule, amounts, device mode and exclusions are settings read by SQL, never literals (5.12).
7. SQL functions write their own success audit rows in addition to the application, so a successful direct RPC call
   leaves the same trace (5.11); refusal rows follow the typed-refusal or server-layer rule of 5.13.
8. Every function migration ends with `revoke all on function ... from public, anon` and `grant execute ... to
   authenticated, service_role`, including functions re-created with DROP and CREATE. Exceptions: trigger functions,
   the audit writer and any private function that does not filter by the caller get no EXECUTE for an end-user role
   (revoke it from `authenticated` explicitly if default privileges granted it); triggers fire without the caller's
   EXECUTE, and definer functions call the writer as their owner.

Permission key mapping. The template keys are the eleven keys of `PERMISSIONS.md` section 4.2, which wins if a name
changes. The only other key used in this section is the optional `attendance.delete.request` (second bullet below the
table). Own-row access needs no key (`PERMISSIONS.md` section 4.1 principle 7).

| CURRENT gate | Template key |
|---|---|
| `hr_attendance` on the page, the loader and `list_clock_staff`; active staff on the clock write | `attendance.clock_operate` |
| `hr_review_attendance` as the third branch of `attendance_read` | `attendance.view_team` |
| `hr_review_attendance` on the Review page and the selfie reader | `attendance.review` |
| role title Super Admin or Admin on `correct_attendance_clock_out` | `attendance.correct` |
| role title Super Admin or Admin on `delete_attendance_record` | `attendance.delete` |
| `initiate_high_risk_action` for an `attendance_delete` request | optional `attendance.delete.request`, outside 4.2 (see below) |
| inline Super Admin check in the device functions and policy | `attendance.devices.manage` |
| `hr_payroll` on the page | no key: the page opens for any `payroll.*` key except `payroll.export`, and per `payroll.selfView` |
| self branches of `attendance_read`, `report_payroll` and `payroll_snapshots_read` | no key: `employee_id = app_private.current_staff_id()` |
| `is_owner()` branch of `report_payroll` and `payroll_snapshots_read` | `payroll.view_all` |
| no TypeScript guard; live-only `set_staff_salary_rate` gate | `payroll.rates.edit` |
| `requireOwner()` and the Super Admin INSERT policy on `payroll_snapshots` | `payroll.payslip.generate` |
| `requireOwnerOrAdmin()` versus the Super Admin UPDATE policy on `payroll_snapshots` | `payroll.payslip.mark_paid` |
| export route role check | `payroll.export` |

- Own rows. Every own-row branch in this section is `employee_id = app_private.current_staff_id()` with no key, as
  the CURRENT self branches behave (`M/20260804140000:11`; `M/20260907160000:100`; `M/20260722210000:54`). Because the
  template helper returns null for an inactive profile (principle 4), the branch admits active members only.
  `attendance.selfView` and `payroll.selfView` decide only whether self-service screens exist, not what RLS returns
  (`CONFIGURATION.md` section 2.3).
- `attendance.delete.request` is not one of the `PERMISSIONS.md` section 4.2 keys: 4.2 drops the request path by
  default. The key exists only when `attendance.deletion.requestApprovalPath` is true, and it must then be listed in
  the access catalogue and checked by the request insert policy (`CONFIGURATION.md` sections 2.3 and 2.4; 5.13).

### 5.2 `employees` (maps to the `staff_profiles` subset)

The template does not own identity. It requires an identity table with these columns; in the reference
implementation it is `staff_profiles` and the mapping is one to one except `timekeeping_exempt`.

```
employees                      -- provided by the host identity module
  id                    uuid primary key default gen_random_uuid()
  auth_user_id          uuid not null unique references auth.users(id) on delete restrict
  full_name             text not null check (length(trim(full_name)) between 1 and 120)
  role_key              text not null references roles(key) on update cascade
  is_active             boolean not null default true
  deactivated_at        timestamptz
  deactivated_reason    text
  is_demo               boolean not null default false     -- not a real employee
  timekeeping_exempt    boolean not null default false     -- RECOMMENDED: not clocked, not on payroll
  created_at            timestamptz not null default now()
  updated_at            timestamptz not null default now()
  constraint employees_deactivation_ck
    check ((is_active and deactivated_at is null) or (not is_active and deactivated_at is not null))
```

- Timestamps: `created_at`, `updated_at` (maintained by a BEFORE UPDATE trigger), `deactivated_at`.
- Status: `is_active` with `deactivated_at`.
- Eligibility predicate (RECOMMENDED TEMPLATE IMPROVEMENT): `app_private.is_timekeeping_eligible(p_employee_id uuid)
  returns boolean` is true when the employee is active, is not demo (`exclusions.excludeDemoAccounts`, fixed true)
  and is not `timekeeping_exempt`. The roster, both clock functions, the payroll computation and the rates reader
  all call it, so the CURRENT split (roster excludes Super Admins while `kiosk_clock_in` accepts them; roster lists
  demo accounts while `kiosk_clock_in` refuses them) cannot recur.
- `exclusions.excludedRoles` seeds the flag: a BEFORE INSERT OR UPDATE OF `role_key` trigger sets
  `timekeeping_exempt = true` when the new role is in the list. Moving out of an excluded role leaves the flag
  as it is, so un-exempting is always an explicit per-profile edit. Runtime checks read only the flag.
- RLS as CURRENT: SELECT for Super Admin or self; writes owned by the identity module. Readers that need other
  members' names use definer functions (5.13), never a profile embed.
- A primary Super Admin concept, if the host needs one (`CONFIGURATION.md` section 1.7), is an identity-module
  flag with a partial unique index; attendance and payroll never read it.

### 5.3 `attendance_sessions` (= `attendance_records`, one row per session)

```
attendance_sessions
  id                    uuid primary key default gen_random_uuid()
  employee_id           uuid not null references employees(id) on delete restrict
  work_date             date not null default app_private.business_today()
  time_in               timestamptz not null default now()
  time_out              timestamptz
  note                  text check (note is null or length(trim(note)) <= 500)
  clock_in_device_id    uuid references attendance_devices(id) on delete set null
  clock_out_device_id   uuid references attendance_devices(id) on delete set null
  clock_in_by           uuid not null references employees(id) on delete restrict    -- operator
  clock_out_by          uuid references employees(id) on delete restrict
  edited_by             uuid references employees(id) on delete restrict
  edited_at             timestamptz
  edit_reason           text
  deleted_at            timestamptz                  -- used only when attendance.deletion.mode = 'soft'
  deleted_by            uuid references employees(id) on delete restrict
  delete_reason         text
  created_at            timestamptz not null default now()
  constraint attendance_sessions_out_after_in check (time_out is null or time_out >= time_in)
  constraint attendance_sessions_out_pair check ((time_out is null) = (clock_out_by is null))
  constraint attendance_sessions_edit_triplet
    check ((edited_by is null) = (edited_at is null) and (edited_by is null) = (edit_reason is null))
  constraint attendance_sessions_delete_triplet
    check ((deleted_at is null) = (deleted_by is null) and (deleted_at is null) = (delete_reason is null))

indexes
  attendance_sessions_one_open_uq    unique (employee_id) where time_out is null and deleted_at is null
  attendance_sessions_emp_date_idx   (employee_id, work_date desc)
  attendance_sessions_work_date_idx  (work_date, employee_id)       -- period scans by payroll
  attendance_sessions_time_in_idx    (time_in desc)                 -- R10 made explicit
```

- PK `id`. FKs: employee RESTRICT (history survives, as CURRENT), devices SET NULL, actor columns RESTRICT.
- Timestamps: `time_in`, `time_out`, `created_at`, `edited_at`, `deleted_at`. Status: derived (open when
  `time_out is null`; deleted when `deleted_at is not null`). No stored status column.
- The partial unique index is the same invariant as CURRENT, ignoring soft-deleted rows.
- The note limit is the column check (500 characters after trimming), as CURRENT. It is engine, not a setting:
  `CONFIGURATION.md` section 2 defines no note-length key.
- `clock_out_by` is null exactly while the session is open. A correction that closes a session sets
  `clock_out_by` to the corrector, alongside `edited_by`.
- Night flag: no stored column and no trigger (`CONFIGURATION.md` section 2.6 and its section 7 row "Night
  predicate"). Payroll, the payslip function and any list badge call the single predicate
  `app_private.is_night_session(time_in, time_out)` (5.12), directly or through a view. A generated column cannot be
  used: the predicate reads settings, and Postgres accepts only immutable expressions in generated columns. Because
  nothing is stored, a corrected `time_out` changes the badge and the payroll count on the next read, unlike the
  CURRENT INSERT-only trigger (section 3.7).
- RLS: enable and force. One policy: SELECT to `authenticated` USING
  `employee_id = app_private.current_staff_id() or app_private.has_permission('attendance.view_team')`. Readers
  filter `deleted_at is null`. No INSERT, UPDATE or DELETE policy or grant.
- Realtime: add to the publication with REPLICA IDENTITY FULL if the client refreshes screens on change.
- Differences from CURRENT: night columns and unused columns removed; operator and clock-out device recorded;
  `edited_at` added; optional soft delete; direct writes closed.

### 5.4 Why a separate `attendance_days` table is not needed

The reference implementation stores only sessions, and both readers compute the day:

- TypeScript: one entry per `(staff_profile_id, work_date)`, total = sum of completed session durations, gaps
  between sessions never counted (`src/lib/hr/sessions.ts:4-17`).
- SQL: `days_worked = count(distinct work_date)` and `night_shifts = count(distinct work_date) filter (...)`
  (`M/20260907160000:52-55`).

Why this should stay:

1. Integrity needs no parent row. The partial unique index guarantees one open session; a second session on the
   same date ("Continue Duty") is just another row, so there is no day row to create, keep in sync or repair.
2. Payroll needs only aggregates that are cheap at read time (distinct dates, summed intervals). A correction or a
   deletion is reflected on the next read with no recomputation step, while issued payslips stay frozen.
3. There is no stored total that can drift from its sessions.

A day table becomes necessary only for day-level attributes that are not derivable from sessions: an approval
decision, a reviewer note, a lateness or undertime flag decided by a person. Section 5.5 adds exactly that,
without restructuring sessions.

### 5.5 OPTIONAL `attendance_day_reviews` (RECOMMENDED TEMPLATE IMPROVEMENT)

The reference implementation has no approval, finalization or lock state: the `status` column is unused, payroll
counts every completed session (`M/20260907160000:43-44`), and "payroll from approved attendance only" was deferred
and never built (`docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212`). Corrections and deletions remain possible after a
payslip is issued. A client that wants approval adds:

```
attendance_day_reviews
  employee_id   uuid not null references employees(id) on delete restrict
  work_date     date not null
  status        text not null default 'pending' check (status in ('pending', 'approved'))
  reviewed_by   uuid references employees(id) on delete restrict
  reviewed_at   timestamptz
  note          text
  updated_at    timestamptz not null default now()
  primary key (employee_id, work_date)
  constraint attendance_day_reviews_decided check (status = 'pending' or (reviewed_by is not null and reviewed_at is not null))
```

Rules, each behind a `CONFIGURATION.md` setting and off by default:

- `payroll.approvalRequired`: the payroll computation counts only sessions whose `(employee_id, work_date)` row is
  `approved`. Any correction or deletion of a session resets that day's row to `pending`, so an approval never
  covers changed data.
- `payroll.lockPeriodAfterPayslip` (`off`, `generated`, `paid`): `correct_attendance_clock_out` and
  `delete_attendance_record` refuse a session whose `work_date` lies inside the period of a current (not superseded,
  not void) payslip for that employee, as soon as that payslip exists (`generated`) or once it is paid (`paid`). This
  lock reads `payroll_snapshots` and needs no column here.
- Writer: a definer `review_attendance_day(p_employee_id uuid, p_work_date date, p_status text, p_note text)`
  gated by `attendance.correct`, because approving a day fixes the figures payroll will use. That is the default of
  `PERMISSIONS.md` section 4.2 ("Day approval"); a client may add a separate approval key there.
- RLS: enable and force; SELECT for self or `attendance.view_team`; no direct writes.

### 5.6 `attendance_devices`

```
attendance_devices
  id              uuid primary key default gen_random_uuid()
  label           text not null check (length(trim(label)) between 1 and 80)
  token_hash      text not null unique                -- sha256 hex of the cookie token
  is_active       boolean not null default true
  registered_by   uuid not null references employees(id) on delete restrict
  created_at      timestamptz not null default now()
  revoked_at      timestamptz
  revoked_by      uuid references employees(id) on delete restrict
  constraint attendance_devices_active_ck check (is_active = (revoked_at is null))
  constraint attendance_devices_revoked_pair check ((revoked_at is null) = (revoked_by is null))
```

- Status: `is_active`, tied to `revoked_at` by a check (CURRENT sets both but does not enforce the pair).
- Maximum active devices: `attendance.device.maxActiveDevices`, enforced inside `register_attendance_device` under
  a table lock. With a maximum of 1 and "replace" behaviour the CURRENT rule (deactivate all, then insert) is
  reproduced; a larger maximum refuses registration once full.
- Gate mode `attendance.device.mode`: `off` never checks; `auto` checks whenever an active device exists (CURRENT);
  `required` always checks, so a client with no registered device cannot clock.
- Where the check runs is engine, not a setting (`CONFIGURATION.md` section 2.4): whenever the mode calls for a
  check, both clock functions hash the token passed by the server action and compare it with active rows, so the
  check is bound to the token hash rather than to a readable device id (5.13). `attendance.device.failMode` governs
  only the TypeScript pre-check that produces the operator message and the blocked-device audit event.
- RLS: enable and force; SELECT USING `app_private.has_permission('attendance.devices.manage')`; an explicit column
  `grant select` to `authenticated` that leaves out `token_hash`; no write grants.

### 5.7 `attendance_photos` (replaces the polymorphic `attachments` usage)

```
attendance_photos
  id              uuid primary key default gen_random_uuid()
  session_id      uuid not null references attendance_sessions(id) on delete cascade
  kind            text not null check (kind in ('clock_in', 'clock_out'))
  storage_bucket  text not null                       -- a dedicated private bucket
  storage_path    text not null check (length(trim(storage_path)) between 1 and 400)
  content_type    text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp'))
  byte_size       bigint not null check (byte_size between 0 and 10485760)
  image_width     integer check (image_width is null or image_width > 0)
  image_height    integer check (image_height is null or image_height > 0)
  uploaded_by     uuid not null references employees(id) on delete restrict
  uploaded_at     timestamptz not null default now()
  constraint attendance_photos_unique_path unique (storage_bucket, storage_path)
  constraint attendance_photos_one_per_kind unique (session_id, kind)
```

- A real FK replaces the polymorphic pair, `kind` replaces the file-name substring, and one photo per kind is
  enforced. ON DELETE CASCADE removes the metadata row with a hard-deleted session; soft delete keeps it.
- Writer: `attach_attendance_photo` (5.13), which accepts a photo only from the operator recorded on that session
  for that kind (`clock_in_by` or `clock_out_by`) and only for a storage path under that session prefix for that kind,
  so no one can attach an image to an arbitrary session.
- Read: RLS SELECT USING `exists (select 1 from attendance_sessions s where s.id = session_id and (s.employee_id =
  app_private.current_staff_id() or app_private.has_permission('attendance.review')))`, with the same predicate on
  the bucket's `storage.objects` read policy. Bytes are served through short-lived signed URLs
  (`retention.signedUrlTtlSeconds`). The `exists` subquery runs under the caller's RLS on `attendance_sessions`, so a
  reviewer sees other members' photos only while also holding `attendance.view_team`; the dependency
  `attendance.review` requires `attendance.view_team` (`PERMISSIONS.md` section 4.3) is enforced by the grant-saving
  function, not by this policy.
- Retention (`retention.selfieRetentionDays`, `retention.deleteSelfieWithRecord`): a scheduled server-side job with
  the service-role key deletes objects through the Storage API, because object rows may be protected from SQL
  deletes (R15). The job reads its project URL from the environment.
- `attendance.selfie.mode = 'required'` is not built in the template and fails configuration validation
  (`CONFIGURATION.md` section 2.9 rule 8); if a client ever needs it, it needs a database check (the clock-out or a
  later review refuses a session without its photo). `off` and `optional` need none.

### 5.8 `employee_pay_rates` (= `staff_salary_rates`, effective-dated, with the DDL the repository lacks)

```
employee_pay_rates
  id              uuid primary key default gen_random_uuid()
  employee_id     uuid not null references employees(id) on delete restrict
  rate_basis      text not null check (rate_basis in ('daily', 'hourly', 'monthly'))
  rate_amount     numeric(12,2) not null check (rate_amount >= 0)
  pay_frequency   text not null
  effective_date  date not null
  created_by      uuid not null references employees(id) on delete restrict
  created_at      timestamptz not null default clock_timestamp()

indexes
  employee_pay_rates_lookup_idx (employee_id, effective_date desc, created_at desc)
```

- `created_at` defaults to `clock_timestamp()`, not `now()`, so two rows saved in one transaction still order by
  `created_at`.
- Append-only: no UPDATE or DELETE grant or policy; a correction is a newer row. Timestamps: `effective_date`,
  `created_at`. No status field.
- `numeric(12,2)` holds the 10 integer digits the reference application accepts (`src/lib/hr/rate.ts:210`).
- `rate_basis` values follow `payroll.rateBasis`; the reference implements `daily` only, and the formula for each
  basis is defined in `PAYROLL.md`. The CHECK keeps `monthly` for a later formula, but `monthly` is refused by
  configuration validation (`CONFIGURATION.md` section 2.9 rule 14) until `PAYROLL.md` defines its formula, so no
  `monthly` row is written before then. `set_staff_salary_rate` also refuses `monthly`, and the payroll computation
  returns a null gross with the warning `unsupported_rate_basis` for a `monthly` row. `pay_frequency` has no column
  check because the list is CONFIGURABLE (`payroll.payFrequencies`); `set_staff_salary_rate` validates it.
- Selection: `payroll.rateSelection` decides whether the computation uses the row effective on the period end
  (CURRENT) or the row effective on each work date. `payroll.currentRateLookup` decides whether "current rate"
  screens ignore future-dated rows (CURRENT does not, `rate.ts:139-143`).
- RLS: enable and force; SELECT USING `employee_id = app_private.current_staff_id() or
  app_private.has_permission('payroll.view_all') or app_private.has_permission('payroll.rates.edit')`. The own-row
  branch needs no key (5.1). The `payroll.rates.edit` branch is redundant while the grant function enforces that
  key's dependency on `payroll.view_all` (`PERMISSIONS.md` section 4.3); a client may drop it. Writes only through
  `set_staff_salary_rate`.

### 5.9 `payroll_snapshots` (frozen payslips, including the six reconstructed columns)

```
payroll_snapshots
  id                   uuid primary key default gen_random_uuid()
  employee_id          uuid not null references employees(id) on delete restrict
  payroll_start_date   date not null
  payroll_end_date     date not null
  rate_basis           text not null check (rate_basis in ('daily', 'hourly', 'monthly'))
  rate_amount          numeric(12,2) not null check (rate_amount >= 0)
  pay_frequency        text not null
  total_hours          numeric(10,2) not null default 0
  overtime_hours       numeric(10,2) not null default 0      -- display only unless a multiplier is configured
  days_worked          integer not null default 0 check (days_worked >= 0)
  night_shifts         integer not null default 0 check (night_shifts >= 0)
  regular_salary       numeric(12,2) not null default 0
  overtime_pay         numeric(12,2) not null default 0
  gross_salary         numeric(12,2) not null default 0
  deductions           numeric(12,2) not null default 0 check (deductions >= 0)
  net_salary           numeric(12,2) not null default 0
  payment_status       text not null default 'pending' check (payment_status in ('pending', 'paid', 'void'))
  payment_date         date
  paid_at              timestamptz
  paid_by              uuid references employees(id) on delete restrict
  voided_at            timestamptz
  voided_by            uuid references employees(id) on delete restrict
  void_reason          text
  superseded_by        uuid references payroll_snapshots(id) on delete restrict deferrable initially deferred
  generated_by         uuid not null references employees(id) on delete restrict
  generated_at         timestamptz not null default now()
  constraint payroll_period_valid check (payroll_end_date >= payroll_start_date)
  constraint payroll_paid_complete
    check (payment_status <> 'paid' or (paid_at is not null and paid_by is not null and payment_date is not null))
  constraint payroll_pending_unpaid check (payment_status <> 'pending' or paid_at is null)
  constraint payroll_void_complete
    check ((payment_status = 'void') = (voided_at is not null and voided_by is not null
                                        and void_reason is not null and length(trim(void_reason)) > 0))
  constraint payroll_not_self_superseded check (superseded_by is null or superseded_by <> id)

indexes
  payroll_snapshots_employee_idx   (employee_id, generated_at desc)
  payroll_snapshots_period_idx     (payroll_start_date, payroll_end_date)
  payroll_snapshots_current_uq     unique (employee_id, payroll_start_date, payroll_end_date)
                                   where superseded_by is null and payment_status <> 'void'
```

- Status field: `payment_status`. CURRENT values are `pending` and `paid` (section 2.7). `void`, with `voided_at`,
  `voided_by` and `void_reason`, is the RECOMMENDED TEMPLATE IMPROVEMENT for the missing reverse path;
  `CONFIGURATION.md` section 2.6 fixes `payroll.statuses` to `pending`, `paid` and `void`. Allowed transitions:
  `pending` to `paid`, `pending` to `void`, `paid` to `void`. A voided paid payslip keeps `paid_at` and `paid_by`, so
  both facts survive.
- Timestamps: `generated_at`, `payment_date`, `paid_at`, `voided_at`.
- `rate_basis` copies the basis of the rate row used (5.8). Its CHECK allows `monthly`, but `monthly` is refused by
  configuration validation (`CONFIGURATION.md` section 2.9 rule 14) until `PAYROLL.md` defines a formula, so no
  snapshot carries it before then.
- Uniqueness (`payroll.snapshot.uniquePerPeriod`): the partial unique index allows one current payslip per employee
  and exact period. Regenerating supersedes the current row in the same transaction instead of silently masking it.
  `CONFIGURATION.md` section 2.6 lists this key as fixed true, so the index is always present.
- Supersede order. The partial unique index cannot be deferred (Postgres defers only unique constraints, which take
  no WHERE clause), so inserting the new row while the old one is still current fails. `generate_payslip_snapshot`
  therefore: (1) locks the current row with `select ... for update`; (2) draws the new id with `gen_random_uuid()`;
  (3) updates the old row's `superseded_by` to that id, which the index then no longer covers; (4) inserts the new
  row with that id. Step 3 points at a row that does not exist yet, which is why the `superseded_by` foreign key is
  `deferrable initially deferred`: it is checked at commit, after step 4. A paid row is voided instead of superseded,
  and the void status also removes it from the index.
- Void check: `void_reason is not null` is written out because `length(trim(NULL)) > 0` is NULL and a CHECK accepts
  NULL; without it a void row with no reason would pass.
- Freeze trigger (engine, `payroll.snapshot.immutable`): BEFORE UPDATE refuses any change except to
  `payment_status`, `payment_date`, `paid_at`, `paid_by`, `voided_at`, `voided_by`, `void_reason` and
  `superseded_by`, refuses transitions outside the list above and refuses clearing `paid_at`; BEFORE DELETE raises.
- Negative net (`payroll.allowNegativeNet`): enforced in `generate_payslip_snapshot`. A client that never allows it
  also adds `check (net_salary >= 0)` at install.
- Columns renamed or dropped from CURRENT: `regular_hours` becomes `total_hours` (it always held all hours);
  `hourly_rate` and `daily_rate` merge into `rate_basis` plus `rate_amount`; `approved_by` is dropped (never
  written; approval is 5.5).
- RLS: enable and force; SELECT USING `employee_id = app_private.current_staff_id() or
  app_private.has_permission('payroll.view_all')`. The own-row branch needs no key (5.1). No INSERT, UPDATE or DELETE
  policy or grant; writes through `generate_payslip_snapshot`, `mark_payslip_paid` and `void_payslip`.
- Realtime: as CURRENT if the client refreshes on change.

### 5.10 `payroll_adjustments` (RECOMMENDED TEMPLATE IMPROVEMENT; today deductions are one lump sum)

Used only when `payroll.deductionsModel = 'itemized'`. With `lump_sum` (CURRENT) the table stays empty and the
snapshot's `deductions` column holds the single amount.

```
payroll_adjustments
  id            uuid primary key default gen_random_uuid()
  snapshot_id   uuid not null references payroll_snapshots(id) on delete restrict
  kind          text not null check (kind in ('deduction', 'addition'))
  code          text not null check (length(trim(code)) between 1 and 40)
  label         text not null check (length(trim(label)) between 1 and 120)
  amount        numeric(12,2) not null check (amount > 0)
  note          text
  created_by    uuid not null references employees(id) on delete restrict
  created_at    timestamptz not null default now()

indexes
  payroll_adjustments_snapshot_idx (snapshot_id)
```

- Written only by `generate_payslip_snapshot` in the same transaction as its snapshot; frozen afterwards (no UPDATE
  or DELETE grant; a BEFORE UPDATE OR DELETE trigger raises).
- The snapshot's `deductions` equals the sum of `deduction` rows. Additions are a proposal beyond the reference
  (which has none): `gross_salary = regular_salary + overtime_pay + sum(addition rows)`. `PAYROLL.md` section 5
  owns the rule.
- `code` values are a client list (statutory items, cash advances and similar); no code is engine.
- RLS: enable and force; SELECT follows the parent snapshot's visibility through an `exists` on `payroll_snapshots`.

### 5.11 `audit_events`

The table, its append-only triggers and the self-attributed insert policy stay as CURRENT (section 2.8). Changes:

- SQL functions write their own rows through `app_private.record_audit_event(p_action text, p_entity_type text,
  p_entity_id uuid, p_outcome text, p_reason text, p_context jsonb)`, SECURITY DEFINER, which fills
  `actor_auth_uid = auth.uid()`, `actor_kind = 'staff'` and `actor_label` from the caller's profile. The application
  may still log for request context, and SQL-side rows are the reliable record.
- Context payloads carry ids and change markers; amounts are included only when `audit.payloadIncludesAmounts` is on.
- Read policy. Audit read access is not configuration (`CONFIGURATION.md` section 2.7); this document defines it.
  Proposal, using only `PERMISSIONS.md` section 4.2 keys: a SELECT policy to `authenticated` USING
  `(action like 'payroll.%' and app_private.has_permission('payroll.view_all')) or (action like 'attendance.%' and
  app_private.has_permission('attendance.review'))`. The payroll branch follows `PERMISSIONS.md` section 6 item 16 and
  `SECURITY.md` section 7.2; the attendance branch gives correction reasons and deletion records the audience that
  reviews sessions, which is a proposal of this document. `attach_attendance_photo` (5.13) records its event under
  an `attendance.` action name so that photo events fall under the same branch. Postgres combines permissive SELECT
  policies with OR, so the host must not keep a policy that admits these rows more widely: the live `audit_read` (any
  active staff) and the PENDING form (role titles and `view_settings`, section 7) both would.
- A correction writes `old_time_out` and `new_time_out`; a deletion writes the deleted row's values, so a hard
  delete stays explainable.
- Correction history. The template adds no separate edit-history table. The success row that
  `correct_attendance_clock_out` writes through `record_audit_event` in its own transaction (entity id = session id,
  actor, `created_at`, reason, `old_time_out` and `new_time_out` in the context) is the append-only history: one row per
  correction, never updated or deleted (append-only triggers). The session row keeps `edited_by`, `edited_at` and
  `edit_reason` as the latest-change summary (5.3). A Review day-details history reads these rows under the read
  policy above.

### 5.12 Settings: replacing literals

CURRENT: every setting is a literal at its point of use; the only SQL value that behaves like a setting is
`app_private.night_ot_bonus()` (R5), and the insert trigger repeats the amount as a literal
(`M/20260722200000:37`). `CONFIGURATION.md` sections 1.2 to 1.4 require one SQL store, read by SQL and exposed to
the application, with effective dating for values that affect money. The DDL:

```
app_private.hr_settings
  key             text not null        -- a CONFIGURATION.md key, for example 'payroll.nightRule.thresholdTime'
  value           jsonb not null
  effective_from  date not null default '-infinity'
  updated_by      uuid references employees(id) on delete restrict
  updated_at      timestamptz not null default now()
  primary key (key, effective_from)
  constraint hr_settings_dated_keys check (effective_from = '-infinity' or key like 'payroll.%')
```

- `effective_from = '-infinity'` means "in force from the beginning". The primary key includes `effective_from`
  because an effective-dated key needs several rows. The check allows dated rows only for payroll keys, so the
  timezone can never change by date.
- Seed: one migration inserts every SQL-read key with the client's value; the recommended defaults are the ones in
  `CONFIGURATION.md` section 2. A file-content test compares the seed with the TypeScript defaults
  (`CONFIGURATION.md` section 1.3).
- Schema `app_private` is not exposed through the API. No grants to `anon` or `authenticated` on the table.
- A BEFORE INSERT OR UPDATE trigger refuses unknown keys, malformed values and values of modules the build does not
  implement, and stamps `updated_at` and `updated_by`.
- Readers are `stable security definer` with `set search_path = ''`, EXECUTE to `authenticated` and `service_role`; a
  reader that must raise on a missing or unset value (`hr_setting`, `business_timezone`, `is_night_session`, and a
  required-scalar reader such as the code template's `hr_setting_text`) is `plpgsql`, the others may be SQL:
  - `app_private.hr_setting(p_key text, p_as_of date default null) returns jsonb`: the row with the greatest
    `effective_from` not after `coalesce(p_as_of, app_private.business_today())`.
  - `app_private.business_timezone() returns text`: `locale.timezone`, always the `-infinity` row.
  - `app_private.business_today() returns date`: `(now() at time zone app_private.business_timezone())::date`.
  - `app_private.is_night_session(p_time_in timestamptz, p_time_out timestamptz) returns boolean`: evaluates
    `payroll.nightRule.*` as in force on the business date of `p_time_in`; false when the rule is disabled or when
    the anchor is the clock-out and the session is open. The window semantics are defined in `PAYROLL.md` section 4
    and `CONFIGURATION.md` section 2.6; this predicate is the only place they are implemented.
  - `app_private.night_bonus_amount(p_as_of date) returns numeric`: replaces `night_ot_bonus()`.
- `public.get_hr_settings() returns jsonb` (definer, active staff): the SQL-evaluated keys in force today, for the
  application to render labels and defaults from the same values SQL uses.
- Writes: migrations by default. An optional runtime editor is `public.set_hr_setting(p_key text, p_value jsonb,
  p_effective_from date default null)` (5.13; adopted from `CONFIGURATION.md` section 1.3), SECURITY DEFINER, gated on
  the Super Admin, the only runtime writer (the table keeps no end-user grant). For a `payroll.*` key it inserts a new
  dated row and never updates an old one; it refuses an `effective_from` earlier than business today
  (`CONFIGURATION.md` section 1.4). For any other key it updates the value of the single `-infinity` row, which is what
  `hr_settings_dated_keys` allows. It refuses `locale.timezone`, which changes only by migration because every
  `work_date` stamp depends on it. In the same transaction it writes an audit row through `record_audit_event` (5.11)
  with the key, the old and new policy values and `effective_from`.

### 5.13 Function set for the template

All functions: `set search_path = ''`; the permission gate first; explicit revoke and grant in the same migration.
Audit: a success row is inserted inside the function's transaction, together with the change. A refusal row cannot
survive a raise (the exception rolls back every row the transaction inserted), so each function takes one of two
paths: a typed refusal (the function decides before changing anything, inserts the denied or failed row and returns a
refusal instead of raising) or a raise with `insufficient_privilege` (authority and device refusals) or another stable
SQLSTATE, with the SERVER_API.md section 9.10 error code in the hint, after which the server layer writes the refusal
row outside the refused transaction (SERVER_API.md section 9.1 rule 8). Never insert an audit row and then raise.

Signatures:

```
public.kiosk_clock_in(p_employee_id uuid, p_device_token text, p_note text default null) returns uuid
public.kiosk_clock_out(p_employee_id uuid, p_device_token text) returns uuid
public.self_clock_in(p_device_token text, p_note text) returns uuid         -- optional, self_service mode only
public.self_clock_out(p_device_token text) returns uuid                     -- optional, self_service mode only
public.attach_attendance_photo(p_session_id uuid, p_kind text, p_storage_path text,
                               p_content_type text, p_byte_size bigint) returns uuid
public.attendance_status(p_employee_ids uuid[] default null)
  returns table(employee_id uuid, open_since timestamptz, last_clock_out_today timestamptz,
                open_session_id uuid, open_work_date date)
  -- null lists every eligible employee; the last two columns serve SERVER_API.md section 9.4 ClockStatus.openSession
public.list_clock_staff() returns table(id uuid, full_name text)     -- id and display name only
public.review_attendance_page(p_from date, p_to date, p_employee_ids uuid[], p_status text,
                              p_page int, p_page_size int) returns table(...)
public.correct_attendance_clock_out(p_record_id uuid, p_time_out timestamptz, p_reason text) returns timestamptz
public.delete_attendance_record(p_record_id uuid, p_reason text) returns void
public.review_attendance_day(p_employee_id uuid, p_work_date date, p_status text, p_note text) returns void
public.register_attendance_device(p_label text, p_token text) returns uuid
public.revoke_attendance_device(p_id uuid) returns void
public.verify_attendance_device(p_token text) returns uuid
public.attendance_gating_active() returns boolean
app_private.payroll_lines(p_from date, p_to date) returns table(...)
public.report_payroll(p_from date, p_to date) returns table(...)
public.generate_payslip_snapshot(p_employee uuid, p_from date, p_to date, p_deductions numeric default 0,
                                 p_regenerate boolean default false) returns public.payroll_snapshots
public.mark_payslip_paid(p_snapshot_id uuid, p_payment_date date default null) returns public.payroll_snapshots
public.void_payslip(p_snapshot_id uuid, p_reason text) returns public.payroll_snapshots
public.set_staff_salary_rate(p_employee uuid, p_basis text, p_amount numeric, p_frequency text,
                             p_effective date) returns uuid
public.get_hr_settings() returns jsonb
public.set_hr_setting(p_key text, p_value jsonb, p_effective_from date default null) returns void   -- optional
app_private.current_staff_id(), current_staff_role(), is_active_staff(), is_owner(),
            has_permission(text), is_timekeeping_eligible(uuid)
```

| Function | Security | Gate (template key) | Writes |
|---|---|---|---|
| `kiosk_clock_in` | DEFINER | `attendance.clock_operate`; target eligible; device per `attendance.device.*` | INSERT session, `clock_in_by`, device |
| `kiosk_clock_out` | DEFINER | same rules; one open session required | UPDATE `time_out`, `clock_out_by`, device |
| `self_clock_in` (optional) | DEFINER | no key; target = caller; mode `self_service` only; active, eligible; device per settings | INSERT session, `clock_in_by` = caller |
| `self_clock_out` (optional) | DEFINER | same rules as `self_clock_in`; one open session of the caller required | UPDATE `time_out`, `clock_out_by` = caller |
| `attach_attendance_photo` | DEFINER | `attendance.clock_operate` AND caller is the operator recorded on that session for that kind AND a storage path under that session prefix for that kind | INSERT photo |
| `attendance_status` | DEFINER | `attendance.clock_operate` or `attendance.view_team` | none |
| `list_clock_staff` | DEFINER | `attendance.clock_operate` or `attendance.view_team`; eligible employees only | none |
| `review_attendance_page` | DEFINER | `attendance.view_team`; returns sessions with names | none |
| `correct_attendance_clock_out` | DEFINER | `attendance.correct`; lock, window and overlap rules | UPDATE `time_out`, edit columns; reset day review |
| `delete_attendance_record` | DEFINER | `attendance.delete`, or the approved-request executor | hard or soft per `attendance.deletion.mode` |
| `review_attendance_day` (optional, 5.5) | DEFINER | `attendance.correct` | upsert day review |
| `register_attendance_device` | DEFINER | `attendance.devices.manage`; maximum from settings | INSERT device; may revoke others |
| `revoke_attendance_device` | DEFINER | `attendance.devices.manage` | UPDATE device |
| `verify_attendance_device` | DEFINER | active caller (the page gate stays on the page key) | none |
| `attendance_gating_active` | DEFINER | active caller; honours `attendance.device.mode` (the page gate stays on the page key) | none |
| `app_private.payroll_lines` | DEFINER; EXECUTE to the signed-in role | caller filter inside: eligible AND (own row, no key, OR `payroll.view_all`) | none |
| `report_payroll` | INVOKER | none of its own: a signature wrapper over `payroll_lines`, whose filter scopes the rows | none |
| `generate_payslip_snapshot` | DEFINER | `payroll.payslip.generate` and `payroll.view_all` (it reads the filtered lines) | INSERT snapshot; supersede a pending one only with `p_regenerate` |
| `mark_payslip_paid` | DEFINER | `payroll.payslip.mark_paid`; pending only | UPDATE status columns |
| `void_payslip` | DEFINER | `payroll.payslip.generate` | UPDATE void columns |
| `set_staff_salary_rate` | DEFINER | `payroll.rates.edit` | INSERT rate row |
| `get_hr_settings` | DEFINER | active staff | none |
| `set_hr_setting` (optional, 5.12) | DEFINER | Super Admin; refuses `locale.timezone` and a back-dated payroll row | INSERT dated payroll row, or UPDATE the `-infinity` row |
| `app_private` helpers | DEFINER | none | none |

Notes:

- One computation: `app_private.payroll_lines` holds the only money math (days, hours, night shifts, rate per
  `payroll.rateSelection`, gross, warnings) using `is_night_session`, the settings readers and, when
  `payroll.approvalRequired` is on, `attendance_day_reviews`. The row filter lives inside `payroll_lines`: its own
  WHERE clause returns only eligible employees AND (the caller's own row OR a caller holding `payroll.view_all`). The
  identity and permission helpers read the signed-in user from the request context, so inside the definer function
  they still name the real caller. `report_payroll` is a thin INVOKER wrapper that selects from `payroll_lines` for a
  stable public signature and adds no protection. Because an INVOKER function's callees are checked against the
  caller, the signed-in role holds EXECUTE on `payroll_lines`; that grant is safe only because the filter is inside
  it, and a direct call returns exactly what `report_payroll` returns to the same caller.
  `generate_payslip_snapshot` reads the same filtered lines (hence its `payroll.view_all` requirement). An unfiltered
  private payroll function, if one is ever added for a server job, gets no end-user EXECUTE (principle 8). This
  removes CURRENT's dependence on the caller's RLS over the rate table and on an EXECUTE grant for the bonus function
  (R3, R5), and the stale-body problem of R9. The output shape of a line is `PAYROLL.md` section 11.
- Generation refuses when the employee has no effective rate (salary is never invented), when net pay would be
  negative and `payroll.allowNegativeNet` is off, and when a current payslip exists for the exact period: a call with
  `p_regenerate` false returns `conflict`; with true it supersedes a pending payslip; a paid payslip returns `conflict`
  either way until it is voided.
- Correction rules: the new `time_out` must be at or after `time_in`, not in the future, not after the `time_in` of
  the member's next session (no overlap), within `attendance.correction.maxWindowDays` when set, and outside a
  locked period when `payroll.lockPeriodAfterPayslip` is on. One precision, the minute, in the UI, the server action
  and SQL: a new `time_out` that is not a whole minute (seconds or fractions not zero) is refused, and a value equal to
  the stored `time_out` truncated to its minute is refused as unchanged, leaving every column of the row untouched
  (IMPLEMENTATION_PROMPT.md R7 and R8). An exact comparison is not enough: it would accept an untouched
  minute-precision save of a completed session whose `time_out` has seconds and rewrite the clock-out, the CURRENT
  defect (`src/components/hr/review-attendance-view.tsx:674-679`).
- Self-service clocking (NOT IN THE REFERENCE; RECOMMENDED TEMPLATE IMPROVEMENT, built only when a client sets
  `attendance.clockMode = 'self_service'`; adopted from `CONFIGURATION.md` section 2.4). `self_clock_in` and
  `self_clock_out` take no employee id: the target is `app_private.current_staff_id()`. They apply the same
  eligibility, one-open-session, `work_date`, multiple-sessions and device rules as the kiosk functions and write the
  same audit rows. They need no permission key, because a member acting on their own row needs none
  (`PERMISSIONS.md` section 4.1 principle 7); the page gate for that mode is in `PERMISSIONS.md` section 4.3. The kiosk
  functions and `attendance.clock_operate` are unchanged; in `kiosk` mode the self functions refuse.
- The typed confirmation word for deletion (`attendance.deletion.requireTypedConfirmation`) stays in the server
  action, as CURRENT (`src/lib/hr/actions.ts:143-148`); it is a guard against slips, not authority, so the function
  takes a reason instead.
- The request-then-approve deletion path (`owner_approval_requests`, kind `attendance_delete`) is optional and off by
  default (`attendance.deletion.requestApprovalPath`). If a client enables it, the request insert checks
  `attendance.delete.request`, an optional key outside `PERMISSIONS.md` section 4.2, and the key is listed in the
  access catalogue (`CONFIGURATION.md` sections 2.3 and 2.4).
- Gating with a token: the server action reads the httpOnly cookie and passes the raw token; the function hashes and
  compares it. The token never reaches the browser's JavaScript, and the device id is no longer a bearer value.

### 5.14 Mapping: reference implementation to generic model

| CURRENT object | GENERIC object | Change |
|---|---|---|
| `staff_profiles` (subset) | `employees` | adds `timekeeping_exempt`; keeps `is_demo`; eligibility predicate |
| `attendance_records` | `attendance_sessions` | drops night and unused columns; adds operator, clock-out device, `edited_at`, soft delete |
| virtual day (group by) | virtual day (group by) | unchanged; optional `attendance_day_reviews` |
| `attendance_devices` | `attendance_devices` | unique `token_hash`; forced RLS; explicit grants; `revoked_by`; maximum from settings |
| `attachments` rows of type `attendance_record` | `attendance_photos` | real FK; `kind`; own bucket; narrow read; operator-checked insert |
| `staff_salary_rates` (R3) | `employee_pay_rates` | full DDL; `rate_basis`; `created_by`; append-only |
| `staff_hourly_rates` (R6), `set_staff_hourly_rate` (R7) | none | dropped |
| `payroll_snapshots` plus R8 | `payroll_snapshots` | declared columns; uniqueness; freeze trigger; optional `void` |
| `deductions` lump sum | `deductions` plus optional `payroll_adjustments` | itemized mode |
| `audit_events` | `audit_events` | SQL-side writer; narrowed read |
| `night_ot_bonus()` (R5) and literals | `app_private.hr_settings` plus readers | values from rows, effective-dated for payroll keys |
| `report_payroll` (INVOKER, RLS-scoped) | `app_private.payroll_lines` plus `report_payroll` wrapper | one computation, caller filter inside the engine |
| direct UPDATE for mark paid | `mark_payslip_paid` | gate in SQL |
| `owner_approval_requests` kind `attendance_delete` | same, optional | request key in the catalogue |

---

## 6. Entity-relationship sketch (text)

CURRENT relationships. `(R)` marks a RECONSTRUCTED object. Arrows point from the referencing column to the
referenced table; the ON DELETE rule is in brackets.

```
auth.users 1 ---- 1 staff_profiles   (auth_user_id [RESTRICT]; role_key -> roles.key [ON UPDATE CASCADE])
                      ^
                      |  every arrow below points at staff_profiles.id
                      |
  staff_permission_grants.staff_profile_id [RESTRICT]    .granted_by [RESTRICT]    .permission_key -> permissions.key
  attendance_records.staff_profile_id [RESTRICT]         .edited_by [NO ACTION]
  attendance_devices.registered_by [NO ACTION]
  attachments.uploaded_by [RESTRICT]
  payroll_snapshots.employee_id [RESTRICT]    .generated_by [NO ACTION]    .approved_by [NO ACTION, unused]
                                              .paid_by (R, FK unknown)
  staff_salary_rates.staff_profile_id (R, FK unknown)
  staff_hourly_rates (R, legacy, columns unknown)
  owner_approval_requests.requested_by / .decided_by / .executed_by [RESTRICT]

attendance_records.device_id  N:1 --> attendance_devices.id [SET NULL]

attendance_records.id  <-- attachments.related_entity_id        no FK; related_entity_type = 'attendance_record'
attendance_records.id  <-- owner_approval_requests.entity_id    no FK; action_kind = 'attendance_delete'
attendance_records.id  <-- audit_events.entity_id                no FK; entity_type = 'attendance_record'
staff_profiles.id      <-- audit_events.entity_id                no FK; 'attendance.blocked_device' and 'payroll.set_salary_rate'
payroll_snapshots.id   <-- audit_events.entity_id                no FK; entity_type = 'payroll_snapshot'

Derived flow (no stored rows between the steps):

attendance_records --group by (staff_profile_id, work_date)--> virtual DAY
virtual DAY + staff_salary_rates (R, row effective on p_to) + app_private.night_ot_bonus() (R)
    --> report_payroll(p_from, p_to)                     (INVOKER, row filter self or Super Admin)
    --> generate_payslip_snapshot(...) (live body R)      --> payroll_snapshots (frozen; newest per period wins on read)
```

Cardinalities (CURRENT): one member has many sessions (at most one open), many payslips (several per period
allowed), many rate rows; one device has many sessions; one session has zero, one or two selfies in practice, with
no constraint; one approval request targets one session id.

GENERIC sketch (section 5):

```
employees 1 --< attendance_sessions            (employee_id [RESTRICT]; clock_in_by, clock_out_by, edited_by, deleted_by [RESTRICT])
attendance_devices 1 --< attendance_sessions   (clock_in_device_id, clock_out_device_id [SET NULL])
attendance_sessions 1 --< attendance_photos    (session_id [CASCADE]; unique per kind: 0..2)
employees 1 --< attendance_day_reviews         (optional; primary key employee_id + work_date; no FK to sessions)
employees 1 --< employee_pay_rates             (append-only, effective-dated)
employees 1 --< payroll_snapshots              (one current row per employee and exact period)
payroll_snapshots 1 --< payroll_adjustments    (optional; itemized mode)
payroll_snapshots 0..1 --> payroll_snapshots   (superseded_by)
app_private.hr_settings                        (key + effective_from; read by the readers in 5.12)
audit_events                                   (no FKs; entity_type + entity_id)

attendance_sessions + attendance_day_reviews (optional) + employee_pay_rates + hr_settings
    --> app_private.payroll_lines (caller filter inside) --> report_payroll (wrapper, no filter of its own)
                                                         and generate_payslip_snapshot --> payroll_snapshots
```

---

## 7. PENDING (not live) schema changes affecting these objects

All items come from `M/20260916120000_security_hardening_definer_grants_owner_guards.sql` unless stated. The file
says it is not applied to production and must be applied after `20260913120000`, `20260913130000` and
`20260915120000`, in file order (`:2-3`). A file-content regression test pins several of its decisions
(`tests/unit/security-hardening.test.ts:218-286`); there is no behavioural or pgTAP test for them.

- Section 1 (`:38-62`). `app_private.current_staff_role()` returns `'inactive'` for a deactivated profile and NULL
  only when there is no profile (`:46-57`). Every role-title gate then refuses a deactivated account.
  `current_staff_id()` is unchanged. Affects `correct_attendance_clock_out` (named at `:43`), and
  `delete_attendance_record` (R2) and `set_staff_salary_rate` (R4) if they use the helper.
- Section 2 (`:64-110`). For every `public` SECURITY DEFINER function: `revoke all on function ... from public,
  anon`. A fixed list of integration functions and names ending in `_system` also lose `authenticated` and receive
  an explicit `grant execute ... to service_role` (`:91-108`); no HR function is on that list. The header's
  "NOTHING is granted" (`:70`) is exact only for `authenticated` and `anon`. Affects `kiosk_clock_in`,
  `list_clock_staff`, `correct_attendance_clock_out`, the four device functions, `delete_team_member`, and, if they
  are definer functions live, `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate` and
  `set_staff_hourly_rate`. Not `report_payroll` or the repository `generate_payslip_snapshot`, which are invoker
  functions.
- Section 4 (`:169-222`). `delete_team_member` refuses a Super Admin target (`:206-208`); grants add
  `service_role` (`:221-222`). The RESTRICT rules on attendance and payslips are unchanged.
- Section 5 (`:224-279`). Trigger `staff_profiles_owner_floor`, BEFORE UPDATE OF `role_key`, `is_active` OR DELETE:
  the last active, non-demo Super Admin cannot be demoted, deactivated or deleted; the check takes a table lock.
- Section 6 (`:281-298`). `audit_read` narrowed to Super Admin, Admin and `view_settings` holders, plus the
  per-order history slice for active staff (expression D, section 2.8). `attendance.*` and `payroll.*` events stop
  being readable by ordinary staff.
- Section 8 (`:362-368`). `alter table public.attendance_records alter column work_date set default ((now() at time
  zone '<business-tz>')::date)`. Existing rows are not rewritten.
- Section 9 (`:370-422`). `revoke_staff_sessions(uuid)`, Super Admin only, and a one-off deletion of `auth.sessions`
  for inactive profiles. Tangential: a deactivated kiosk operator loses every session.
- Section 10 (`:424-488`). `kiosk_clock_in` refuses the call when any device is active and `p_device_id is null or
  not exists (select 1 from public.attendance_devices d where d.id = p_device_id and d.is_active and d.revoked_at is
  null)`, raising "This device is not an approved time clock." with `insufficient_privilege` (`:451-459`). The body
  is otherwise identical to the live one. Grants: revoke public and anon; grant `authenticated` and `service_role`
  (`:487-488`). The file itself notes the residual: the check binds to the device id, which a member can read in
  their own rows; binding to the token needs a signature change (`:431-432`). `kiosk_clock_out` is not changed.

Also PENDING: `M/20260916130000:12-13` adds `audit_events_occurred_at_idx (occurred_at desc)`.
`M/20260917120000` contains no attendance or payroll object.

What the PENDING set does not address (carried into section 9): direct INSERT and UPDATE on `attendance_records`;
the operator permission inside the clock functions; a clock-out device check; `current_staff_id()` ignoring
`is_active`; selfie read exposure; the two night rules; payslip uniqueness and immutability; the Admin mark-paid and
rate-edit disagreements; reviewer name visibility; the request-approval delete path, whose key is granted by no
migration and only on the legacy Super Admin console, so it fails by default on a fresh install.

---

## 8. Verification queries (read-only catalog SQL)

For someone with access to the reference project's production database. Run them in the SQL editor as a
privileged role; they read catalogs only and change nothing. Never run them through a connector attached to
another client's project. Section 10 maps every RECONSTRUCTED object and NEEDS VERIFICATION item to a query.
V15 returns a count only; no query returns personal data.

V1. Live function bodies and security mode (R1, R2, R4, R5, R7, R9, R13, R16, and the live `report_payroll`).

```sql
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args,
       p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in (
        'kiosk_clock_in', 'kiosk_clock_out', 'delete_attendance_record',
        'correct_attendance_clock_out', 'list_clock_staff', 'attendance_apply_overtime',
        'report_payroll', 'generate_payslip_snapshot',
        'set_staff_salary_rate', 'set_staff_hourly_rate',
        'register_attendance_device', 'verify_attendance_device',
        'attendance_gating_active', 'revoke_attendance_device',
        'set_team_member_role'))
   or (n.nspname = 'app_private' and p.proname in (
        'night_ot_bonus', 'current_staff_id', 'current_staff_role',
        'is_active_staff', 'is_owner', 'has_permission', 'is_primary_super_admin'))
order by n.nspname, p.proname;
```

V2. Columns of the reconstructed tables and of the tables with drifted columns (R3, R6, R8, R14).

```sql
select table_name, ordinal_position, column_name, data_type, numeric_precision, numeric_scale,
       column_default, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                     'staff_salary_rates', 'staff_hourly_rates', 'attachments', 'owner_approval_requests')
order by table_name, ordinal_position;
```

V3. Constraints, including checks and FK actions (R3, R8, R14).

```sql
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public'
                     and c.relname in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                                       'staff_salary_rates', 'staff_hourly_rates', 'attachments',
                                       'owner_approval_requests'))
order by 1, 2;
```

V4. Column-level privileges on `attendance_records` (section 2.1, observation 2).

```sql
select grantee, privilege_type, column_name
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'attendance_records'
  and grantee in ('anon', 'authenticated')
order by grantee, privilege_type, column_name;
```

V5. Every policy on the tables in scope (R3, R12, section 2.1 observation 2).

```sql
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                    'staff_salary_rates', 'staff_hourly_rates', 'attachments', 'staff_profiles',
                    'staff_permission_grants', 'audit_events', 'owner_approval_requests')
order by tablename, policyname;
```

V6. Table-level grants and RLS mode (sections 2.2, 2.5).

```sql
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                     'staff_salary_rates', 'staff_hourly_rates', 'attachments')
  and grantee in ('anon', 'authenticated', 'service_role')
order by table_name, grantee, privilege_type;

select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                    'staff_salary_rates', 'staff_hourly_rates', 'attachments');
```

V7. SELECT policies on `staff_profiles` (reviewer name visibility, section 2.4).

```sql
select polname, pg_get_expr(polqual, polrelid) as using_expr
from pg_policy
where polrelid = 'public.staff_profiles'::regclass and polcmd = 'r';
```

V8. Indexes, including `attendance_records_time_in_idx` (R10) and any index on the rate table (R3).

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                    'staff_salary_rates', 'staff_hourly_rates')
order by tablename, indexname;
```

V9. EXECUTE privileges on every function in scope, and the anon question (R11, section 3.0).

```sql
select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_role_can_execute,
       p.proacl
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.proname ~ '(attendance|payroll|payslip|salary|hourly|clock|night_ot|team_member|staff_role|staff_id|is_owner|has_permission|is_active_staff)'
order by n.nspname, p.proname;
```

V10. Triggers on the attendance and payroll tables (R13; also detects any live-only freeze trigger).

```sql
select tgrelid::regclass as table_name, tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal
  and tgrelid in (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public'
                    and c.relname in ('attendance_records', 'attendance_devices', 'payroll_snapshots',
                                      'staff_salary_rates', 'staff_hourly_rates'))
order by 1, 2;
```

V11. The twenty production migration names with their versions (section 1.1). The pattern matches all twenty
names, including `team_management_phase2_devices` through `devices`, and may also return other migrations whose
names contain one of the words; the twenty are the rows of section 1.1.

```sql
select version, name
from supabase_migrations.schema_migrations
where name ~ '(attendance|payroll|payslip|salary|hourly|kiosk|clock|timekeeping|night|devices)'
order by version;
```

V12. Realtime publication membership (section 2.12).

```sql
select tablename
from pg_publication_tables
where pubname = 'supabase_realtime' and schemaname = 'public'
order by tablename;
```

V13. Function-owning database role and its RLS bypass, for the definer functions that write FORCE RLS tables
(section 2.1, observation 4).

```sql
select p.proname, r.rolname as owner_role, r.rolbypassrls, r.rolsuper
from pg_proc p
join pg_roles r on r.oid = p.proowner
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('kiosk_clock_in', 'kiosk_clock_out', 'correct_attendance_clock_out',
                    'delete_attendance_record', 'set_staff_salary_rate', 'register_attendance_device',
                    'generate_payslip_snapshot');
```

V14. Triggers on `staff_profiles` (the Admin cap, a possible Super Admin cap for R16, and the PENDING Super Admin
floor trigger `staff_profiles_owner_floor` once applied).

```sql
select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal and tgrelid = 'public.staff_profiles'::regclass
order by tgname;
```

V15. Whether the request-then-approve delete path can work at all (count only).

```sql
select count(*) as holders
from public.staff_permission_grants
where permission_key = 'initiate_high_risk_action';
```

V16. pgcrypto availability for the device token hash (section 3.8).

```sql
select e.extname, n.nspname as schema_name
from pg_extension e
join pg_namespace n on n.oid = e.extnamespace
where e.extname = 'pgcrypto';
```

V17. The actual night bonus value (R5), run as a role allowed to execute the function.

```sql
select app_private.night_ot_bonus() as night_bonus_amount;
```

V18. Triggers on `storage.objects`, including the delete protection (R15).

```sql
select tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal and tgrelid = 'storage.objects'::regclass
order by tgname;
```

V19. Whether the PENDING migrations have been applied (decides which half of section 7 is live).

```sql
select version, name
from supabase_migrations.schema_migrations
where version >= '20260913000000'
order by version;
```

V20. Schema usage on `app_private` for `anon` and `authenticated` (R11, section 3.1).

```sql
select r.rolname, has_schema_privilege(r.rolname, 'app_private', 'usage') as has_usage
from pg_roles r
where r.rolname in ('anon', 'authenticated', 'service_role');
```

Non-SQL checks that belong with these: run `npx supabase db reset` on a scratch stack to confirm the replay
failure of section 1.1; run `npx supabase test db` to confirm that `supabase/tests/26_hr_attendance.test.sql` fails
at its `hourly_rate` assertion (`:142-148`); and correct one record in a browser to confirm that the Review list
reloads while an open day modal keeps the old times (`UI_UX.md`).

---

## 9. RECOMMENDED TEMPLATE IMPROVEMENTS (database layer, consolidated)

Each item is a gap in the reference implementation established above, and the change the template makes. None is
a change to production. Format: defect (CURRENT); evidence; template change.

1. Members can INSERT and UPDATE their own attendance rows directly, bypassing the kiosk, the device gate, the
   selfie and the audit; the night trigger is INSERT-only.
   Evidence: `M/20260717120000:59-75`; `M/20260722200000:46-49`. Template: no write grants or policies on sessions;
   definer functions only (5.1, 5.3).
2. The clock functions check only "active staff"; `hr_attendance` gates the page and roster, not the write.
   Evidence: `M/20260907120000:25-28`; `src/lib/hr/attendance.ts:158, 211`. Template: `attendance.clock_operate`
   inside both clock functions (5.13).
3. Device approval is enforced in TypeScript only, fails open, clock-out has no device argument, and the PENDING
   fix binds clock-in to a readable device id.
   Evidence: `attendance.ts:28-48`; `src/lib/hr/devices.ts:40-41`; `M/20260916120000:431-432, 451-459`.
   Template: token hashed and compared inside both clock functions; `attendance.device.mode` with a `required` mode (5.6).
4. Two night rules: the session flag uses the clock-in hour, payroll uses the clock-out time; a clock-out after
   midnight earns no bonus; the correction file's comment contradicts the payroll rule.
   Evidence: `M/20260722200000:34-37`; `M/20260907160000:41, 53-55`; `M/20260907130000:9-10`. Template: one predicate
   `app_private.is_night_session` read from settings, used by every reader (5.3, 5.12).
5. Exclusions disagree between layers: the roster drops Super Admins but the clock-in function accepts them; the
   roster lists demo accounts but the clock-in function refuses them.
   Evidence: `M/20260907160000:21-25`; `M/20260907120000:30-37`. Template: `is_timekeeping_eligible` used everywhere (5.2).
6. Kiosk status reads (open sessions, last clock-out today) run under the caller's RLS, so an operator without
   `hr_review_attendance` is never offered Clock Out for another member.
   Evidence: `attendance.ts:111-146`; `M/20260804140000:8-14`. Template: definer `attendance_status` (5.13).
7. Reviewers who are not Super Admin see no member names, and a reviewer without `hr_attendance` gets an empty
   employee filter.
   Evidence: `attendance.ts:102, 562-563`; `M/20260821140000:21-22`; `M/20260907160000:16-19`. Template: definer
   `review_attendance_page` and a roster gate that accepts `attendance.view_team` (5.13).
8. Selfie metadata and objects are readable by every active member; anyone active can attach an image to any
   record; in versus out is a file-name convention; no FK; no retention job.
   Evidence: `M/20260716300000:127-129, 137-142, 159-165`; `attendance.ts:505, 553`; `src/lib/attachments/upload.ts:72`.
   Template: `attendance_photos` with FK, `kind`, own bucket, subject-or-review read, operator-checked insert, a
   service-role retention job (5.7).
9. Deactivated accounts pass role-title gates (live) and self branches (live and PENDING), because
   `current_staff_role()` and `current_staff_id()` ignore `is_active`.
   Evidence: `M/20260715130000:28-58`. Template: the sentinel plus an active-only `current_staff_id()` (5.1).
10. A role gate without an `is null` branch skips its raise for a caller with no profile.
    Evidence: `M/20260907130000:30` is the one gate that handles it; R2 and R4 unknown. Template: permission gates
    only, and a catalog test that scans every definer body.
11. Hard delete keeps no values; the old clock-out survives only in a best-effort application event; SQL functions
    write no audit rows; no column records the kiosk operator.
    Evidence: `attendance.ts:341-347`; `M/20260907130000:55-61`; `src/lib/audit/log.ts:75-78`. Template: SQL-side
    audit writer, `clock_in_by`, `clock_out_by`, `edited_at`, optional soft delete (5.3, 5.11).
12. No approval, finalization or period lock; corrections and deletions change periods that already have payslips.
    Evidence: `M/20260907160000:43-44`; `M/20260907130000:13-63`. Template: optional `attendance_day_reviews` and
    `payroll.lockPeriodAfterPayslip` (5.5).
13. Payslips: no uniqueness per employee and period, so a newer pending row can hide a paid one; immutability by
    convention only; `approved_by` never written; no reverse path.
    Evidence: `M/20260722210000:15-68`; `src/lib/hr/payslip.ts:55-82`. Template: partial unique index with
    `superseded_by`, freeze trigger, optional `void` (5.9).
14. Negative net pay is allowed and corrupts the printed Payroll Summary total.
    Evidence: `M/20260722210000:28`; `src/components/hr/payroll-summary-button.tsx:32-36`. Template: refuse in
    generation unless `payroll.allowNegativeNet`; signed parsing in the renderer (`PAYROLL.md`).
15. Deductions are one lump sum with no reason, no additions and no later edit.
    Evidence: `M/20260722210000:27, 93`; `src/lib/hr/payslip-actions.ts:48-55`. Template: optional `payroll_adjustments` (5.10).
16. Mark-paid and rate-edit authority disagree between UI, TypeScript and the database; rate edits have no
    TypeScript guard and a live-only database gate.
    Evidence: `payslip-actions.ts:106` versus `M/20260722210000:62-65`; `src/lib/hr/rate.ts:201-244`; R4.
    Template: `mark_payslip_paid` and `set_staff_salary_rate` gated by `payroll.payslip.mark_paid` and
    `payroll.rates.edit`, mirrored in TypeScript (5.13).
17. Payroll money lives in two SQL bodies that can drift (the repository snapshot body is stale and cannot run),
    the derived report depends on the caller's RLS over the rate table and on a bonus-function grant, and the
    repository snapshot body stores a zero salary when no rate exists.
    Evidence: `M/20260722210000:97-100, 113`; `M/20260907160000:30, 62, 85`. Template: one `app_private.payroll_lines`
    computation; generation refuses without a rate (5.13).
18. Six live columns and four live functions have no DDL; the pgTAP suite is stale; a replay from the repository
    most likely fails.
    Evidence: section 1.3; `supabase/tests/26_hr_attendance.test.sql:142-148`. Template: complete migrations, pgTAP
    for every function, and a replay-from-empty test.
19. Timezone, night threshold, bonus amount, device maximum and default label are literals in SQL and TypeScript.
    Evidence: `M/20260722200000:34-37`; `M/20260907120000:45`; `M/20260907160000:41`; `M/20260722150000:49, 51`.
    Template: `app_private.hr_settings` and its readers (5.12); `CONFIGURATION.md`.
20. Grant hygiene is inconsistent: several definer functions have no anon revoke in the repository and the live
    state is known only from two dated migration comments.
    Evidence: section 3.0; `M/20260821120000:14`; `M/20260916120000:12-14`. Template: revoke and grant in the same
    migration as every create; a catalog test (5.1, principle 8).
21. The request-then-approve delete path depends on a permission that no migration grants and no catalogue exposes.
    Evidence: `M/20260715120100:78-80`; `src/lib/fulfillment/service.ts:502`; `src/lib/authz/permissions.ts:41`.
    Template: the path is dropped by default; a client that sets `attendance.deletion.requestApprovalPath` lists the
    optional `attendance.delete.request` key in the catalogue and checks it in the request insert policy (5.1, 5.13).
22. `attendance_devices` RLS is not forced, has no explicit grants and no uniqueness on the token hash.
    Evidence: `M/20260722150000:14-30`. Template: forced RLS, explicit grants, unique `token_hash`, active pair check (5.6).
23. Selfie retention cannot run from SQL and the maintenance script embeds the production project URL.
    Evidence: R15; `scripts/purge-attendance-selfies.mjs:7-9` (URL not copied). Template: a service-role job
    reading its target from the environment (5.7).
24. The correction has no overlap check against the member's next session and no age limit, and the Review modal's
    minute-precision default usually refuses an unchanged save on an open session (it closes the session at zero
    length when `time_in` lies exactly on a whole minute) and silently rewrites a completed one.
    Evidence: `M/20260907130000:45-53`; `src/components/hr/review-attendance-view.tsx:674-679, 707, 713`. Template:
    overlap, window and no-op checks in the function (5.13); seed the input from `time_in` rounded up (`UI_UX.md`).
25. The static authorization sweep only detects `.insert(`, `.update(` and `.delete(` calls, so a module that
    writes through `.rpc(` alone is never checked.
    Evidence: `tests/integration/phase11-authorization-boundary.test.ts:27-31`. Template: the sweep also matches RPC
    calls and asserts per export (`TESTING_CHECKLIST.md`).

---

## 10. NEEDS VERIFICATION index

| Item | Where discussed | Query |
|---|---|---|
| R1 `kiosk_clock_out` body, security, gate, grants, function-owning role | 1.3, 3.3 | V1, V9, V13 |
| R2 `delete_attendance_record` body, gate, selfie handling, grants | 1.3, 3.6 | V1, V9, V13 |
| R3 `staff_salary_rates` DDL, checks, indexes, RLS, grants, realtime | 2.5 | V2, V3, V5, V6, V8, V10, V12 |
| R4 `set_staff_salary_rate` body and role gate | 3.11 | V1, V9 |
| R5 `night_ot_bonus()` definition, value, grant | 3.13 | V1, V9, V17 |
| R6, R7 legacy hourly table and function | 2.6, 3.12 | V2, V1 |
| R8 six `payroll_snapshots` columns | 2.7 | V2, V3 |
| R9 live `generate_payslip_snapshot` | 3.10 | V1, V9, V13 |
| R10 `attendance_records_time_in_idx` | 2.1 | V8 |
| R11 live `report_payroll` grants; anon EXECUTE; anon schema usage | 3.0, 3.9 | V9, V20 |
| R12 widened `payroll_snapshots` policies | 2.7 | V5 |
| R13 live `attendance_apply_overtime` and trigger set | 2.1, 3.7 | V1, V10 |
| R14 `owner_approval_requests.payload` | 2.10 | V2 |
| R15 `storage.protect_delete` | 2.3 | V18 |
| R16 Super Admin cap and primary Super Admin function | 1.3, 2.4 | V14, V1 |
| Live grants of `kiosk_clock_in` (note a) | 3.0, 3.2 | V9 |
| Direct write exposure on `attendance_records` | 2.1 | V4, V5, V6 |
| Table privileges on `attendance_devices` | 2.2 | V6 |
| A second SELECT policy on `staff_profiles` | 2.4 | V7 |
| Function-owning database role and its RLS bypass for the definer functions | 2.1 | V13 |
| `staff_profiles_selected_admin_limit` still present | 2.4 | V14 |
| Holders of `initiate_high_risk_action` (count) | 2.9 | V15 |
| pgcrypto on a new stack | 3.8 | V16 |
| Realtime membership of the remaining tables | 2.12 | V12 |
| Versions and order of the twenty production names | 1.1 | V11 |
| Whether the PENDING migrations are applied | 7 | V19 |
| Repository-only replay; stale pgTAP suite | 1.1, 3.9 | CLI runs after V19 |

---

## 11. PROJECT-SPECIFIC values removed from the template

This is the only section of this document that names the reference implementation's business values. None of them
may appear in template code, template migrations or `IMPLEMENTATION_PROMPT.md`; each becomes a setting or is dropped.

Format: value; where it lives; template treatment.

- Business timezone `Asia/Manila`, written `<business-tz>` above.
  Where: `M/20260722200000:34`; `M/20260907120000:45`; `M/20260907160000:41`; `M/20260916120000:368, 476`;
  `src/lib/hr/attendance.ts:133`; the business-date helper module `src/lib/format/manila-date.ts:16`. The kiosk
  clock-in migration file is `supabase/migrations/20260907120000_kiosk_clock_in_manila_work_date.sql` (cited as
  `M/20260907120000`), and production migration 18 is `kiosk_clock_in_manila_work_date`.
  Template: `locale.timezone` in `app_private.hr_settings`; migration and file names never embed a zone.
- Currency: Philippine peso. The peso sign appears in server messages (`src/lib/hr/attendance.ts:201`;
  `src/lib/hr/rate.ts:242`), in SQL comments and provisional-field notes (`M/20260722200000:6, 20, 72`;
  `M/20260907160000:54`), and `PHP` in the payslip PDF. Template: `locale.currencyCode` and `locale.currencySymbol`.
- Session night flag: a clock-in hour at or after 22 in the business zone stores `is_overtime` and the literal amount
  300.00 on that session, set per session by the BEFORE INSERT trigger, registered as provisional pending the business
  owner's confirmation. Where: `M/20260722200000:34-37, 70-73`. Template: no stored flag; the one predicate reads
  `payroll.nightRule.*` (5.3, 5.12).
- Payroll night bonus: one bonus per distinct `work_date` with a clock-out at or after 22:00 in the business zone,
  priced by `night_ot_bonus()` (R5), whose comment says 300. Where: `M/20260907160000:41, 53-55`. Template:
  `payroll.nightRule.*`, decided by each client.
- Device cookie name `av_att_device`, prefixed with the brand initials. Where: `src/lib/hr/devices.ts:27`.
  Template: `branding.cookieNamePrefix`.
- Default device label `Shop phone` and the "approved shop phone" wording of refusals. Where:
  `M/20260722150000:51`; `src/lib/hr/devices.ts:94`; `src/lib/hr/attendance.ts:41, 46`.
  Template: `attendance.device.defaultLabel` and neutral copy.
- Super Admin accounts excluded from clocking and payroll by role title, a business-owner decision dated 2026-09-07 whose
  migration comment names two real people (names not copied). Where: `M/20260907160000:1-7, 24, 99`;
  `src/lib/hr/rate.ts:137`. Template: `timekeeping_exempt` seeded from `exclusions.excludedRoles` (5.2).
- Demo accounts back-filled once from an auth-email LIKE pattern on a non-routable test domain (pattern not
  copied). Where: `M/20260722160000:10-15`. Template: keep the `is_demo` flag; drop the seed convention.
- The production project URL in the selfie purge script's usage text. Where: `scripts/purge-attendance-selfies.mjs:25`
  (not copied). Template: read the URL from the environment.
- Specification references: "Bible" section labels in migration comments and in the provisional-fields column
  `bible_reference`. Where: `M/20260715140000:230-236`; `M/20260717120000:138-141`; `M/20260722200000:70-73`;
  `M/20260722210000:137-142`. Template: drop them, or an open-decisions table with the client's own references.
- The three-role vocabulary `owner`, `selected_admin`, `staff` with the labels Super Admin, Admin and Staff (the SQL
  messages say "Owner" and "Selected Admin"), the max-two-Admin trigger and the cap of two Super Admins (R16).
  Where: `M/20260715120100:15-31, 145-182`; `M/20260715130300:104-139`; `src/lib/authz/access-catalogue.ts:188-190`.
  Template: role keys stay engine vocabulary; labels and caps belong to the identity module's settings.
- The business attachment entity types and purposes, and every approval kind other than `attendance_delete`.
  Where: `M/20260716300000:61-80`; `M/20260722200000:56-68`; `M/20260817190000:11-17`.
  Template: `attendance_photos` and an optional single-kind approval queue.
- Hosting the approval executor inside the fulfilment module, and the realtime list that covers every business
  table. Where: `src/lib/fulfillment/service.ts:735-739`; `M/20260731130000:11-35`.
  Template: a per-module executor and per-module realtime registration.
