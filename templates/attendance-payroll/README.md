# Attendance and Payroll: Reference Code Template

This folder is reference code for building Attendance (a shared clock kiosk), Review Attendance and Payroll on Postgres
with row-level security. It turns the design of `docs/templates/attendance-payroll/` (DATABASE.md section 5,
CONFIGURATION.md section 2, PAYROLL.md section 11, IMPLEMENTATION_PROMPT.md Steps 3 to 8, SERVER_API.md section 9) into
generic SQL migrations with the same object names, a key-value settings store, a self-test built on the template fixture
T3, and a typed client configuration. It is a TEMPLATE: adapt it to the host's identity and permission layer and review
it before use. It is not drop-in code and production never imports it. All nine SQL files were applied in order to a
throwaway PostgreSQL 17 database and `0008_selftest.sql` completed without error; run the self-test again on a scratch
copy of the host stack after replacing 0000.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, cited as `file:line`. |
| GENERIC | The reusable form this code ships. |
| PROJECT-SPECIFIC | Tied to the source business. Brand, timezone and currency values are not reproduced here; the reference pay-policy values appear only as cited CURRENT facts (the paragraph below and section 11), never as seeds. |
| CONFIGURABLE | A client setting: a row of `app_private.hr_settings` (SQL) or a configuration key (TypeScript). |
| NEEDS VERIFICATION | Neither the repository nor this code settles it; the text says what would. |
| RECONSTRUCTED | A live object of the reference implementation whose DDL is missing from its repository. |
| PENDING (not live) | Content of reference migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that this code fixes. Never a production change. |

`M/<timestamp>:<lines>` is the file in `supabase/migrations/` whose name starts with that timestamp. Roles: Super Admin
(role key owner), Admin (role key selected_admin), Staff (role key staff); below, Super Admin, Admin and Staff.

CURRENT in one paragraph: clocking is a shared kiosk, where a signed-in operator holding `hr_attendance` picks a member
from `list_clock_staff` and clocks that member; `attendance_records` holds one row per session with one open session per
member (unique partial index); `work_date` is the business-timezone date at clock-in; a day's total is the sum of its
completed sessions. Two different night rules exist: a BEFORE INSERT trigger flags a session whose clock-in hour is 22 or
later with a flat 300.00 (`M/20260722200000:26-49`), while payroll counts distinct work dates with a clock-out at or after
22:00 and multiplies by `app_private.night_ot_bonus()` (RECONSTRUCTED; `M/20260907160000:41, 53-55, 85`). Pay is
round(days_worked x daily_rate + night_shifts x night_ot_bonus(), 2) (`:86-93`); deductions are one lump sum >= 0 at
payslip generation; a payslip is a frozen snapshot whose status goes pending to paid. There is no approval or
finalization step and no period lock. Only the clock-out can be corrected, by Super Admin or Admin by role title, with a
reason, in place, and the old value survives only in a best-effort application audit event; delete is a hard delete.
Device approval stores the hash of a token kept in an httpOnly cookie and is enforced in server TypeScript only (the live
database has no check; PENDING adds a clock-in check), failing open while no device is registered. Super Admins and demo
accounts are excluded from payroll; the roster excludes Super Admins but lists demo accounts.

## 1. Files and apply order

| Order | File | Purpose |
|---|---|---|
| 1 | `migrations/0000_prerequisites_example.sql` | EXAMPLE roles, `auth.uid()` stub, pgcrypto, `employees`, grants table, helpers. Replace it. |
| 2 | `migrations/0001_settings.sql` | `app_private.hr_settings`, validation, seed, readers, night predicate, eligibility, `get_hr_settings`. |
| 3 | `migrations/0002_audit.sql` | `audit_events` when the host has none, `record_audit_event`, the attendance and payroll read policy. |
| 4 | `migrations/0003_attendance_sessions.sql` | `attendance_sessions`, one-open-session index, read-only RLS. |
| 5 | `migrations/0004_attendance_devices.sql` | `attendance_devices`, gate, verify, register, revoke. |
| 6 | `migrations/0005_attendance_photos.sql` | `attendance_photos`, `attach_attendance_photo`, storage notes. |
| 7 | `migrations/0006_attendance_rpcs.sql` | `list_clock_staff`, `attendance_status`, kiosk clock in and out, correction, deletion. |
| 8 | `migrations/0007_payroll.sql` | Rates, `payroll_lines`, `report_payroll`, payslips, mark paid, void, freeze trigger. |
| 9 | `migrations/0008_selftest.sql` | One transaction ending in ROLLBACK; prints `SELFTEST OK`. |
| - | `config/attendance-payroll.config.ts.example` | CONFIGURATION.md section 2 types, rules 1 to 15, engine and store checks, seed rows, defaults. Shipped as `.ts.example` so a host type-check, lint and build never include template code; rename it to `.ts` when adopting. |
| - | `config/example.client.config.json` | Placeholder client file with the same shape; fails validation until the placeholders are filled. |

Each migration header states its CURRENT behaviour with citations, the improvements it makes and a rollback. No file
references an object that a later file creates (SQL-language bodies are checked when created, plpgsql bodies when
called; both hold in this order). Statements are idempotent where Postgres allows (`if not exists`, `create or replace`, drop-then-create for
policies and constraints). `create or replace` cannot change a `returns table` shape: drop, create and grant again
(`M/20260721100000:10-12`).

## 2. Prerequisites

| Requirement | Why |
|---|---|
| PostgreSQL 14 or later (written for 17) | `create or replace trigger`. |
| Roles `anon`, `authenticated`, `service_role` | Grants name them; 0000 creates them when missing. |
| `auth.uid()` | Every helper resolves the caller from it; the 0000 stub reads `request.jwt.claim.sub`. |
| pgcrypto as `extensions.digest(text, text)` | Device token hashes; 0000 fails loudly otherwise. The server mints tokens. |
| `public.employees(id, auth_user_id, full_name, role_key, is_active, is_demo, timekeeping_exempt)` | Identity and eligibility. |
| `app_private` helpers `current_staff_id()`, `current_staff_role()`, `is_active_staff()`, `is_owner()`, `has_permission(text)` | Every gate. |
| Definer functions owned by a role that bypasses RLS | Tables force RLS with no write policies; the self-test checks each owner. |

Keys checked in SQL are the PERMISSIONS.md section 4.2 keys `attendance.clock_operate`, `attendance.view_team`,
`attendance.review`, `attendance.correct`, `attendance.delete`, `attendance.devices.manage`, `payroll.view_all`,
`payroll.rates.edit`, `payroll.payslip.generate` and `payroll.payslip.mark_paid`; `payroll.export` stays in the export
route. They replace CURRENT `hr_attendance`, `hr_review_attendance`, `hr_payroll` and the role-title gates. The key
dependencies of PERMISSIONS.md section 4.3 belong to the host's grant-saving function; each SQL gate checks only its own
key, except `generate_payslip_snapshot`, which also requires `payroll.view_all`.

## 3. Names

Object names, signatures and columns follow DATABASE.md sections 5.2 to 5.13; the mapping to the reference tables is
DATABASE.md section 5.14 (`attendance_records` to `attendance_sessions`, `attachments` to `attendance_photos`,
`staff_salary_rates` to `employee_pay_rates`, `staff_profiles` to `employees`). Where the documents leave a detail open,
or this code adds a helper, the choice is listed here. Rows marked "documented" are now stated in the documents too.

| Object | Choice made here |
|---|---|
| `attendance_status(p_employee_ids uuid[] default null)` | Documented in DATABASE.md 5.13: `open_session_id` and `open_work_date` after the first three columns (SERVER_API.md 9.4). |
| `kiosk_clock_in(p_employee_id, p_device_token, p_note)` | Documented in DATABASE.md 5.13: `p_note` defaults to null. |
| `generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions, p_regenerate)` | Documented in DATABASE.md 5.13: `p_regenerate boolean default false`; regeneration is explicit (IMPLEMENTATION_PROMPT.md P14). |
| Settings readers | Documented in DATABASE.md 5.12: `hr_setting`, `hr_setting_text`, `business_timezone` and `is_night_session` are plpgsql so they can raise; the rest are SQL. |
| `app_private.payroll_lines`, `report_payroll` | Columns mirror PAYROLL.md section 11 `PayrollLine`: `gross_regular`, `gross_night_bonus`, `gross_overtime`, `gross_total`, `warnings`. |
| `payroll_lines` warnings | `no_rate`, `open_session_in_period`, `rate_changed_mid_period`, plus `unsupported_rate_basis` for a `monthly` row. |
| `payroll_snapshots.overtime_pay` | Holds the night bonus pay (IMPLEMENTATION_PROMPT.md P13); overtime hours are never paid. |
| `app_private.hr_setting_text(p_key, p_as_of)` | Added: a required scalar as text; raises while the value is JSON null. |
| `app_private.attendance_device_check_applies()`, `attendance_resolve_device(text)` | Added: internal device helpers, no end-user EXECUTE. |
| `app_private.employees_apply_exclusions()` | The DATABASE.md 5.2 trigger that sets `timekeeping_exempt` from `exclusions.excludedRoles`. |
| `app_private.audit_events_refuse_change()` | Template-owned append-only trigger function, used only when 0002 creates `audit_events`. |
| `app_private.record_audit_event(...)` | Returns the new row id. |
| `register_attendance_device(p_label, p_token)` | Refuses a token shorter than 32 or longer than 256 characters. |
| `employee_pay_rates.created_at` | Defaults to `clock_timestamp()`, so two rows saved in one transaction still order deterministically. |
| `attendance_photos.storage_bucket` | Defaults to `attendance-photos`; rename to the host bucket. |
| `payroll_lines` night bonus | Counted on every night day, including a day below `payroll.minHoursForDay` (IMPLEMENTATION_PROMPT.md Q7). |
| `payroll_lines` with `per_day` | A work date with no rate in force makes `gross_regular` and `gross_total` null for the line. |
| `mark_payslip_paid(p_snapshot_id, p_payment_date)` | Accepts any date not after business today; `payroll.paidDateEditable` is enforced by the server action. |
| `attach_attendance_photo` | Path must be exactly `<session id>/<kind>.<jpg, jpeg, png or webp>`; a soft-deleted session is `not_found`. |
| `set_staff_salary_rate` | An ineligible employee is `validation`; `monthly` is refused. |
| `kiosk_clock_in`, `kiosk_clock_out` | An ineligible target is `conflict`. |
| `payroll_lines` extra columns | `role_key`, `period_start`, `period_end`, `rate_effective_date`, `open_sessions`. |

## 4. Settings store

`app_private.hr_settings(key, value jsonb, effective_from)` holds one `-infinity` row per key of CONFIGURATION.md
section 2.8; `payroll.*` keys may add dated rows (check `hr_settings_dated_keys`). No end-user role has any grant on it.
SQL reads it through `hr_setting(p_key, p_as_of)`, `hr_setting_text`, `business_timezone()`, `business_today()`,
`night_bonus_amount(p_as_of)` and `is_night_session(p_time_in, p_time_out)`; the application reads the values in force
through `public.get_hr_settings()`. Per-session and per-day keys are read as of the session's `work_date`; period-wide
keys as of the period end (CONFIGURATION.md section 1.4). A trigger refuses unknown keys, malformed values and values of
modules this code does not build, and stamps `updated_at` and `updated_by`. Changes are reviewed migrations; the runtime
editor `set_hr_setting` is not built.

The seed writes the CONFIGURATION.md section 2 default of each key. Keys set at onboarding are seeded as JSON null, and
every reader that needs them raises until they are set: clocking and payroll refuse rather than run on a guessed value.
No reference pay-policy value is seeded. `hrSettingsSeedRows(config)` in the TypeScript file produces the same 29 rows
from a client configuration; pin the seed migration to it with a file-content test (as the reference does,
`tests/unit/security-hardening.test.ts:218-286`).

| Key | Seed | Read by | SQL accepts |
|---|---|---|---|
| `locale.timezone` | null (set at onboarding) | `business_timezone` | an IANA zone |
| `payroll.nightRule.enabled` | false | `is_night_session` | boolean |
| `payroll.nightRule.anchor` | null (set when enabled) | `is_night_session` | `clock_in`, `clock_out`, null |
| `payroll.nightRule.thresholdTime` | null (set when enabled) | `is_night_session` | HH:MM, null |
| `payroll.nightRule.windowEnd` | null | `is_night_session` | HH:MM earlier than the threshold, null |
| `payroll.nightRule.bonusAmount` | "0.00" | `night_bonus_amount` | money text, at most ten integer digits |
| `payroll.nightRule.oncePerDay` | true | `payroll_lines` | boolean |
| `payroll.overtimeDisplayThresholdHours` | null (set at onboarding) | `payroll_lines` | above 0 and at most 24 |
| `payroll.overtimeBasis` | "session" | `payroll_lines` | `session`, `day` |
| `payroll.minHoursForDay` | 0 | `payroll_lines` | 0 to 24 |
| `payroll.rateSelection` | "period_end" | `payroll_lines` | `period_end`, `per_day` |
| `payroll.allowNegativeNet` | false | `generate_payslip_snapshot` | boolean |
| `payroll.payFrequencies` | null (set at onboarding) | `set_staff_salary_rate` | non-empty subset of the four frequencies |
| `payroll.approvalRequired` | false | none | false only (day approval not built) |
| `payroll.lockPeriodAfterPayslip` | "off" | none | `off` only (period lock not built) |
| `payroll.overtimePayMultiplier` | 0 | none | 0 only |
| `payroll.deductionsModel` | "lump_sum" | none | `lump_sum` only (itemized not built) |
| `attendance.device.mode` | "auto" | device helpers | `off`, `auto`, `required` |
| `attendance.device.maxActiveDevices` | 1 | `register_attendance_device` | integer 1 to 1000 |
| `attendance.device.defaultLabel` | "Time clock" | `register_attendance_device` | 1 to 80 characters |
| `attendance.allowMultipleSessionsPerDay` | true | `kiosk_clock_in` | boolean |
| `attendance.clockMode` | null (set at onboarding) | none | `kiosk`, null (self-service not built) |
| `attendance.correction.maxWindowDays` | null | `correct_attendance_clock_out` | integer 1 to 3650, null |
| `attendance.deletion.mode` | "soft" | `delete_attendance_record` | `soft`, `hard` |
| `attendance.selfie.mode` | "off" | none | `off`, `optional` |
| `review.dateFilterBasis` | "work_date" | none (the paged reader is not built) | `work_date`, `time_in` |
| `exclusions.excludedRoles` | [] | `employees_apply_exclusions` | array of role keys |
| `exclusions.excludeDemoAccounts` | true | `is_timekeeping_eligible` | true only |
| `audit.payloadIncludesAmounts` | false | rate and payslip functions | boolean |

The TypeScript validator reports the same limits before install: CONFIGURATION.md rules 1 to 15, an `engine` check for
`attendance.clockMode = self_service`, and `store` checks for the ranges above. `attendance.device.failMode` is not in
the store: it governs only the server pre-check (CONFIGURATION.md section 2.4); SQL refuses on its own.

Not checked by `validateAttendancePayrollConfig`: IMPLEMENTATION_PROMPT.md V1 (unknown or missing keys at run time), V2
(currency code shape and separators), V6 (`maxSessionHours`), V11 (`fileNamePattern` tokens; `logoText` is required even
with `logoUrl`) and V12 (unfilled placeholder text). A host that loads JSON adds these checks.

## 5. Errors and audit

- Authority refusals raise SQLSTATE 42501 with hint `forbidden` (or `device_not_approved`); every other refusal carries
  its SERVER_API.md section 9.10 code in the hint: `validation`, `not_found`, `conflict`, `unavailable`. The server maps
  the hint, never the message text. Writes are never retried by the transport (`src/lib/supabase/retry-fetch.ts:58-60`).
- Success rows are written in SQL through `app_private.record_audit_event`, inside the transaction of the change, with
  these actions: `attendance.clock_in`, `attendance.clock_out`, `attendance.clock_out_corrected` (old and new clock-out),
  `attendance.delete` (the full row on a hard delete), `attendance.photo_attach`, `attendance.device_register`,
  `attendance.device_revoke`, `payroll.set_salary_rate`, `payroll.payslip_generated`, `payroll.payslip_marked_paid`,
  `payroll.payslip_voided`. Money appears in a context only when `audit.payloadIncludesAmounts` is true.
- Refusals follow path (b) of IMPLEMENTATION_PROMPT.md B12 in every function: the function raises and the server layer
  writes the denied or failed row after the error returns. A raise rolls back every row its transaction wrote, so no
  function writes a row and then raises. A refused direct RPC call therefore leaves no row; a client that needs those rows
  asks for path (a) (typed refusals) at question Q23.

## 6. Security properties the code relies on

- Every module function (the `auth.uid()` stub of 0000 aside) has `set search_path = ''`, names every non-catalog object
  with its schema, and revokes EXECUTE from PUBLIC and `anon` in its own migration. Trigger functions, the audit writer and the two device helpers also have no
  EXECUTE for `authenticated`. `app_private.payroll_lines` is granted to `authenticated` because `report_payroll` runs as
  the caller; the grant is safe only because the caller filter (eligible AND (own row OR `payroll.view_all`)) is inside it.
- Every module table has RLS enabled and forced, SELECT policies only, and no INSERT, UPDATE or DELETE grant for end
  users. The one exception is `audit_events` created by 0002, which keeps the CURRENT self-attributed insert policy for
  the server layer's refusal rows (`M/20260715130100:664-670`).
- Read scopes: sessions own or `attendance.view_team`; photos subject or `attendance.review`; devices
  `attendance.devices.manage` (no `token_hash` grant); rates own, `payroll.view_all` or `payroll.rates.edit`; payslips own
  or `payroll.view_all`; audit rows `payroll.*` for `payroll.view_all` and `attendance.*` for `attendance.review`.
- Payslips are frozen by a trigger (figures never change; pending to paid, pending to void, paid to void; payment facts
  and superseded or void rows never change; no delete), and one current payslip per exact period is a partial unique
  index. A second generation for the same period returns `conflict` unless `p_regenerate` is true; regeneration then
  supersedes a pending payslip, and it is refused over a paid one until that payslip is voided.

## 7. Running the self-test

On a scratch PostgreSQL 17 database, as a superuser, apply 0000 to 0007 in order, then run
`psql -v ON_ERROR_STOP=1 -d <scratch-db> -f migrations/0008_selftest.sql` and expect `NOTICE: SELFTEST OK`. Everything
rolls back. The file header lists what it covers and what it does not (device modes `required` and `off`,
`allowMultipleSessionsPerDay = false`, `maxWindowDays` and storage policies are not exercised).

The payroll assertions use fixture T3 of IMPLEMENTATION_PROMPT.md Step 10 (template data, not reference data), with the
business timezone set to UTC: daily rate 120.00; night rule on, anchor clock-out, threshold 21:00, no window end, bonus
50.00 once per day; overtime shown above 9 hours per session; no minimum hours.

| Work date | Sessions | Hours | Night |
|---|---|---|---|
| 2026-01-05 | 09:00 to 17:00 | 8.00 | no |
| 2026-01-06 | 08:00 to 12:00; 13:00 to 22:30 (corrected from 18:00:30) | 4.00 + 9.50 | yes (22:30) |
| 2026-01-07 | 22:15 to 00:30 next day | 2.25 | no (00:30 is before 21:00) |
| 2026-01-08 | 09:00, open | excluded | excluded |

Expected: total_hours 23.75; days_worked 3; night_shifts 1; overtime_hours 9.50 - 9 = 0.50; gross = round(3 x 120.00 +
1 x 50.00, 2) = 410.00; with deductions 20.00, net 390.00; deductions 500.00 are refused. Variations asserted: window end
06:00 gives 2 nights and 460.00; a dated bonus of 80.00 from 2026-01-07 on top gives 360.00 + 50.00 + 80.00 = 490.00;
anchor clock-in gives 1 night (2026-01-07) and 410.00; overtime basis day gives 13.50 - 9 = 4.50; a second rate of 150.00
from 2026-01-07 gives 3 x 150.00 + 50.00 = 500.00 with `period_end` and 120.00 + 120.00 + 150.00 + 50.00 = 440.00 with
`per_day`; an hourly rate of 15.00 gives 23.75 x 15.00 + 50.00 = 406.25; a 3-hour minimum drops 2026-01-07 and gives
2 x 120.00 + 50.00 = 290.00. After a soft delete of 2026-01-05 the line is 15.75 hours, 2 days and 290.00; after a hard
delete of the 08:00 to 12:00 session it is 11.75 hours, 2 days and 290.00.

## 8. RECOMMENDED TEMPLATE IMPROVEMENTS built in

| Reference defect (CURRENT) | Fix in this code |
|---|---|
| Staff may insert and update their own sessions through the data API (`M/20260717120000:58-75`) | Select-only grants; writes only through definer functions (0003). |
| Clock writes check only an active account (`M/20260907120000:25-28`); device checked in TypeScript (`src/lib/hr/attendance.ts:28-48`) | Key and token hash in both clock functions (0006). |
| `work_date` column default is the UTC date (`M/20260717120000:25`) | Default `app_private.business_today()` (0003). |
| Two night rules (`M/20260722200000:34-37`; `M/20260907160000:41`); a clock-out after midnight never qualifies | One predicate computed on read, optional window end, dated amounts (0001, 0007). |
| Roster lists demo accounts; clock-in accepts a Super Admin target (`M/20260907160000:20-25`; `M/20260907120000:30-37`) | One eligibility predicate and the `timekeeping_exempt` flag (0001). |
| An operator without the review key never sees open sessions (`src/lib/hr/attendance.ts:111-146`) | `attendance_status`, gated on `attendance.clock_operate` or `attendance.view_team` (0006). |
| Correction by role title, no row lock or overlap check, old value only in a best-effort event (`M/20260907130000:29-61`) | Key, lock, overlap, window, audit row in the transaction (0006). |
| An untouched minute-precision save rewrites a clock-out (`src/components/hr/review-attendance-view.tsx:674-679`) | Whole minutes only; an unchanged minute is refused (0006). |
| Hard delete with no reason, nothing of the row kept (RECONSTRUCTED; `src/lib/hr/attendance.ts:348-390`) | Reason required; soft by default; a hard delete keeps the row in audit (0006). |
| Every active staff member reads every photo and inserts attachment rows (`M/20260716300000:127-129, 137-142`) | Foreign key, kind, narrow reads, operator- and path-checked attach (0005). |
| Rate table and function have no DDL; the rate action has no guard (`src/lib/hr/rate.ts:201-231`) | Append-only rates; `set_staff_salary_rate` on `payroll.rates.edit` checks the frequency (0007). |
| INVOKER report tied to the caller's RLS; all rows only for the Super Admin (`M/20260907160000:29-34, 100`) | Definer `payroll_lines` with the filter inside, `payroll.view_all` (0007). |
| Payslip body stale against the report (`M/20260722210000:75-132`) | Generation reads `payroll_lines` (0007). |
| Negative net allowed (`M/20260722210000:28`) and mis-summed (`src/components/hr/payroll-summary-button.tsx:31-36`) | Refused unless `payroll.allowNegativeNet` (0007). |
| No uniqueness per period; the reader keeps the newest row (`M/20260722210000:41-44`; `src/lib/hr/payslip.ts:66-80`) | Partial unique index, supersede, void (0007). |
| Mark paid is a direct UPDATE under a policy that is not column-limited (`src/lib/hr/payslip-actions.ts:124-135`; `M/20260722210000:62-65`) | `mark_payslip_paid` plus a freeze trigger (0007). |
| `current_staff_id()` ignores `is_active` (`M/20260715130000:35-38`) | The example helper returns null for an inactive profile (0000). |
| Device table RLS not forced (`M/20260722150000:30`); the gate cannot be turned off or required | Forced RLS; `attendance.device.mode` off, auto or required; a device maximum (0004). |
| Every active staff member reads every audit row, payroll money included (`M/20260715130100:661-662`) | Read policy per action prefix; amounts only when configured (0002). |

## 9. Not built here

- The server layer: actions, the httpOnly device cookie and token minting, result types, mapping of the hint codes,
  refusal audit rows, the export route, UI, PDF and print.
- `review_attendance_page` (paged team rows with names for reviewers, IMPLEMENTATION_PROMPT.md R2). Until it exists, a
  reviewer who is not the Super Admin gets team rows under RLS but no names from `employees` (the defect of
  `src/lib/hr/attendance.ts:562-563`); `list_clock_staff` supplies ids and names for the employee filter.
- `self_clock_in` and `self_clock_out`, `attendance_day_reviews` with `review_attendance_day`, the period lock,
  `payroll_adjustments` (itemized deductions), the deletion request path, the runtime settings editor `set_hr_setting`,
  a current-rate reader for `payroll.currentRateLookup`, and the `maxSessionHours` flag. The settings store refuses the
  values that would need them.
- Storage: the private bucket, object policies, signed upload URLs and the retention job. The reference stack blocks
  deleting storage objects from SQL (`scripts/purge-attendance-selfies.mjs:7-9`), so retention runs on the Storage API.
  Photos need the camera allowed for the app's own origin (`next.config.ts:45-48`).
- Typed refusals (path (a) of B12) and the optional `check (net_salary >= 0)` for clients that never allow a negative net.
- A `monthly` rate formula: none exists in the reference implementation (PAYROLL.md section 11 step 4), so
  `set_staff_salary_rate` refuses `monthly` and the configuration validator refuses it (rule 14).

Adapting: replace 0000 and keep NULL-safe gates; add `timekeeping_exempt` to the host identity table; confirm that definer
owners bypass RLS; write the seed from the client configuration; rename the configuration file to `.ts`; seed grants per
PERMISSIONS.md section 5; run 0008; then add pgTAP tests per gate (TESTING_CHECKLIST.md) and validate the configuration
with `validateAttendancePayrollConfig` when it loads. Every write here is an RPC, so a static authorization sweep must
match `.rpc(` calls per exported function; the reference sweep matches only insert, update and delete calls and misses
RPC-only writers (`tests/integration/phase11-authorization-boundary.test.ts:27-31`). On a database that already has the
four-parameter `generate_payslip_snapshot`, drop that signature first (IMPLEMENTATION_PROMPT.md M6); otherwise the new
one is an ambiguous overload.

## 10. NEEDS VERIFICATION

- Behaviour on the host stack (platform roles, the real `auth.uid()`, the host identity tables). Verified so far only on a
  throwaway PostgreSQL 17 database with the 0000 stub. Settled by: replacing 0000 and running 0008 on a scratch copy of
  the host.
- Whether the host's migration role bypasses RLS. Settled by: the owner check in step 1 of 0008.
- Whether a host `audit_events` table keeps append-only triggers and a SELECT policy wider than `audit_events_read_hr`
  (Postgres ORs permissive policies). Settled by: `pg_policy` and `pg_trigger` rows for that table on the host.
- How the host stores `set search_path = ''` in `pg_proc.proconfig`. The self-test accepts the quoted and unquoted forms.
- Cost of `payroll_lines` at client volume: it calls `is_night_session` once per completed session, and each call reads
  several settings rows. Settled by: `explain analyze` of `report_payroll` over a full period on production-sized data.

## 11. PROJECT-SPECIFIC values removed from the template

Not reproduced anywhere in this folder: the source brand and logo text, brand-prefixed cookie and file names, the
business timezone literal, the currency and its symbol, the device label literal, staff names and ids, the primary Super
Admin identity constant, and the production project URL in the reference photo purge script. The reference pay policy
(the 22:00 threshold, the 300.00 night amount, the 8-hour overtime display threshold and the weekly default frequency)
appears only as CURRENT facts with citations and is never seeded; the self-test values (21:00, 50.00, 9 hours, 120.00)
are the template fixture T3.
