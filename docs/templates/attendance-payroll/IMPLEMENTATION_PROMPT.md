# Attendance and Payroll Template: Implementation Prompt (Phase 17)

This file holds one copy-paste prompt that tells an AI coding agent how to build the Attendance, Review Attendance and
Payroll module in a DIFFERENT project, using the architecture of the reference implementation (server actions, Postgres
behind row level security, SECURITY DEFINER functions with a pinned empty search_path, authorization helpers in a
private schema) while keeping that project's own stack, UI system and conventions. The prompt stands alone: the
business rules, the permission model, the configuration keys, the checks that must never be frontend-only, the known
defects of the reference implementation and a fixed final-report format are written inline. The sections around the
prompt explain how to use it, which companion document owns which decision, and where each rule comes from in the
reference repository, so that the prompt block itself can stay free of every source-business detail.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves today, cited as `path:line` in the reference repository. |
| GENERIC | The reusable form the prompt asks the agent to build. |
| PROJECT-SPECIFIC | Tied to the source business; kept out of the prompt block and listed at the end of this file. |
| CONFIGURABLE | Should become a client setting in the new project. |
| NEEDS VERIFICATION | The reference repository cannot settle it; the note says what would. |
| RECONSTRUCTED | A live database object whose DDL is missing from the reference repository. |
| PENDING (not live) | Content of reference migrations 20260916120000, 20260916130000 and 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template fixes. Never a change to production. |

- Roles. The reference implementation has three database role keys; its UI calls them Super Admin (role key owner),
  Admin and Staff. After this line the file says Super Admin, Admin and Staff. The reference Admin role key, the
  reference permission-key names, the business timezone, the currency and the pay-policy values are not written
  anywhere in this file on purpose (INTEGRATION_GUIDE.md section 1.6 scans for them).
- Citations. `M/<timestamp>:<lines>` is the single file in `supabase/migrations/` whose name starts with that
  timestamp. File names are shortened because one of them carries the reference timezone.
- Inside the prompt block the agent sees its own vocabulary: MUST, CONFIGURABLE, ASK (Qn), NOT IN THE REFERENCE and
  REFERENCE DEFECT (RDn). The block defines them.

## Key facts the prompt relies on (CURRENT)

- Clocking is a shared kiosk, not self-service. A signed-in operator whose account holds the Attendance page key picks a
  member from `list_clock_staff` and clocks that member (`src/components/hr/attendance-clock.tsx:145-150`;
  `M/20260907160000:9-27`). The key gates the page and the roster. The server code of both clock actions checks only
  for an active account (`src/lib/hr/attendance.ts:158`, `:211`), and so does the clock-in SQL function
  (`M/20260907120000:25-28`). The clock-out SQL function is RECONSTRUCTED: the repository has no DDL for it, only a
  comment saying it allows any active account (`M/20260805160000:2-4`).
- One row per work session in the table `attendance_records` (template name `attendance_sessions`); one open session
  per member, enforced by a unique partial index (`M/20260717120000:41-45`).
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:40-46`). A day's total is the sum of its
  completed sessions (`src/lib/hr/sessions.ts:90-91`; `M/20260907160000:39`, `:43`, `:49`).
- Two different night rules exist: a session flag that a BEFORE INSERT trigger sets from the clock-in hour, with a flat
  amount (`M/20260722200000:26-49`), and a payroll count of distinct work dates with a clock-out at or after a fixed
  time, multiplied by `app_private.night_ot_bonus()` (RECONSTRUCTED; `M/20260907160000:41`, `:53-55`, `:85`). Their
  literal values are PROJECT-SPECIFIC and appear only in CONFIGURATION.md section 9.
- Pay = round(days_worked x daily_rate + night_shifts x night_ot_bonus(), 2), null without a rate
  (`M/20260907160000:86-93`).
- Deductions are one lump sum >= 0 entered at payslip generation (`M/20260722210000:27`, `:93`). A payslip is a frozen
  snapshot whose payment_status goes pending -> paid (`M/20260722210000:29-30`; `src/lib/hr/payslip-actions.ts:124-135`).
- There is no approval or finalization step for attendance and no period lock (`M/20260907160000:43-44` counts every
  completed session).
- Only the clock-out can be corrected: by Super Admin or Admin by role title, reason required, updated in place; the
  old value survives only in a best-effort application audit event (`M/20260907130000:29-61`;
  `src/lib/hr/attendance.ts:447-456`; `src/lib/audit/log.ts:35-80`). Delete is a hard delete through a RECONSTRUCTED
  function (`src/lib/hr/attendance.ts:348-390`).
- Device approval stores the hash of a random token kept in an httpOnly cookie (`src/lib/hr/devices.ts:75`, `:83-89`;
  `M/20260722150000:50-53`). It is enforced in server TypeScript only (`src/lib/hr/attendance.ts:28-48`): the live
  clock-in function has no device check (`M/20260907120000:14-54`), and PENDING (not live) adds a clock-in check by
  device id (`M/20260916120000:451-459`). The gate is fail-open while no device is registered, and a failed gate read
  also counts as "no gate" (`src/lib/hr/devices.ts:38-42`).
- Exclusions. Super Admins are excluded from the roster, payroll and the rate list (`M/20260907160000:24`, `:99`;
  `src/lib/hr/rate.ts:137`) but accepted as a clock-in target (`M/20260907120000:30-37`). Demo accounts are excluded from
  payroll and the rate list (`M/20260907160000:98`; `src/lib/hr/rate.ts:136`) and refused as a clock-in target
  (`M/20260907120000:35-37`), but the roster still lists them (`M/20260907160000:21-25`).

## Template names and the reference tables they replace

The prompt block uses the template vocabulary of DATABASE.md section 5, so that a rule reads the same in every host
project. The citations in this file point at the reference tables. This mapping ties the two together; DATABASE.md
section 5.14 has the column-level detail.

| Template name (in the prompt) | Reference object (in the citations) | Note |
|---|---|---|
| `employees` | `staff_profiles` (the subset used for timekeeping) | DATABASE.md 5.2; `timekeeping_exempt` is new |
| `attendance_sessions` | `attendance_records`, one row per session | DATABASE.md 5.3; soft-deletion and `edited_at` columns are new |
| `attendance_devices` | `attendance_devices` | DATABASE.md 5.6 |
| `attendance_photos` | `attachments` rows used for clock-in and clock-out selfies | DATABASE.md 5.7; the reference has no photo table of its own |
| `employee_pay_rates` | `staff_salary_rates` (RECONSTRUCTED) | DATABASE.md 5.8 |
| `payroll_snapshots` | `payroll_snapshots` (six columns RECONSTRUCTED) | DATABASE.md 5.9 |
| audit table | `audit_events` | DATABASE.md 5.11 |
| settings store | none: literals in code and SQL bodies | DATABASE.md 5.12 |
| `attendance_day_reviews` | none | NOT IN THE REFERENCE; DATABASE.md 5.5 |

Function names in the block keep the reference names where one exists (`list_clock_staff`, `kiosk_clock_in`,
`kiosk_clock_out`, `correct_attendance_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`,
`report_payroll`, `generate_payslip_snapshot`, and the four device functions `register_attendance_device`,
`revoke_attendance_device`, `verify_attendance_device` and `attendance_gating_active`), as DATABASE.md section 5.13
does. Their parameter names and the tables they touch use the template names above. `kiosk_clock_out`,
`delete_attendance_record` and `set_staff_salary_rate` are RECONSTRUCTED in the reference. `mark_payslip_paid` and
`app_private.payroll_lines` have no reference counterpart: the reference marks a payslip paid with a direct table
update (`src/lib/hr/payslip-actions.ts:124-135`) and computes payroll inside `report_payroll` itself
(`M/20260907160000:29-102`).

## How to use

1. Collect the companion documents of this folder: README.md, ARCHITECTURE.md, BUSINESS_RULES.md, PERMISSIONS.md,
   SECURITY.md, SERVER_API.md, DATABASE.md, PAYROLL.md, CONFIGURATION.md, UI_UX.md, INTEGRATION_GUIDE.md and
   TESTING_CHECKLIST.md, plus the code folder `templates/attendance-payroll/` (reference SQL migrations 0000 to 0007, a
   self-test 0008 that ends in ROLLBACK, and `config/attendance-payroll.config.ts.example`, which is renamed to `.ts`
   when adopted). Give all of them to the agent.
2. Fill the placeholders in the table below, or leave them; the agent asks for any that are empty.
3. Paste the whole fenced block, from its title line to its last line, as the first message in the NEW project's
   workspace. Give the agent repository access and, for databases, access to a local or scratch database only.
4. The agent stops after Step 1 with an ARCHITECTURE REPORT. Answer its questions (Q1 to Q23), confirm the role and
   name mapping, then tell it to continue. Do not skip this gate.
5. At the end, read the FINAL REPORT. Every FAIL line and every item under WHAT WAS NOT VERIFIED is open work.
   Applying migrations to a shared database and deploying remain separate human decisions.
6. When editing the block, keep it free of the source business's names, values, timezone and currency.
7. Payroll row scope departs on purpose from an "invoker payroll report scoped by row level security". The row scope
   comes from the caller filter inside the SECURITY DEFINER function `app_private.payroll_lines`, which applies the
   same own-row-or-`payroll.view_all` rule as the snapshot and rate read policies. `report_payroll` stays SECURITY
   INVOKER only for a stable public signature and adds no protection of its own. Rule P16 in the block states this,
   and the database tests in T2 prove the filter. The reason: PostgreSQL checks EXECUTE on every function an INVOKER
   function calls against the caller, so the signed-in role must be able to execute `payroll_lines`; that grant is
   safe only because the filter lives inside it.

| Placeholder | Meaning |
|---|---|
| `<TIMEZONE>` | Business timezone of the new client, as an IANA zone name. |
| `<CURRENCY>` | ISO 4217 code of the payroll currency. |
| `<CURRENCY_SYMBOL>` | Symbol shown on screen for that currency. |
| `<ORG_NAME>` | Name printed on payslips and summaries. |
| `<CLOCK_MODE>` | `kiosk` (the reference model) or `self_service`. |
| `<TARGET_DATABASE>` | The only database the agent may migrate: local or scratch, named by the human. |

````text
ATTENDANCE + PAYROLL TEMPLATE IMPLEMENTATION PROMPT

ROLE
You are the architect, full-stack engineer, database engineer, security reviewer and QA engineer for one module that
is being added to an EXISTING project (the "host project"). The module has three screens:
- Attendance: a time clock that records work sessions.
- Review Attendance: a reviewer's view of every employee's sessions, with corrections and deletions.
- Payroll: pay rates, a payroll report for a period, and frozen payslips.
The design comes from a template extracted from a working reference implementation. You adapt the design to the host
project. You keep the host project's stack, UI system, naming, folder layout and conventions. You do not copy the
reference implementation's styling, wording, branding, timezone, currency or pay-policy values.

WORDS USED IN THIS PROMPT
- MUST: a rule of the module. Change it only with written approval from the human.
- CONFIGURABLE: the value comes from the configuration object (Step 8).
- ASK (Qn): a decision the human makes in Step 1. Never guess it.
- NOT IN THE REFERENCE: behaviour the reference implementation never had. Build it only as described here, and list
  it in the final report.
- REFERENCE DEFECT (RDn): a known problem of the reference implementation. Do not reproduce it (Step 12).

GROUND RULES (apply to every step)
G1  Read every companion document before Step 1 (Step 0). List any that are missing under WHAT WAS NOT VERIFIED.
G2  Write no application code and no migration before the human has answered your Step 1 report.
G3  Never invent a formula, a permission key, a status or a business rule. If neither this prompt nor the companion
    documents define something you need, add a question and wait.
G4  If documents disagree, use the owning document for that subject: PERMISSIONS.md for permission keys and default
    grants; CONFIGURATION.md for configuration keys and defaults; DATABASE.md for tables, columns and function names;
    PAYROLL.md for pay formulas and the payslip lifecycle; SECURITY.md for enforcement rules; SERVER_API.md for result
    shapes, error mapping and how refusals are audited; UI_UX.md for screens and labels. MUST rules in this prompt win
    over every document. If a MUST rule, built the way you plan, would break a technical constraint that a document
    records (for example that a raised exception rolls back every row written before it), stop and ask. Never ship a
    version that silently misses the rule. Report each difference you found in Step 1.
G5  Never report a check as passed unless you ran it and saw it pass. Anything not run is FAIL or NOT VERIFIED.
G6  Touch only what the module needs. Do not upgrade, remove or reformat unrelated code, dependencies or configuration.
G7  Apply migrations only to <TARGET_DATABASE>. Never run a migration, a data change or a destructive statement against a
    shared, staging or production database unless the human names that database in this conversation and a fresh
    backup exists. Never deploy.
G8  Never use database connections, cloud connectors or credentials that the human did not name for this project.
G9  No secrets, tokens, real person names, email addresses, phone numbers, production ids or production URLs in code,
    scripts, tests, fixtures or comments. Fixtures use synthetic names. Credentials come from the environment.
G10 Follow the host project's rules for branches, commits and pull requests. If it has none, work on a branch and
    commit only when the human asks.

PLACEHOLDERS
<TIMEZONE> IANA zone name | <CURRENCY> ISO 4217 code | <CURRENCY_SYMBOL> symbol shown on screen |
<ORG_NAME> name printed on payslips | <CLOCK_MODE> kiosk or self_service |
<TARGET_DATABASE> the only database you may migrate. An empty placeholder at Step 1 becomes a question.

------------------------------------------------------------------------------------------------------------------
STEP 0. COMPANION DOCUMENTS
------------------------------------------------------------------------------------------------------------------
Read all that are present in the template folder you were given:
- README.md: index, scope, known defects.
- ARCHITECTURE.md: the request path per screen (page gate, server action, domain module, SQL function, row policy).
- BUSINESS_RULES.md: clocking, sessions, work_date, devices, photos, corrections, deletions, review workflow.
- PERMISSIONS.md: permission keys (section 4.2), key dependencies (section 4.3), default grants (section 5).
- SECURITY.md: checks that must never be frontend-only (section 2), device, photo, payroll privacy, function hygiene.
- SERVER_API.md: the capability contract, result and error shapes, and how refusals are audited (section 9, rule 8).
- DATABASE.md: the generic data model and function set (section 5), catalog queries.
- PAYROLL.md: pay formulas, the engine interface (section 11), payroll improvements (section 12).
- CONFIGURATION.md: the configuration schema (section 2), validation (section 2.9), alignment decisions (section 7).
- UI_UX.md: screens, the label set (section 5), responsive guidance (section 8), component names (section 9).
- INTEGRATION_GUIDE.md: install checklist, what to remove, pre-publish scan.
- TESTING_CHECKLIST.md: required tests, manual scripts per role, security regression checklist.
- templates/attendance-payroll/: reference SQL migrations 0000 to 0007 (0000 is an example stub), a scratch-only
  self-test 0008, and config/attendance-payroll.config.ts.example (rename to .ts when adopting); its README.md lists
  extra choices and what it does not build. Read it when it was given to you.
Treat any SQL or code in these documents as a description to translate into the host project, never as files to copy
unchanged. Names in this prompt are template names; map each one to the host project's naming in Step 1.

------------------------------------------------------------------------------------------------------------------
STEP 1. INSPECT THE HOST PROJECT, REPORT, THEN STOP
------------------------------------------------------------------------------------------------------------------
Inspect read-only. Answer every heading with file paths as evidence, or write "not found". Do not guess.
1.1  Stack: framework and version, rendering model (server components, server actions, API routes), language, package
     manager, lint, type-check and test commands, CI.
1.2  Database: engine and hosting; migration tool (create, apply, roll back); how backups or snapshots are taken; row
     level security in use or not; a private helper schema; how existing SECURITY DEFINER functions set search_path and
     grants; which role owns functions and whether it bypasses row level security; whether pgcrypto or another sha256
     source is available.
1.3  Auth: provider; how the current user is resolved in SQL and in server code; session refresh; MFA levels.
1.4  Roles and permissions: every role key; a per-user permission grant table or not; how "this role holds every
     permission" is expressed; how pages and server actions are gated today; the access-management screen and whether
     it can enforce key dependencies on the server; whether an approval-request queue exists.
1.5  Employee table: the table or view that represents employees; primary key; link to the auth user; display name;
     active flag and deactivation fields; any "not a real employee" (demo or test) flag; any exemption flag; whether
     business owners or administrators are rows in it.
1.6  Existing attendance, time-clock, rate, payroll or payslip tables or code. Report every one as a risk.
1.7  Dates: how "today" is computed for business dates; whether a business timezone is configured; whether <TIMEZONE>
     has daylight saving time.
1.8  Money: SQL numeric type and scale; how money crosses to the client (string or number); a shared money formatter
     or money input; how PDFs are produced and whether their fonts can render <CURRENCY_SYMBOL>.
1.9  UI system: component library; design tokens; dialog or bottom-sheet primitive; table primitive and its phone
     layout; tabs, select, pagination, search and badge components; empty, loading and error states; breakpoints;
     tap-target rules; print support; unsaved-changes protection; how navigation registers a page and its key.
1.10 Storage: file storage service; private buckets; signed URLs; whether SQL can delete stored objects; whether a
     scheduled job runner exists (needed for photo retention).
1.11 Audit: an append-only audit table; how server code and SQL write to it; who can read it.
1.12 Realtime and caching: live page refresh; service worker or HTTP cache rules.
1.13 HTTP response headers: where they are set; whether Permissions-Policy allows the camera for the app's own origin.
1.14 Tests: unit runner; component test setup; database test framework (pgTAP or other); end-to-end runner; browser or
     device emulation available to you.
1.15 Environments: which databases exist; which one is <TARGET_DATABASE>; how you will take a fresh backup.
1.16 Proposed mapping: Super Admin, Admin and Staff to host role keys; every permission key of Step 4 to a host key
     name; every table and function of Step 7 to a host name; the placeholder values.
1.17 Differences between companion documents that affect names or defaults (G4), and which one you will follow.
1.18 Questions. Ask each one with your recommendation and the reason:
     Q1  Role mapping, and which accounts are Super Admin.
     Q2  Employee table mapping; adding the timekeeping_exempt flag; which role keys set it (exclusions.excludedRoles).
     Q3  <TIMEZONE>, <CURRENCY>, <CURRENCY_SYMBOL>, <ORG_NAME>, date locale, branding values.
     Q4  Clock mode: kiosk or self_service. For self_service the default page gate is no key (every eligible
         employee, PERMISSIONS.md section 4.3); ask whether the client wants a key on that page instead.
     Q5  Device approval mode (off, auto, required) and the maximum number of active devices.
     Q6  Photo mode (off or optional), retention days, and the privacy basis for storing face photos.
     Q7  Night rule: enabled or not; anchor (clock_in or clock_out); threshold time; window end after midnight; bonus
         amount; once per day or per session; whether a night bonus still counts on a day that does not reach
         payroll.minHoursForDay. These are client policy with no inherited values.
     Q8  Overtime hours: display threshold and basis (session or day). Overtime hours are never paid in this template.
     Q9  Rate basis offered for new rates (daily or hourly), rate selection (period_end or per_day), pay frequencies,
         the default frequency, and whether a frequency drives period presets.
     Q10 Minimum hours for a day to count as worked.
     Q11 Whether negative net pay is allowed.
     Q12 Deletion mode (soft or hard), and whether a request-then-approve deletion path is wanted (needs an approval
         queue in the host).
     Q13 The optional void path for payslips (gated on payroll.payslip.generate): wanted or not.
     Q14 Optional day approval: wanted or not, and whether to change the approving key (default attendance.correct,
         PERMISSIONS.md section 4.2).
     Q15 Period lock: off, locked when a payslip is generated, or locked when it is paid.
     Q16 Self views: may employees see their own sessions, and their own payroll row and payslips, without a key?
     Q17 Default grants per role (Step 4) and which accounts operate the kiosk.
     Q18 Payslip page size, file-name pattern, whether the paid date is editable, signature labels.
     Q19 MFA step-up for payroll writes and access management, if the host supports MFA levels.
     Q20 Maximum session hours before an open session is flagged.
     Q21 <TARGET_DATABASE> and the backup procedure.
     Q22 Anything the host already does differently from this prompt that you propose to keep.
     Q23 How each writing function audits its refusals: typed refusal (path a) or server-layer audit (path b), as B12
         describes.
Print the report under the heading ARCHITECTURE REPORT and STOP. Continue only after the human answers.

------------------------------------------------------------------------------------------------------------------
STEP 2. WHAT YOU ARE BUILDING
------------------------------------------------------------------------------------------------------------------
- One row in attendance_sessions is one work session: clock-in to clock-out.
- A day is not stored. It is the group of one employee's sessions with the same work_date.
- Several sessions per day are allowed ("Continue Duty"). The gap between them is off duty and never counted.
- At most one session per employee is open at a time.
- Payroll is derived from completed sessions every time it is read. Nobody types hours or totals.
- A payslip is a frozen snapshot of that derivation. Later corrections, deletions and rate changes never change it.
- Every write goes through a SECURITY DEFINER function. Every read is bounded by row level security, or by a function
  whose row filter applies the same rule.
- Authority comes from permission keys checked in SQL. The UI only hides what the caller cannot do.

------------------------------------------------------------------------------------------------------------------
STEP 3. ATTENDANCE RULES (MUST unless marked)
------------------------------------------------------------------------------------------------------------------
B1  Session row (DATABASE.md section 5.3): id; employee id (foreign key, on delete restrict); work_date; time_in;
    time_out (null while open); note (trimmed, at most 500 characters); clock-in and clock-out device ids (nullable);
    clock_in_by (the operator) and clock_out_by (null exactly while open); edited_by, edited_at, edit_reason (all
    null or all set); deleted_at, deleted_by, delete_reason (all null or all set; soft deletion); created_at. CHECK
    time_out is null or time_out >= time_in. No stored status column: a session is open when time_out is null.
B2  One open session per employee: a UNIQUE partial index on the employee id where time_out is null and deleted_at is
    null. A second clock-in fails in the database; the clock-in function turns the unique violation into a clear
    refusal ("already clocked in; clock out first"), returned or raised as B12 says. Not configurable.
B3  Server time only. time_in and time_out are set to now() inside the clock functions. The client never sends a
    clock time. Only the correction function (R7) accepts a time, and it validates it.
B4  work_date is the business date in <TIMEZONE> at clock-in, computed in SQL by app_private.business_today() from
    the settings store. The column default uses the same function, so every insert path agrees. A session that crosses
    midnight belongs entirely to its clock-in date. Never use a fixed UTC offset; always use the zone name.
B5  Day total = sum of (time_out - time_in) over the day's completed sessions. Open sessions add nothing. Gaps are
    never counted. Round once, at the end, to 2 decimal hours, in the same order in SQL and in display helpers.
B6  Clock state for one employee, first match wins:
    1. an open session exists: show "Clocked in since <hour:minute>", adding the date when the session did not start
       on today's business date, and offer Clock Out;
    2. a completed session exists on today's work_date and attendance.allowMultipleSessionsPerDay is true: show
       "Clocked out at <hour:minute>" and offer Continue Duty behind a confirmation dialog that says the gap is not
       counted; Continue Duty calls the same clock-in function and adds a new session on the same work_date;
    3. otherwise: offer Clock In.
    When attendance.allowMultipleSessionsPerDay is false, the clock-in function refuses a second session on the same
    work_date. The state comes from the attendance_status function (Step 7), never from table reads under the
    operator's own row level security.
B7  Clock mode (attendance.clockMode = <CLOCK_MODE>):
    - kiosk (the reference model): a signed-in operator holding attendance.clock_operate picks an employee from
      list_clock_staff and clocks THAT employee. The picker shows display names only, never roles, emails or ids.
    - self_service (NOT IN THE REFERENCE): separate clock functions where the caller is always the target,
      self_clock_in(p_device_token, p_note) and self_clock_out(p_device_token) (DATABASE.md section 5.13). They never
      accept another employee id, never rely on a table grant, apply B2 to B4, B6 to B8 and DV3 like the kiosk
      functions, and refuse unless attendance.clockMode is self_service. The self-service page needs no key and opens
      for every eligible employee (PERMISSIONS.md section 4.3), unless the answer to Q4 adds one.
B8  Eligibility, one predicate used everywhere (roster, status reader, both clock functions, payroll computation, rate
    list, payslip generation): app_private.is_timekeeping_eligible(employee id) is true when the employee is active,
    not a demo account and not timekeeping_exempt. exclusions.excludedRoles only seeds the flag: a trigger sets it
    when a profile is created in, or moved into, a listed role; leaving the role does not clear it. The clock
    functions refuse an ineligible target with a clear message. The operator must be an active account.
B9  Forgotten clock-outs: nothing closes a session automatically. When attendance.maxSessionHours is set, open sessions
    longer than that are FLAGGED on the clock status and on review lists. Never build an auto-close job. The remedies
    are a normal clock-out or a correction (R7).
B10 No automatic retry of writes. The data client may retry idempotent GET or HEAD reads on transient failures (for
    example 429, 502, 503, 504) a small bounded number of times. It never retries a POST, an RPC call or any write.
    Clock buttons are disabled while a request is pending; a failure is shown and the human clicks again.
B11 Time display: dates are work_date strings. Times of day are shown in <TIMEZONE> on every screen when
    locale.showTimesInBusinessTimezone is true, as hour and minute through one shared formatter. Date and datetime
    inputs are converted using <TIMEZONE>, never the viewer's device zone.
B12 Audit: every clock-in and clock-out (success and refusal), blocked device, photo attach, correction, deletion,
    device register and revoke, settings change, rate change (success and refusal), payslip generation, mark-paid and
    void leaves an audit row: actor, action, entity type, entity id, outcome, reason, context.
    - Success: the SQL function inserts the row through the SQL audit writer, INSIDE its own transaction, together
      with the change, so a direct RPC call leaves the same trace as a call from the UI.
    - Refusal: a function that refuses by raising cannot keep an audit row. PostgreSQL rolls back every row the
      transaction inserted, the audit row included. Choose one of two paths per function, and list the choice in
      the report (SERVER_API.md section 9.1 rule 8 and section 9.10):
      (a) typed refusal: the function decides before it changes anything, inserts the audit row with outcome denied
          or failed, and RETURNS a refusal (an error code and a safe message) instead of raising; the server action
          maps it to the same error. A refusal caught inside the function (for example the unique violation of B2,
          caught in an inner block) can take this path too. This path records refusals whoever the caller is. It
          changes the return type, so record the shape you chose against the DATABASE.md section 5.13 signature;
      (b) server-layer audit: the function raises with a stable SQLSTATE and its error code in the exception hint
          (SERVER_API.md section 9.10), and the server layer writes the denied or
          failed row after the error has returned, outside the refused transaction. A failed audit insert goes to
          the server log; it is never dropped. This path records only refusals of calls that pass through the
          server layer. A direct RPC call that is refused leaves no row.
      Never insert an audit row and then raise in the same transaction. Propose the path for each function in your
      Step 1 report (question Q23); build what the human confirms.
    When audit.payloadIncludesAmounts is false, the context holds ids and change markers, not money amounts.

Approved devices (optional module, attendance.device.*):
DV1 mode: off (no check), auto (the check applies while at least one active device exists; the reference behaviour),
    required (the check always applies; with no active device every clock action is refused).
DV2 Register (attendance.devices.manage): the server creates a random 32-byte token; the database stores only its
    sha256 hash (unique); the raw token goes into an httpOnly, secure, sameSite=lax cookie with path "/", a name built
    from branding.cookieNamePrefix, and max age attendance.device.cookieMaxAgeDays. The cookie belongs to the browser,
    not to a user. maxActiveDevices = 1 with replacement reproduces the reference (registering deactivates the
    previous device); a larger maximum refuses a new registration once it is full.
DV3 Both clock functions verify the token hash themselves whenever the check applies. The token is never a request
    field and never readable by page JavaScript: the server reads the cookie and passes it to SQL. A server-side
    pre-check may run first to produce a friendly message, but the SQL check is the control and refuses on its own.
DV4 attendance.device.failMode = closed: if the pre-check errors, refuse and log. Never treat an error as "no gate".
DV5 Refusals are audited with outcome denied and an entity type of device or employee, never the session type (a
    refused clock-in has no session). The row is kept by one of the two refusal paths of B12, never by an insert
    that the refusal's raise rolls back. A refusal by the server-side pre-check never reaches SQL, so the server layer
    writes its row.
DV6 UI: when this browser is not approved, show a banner AND disable the clock buttons. Revoke asks for confirmation.
DV7 Device table: row level security enabled and forced; SELECT only for attendance.devices.manage holders; no write
    grants. Writes only through the register and revoke functions.

Photos (optional module, attendance.selfie.*, retention.*):
PH1 mode: off or optional. A required mode is not part of this template (CONFIGURATION.md validation rejects it).
PH2 optional (the reference): the camera opens after the button; the clock function runs; the photo attaches after it
    succeeds; a failed attach never undoes the clock event and is reported softly; "without photo" is offered only
    when the camera is unavailable or permission is denied.
PH3 attendance_photos: session id (foreign key), kind clock_in or clock_out (a column, never inferred from a file
    name), one photo per kind per session, storage path, content type (jpeg, png, webp), byte size, uploaded_by,
    uploaded_at. A private bucket used only by this module.
PH4 Attach only through attach_attendance_photo, a SECURITY DEFINER function that accepts a photo only from a caller
    who holds attendance.clock_operate AND is the operator recorded on that session for that kind (clock_in_by for
    clock_in, clock_out_by for clock_out), and only when storage_path lies under that session's path prefix for that
    kind.
    Object writes are scoped the same way. Store each photo under a path prefix that names the session and the kind.
    Uploads use ONE of:
    - a server-issued signed upload URL: the server action checks the operator for that session and kind (the same
      rule as the attach function) and signs one exact path under that prefix; end-user roles then hold no INSERT
      policy on the bucket;
    - an object INSERT policy limited to the module bucket, a path prefix naming the session and kind, and the
      operator recorded for that kind, checked through a private definer helper that reads the session row.
    Never use a policy that lets any active account insert objects into the bucket. End-user roles hold no UPDATE or
    DELETE policy on the bucket's objects, so an upload can never overwrite or remove another photo.
PH5 Read: row level security on the metadata table AND on the stored objects allows the employee in the photo and
    holders of attendance.review. Serve photos as signed URLs that expire after retention.signedUrlTtlSeconds; mint
    new ones when a dialog stays open longer than that.
PH6 Retention: stored objects are often not deletable from SQL. Run retention (retention.selfieRetentionDays) and
    removal after a deletion (retention.deleteSelfieWithRecord) as a scheduled server-side job with elevated
    credentials read from the environment, and log what it removed.
PH7 Camera header: when photos are on, every page response must allow the camera for the app's own origin
    (Permissions-Policy camera=(self)). Test the header. Do not weaken any other security header.
PH8 Capture: facing mode attendance.selfie.facingMode, longest edge attendance.selfie.maxEdgePx, JPEG quality
    attendance.selfie.jpegQuality. The video element has an accessible name.

------------------------------------------------------------------------------------------------------------------
STEP 4. PERMISSION MODEL
------------------------------------------------------------------------------------------------------------------
Roles: Super Admin, Admin, Staff, mapped to host role keys in Step 1. Super Admin holds every key implicitly through
has_permission. Every other capability comes from a key, never from a role title compared in code or SQL. A role
title only selects the default grant set.

Keys (rename to the host convention; keep the meaning):
  attendance.clock_operate    open the clock page; read the roster and clock status; clock an eligible employee
  attendance.view_team        read every employee's sessions and names; team summary tiles; employee filter
  attendance.review           open Review Attendance; day details; photos
  attendance.correct          correct a clock-out, with a mandatory reason
  attendance.delete           delete a session
  attendance.devices.manage   register, list and revoke clock devices
  payroll.view_all            read every payroll row, rate and payslip; print the period summary
  payroll.rates.edit          add an effective-dated rate row
  payroll.payslip.generate    generate a frozen payslip
  payroll.payslip.mark_paid   move a pending payslip to paid
  payroll.export              export the attendance and payroll data
Not keys: own-row access (own sessions, own payroll row, own payslips, own rate) needs no key; whether a self view
screen exists is Q16. The request key attendance.delete.request exists only when the request path is enabled (Q12)
and it must be grantable in the host's access screen. Void (P15) is gated on payroll.payslip.generate. Day
approval (R11) reuses attendance.correct unless Q14 changes it; the self_service page (B7) needs no key unless Q4 adds
one.

Key dependencies, checked by the grant-saving function on the server (each SQL gate checks only its own key, with one
exception: generate_payslip_snapshot also requires payroll.view_all, because it reads the filtered payroll lines):
  attendance.devices.manage requires attendance.clock_operate.
  attendance.review requires attendance.view_team.
  attendance.correct and attendance.delete require attendance.review.
  payroll.rates.edit, payroll.payslip.generate and payroll.payslip.mark_paid require payroll.view_all.
Page access: the clock page opens with attendance.clock_operate; Review Attendance with attendance.review; Payroll with
any payroll key except payroll.export, or for every eligible employee when the payroll self view is enabled.

Default grants (a proposal; confirm in Q17):
  Staff:  none.
  Admin:  attendance.view_team, attendance.review, attendance.correct, attendance.delete, payroll.export.
  Super Admin: every key, implicitly.
Grant attendance.clock_operate to the accounts that operate the kiosk. A delegated payroll officer receives
payroll.view_all, payroll.rates.edit, payroll.payslip.generate, payroll.payslip.mark_paid and payroll.export.

Enforcement layers, all required:
  UI      flags come from the granted-key set, default false, never from a role title. The UI is never the control.
  Page    a server-side gate on the page's key; a missing key follows the host convention (404 or 403).
  Action  every server action re-checks the key before calling SQL, to produce the message.
  SQL     every write goes through a SECURITY DEFINER function that checks the key, the caller's active state, NULL
          results as refusal, target eligibility and inputs, and writes the success audit row in its transaction
          (refusals: B12).
  RLS     every read is bounded by forced row level security; end-user roles hold SELECT only.
Helper functions: the current-employee helper returns null for an inactive profile; the role helper returns the
non-NULL sentinel 'inactive' for a deactivated account, because "NULL not in (...)" skips a refusal; every gate
treats NULL as a refusal; has_permission returns true for Super Admin or for an explicit grant held by an active
account.

Checks that MUST NOT be frontend-only (numbered as in SECURITY.md section 2; each needs a SQL, policy or route test):
  1  Page access for the three pages: server page gate.
  2  Operator authority and the approved device for clock in AND clock out: inside both clock functions.
  3  Clock target eligibility (active, not demo, not timekeeping_exempt): inside both clock functions.
  4  No direct table writes to attendance rows (or to devices, photos, rates, snapshots, adjustments, day reviews,
     settings): grants and row level security.
  5  Correction and deletion authority, mandatory reason, time bounds, overlap and locks: inside the functions.
  6  Team visibility: row level security on attendance_sessions.
  7  Photo visibility, upload scope and attach integrity: read policies on the metadata table and the stored objects;
     the signed upload URL or path-scoped object insert policy of PH4; the attach function.
  8  Payroll row scope: the caller filter inside app_private.payroll_lines (which report_payroll wraps) plus the
     snapshot and rate read policies.
  9  Generate, mark-paid, void and rate-write authority, matching exactly what the UI offers: inside the functions.
  10 Rate visibility: row level security on employee_pay_rates.
  11 Export authority: the key checked in the route; rows limited by row level security.
  12 Snapshot immutability and the pending-only paid transition: the mark-paid function plus a freeze trigger.
  13 Deactivated accounts refused by every SQL gate: the helper functions.
  14 EXECUTE revoked from PUBLIC and anon, search_path pinned: in the migration that creates each function.
  15 Names and clock status for operators and reviewers: permission-gated SECURITY DEFINER readers.
  16 Audit rows for every write: inside the function transaction on success; for a refusal, a typed refusal that
     writes its row before returning, or the server layer after the error has returned (B12).
Acceptable as UI-only, because a lower layer already bounds them: navigation visibility, the summary print button,
masking money on screen, disabling Save until a reason is typed, and the blocked-device banner.

------------------------------------------------------------------------------------------------------------------
STEP 5. REVIEW ATTENDANCE RULES (MUST unless marked)
------------------------------------------------------------------------------------------------------------------
R1  Access: the page needs attendance.review. Reading every employee's sessions needs attendance.view_team, enforced by
    row level security.
R2  Names: team rows and display names come from a SECURITY DEFINER reader, review_attendance_page(p_from, p_to,
    p_employee_ids, p_status, p_page, p_page_size), gated on attendance.view_team. A self view reads the caller's own
    rows under row level security. Never get names through a join that the employee table's row policy can turn into
    nulls.
R3  Filters: status tabs All, Open, Completed (default review.defaultStatus); quick ranges from review.quickRanges
    (default range review.defaultRangeDays); custom from and to, validated (valid dates, from <= to); an employee
    select fed by list_clock_staff through attendance.view_team; a name search. Any filter change returns to page 1.
    Date filters apply to work_date on screen, in payroll and in exports (review.dateFilterBasis = work_date).
R4  Paging: server-side; page sizes review.pageSizes, default review.defaultPageSize. The count text names its unit
    ("days" or "sessions") and counts what the list shows.
R5  Day rows: one row or card per (employee, work_date); sessions sorted by time_in; "Continued Duty" on the second and
    later sessions; gaps marked "not counted"; day total per B5 ("Total so far" while a session is open); status Open
    when any session is open, otherwise Completed; "{n} sessions" when there are several; "Night bonus" with its amount
    from the single night predicate (P8).
R6  Day details dialog: each session with clock-in and clock-out (date added when it differs from work_date), duration,
    photos (loaded lazily), night bonus marker, and for a corrected session who corrected it, when, and why. After a
    correction or deletion, reload both the list and the open dialog. Never keep the pre-change object.
R7  Correction (attendance.correct), clock-out only. Clock-in is not correctable in this template
    (attendance.correction.allowClockInCorrection is fixed false); if the human needs it, it is a separate audited
    function designed with them. correct_attendance_clock_out(p_record_id, p_time_out, p_reason):
    - the caller holds the key and is active; a NULL role or grant result is a refusal;
    - the reason is required after trimming, in the UI, the server action and SQL;
    - lock the row (SELECT ... FOR UPDATE) before validating;
    - one precision, the minute, in the UI, the server action and SQL: the server action and the function refuse a
      new time_out that is not a whole minute (seconds and fractions not zero), and refuse as unchanged a value equal
      to the stored time_out truncated to its minute, leaving every column of the row untouched;
    - the new time_out is >= time_in and <= now();
    - the new time_out is not after the time_in of the same employee's next session (no overlap);
    - refuse when attendance.correction.maxWindowDays is set and the work_date is older than that, when the period is
      locked (R12), or when the session is soft-deleted;
    - update in place: time_out, edited_by, edited_at, edit_reason; closing an open session also sets clock_out_by to
      the corrector; with day approval on, the day's review returns to pending;
    - write the audit row with the old time_out, the new time_out and the reason inside the function; return the old
      value.
    Correcting an open session closes it and frees the one-open-session index.
R8  Correction form, minute precision as in R7: the input shows and sends hour and minute only. The default value is
    the stored time_out truncated to its minute for a completed session, or time_in rounded UP to the next whole
    minute for an open session, both shown in <TIMEZONE>. Save stays disabled until the reason is not blank and, for a
    completed session, the chosen minute differs from the stored time_out's minute. The form never submits an
    untouched default of a completed session; the server refusal in R7 catches it if a request is forced.
R9  Deletion (attendance.delete): delete_attendance_record(p_record_id, p_reason); a reason is required; when
    attendance.deletion.requireTypedConfirmation is true the server action also checks the typed phrase
    (attendance.deletion.confirmationPhrase), which guards against an accidental click, not an unauthorized caller.
    soft (the template default): set deleted_at, deleted_by and delete_reason; every reader, index, report and export
    excludes the row. hard: delete the row after the function writes an audit row holding the deleted values. Refuse
    inside a locked period (R12); with day approval on, the day's review returns to pending. Photos follow PH6.
R10 One deletion policy on every screen. Holders of attendance.delete delete directly. When
    attendance.deletion.requestApprovalPath is true (only with an approval queue in the host), holders of
    attendance.delete.request create a request, and a holder of attendance.delete executes it through the same delete
    function. Otherwise no request control exists anywhere.
R11 Optional day approval (payroll.approvalRequired, default false; NOT IN THE REFERENCE): attendance_day_reviews
    (employee id, work_date, status pending or approved, reviewed_by, reviewed_at, note, updated_at; primary key
    employee id plus work_date). When enabled, the payroll computation counts only approved days, and any correction
    or deletion returns that day to pending. The writer is review_attendance_day(p_employee_id, p_work_date, p_status,
    p_note), gated on attendance.correct by default (PERMISSIONS.md section 4.2; DATABASE.md section 5.5); Q14 asks
    only whether the client changes that key.
R12 Optional period lock (payroll.lockPeriodAfterPayslip = off, generated or paid; default off; NOT IN THE REFERENCE):
    the correction and delete functions refuse a session whose work_date lies inside the period of that employee's
    current payslip (not superseded, not void): any such payslip when the value is generated, a paid one when it is
    paid. The message names the period.
R13 Attendance export (payroll.export): an explicit date range is required; columns employee, work_date, clock-in and
    clock-out in <TIMEZONE>, hours, Open or Completed, night bonus marker, corrected marker; rows limited by row level
    security; the export is audited.

------------------------------------------------------------------------------------------------------------------
STEP 6. PAYROLL RULES (MUST unless marked)
------------------------------------------------------------------------------------------------------------------
P1  Period: inclusive from and to on work_date. Validate both as dates and from <= to on the server before any query;
    refuse otherwise. Default payroll.periodDefault; presets payroll.periodPresets (empty means a free range). A pay
    frequency drives nothing unless payroll.frequencyDrivesPeriod is true with presets the human defined.
P2  Rates (employee_pay_rates), append-only (no update or delete grants): employee id, rate_basis, rate_amount
    (numeric(12,2), >= 0, at most 10 integer digits), pay_frequency, effective_date (required; the editor defaults it
    to today's business date), created_by, created_at; index on (employee id, effective_date desc, created_at desc).
    Writes only through set_staff_salary_rate(p_employee, p_basis, p_amount, p_frequency, p_effective), gated on
    payroll.rates.edit, which checks the frequency against payroll.payFrequencies. A success is audited inside the
    function; a refusal is audited by the path of B12 chosen for it.
P3  Rate for a period (payroll.rateSelection):
    - period_end (the reference, the default): the newest row with effective_date <= the period end (ties: newest
      created_at) applies to every day of the period; the payroll screen warns when a rate changes inside the period;
    - per_day (NOT IN THE REFERENCE): each work_date uses the newest row with effective_date <= that work_date.
    No matching row means no rate.
P4  "Current rate" on screens and exports is the newest row with effective_date <= today's business date
    (payroll.currentRateLookup = effective_today). A later row is shown as upcoming, never as current.
P5  total_hours = sum of completed session durations with work_date in the period; open sessions excluded; rounded
    once to 2 decimals.
P6  days_worked = number of distinct work_dates with at least one completed session and a day total >=
    payroll.minHoursForDay (0 means any completed session counts, as in the reference).
P7  Overtime hours are shown, never paid: threshold payroll.overtimeDisplayThresholdHours; basis session (the
    reference) = sum over sessions of max(session hours - threshold, 0); basis day (NOT IN THE REFERENCE; confirm Q8) =
    sum over days of max(day total - threshold, 0). payroll.overtimePayMultiplier stays 0. The hours column is labelled
    "Total hours", never "Regular hours".
P8  Night rule: ONE predicate, app_private.is_night_session(time_in, time_out), reading payroll.nightRule from the
    settings store. Payroll, payslips, the review marker, the clock message and exports all use it. Do not store a
    night flag and do not add a night trigger (DATABASE.md section 5.3; a generated column cannot read settings). A
    list badge calls the predicate directly or through a view, so a corrected time_out changes the badge and the pay
    on the next read.
    - enabled false: nothing qualifies.
    - A completed session qualifies when the local time in <TIMEZONE> of its anchor instant (time_in for clock_in,
      time_out for clock_out) is at or after thresholdTime, or, when windowEnd is set, before windowEnd.
    - night_shifts = number of distinct work_dates with a qualifying session when oncePerDay is true; otherwise the
      number of qualifying sessions.
    - night bonus pay = night_shifts x bonusAmount, computed even when the employee has no rate.
    Threshold, window and amount are client policy (Q7). Never reuse a value from the reference implementation.
P9  Gross pay, by the basis of the rate in force:
    - daily (the reference): round(days_worked x rate + night_shifts x bonusAmount, 2);
    - hourly (the reference's legacy payslip rule for the hours part): round(total_hours x rate + night_shifts x
      bonusAmount, 2);
    - monthly: no formula exists in the reference; do not offer it unless the human writes one down.
    With per_day selection the rate part is the sum over days (daily) or sessions (hourly) of quantity x the rate in
    force on that work_date, and the total is rounded once at the end. No rate: gross is null and the screen says
    "No rate set". Never treat a missing rate as zero.
P10 Money: numeric in SQL; strings between server and client; never a JavaScript float. Client-side totals are summed
    in integer minor units. Every money parser keeps a leading minus sign. Money scale is fixed at 2. Screen
    formatting reads locale.*; PDFs print locale.currencyCode unless a font that renders <CURRENCY_SYMBOL> is embedded
    (locale.moneyDisplay.pdfUsesCode).
P11 Deductions (payroll.deductionsModel = lump_sum): one amount >= 0 entered when the payslip is generated and stored in
    the snapshot's deductions column. An itemized mode (payroll_adjustments rows) is not part of this template
    (CONFIGURATION.md validation rejects it).
P12 Net = gross - deductions. payroll.allowNegativeNet false (default): generation is refused when deductions exceed
    gross, and the install adds CHECK net_salary >= 0. true: every reader, total and printed document parses signed
    money.
P13 Payslip snapshot: generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions, p_regenerate), gated on
    payroll.payslip.generate and payroll.view_all. It validates the period and eligibility, reads the line from the
    same computation as report_payroll (P16), refuses when there is no effective rate, and copies into
    payroll_snapshots: payroll_start_date, payroll_end_date, rate_basis, rate_amount, pay_frequency, total_hours,
    overtime_hours, days_worked, night_shifts, regular_salary, overtime_pay (the night bonus pay), gross_salary,
    deductions, net_salary, generated_by, generated_at. A BEFORE UPDATE trigger refuses any change except the payment
    columns, the void columns and superseded_by, and refuses clearing paid_at; a BEFORE DELETE trigger refuses deletes.
P14 One current payslip per employee and period: a UNIQUE partial index on (employee id, payroll_start_date,
    payroll_end_date) where superseded_by is null and payment_status is not void. Regenerating is an explicit, audited
    action requested with p_regenerate true; without it a current payslip returns conflict. It is allowed only while
    the current row is pending: it inserts the new row and sets superseded_by on the old row in one transaction. A paid
    row returns conflict until it is voided; when void is not built, a paid period cannot be regenerated.
P15 Payment status values are pending, paid and void.
    - mark_payslip_paid(p_snapshot_id, p_payment_date), gated on payroll.payslip.mark_paid: only a current pending
      row; stamps payment_date (the chosen date when payroll.paidDateEditable is true, otherwise today's business date),
      paid_at and paid_by; repeating it changes nothing. The UI asks for confirmation.
    - void_payslip(p_snapshot_id, p_reason), optional (NOT IN THE REFERENCE; Q13), gated on payroll.payslip.generate:
      allowed from pending or paid; reason required; keeps paid_at and paid_by; stamps voided_at, voided_by and
      void_reason. The UI asks for confirmation. When void is not built, no void control and no Void label appear.
P16 One computation, scoped to the caller inside it. This is deliberately NOT an invoker report scoped by row level
    security: the row scope of payroll lines comes from the caller filter inside the definer function below, which
    applies the same own-row-or-payroll.view_all rule as the snapshot and rate read policies. report_payroll stays
    INVOKER only to give a stable public signature; it adds no protection. T2 proves the filter.
    - app_private.payroll_lines(p_from, p_to) is a SECURITY DEFINER function in the private schema that holds the only
      pay math (days, hours, night shifts, rate selection, gross, warnings). Its own WHERE clause returns only
      employees who are eligible (B8) AND (the caller's own row OR the caller holds payroll.view_all). The filter is
      part of this function, not only of a wrapper.
    - The identity and permission helpers read the signed-in user from the request context, not from current_user,
      so inside a definer function they still name the real caller. Prove it with a database test (T2).
    - report_payroll(p_from, p_to) is a thin SECURITY INVOKER, STABLE wrapper with a pinned search_path that selects
      from app_private.payroll_lines. PostgreSQL checks EXECUTE on every function an INVOKER function calls against
      the caller, so the signed-in role holds USAGE on the private schema and EXECUTE on app_private.payroll_lines.
      That grant is safe only because the filter lives inside payroll_lines: a direct call, through any host or
      client that can reach the private schema, returns exactly what report_payroll returns. Never rely on the
      private schema being hidden from the data API.
    - generate_payslip_snapshot reads the same lines. It requires payroll.view_all, so the filtered lines already
      include its target, and no unfiltered path is needed. If one is ever added (for a scheduled job), it is a
      separate private function on which PUBLIC, anon and the signed-in role hold no EXECUTE, called only by definer
      functions that check a key first.
    - Snapshot and rate read policies use the same own-row-or-view_all rule.
    - Payslip status for a row comes from the current snapshot with exactly that period; if that read fails, show an
      error, never "Pending" or "Not generated".
P17 Payslip document (screen, print and PDF): branding.* (company name, logo text or image, brand color only on the logo
    mark and net pay, address, tax id and contact when set); employee; role label; period; status label; the figures of
    the rate basis; a night label built from bonusAmount and the currency, never a hard-coded amount; signature labels;
    page size payroll.payslip.pageSize; file name from payroll.payslip.fileNamePattern. Printed documents are light.
P18 Period summary: a printable sheet for payroll.view_all holders: employee, total hours, overtime hours, rate, gross,
    deductions, net, status. Print separate totals for gross, deductions and net, summed in integer minor units from
    signed values, and state how many employees have no payslip yet.
P19 Warnings on the payroll screen (NOT IN THE REFERENCE): no rate, open session inside the period, rate changed inside
    the period, a rate basis without a formula.

------------------------------------------------------------------------------------------------------------------
STEP 7. DATABASE WORK
------------------------------------------------------------------------------------------------------------------
Objects (template names from DATABASE.md section 5; use host naming):
  employees                the host identity table or a view over it; add timekeeping_exempt (boolean, default false)
                           and the trigger of B8.
  attendance_sessions      B1, B2; indexes: the one-open-session unique partial index, (employee id, work_date desc),
                           (work_date, employee id), (time_in desc). SELECT policy: own rows or attendance.view_team.
  attendance_devices       id, label, token_hash (unique), is_active, registered_by, created_at, revoked_at, revoked_by;
                           CHECK is_active equals "revoked_at is null". Only with the device module.
  attendance_photos        PH3. Only with the photo module.
  attendance_day_reviews   R11. Only when day approval is on.
  employee_pay_rates       P2; CHECK rate_basis against the supported bases.
  payroll_snapshots        P13 to P15: CHECK payroll_end_date >= payroll_start_date; CHECK deductions >= 0; CHECK
                           payment_status in (pending, paid, void); a paid row has paid_at, paid_by and payment_date; a
                           pending row has no paid_at; a void row has voided_at, voided_by and a reason; superseded_by.
  audit table              reuse the host's append-only audit table; if none exists, create one with triggers that
                           refuse UPDATE and DELETE. SQL functions write through one definer audit writer. Rows whose
                           context concerns payroll are readable only by payroll.view_all holders and Super Admin.
  settings store           a private-schema table of key and value rows (key, value jsonb, effective_from; primary key
                           key plus effective_from), as DATABASE.md section 5.12 and CONFIGURATION.md sections 1.2 to
                           1.4 describe. A key under payroll.* may hold several effective-dated rows; every other key
                           holds one row in force from the beginning, so the timezone never changes by date. Seeded by
                           a migration from the configuration file; no grant to any end-user role; read by SQL only
                           through accessors that take an as-of date; changed by migration, or by an optional Super
                           Admin definer function that inserts a new dated row for a payroll key and writes an audit
                           row. locale.timezone changes only by migration. A change never alters an issued payslip.
Accessors in the private schema (STABLE, SECURITY DEFINER, pinned search_path, EXECUTE granted to the signed-in role):
business_timezone(), business_today(), a setting reader taking a key and an as-of date, is_night_session(time_in,
time_out) and is_timekeeping_eligible(employee id). Per-session and per-day payroll keys are read as in force on the
session's work_date; period-wide keys as of the period end (CONFIGURATION.md section 1.4).
Functions (SECURITY DEFINER unless marked; names from DATABASE.md section 5.13; each checks its key as in Step 4):
  list_clock_staff()                                    eligible employees, id and display name only;
                                                        attendance.clock_operate or attendance.view_team
  attendance_status(p_employee_ids)                     open session id, start and work date, and last clock-out today;
                                                        attendance.clock_operate or attendance.view_team
  kiosk_clock_in(p_employee_id, p_device_token, p_note) B2 to B4, B6 to B8, DV3; sets clock_in_by; audit
  kiosk_clock_out(p_employee_id, p_device_token)        closes the single open session; sets clock_out_by; audit
  self_clock_in(p_device_token, p_note)                 B7; optional, only when attendance.clockMode is self_service
  self_clock_out(p_device_token)                        B7; optional, only when attendance.clockMode is self_service
  attach_attendance_photo(p_session_id, p_kind, p_storage_path, p_content_type, p_byte_size)   PH4
  review_attendance_page(p_from, p_to, p_employee_ids, p_status, p_page, p_page_size)   R2 to R5
  correct_attendance_clock_out(p_record_id, p_time_out, p_reason)   R7
  delete_attendance_record(p_record_id, p_reason)       R9
  review_attendance_day(p_employee_id, p_work_date, p_status, p_note)   R11, optional
  register_attendance_device, revoke_attendance_device  DV2, DV7; attendance.devices.manage
  verify_attendance_device, attendance_gating_active    active caller; the gate honours attendance.device.mode
  set_staff_salary_rate(p_employee, p_basis, p_amount, p_frequency, p_effective)   P2
  app_private.payroll_lines(p_from, p_to)               private; filters to eligible AND (own row OR payroll.view_all)
                                                        inside the function; P5 to P9, P16
  report_payroll(p_from, p_to)                          SECURITY INVOKER, STABLE wrapper over payroll_lines; P16
  generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions, p_regenerate)   P13, P14
  mark_payslip_paid(p_snapshot_id, p_payment_date)      P15
  void_payslip(p_snapshot_id, p_reason)                 P15, optional
  helpers: current employee id (null when inactive), role with the 'inactive' sentinel, active check, Super Admin
  check, has_permission, and the audit writer.
Function grants (write them in the migration that creates each function; list them in the report):
  - every module function, whatever its security mode (definer, invoker, accessor, helper, trigger function):
    revoke all from PUBLIC and anon, then grant EXECUTE only as listed below;
  - the signed-in role: EXECUTE on the public functions above (each checks its own gate inside the function), on
    report_payroll, and on the private accessors and helpers that row level security policies or INVOKER functions
    call; USAGE on the private schema;
  - the signed-in role: EXECUTE on app_private.payroll_lines, because report_payroll runs as the caller (P16); safe
    only because payroll_lines filters by the caller;
  - trigger functions, the audit writer and any unfiltered private function: no EXECUTE for any end-user role
    (triggers fire without the caller's EXECUTE, and definer functions call the writer as their owner); revoke it from
    the signed-in role explicitly if default privileges granted it;
  - the settings store and the audit table: no write grant to any end-user role.
Migration discipline:
  M1  One migration per concern, each with a header stating its purpose and a written rollback (the statements that
      undo it). Test every rollback on <TARGET_DATABASE> or a scratch copy.
  M2  Take the host's backup or snapshot before applying anything to a database other than a throwaway local one.
  M3  Additive only on host objects: no DROP or RENAME of existing tables or columns, no rewrite of existing data.
      Adding a defaulted column such as timekeeping_exempt is additive; say so in the report.
  M4  Enable AND force row level security on every module table. End-user roles get SELECT only, and only where a
      policy exists.
  M5  Every function the module creates, SECURITY DEFINER or SECURITY INVOKER, including accessors, helpers and trigger
      functions: set search_path = '' (or the host's pinned equivalent), schema-qualify every reference, and in the
      same migration revoke all from PUBLIC and anon and apply the function grants above. Repeat this after every
      CREATE, including the DROP plus CREATE of M6, because default privileges can grant again on each CREATE.
  M6  Changing a function's return type needs DROP plus CREATE in the same migration, followed by the grants again.
      CREATE OR REPLACE cannot change it.
  M7  A definer function that writes a table with forced row level security needs an owning role that bypasses row
      level security, or explicit policies for that role. Check each function's owner and report it.
  M8  Every object the module uses exists in a migration file. Prove it: replay all migrations on an empty database and
      run the database tests there.
  M9  Pin SQL decisions with migration-content tests where a test runner cannot reach a database (Step 10).
Catalog checks after applying (report the results):
  - relrowsecurity and relforcerowsecurity are true for every module table;
  - the policies per table (pg_policies) match Step 4;
  - table grants for anon and the signed-in role (information_schema.role_table_grants) include no INSERT, UPDATE or
    DELETE on module tables;
  - for every module function (definer, invoker, accessor, helper and trigger function): prosecdef matches the security
    mode that Step 7 or the creating migration declares, proconfig holds the pinned search_path,
    has_function_privilege('anon', <signature>, 'execute') is false, PUBLIC holds no EXECUTE, and the signed-in role
    holds EXECUTE exactly where the function grants above say;
  - the signed-in role's USAGE on the private schema, and its EXECUTE on app_private.payroll_lines and on no
    unfiltered private payroll function;
  - the owner of each definer function, and whether that role bypasses row level security.

------------------------------------------------------------------------------------------------------------------
STEP 8. CONFIGURATION OBJECT AND VALIDATION
------------------------------------------------------------------------------------------------------------------
Create ONE typed configuration object in the host's configuration location, frozen and validated when it loads. An
unknown key or an invalid value fails the build or the start, never a payslip. Key names and fixed values follow
CONFIGURATION.md section 2. Keys marked "set at onboarding" have no default; they come from Step 1 answers.
```
HR_CONFIG = {
  branding: {
    companyName: "<ORG_NAME>", payslipHeader: "Payslip", summaryHeader: "Payroll Summary",
    logoText: "", logoUrl: null,            // 1 to 3 characters, or an image URL
    brandColor: "",                         // "#rrggbb"; logo mark and net pay highlight only
    documentFilePrefix: "",                 // letters, digits, hyphen
    cookieNamePrefix: "",                   // lowercase letters, digits, underscore
    address: null, taxId: null, contact: null,
  },
  locale: {
    timezone: "<TIMEZONE>",                 // IANA name; there is no fixed-offset key
    currencyCode: "<CURRENCY>", currencySymbol: "<CURRENCY_SYMBOL>",
    moneyDisplay: { minorUnits: 2, hideZeroMinorUnits: false, groupSeparator: ",", decimalSeparator: ".",
                    pdfUsesCode: true },    // minorUnits is fixed
    dateLocale: "",                         // BCP 47 tag; set at onboarding
    showTimesInBusinessTimezone: true,
  },
  permissions: {
    defaultGrants: {                        // keyed by the host role keys mapped to Admin and Staff (Step 4)
      "<admin role key>": ["attendance.view_team", "attendance.review", "attendance.correct",
                           "attendance.delete", "payroll.export"],
      "<staff role key>": [],
    },
  },
  exclusions: { excludedRoles: [], excludeDemoAccounts: true },   // excludeDemoAccounts is fixed
  attendance: {
    clockMode: "<CLOCK_MODE>",              // set at onboarding: kiosk | self_service
    selfView: false,                        // employees see their own sessions (Q16)
    allowMultipleSessionsPerDay: true,
    maxOpenSessionsPerEmployee: 1,          // fixed
    sessionCrossesMidnightPolicy: "clock_in_date",   // fixed
    maxSessionHours: null,
    device: { mode: "auto", failMode: "closed", maxActiveDevices: 1, cookieMaxAgeDays: 365,
              defaultLabel: "Time clock" },          // mode: off | auto | required
    selfie: { mode: "off", facingMode: "user", maxEdgePx: 1600, jpegQuality: 0.82 },   // mode: off | optional
    correction: { allowClockInCorrection: false, requireReason: true, maxWindowDays: null },  // first two fixed
    deletion: { mode: "soft", requireReason: true, requireTypedConfirmation: true, confirmationPhrase: "DELETE",
                requestApprovalPath: false },         // mode: soft | hard; requireReason fixed
  },
  review: {
    defaultRangeDays: 7, quickRanges: ["today", "7d", "month", "custom"],
    pageSizes: [25, 50, 100], defaultPageSize: 25,
    defaultStatus: "all",                   // open | completed | all
    dateFilterBasis: "work_date",
    statusLabels: { open: "Open", completed: "Completed" },
  },
  payroll: {
    selfView: false,                        // employees see their own payroll row and payslips (Q16)
    rateBasis: null,                        // set at onboarding: daily | hourly
    payFrequencies: [],                     // set at onboarding: a non-empty subset of weekly, bi_weekly,
                                            // semi_monthly, monthly
    payFrequencyLabels: {},                 // set at onboarding: one label per listed frequency
    defaultFrequency: null,                 // set at onboarding: a member of payFrequencies
    frequencyDrivesPeriod: false,
    rateEffectiveDating: "append_only",     // fixed
    rateSelection: "period_end",            // period_end | per_day
    prorationPolicy: "none",                // fixed
    currentRateLookup: "effective_today",
    periodPresets: [],                      // [{ key, label, fromDay, toDay }]
    periodDefault: "month_to_date",         // month_to_date | current_preset
    minHoursForDay: 0,
    nightRule: { enabled: false, anchor: null, thresholdTime: null, windowEnd: null, bonusAmount: "0.00",
                 oncePerDay: true },        // anchor and thresholdTime set at onboarding when enabled
    overtimeDisplayThresholdHours: null,    // set at onboarding
    overtimeBasis: "session",               // session | day
    overtimePayMultiplier: 0,               // stays 0
    deductionsModel: "lump_sum",
    allowNegativeNet: false,
    rounding: { moneyScale: 2, hoursScale: 2, roundOnce: true },   // fixed
    snapshot: { immutable: true, uniquePerPeriod: true },          // fixed
    statuses: ["pending", "paid", "void"],  // fixed
    statusLabels: { notGenerated: "Not generated", pending: "Pending", paid: "Paid", void: "Void" },
    paidDateEditable: true,
    approvalRequired: false,
    lockPeriodAfterPayslip: "off",          // off | generated | paid
    payslip: { pageSize: "a5", fileNamePattern: "{prefix}-Payslip-{employee}-{start}_{end}.pdf", labels: {} },   // labels: set at onboarding
  },
  audit: { payloadIncludesAmounts: false },
  retention: { selfieRetentionDays: null, signedUrlTtlSeconds: 300, deleteSelfieWithRecord: true },
}
```
Validation rules (implement all; CONFIGURATION.md section 2.9 is the full list):
  V1  Reject unknown keys and missing keys. Every fixed value equals its constant.
  V2  locale.timezone is accepted by the Intl date-time formatter; currencyCode is three capital letters; the two
      separators are single, different characters.
  V3  Every enumerated key holds one of its listed values, so a key marked "set at onboarding" fails until it is set
      (nightRule.anchor may stay null only while nightRule.enabled is false). rateBasis monthly, selfie mode required
      and deductionsModel itemized are rejected.
  V4  Every "HH:MM" value has hours 00 to 23 and minutes 00 to 59. When nightRule.enabled is true, anchor and
      thresholdTime are set, and windowEnd is null or earlier than thresholdTime.
  V5  Every money value is digits, optionally a dot and one or two digits; bonusAmount is 0 or more.
  V6  overtimeDisplayThresholdHours is above 0 and at most 24; minHoursForDay is 0 to 24; maxSessionHours is null or
      above 0; overtimePayMultiplier is 0.
  V7  payFrequencies is not empty; defaultFrequency is in it; every frequency has a label.
  V8  pageSizes are positive integers containing defaultPageSize; defaultRangeDays is 1 or more;
      periodDefault = current_preset requires at least one preset.
  V9  Every key in defaultGrants is a key of Step 4; the Super Admin role is never listed; key dependencies hold.
  V10 selfie.mode other than off requires selfieRetentionDays; approvalRequired true requires the day-review module;
      requestApprovalPath true requires the host approval queue.
  V11 logoText has 1 to 3 characters unless logoUrl is set; brandColor is "#" plus six hexadecimal digits;
      cookieNamePrefix and documentFilePrefix match their character rules; fileNamePattern uses only {prefix},
      {employee}, {start} and {end}.
  V12 Labels contain no unfilled placeholder text.
SQL mirror: the seed migration writes every SQL-evaluated key (CONFIGURATION.md section 2.8) into the settings store.
After install the store is authoritative for those keys; without it, clock and payroll writes refuse. A file-content
test asserts that the seed migration and the configuration file agree.

------------------------------------------------------------------------------------------------------------------
STEP 9. UI (in the host's UI system)
------------------------------------------------------------------------------------------------------------------
U1  Use the host's primitives and design tokens for dialogs, sheets, tables, tabs, selects, pagination, search, badges
    and states. Do not hand-roll a second version of any of them. The brand accent color is never a status color.
U2  Components (UI_UX.md section 9 names; rename to the host convention; one component per job): AttendanceClockCard,
    CurrentAttendanceStatus, AttendanceSummaryCards, AttendanceHistory, AttendanceDayCard, AttendanceDayDetailsModal,
    AttendanceReviewFilters, AttendanceReviewTable, ClockOutCorrectionModal, AttendanceDeleteModal, DeviceManager,
    PayrollPeriodSelector, PayrollTable, PayrollEmployeeRow, PayslipModal, PayslipDocument, PayrollSummaryDocument,
    EmployeeRatesTable, RateEditor.
U3  Attendance screen: the blocked-device banner (DV6); DeviceManager for attendance.devices.manage holders;
    AttendanceClockCard with CurrentAttendanceStatus (B6); AttendanceSummaryCards for attendance.view_team holders
    (present today; clocked in now, counting open sessions of any date and showing the date when older; completed
    today); AttendanceHistory (own rows, or team rows with attendance.view_team; same filters and paging as Review).
U4  Review Attendance screen: R1 to R12, with the day details, correction and delete dialogs.
U5  Payroll screen: PayrollPeriodSelector (P1); PayrollTable with columns Employee, Role, Total hours, Overtime hours,
    Days worked, Night bonus (when enabled), Rate with its unit ("per day" or "per hour") or "No rate set", Pay
    frequency, Gross, Payslip status, Actions; EmployeeRatesTable and one RateEditor for payroll.rates.edit holders,
    showing current and upcoming rates and a visible success message; PayslipModal: Generate only for
    payroll.payslip.generate holders (with the deductions input), otherwise the frozen document or a message that no
    payslip exists yet, and no generate control; Print; PDF; Mark paid (confirmation); Void (its key, confirmation,
    only when built); PayrollSummaryDocument for payroll.view_all holders (P18); warnings (P19).
U6  One label set on every screen, filter, dialog, printed document and PDF (UI_UX.md section 5): Open, Completed,
    Total so far, All, Continued Duty, "{n} sessions", Night bonus, Not generated, Pending, Paid, Void (only when
    built), No rate set, Approved device, No device registered, Device not approved. One status badge component shows
    text plus icon plus color; color is never the only signal.
U7  States: loading marks the region busy (aria-busy); empty appears only when a read succeeded with zero rows; a read
    failure shows an error (role="alert") that says data may exist, never an empty state; permission denied follows
    the host convention.
U8  Dialogs: focus moves in and returns to the opener; Tab is trapped; Escape closes only the top-most dialog;
    destructive dialogs (delete, void) ignore overlay clicks and Escape; forms with unsaved input use the host's
    unsaved-changes protection.
U9  Accessibility: every action is a real button with an accessible name, including per-row names ("Edit rate for
    <employee>"); tabs have tab roles and keyboard support, or are toggle buttons with aria-pressed; notices use
    role="status"; photos have alt text.
U10 Touch and phones: every control has a hit area of at least 44 by 44 px, including selects, date inputs, small
    buttons and photo thumbnails; form controls use at least 16 px text on touch devices so focus does not zoom. Below
    the host's phone breakpoint, tables become cards, filters move into a sheet, dialogs become bottom sheets with
    safe-area padding, and action cells span the whole card. Payslip figures use one column on phones. The payroll
    table never forces horizontal page scrolling on tablets (use cards up to the host's large breakpoint, or reduce its
    minimum width).
U11 Print and PDF: one shared print-isolation helper; the print container is statically positioned with an @page size
    rule so a long summary paginates; documents are always light; the PDF shows the currency as P10 says.
U12 Refresh: after any write, reload the list and any open dialog. Live refresh, if the host has it, is a convenience,
    never the correctness mechanism.
U13 Caching: no service worker or shared cache stores pages or responses that contain attendance or payroll data.
U14 Browser storage never holds the device token, rates or payroll figures.

------------------------------------------------------------------------------------------------------------------
STEP 10. TESTS (all must exist and pass before the final report; TESTING_CHECKLIST.md has the full list)
------------------------------------------------------------------------------------------------------------------
T1  Unit tests (pure functions): configuration validation (one failing case per rule V1 to V12); the eligibility
    predicate; day grouping (gap excluded, open session adds nothing, sessions out of order); round-once hours (three
    20-minute sessions on one day total 1.00 hour, not 0.99); the night predicate for both anchors, with and without
    windowEnd, a clock-out after midnight, oncePerDay on and off, enabled false; overtime basis session and day; rate
    selection period_end and per_day; the current rate with a future-dated row; gross for daily and hourly; a missing
    rate gives null; signed minor-unit parsing ("-100.50" gives -10050) and totals; the file-name pattern;
    business-date and time formatting in <TIMEZONE>, including a daylight-saving change if <TIMEZONE> has one; the
    correction default (a time_in with seconds rounds up to the next minute; a completed session whose time_out has
    seconds defaults to that minute and keeps Save disabled until another minute is chosen).
T2  Database tests (pgTAP or the host's equivalent) on a database built by replaying every migration from empty:
    - row level security enabled and forced; end users cannot INSERT, UPDATE or DELETE module tables (try it);
    - a second open session fails;
    - clock functions: missing key refused; deactivated caller refused; ineligible target refused (inactive, demo,
      exempt); device check in auto and required mode for clock-in AND clock-out; self_service refuses another target;
      a second same-day session refused when multiple sessions are off;
    - audit: a successful call leaves its row. After each refusal (missing key, blocked device, already clocked in,
      refused rate write), once the call has returned, the denied row exists: it was not rolled back with the
      refusal. For path (a) of B12 prove it here, by calling the function and then reading the audit table. For path
      (b) prove it in a server-action test that calls the action and then reads the audit table;
    - list_clock_staff and attendance_status: key required; ineligible employees absent;
    - review_attendance_page returns names to a reviewer who holds attendance.view_team and is not Super Admin; it
      refuses a caller without attendance.view_team, and that caller reads only own rows through the self view under
      row level security;
    - correction: key, reason, before clock-in, future, overlap, locked period, maxWindowDays, edited_at set,
      clock_out_by set when closing, audit row with old and new values; a value that is not a whole minute is refused;
      an unchanged save on a completed session whose time_out has seconds (its own minute sent as a whole minute) is
      refused and leaves time_out, edited_by, edited_at and edit_reason unchanged;
    - deletion: key, reason, soft rows excluded from readers and the report, hard deletion audit snapshot;
    - photos: read by the subject and attendance.review holders only; attach refused for an unknown session, a wrong
      kind, a caller who is not the operator recorded for that kind, or a storage_path outside that session's prefix;
      an upload to another session's path, or to a kind whose recorded operator is someone else, is refused (by the
      object policy, or by the server action that signs the upload URL); an end user cannot update or delete an
      object in the bucket;
    - report_payroll: own row versus payroll.view_all; the fixture below; open sessions excluded; no rate gives null;
    - app_private.payroll_lines called directly: a Staff session receives only its own line, a payroll.view_all
      holder receives every eligible line, and the lines equal what report_payroll returns to the same caller; the
      signed-in role cannot execute any unfiltered private payroll function;
    - payslips: generate key; refused without a rate; refused when deductions exceed gross; one current payslip;
      regenerate supersedes a pending row and is refused on a paid row; the freeze trigger refuses figure changes and
      clearing paid_at; mark paid only once and only from pending; void only with its key and a reason;
    - rates: key required; append-only; a success audited in the transaction, a refusal audited per B12;
    - every module function (definer, invoker, accessor, helper, trigger function): anon EXECUTE false, PUBLIC
      EXECUTE false, search_path pinned, signed-in EXECUTE only where Step 7 grants it;
    - accessors callable by the signed-in role; the settings store refuses changes from anyone but Super Admin.
T3  Fixture (template data, not reference data). Settings: rate basis daily, rate selection period_end, one rate 120.00
    effective before the period; night rule enabled, anchor clock_out, threshold 21:00, window end null, bonus 50.00,
    once per day; overtime display threshold 9 hours, basis session; minimum hours for a day 0. One employee, times in
    <TIMEZONE>:
      day 1: 09:00 to 17:00
      day 2: 08:00 to 12:00, and 13:00 to 22:30
      day 3: 22:15 to 00:30 on the next calendar day
      day 4: clock-in 09:00, still open
    Expected: total_hours 23.75; days_worked 3; night_shifts 1 (day 2); overtime hours 0.50; gross 410.00.
    Variations: window end 06:00 gives night_shifts 2 and gross 460.00; anchor clock_in with window end null gives
    night_shifts 1 (day 3) and gross 410.00; overtime basis day gives 4.50 overtime hours; a second rate 150.00
    effective on day 3 gives gross 500.00 with period_end and 440.00 with per_day; basis hourly with rate 15.00 gives
    406.25; deductions 20.00 give net 390.00; deductions 500.00 are refused while negative net is not allowed.
T4  Migration-content tests (when a runner has no database): assert the revoke and grant clauses, the search_path
    clause, the partial unique indexes, the CHECK constraints, forced row level security and the freeze trigger by
    reading the migration files.
T5  Authorization sweep (static): every exported server function that writes (an insert, update or delete call, or an
    RPC call) calls a guard. Check per exported function, include action files, and never accept "the file contains a
    guard somewhere" as proof.
T6  UI tests: the clock state machine (Clock In, Clock Out, Continue Duty with confirmation, the date shown for an old
    open session, the photo step, "without photo" only when the camera fails, buttons disabled when the device is not
    approved or a request is pending); history and review lists (first page without a refetch, a filter change returns
    to page 1, the count unit, a read failure shows an error not an empty state, names shown to a reviewer); the
    correction dialog default and disabled Save; the delete dialog per policy; the payslip dialog per key (no generate
    control without the key; confirmations for mark paid and void); the rate editor default date and success message;
    the summary totals with a negative net; Escape closes only the top dialog.
T7  Responsive runs: every screen and dialog at 360, 390 and 430 px wide (phones), 640 and 768 px (tablet), 1024 and
    1280 px (desktop), and at the host's breakpoint edges. Check: no horizontal page scroll; cards and sheets on phones; 44 px targets;
    16 px inputs; one payslip column on phones; bottom sheets clear of safe areas. Record how you ran it (real device,
    emulation or automated browser) and what you saw.
T8  Role flows, end to end or as scripted manual runs if no runner exists:
    - Staff: clocked in and out as the kiosk subject (or in self_service mode); self views per Q16; refused: Review
      Attendance, other employees' rows and photos, direct table writes, every payroll action.
    - Admin with the default grants: review with names; correction with a reason; deletion per policy; export; no
      control shown for anything not granted (clock, devices, rates, payslips).
    - Super Admin: clock operation; devices; rates; generate; mark paid; void if built; summary; a settings change;
      grants, including a refused grant that breaks a key dependency.
T9  Manual checks you cannot automate; list every one not done under WHAT WAS NOT VERIFIED: camera permission in a
    browser and in installed or standalone mode; zoom on focus on an iPhone; print preview of a multi-page summary; the
    PDF currency text; the device cookie on a second browser; real phones at the three widths.

------------------------------------------------------------------------------------------------------------------
STEP 11. SECURITY CHECKLIST (each line is PASS or FAIL in the final report)
------------------------------------------------------------------------------------------------------------------
S1  Every module function (definer, invoker, accessor, helper, trigger function): anon and PUBLIC cannot execute; the
    signed-in role executes only what Step 7 grants; search_path pinned; references schema-qualified; definer owners
    checked (M7). A direct call to app_private.payroll_lines returns only what report_payroll returns to that caller.
S2  End users cannot INSERT, UPDATE or DELETE any module table directly (tried through the host's data API).
S3  Clock functions enforce the key (or the self target), an active caller, an eligible target and the device token
    for clock-in AND clock-out; the pre-check fails closed.
S4  Deactivated accounts are refused by every SQL gate, page and action; no gate lets a NULL through.
S5  Row level security scopes: sessions (own or attendance.view_team); photos (subject or attendance.review, metadata
    and objects); devices (attendance.devices.manage); rates and snapshots (own or payroll.view_all); the caller
    filter inside app_private.payroll_lines, and therefore report_payroll.
S6  Every control the UI offers is allowed by the server for that caller, and no control is shown for a refused action.
S7  Payslip freeze trigger, one current payslip per period, pending-only mark paid, void with a reason; no delete grant.
S8  Audit: every B12 success row is written inside SQL, in the transaction of the change; every B12 refusal row is
    kept by the path chosen in Q23, and a test shows the row still exists after the refusal; no function inserts an
    audit row and then raises; payroll audit rows are readable only by payroll.view_all holders and Super Admin; no
    money amounts in audit context unless configured.
S9  Export: key checked in the route; rows limited by row level security; explicit range; audited.
S10 Device token: random, stored only as a hash, httpOnly secure cookie, never logged, never in browser storage.
S11 Photos: private bucket; uploads only through a signed upload URL for one checked path or a path-scoped insert
    policy (PH4), never an "any active account" insert policy; no object update or delete for end users; expiring
    signed URLs; retention job with credentials from the environment.
S12 No secret, token, real name, email, production id or production URL in code, scripts, tests, fixtures or comments.
S13 Writes are never retried automatically.
S14 Permissions-Policy allows camera=(self) when photos are on; other security headers unchanged.
S15 Attendance and payroll pages and responses are never cached by a service worker or shared cache.
S16 Money math runs in SQL; client parsing is signed and uses integer minor units.
S17 All migrations replay on an empty database, and every rollback was tested.

------------------------------------------------------------------------------------------------------------------
STEP 12. KNOWN REFERENCE DEFECTS YOU MUST NOT REPRODUCE
------------------------------------------------------------------------------------------------------------------
RD1  Clock write not gated by the clock key: the page and roster needed the key, but the server code of both clock
     actions and the clock-in function checked only "active account", so any active account could clock anyone
     through the server action (the clock-out function has no definition in the repository). Build Step 4 item 2.
RD2  Device rule outside the database and failing open: the clock-in function stored whatever existing device id it
     received (a revoked device's id included) or null, without checking it; clock-out took no device input; a failed
     "is the gate on" read counted as off; revoking the last device switched the gate off; a planned fix bound
     clock-in to a device id that employees could read in their own rows. Build DV1 to DV4.
RD3  Direct table writes: in the repository definitions (live state unverified), row policies plus table grants let
     employees insert sessions and rewrite their own times and night fields through the data API, bypassing the
     kiosk, the device rule, photos and audit. Build Step 4 item 4.
RD4  Two night rules: a per-row flag came from the clock-in hour (set by an insert-only trigger and never recomputed
     after a correction) while payroll counted nights from the clock-out time; a shift ending after midnight earned no
     bonus; the review badge and pay disagreed. Build P8.
RD5  Exclusions in different places: the roster hid excluded-role accounts but the clock-in function accepted them; the
     roster listed demo accounts that the function then refused. Build B8.
RD6  Clock status read under the operator's own row policy: an operator without team read access saw no other member
     as clocked in, could not clock another member out, and got the database refusal only when clocking in a member
     who was already clocked in. Build B6 with attendance_status.
RD7  Reviewer name blindness: names came from a join under an employee-table policy of "own row or Super Admin", so
     other reviewers saw dashes, and the employee filter used a roster gated on the clock key. Build R2 and R3.
RD8  Correction history was thin: the old clock-out survived only in an application audit write that never throws;
     the row kept only the last editor and reason and no edit time; no row lock; no overlap check. Build R7.
RD9  Correction form default truncated to the minute: an unchanged save on an open session was refused as "before
     clock-in", and on a completed session it silently moved the clock-out back to the start of its minute. Build R8.
RD10 Deletion policy differed by screen (a request on one page, a direct delete on another, and the server allowed
     both); the request permission could not be granted from the access screen; deletions were hard, kept no copy of
     the row, and left photos behind. Build R9 and R10.
RD11 Photos: clock-in versus clock-out decided by a file-name substring; any active account could read every photo,
     upload any object into the shared bucket and attach a photo to any session; photos kept forever; the camera
     header was an unstated dependency. Build PH1 to PH7.
RD12 Role-title gates and helpers without an active check: a deactivated administrator's session still passed SQL role
     gates, and a NULL role would have skipped a "not in" refusal. Build the Step 4 helpers.
RD13 Payroll permissions that did not match: an Admin was shown payslip generation that the server action refused, and
     rate editing and mark paid that the server may refuse (the rate function is not in the repository, and the
     repository's update policy refuses the Admin's mark paid while the live policy is unverified); in the repository
     definitions the payroll report returned only that Admin's own row; the mark-paid failure message read "may
     already be paid". Build Step 4 item 9 and payroll.view_all.
RD14 Rate writes had no application-side check and an unknown database gate; "current rate" ignored future effective
     dates; two rate editors used different default dates (the device date and the business date). Build P2 to P4 and
     one RateEditor.
RD15 Payslips, in the repository definitions (live state unverified): no uniqueness per employee and period (a newer
     pending row could hide a paid one); figures editable by Super Admin through an update policy that is not limited
     to the payment columns; negative net allowed with no check; no reverse path; the generation body coalesced a
     missing rate to zero. Build P12 to P15.
RD16 A negative net corrupted the printed total: the parser replaced a signed whole part with zero and kept the
     fraction; the total also mixed net and gross. Build P10 and P18.
RD17 Labels: total hours labelled "Regular hours"; pay frequency stored but decorative; three words for "not paid"
     and two for an open day; the night amount hard-coded in labels; a currency glyph in a PDF font that cannot render
     it. Build P7, P17, U6.
RD18 Read failures shown as empty results (a failed count query returned an empty page), and a failed payslip read
     showed every row as unpaid. Build U7 and P16.
RD19 Dates and times: a fixed UTC offset and a hard-coded zone in SQL, code and tests; the work_date column default
     used the server's UTC date; lists filtered on clock-in time while payroll used work_date; times shown in the
     viewer's zone and without a date for an old open session. Build B4, B11, R3.
RD20 Schema not rebuildable: several live functions, the rates table and snapshot columns existed only in production;
     a function's return type was changed with CREATE OR REPLACE; a database test read a column the report no longer
     returned; function grants after an out-of-band re-create were unknown. Build M5, M6 and M8.
RD21 Tests that gave false assurance: the static authorization sweep matched only insert, update and delete calls, so
     RPC-only writers were invisible, and one file passed only because of dead code; no database test covered the
     current pay formula or any permission-key gate. Build T2 and T5.
RD22 Money visible through the audit trail: rates and net pay were written to audit context readable by every active
     account. Build B12 and S8.
RD23 UI safety gaps: revoke device and mark paid had no confirmation; Escape closed nested dialogs together; the open
     day dialog likely kept stale data after a correction (derived from the code, not verified in a browser); clock
     buttons stayed enabled on an unapproved device; several controls were below 44 px and small inputs could zoom on
     focus; the print container used fixed positioning with no page rule. Build U8, U10, U11, U12 and DV6.
RD24 Stale comments described self-service clocking, a Super-Admin-only mark paid and an authority model the code did
     not use. Write comments that name the key and the layer each function actually checks.

------------------------------------------------------------------------------------------------------------------
STEP 13. DELIVERY ORDER (checkpoint after each item, per G10)
------------------------------------------------------------------------------------------------------------------
1. Step 1 report; wait for the answers.
2. Configuration object, validation and its tests.
3. Migrations on <TARGET_DATABASE>: settings store and accessors, helpers, tables, indexes, policies, grants, functions;
   rollback tested; full replay from empty.
4. Database tests and catalog checks.
5. Server layer: readers, server actions with guards, the export route.
6. Attendance screen, then Review Attendance, then Payroll.
7. UI tests, responsive runs, role flows.
8. Security checklist.
9. Final report.

------------------------------------------------------------------------------------------------------------------
STEP 14. FINAL REPORT (print these lines first, exactly, in this order; then the sections)
------------------------------------------------------------------------------------------------------------------
Rule: PASS only when you ran every check on that line and all passed. Otherwise FAIL, with what failed or "not run".
ARCHITECTURE INSPECTED: PASS | FAIL - <where the report is; which questions the human answered>
CONFIG DEFINED: PASS | FAIL - <file path; validation test names; seed agreement test>
MIGRATIONS APPLIED: PASS | FAIL - <database and kind; migration files; replay from empty yes/no; rollback tested yes/no>
RLS VERIFIED: PASS | FAIL - <forced tables; policies; table grants; EXECUTE for PUBLIC, anon, signed-in per function; owners>
STAFF FLOW TESTED: PASS | FAIL - <clocked in and out; self views per Q16; refusals: review, others' rows, direct writes>
ADMIN FLOW TESTED: PASS | FAIL - <review with names; correction with reason; deletion per policy; export; no refused control>
SUPER ADMIN FLOW TESTED: PASS | FAIL - <devices; rates; generate; mark paid; void if built; summary; settings; grants>
MOBILE TESTED: PASS | FAIL - <360, 390, 430, 640, 768, 1024 and 1280 px; method; findings>
SECURITY CHECKS PASSED: PASS | FAIL - <S1 to S17, each PASS or FAIL>
WHAT WAS NOT VERIFIED:
- <one line per item: every manual check not done (T9), every companion document missing, every assumption the human
  has not confirmed>
DECISIONS CONFIRMED BY THE HUMAN:
- <Qn: answer>
DEVIATIONS AND NOT IN THE REFERENCE ITEMS BUILT:
- <what, why, who approved>
ROLLBACK PLAN:
- <migrations to reverse, in order, with the command for each>
FILES CHANGED:
- <one path per line>
OPEN QUESTIONS:
- <one per line>
````

## Decisions this prompt makes where companion documents disagree

The documents in this folder were written in parallel and did not always agree on names or defaults. The prompt
follows the owner of each subject (the same owners it gives the agent in rule G4) and asks the agent to report any
remaining difference. The last column was re-checked against the companion files on 2026-09-17, while several of them
were still being revised; the agent's own Step 1.17 comparison supersedes it. "none found" means the companion files
agreed with the prompt on that subject when checked.

| Subject | What the prompt uses | Follows | Differs when last checked |
|---|---|---|---|
| Permission keys | the eleven keys of Step 4; own-row access needs no key | PERMISSIONS.md 4.2 | none found; no file uses `payroll.view_own` as a key |
| Key dependencies, page access | as in Step 4 | PERMISSIONS.md 4.3 | none found |
| Payslip generation gate | payroll.payslip.generate and payroll.view_all (the one exception to "own key only") | DATABASE.md 5.13; PERMISSIONS.md 4.3 | none found |
| Default grants | Staff none; Admin view team, review, correct, delete, export; clock operate in no default set | PERMISSIONS.md 5 | none found (CONFIGURATION.md 2.3 follows PERMISSIONS.md 5) |
| Delete request path | optional, off unless the host has an approval queue | PERMISSIONS.md 4.2; DATABASE.md 5.13 | none found (CONFIGURATION.md 2.4 defaults it to false) |
| Configuration keys, fixed values | CONFIGURATION.md section 2 names | CONFIGURATION.md 2, 2.9, 7 | none for key names |
| Onboarding keys | night anchor and threshold, overtime threshold, rate basis, default frequency, clock mode: no default | CONFIGURATION.md 2.4, 2.6, 2.9 rule 15 | none found |
| Other onboarding values | `dateLocale`, `payFrequencies` and labels, `payslip.labels`: no default (Q3, Q9) | CONFIGURATION.md 2.2, 2.6, 2.9 rule 15 | none found |
| Monthly rate basis | rejected by V3 until the human writes a formula | P9; CONFIGURATION.md 2.9 rule 14 | none found (DATABASE.md 5.8, 5.9: CHECK keeps it, validation refuses it) |
| New keys | none beyond CONFIGURATION.md section 2 | CONFIGURATION.md 2.4 (`attendance.clockMode`, `attendance.selfView`), 2.6 (`payroll.selfView`) | none found |
| Function names | reference names, such as `kiosk_clock_in` | DATABASE.md 5.13; SERVER_API.md 9 | none found (ARCHITECTURE.md 6 uses the DATABASE.md 5.13 names) |
| Night predicate | `app_private.is_night_session(time_in, time_out)`, computed on read | CONFIGURATION.md 7; DATABASE.md 5.12 | none found (PAYROLL.md 4 and 12 item 1 use the same name) |
| Stored night flag | none, and no night trigger; a badge calls the predicate or a view | DATABASE.md 5.3; CONFIGURATION.md 2.6 | none found |
| Settings store | key and value rows; payroll keys effective-dated | DATABASE.md 5.12; CONFIGURATION.md 1.2 to 1.4 | none found (BUSINESS_RULES.md A13: bonus as in force on the `work_date`) |
| Payslip statuses | pending, paid, void; optional `void_payslip` on `payroll.payslip.generate` | CONFIGURATION.md 2.6, 7; DATABASE.md 5.9 | none found (UI_UX.md 5.3 has Void) |
| Deductions | lump sum in the snapshot's `deductions` column; itemized not built | DATABASE.md 5.9, 5.10; CONFIGURATION.md 2.6, 2.9 | none found |
| Period lock | `off`, `generated`, `paid`, checked against current payslips | CONFIGURATION.md 2.6; DATABASE.md 5.5 | none found |
| Day approval | statuses pending and approved; a correction or deletion resets to pending; gated on attendance.correct unless Q14 changes it | DATABASE.md 5.5; PERMISSIONS.md 4.2 | none found |
| Correction precision | minute everywhere; same minute = unchanged; not a whole minute = refused | RD9; DATABASE.md 5.13 | none found (SECURITY.md 9.4; UI_UX.md 9.2; SERVER_API.md 9.6) |
| Payroll computation | caller filter inside `app_private.payroll_lines`; `report_payroll` a signature only | DATABASE.md 5.13; ARCHITECTURE.md 6.4 | none found (PAYROLL.md 11; SECURITY.md 10) |
| Function grant scope | revoke PUBLIC and anon on every module function | PERMISSIONS.md 4.1 principle 9; DATABASE.md 5.1 principle 8 | none found (SECURITY.md 10) |
| Audit of refusals | success rows in the function; refusals by typed result or server layer (B12) | SERVER_API.md 9.1 rule 8; DATABASE.md 5.13 | none found (SECURITY.md 9.4, 10; TESTING Z10) |
| Summary total | separate gross, deductions and net totals | PAYROLL.md 12 item 21 | none found (the reference prints one mixed total) |
| Label for later sessions | "Continued Duty" | UI_UX.md 5.3 | none found |
| Must-not-be-frontend-only numbering | items 1 to 16 | SECURITY.md 2 | none found |
| Self-service clocking | `self_clock_in`, `self_clock_out` (caller is the target); page without a key unless Q4 adds one | DATABASE.md 5.13; PERMISSIONS.md 4.3 | none found |

`report_payroll` keeps the INVOKER mode only for a stable public signature; the row scope of payroll lines comes from
the caller filter inside `app_private.payroll_lines` (P16), not from row level security on an invoker report.

## Where the rules in the prompt come from

Each row cites the reference implementation and labels how the prompt treats it. The companion documents hold the full
detail; this table shows that the prompt did not invent its rules.

| Prompt rule | CURRENT evidence | Label and note |
|---|---|---|
| B1 session row | `M/20260717120000:22-33`; unused status column `M/20260722150000:12` | GENERIC; `edited_at` and soft deletion are RECOMMENDED TEMPLATE IMPROVEMENT |
| B2 one open session | `M/20260717120000:41-45`; message `M/20260907120000:48-49` | GENERIC |
| B3 server time | `M/20260717120000:26`; no time sent `src/lib/hr/attendance.ts:165-169` | GENERIC |
| B4 work_date | `M/20260907120000:40-46`; column default `M/20260717120000:25` | GENERIC; default fix is PENDING (not live) `M/20260916120000:367-368` |
| B5 day total | `src/lib/hr/sessions.ts:90-91`; `M/20260907160000:39`, `:49`, `:79` | GENERIC; round once is RECOMMENDED TEMPLATE IMPROVEMENT |
| B6 clock state | `src/components/hr/attendance-clock.tsx:300-352`; reads under RLS `src/lib/hr/attendance.ts:111-146` | status reader is RECOMMENDED TEMPLATE IMPROVEMENT |
| B7 kiosk model | `src/components/hr/attendance-clock.tsx:145-150`; `M/20260907160000:9-27` | kiosk GENERIC; self_service NOT IN THE REFERENCE |
| B8 eligibility | roster `M/20260907160000:23-24`; payroll `:97-99`; clock-in target `M/20260907120000:30-37` | one predicate is RECOMMENDED TEMPLATE IMPROVEMENT |
| B9 old open session | time without date `src/components/hr/attendance-clock.tsx:302-306`; no auto-close rule `M/20260907130000:13-63` | RECOMMENDED TEMPLATE IMPROVEMENT |
| B10 no write retry | `src/lib/supabase/retry-fetch.ts:40`, `:58-60`, `:82`; `src/lib/supabase/server.ts:26-30` | GENERIC |
| B11 time display | viewer zone `src/lib/hr/attendance-paging.ts:176-179`; device-local input `src/components/hr/review-attendance-view.tsx:674-679`, `:713` | RECOMMENDED TEMPLATE IMPROVEMENT |
| B12 audit in SQL | app-side writer that never throws `src/lib/audit/log.ts:35-80`; correction event `src/lib/hr/attendance.ts:447-456` | success rows in SQL: RECOMMENDED TEMPLATE IMPROVEMENT |
| B12 refusal paths | denied and failed rows written app-side after the error returns `src/lib/hr/attendance.ts:354-362`, `:372-380` | path (b) GENERIC; path (a) per SERVER_API.md 9.1 rule 8 |
| DV device gate | fail-open read `src/lib/hr/devices.ts:38-42`; TypeScript gate `src/lib/hr/attendance.ts:28-48` | app-only; clock-in id check PENDING (not live) `M/20260916120000:451-459` |
| DV token and cookie | `src/lib/hr/devices.ts:75`, `:83-89`; hash `M/20260722150000:50-53`; one device `:49` | GENERIC; token check in both functions: RECOMMENDED TEMPLATE IMPROVEMENT |
| DV6 revoke confirmation | one-tap revoke `src/components/hr/device-manager.tsx:136-146` | RECOMMENDED TEMPLATE IMPROVEMENT |
| PH photos | in or out by file name `src/lib/hr/attendance.ts:505`, `:553`; read by any active account `M/20260716300000:127-129`, `:159-161` | RECOMMENDED TEMPLATE IMPROVEMENT |
| PH4 object writes | any active account may insert objects in the bucket `M/20260716300000:163-165`; no object update or delete policy `:167-169` | RECOMMENDED TEMPLATE IMPROVEMENT |
| PH6 retention | storage objects removed through the Storage API only `scripts/purge-attendance-selfies.mjs:7-8` | GENERIC constraint; the script's embedded URL is not copied |
| PH7 camera header | `next.config.ts:45-48` | GENERIC |
| Step 4 keys | page keys `src/components/shell/navigation.ts:91-93` | three page keys today |
| Step 4 role gates | `src/lib/hr/attendance.ts:352`, `:406`; `src/lib/hr/payslip-actions.ts:28`, `:106` | keys instead of role titles: RECOMMENDED TEMPLATE IMPROVEMENT |
| Step 4 item 2 | `src/lib/hr/actions.ts:81-105`; `src/lib/hr/attendance.ts:158`, `:211`; `M/20260907120000:25-28` | RECOMMENDED TEMPLATE IMPROVEMENT |
| Step 4 item 4 | `M/20260717120000:59-75` | live grants NEEDS VERIFICATION |
| Step 4 item 13 | `M/20260715130000:28-39`, `:47-58`; sentinel `M/20260916120000:46-57` | sentinel PENDING (not live); id-helper active check: RECOMMENDED TEMPLATE IMPROVEMENT |
| Step 4 item 14 | `M/20260907130000:65-68`; `M/20260806260000:17`, `:33-34`; default re-grant `M/20260916120000:12-14`, `:70-73` | GENERIC; blanket revoke PENDING (not live) |
| Step 4 item 15, R2 | `src/lib/hr/attendance.ts:562-563`; `M/20260821140000:21-22` | RECOMMENDED TEMPLATE IMPROVEMENT; another live profile policy NEEDS VERIFICATION |
| R3 date basis | lists `src/lib/hr/attendance.ts:615-616`; payroll `M/20260907160000:44` | RECOMMENDED TEMPLATE IMPROVEMENT |
| R4 count unit | `src/components/hr/review-attendance-view.tsx:326-330` | RECOMMENDED TEMPLATE IMPROVEMENT |
| R6 stale open dialog | `src/components/hr/review-attendance-view.tsx:107`, `:495-503` | NEEDS VERIFICATION in a browser |
| R7 correction | `M/20260907130000:29-61`; no row lock `:39-40`; old value app-side `src/lib/hr/attendance.ts:447-456` | key gate, overlap, lock, SQL audit are RECOMMENDED TEMPLATE IMPROVEMENT |
| R8 correction default | `src/components/hr/review-attendance-view.tsx:674-679`, `:707`; refusal `M/20260907130000:48-50` | RECOMMENDED TEMPLATE IMPROVEMENT |
| R9, R10 deletion | direct `src/components/hr/review-attendance-view.tsx:624-629` | delete function RECONSTRUCTED |
| R10 two policies | request instead of delete `src/components/hr/attendance-day-details.tsx:138-150` | one policy: RECOMMENDED TEMPLATE IMPROVEMENT |
| R10 request key | absent from `src/lib/authz/access-catalogue.ts:37-129`; required at `src/lib/fulfillment/service.ts:502` | RECOMMENDED TEMPLATE IMPROVEMENT |
| R11, R12 approval, lock | payroll counts every completed session `M/20260907160000:43-44` | NOT IN THE REFERENCE |
| P1 period | `src/app/(app)/admin/payroll/page.tsx:31-34`; inclusive `M/20260907160000:44` | validation is RECOMMENDED TEMPLATE IMPROVEMENT |
| P2 to P4 rates | append-only `src/lib/hr/rate.ts:193-231`; selection `M/20260907160000:59-74`; current rate `src/lib/hr/rate.ts:139-143` | rates table and function RECONSTRUCTED |
| P5 to P7 hours, days, overtime | `M/20260907160000:39-52` | GENERIC; threshold value PROJECT-SPECIFIC |
| P8 night rule | payroll `M/20260907160000:41`, `:53-55`, `:85-93`; flag `M/20260722200000:26-49` | bonus function RECONSTRUCTED; values PROJECT-SPECIFIC |
| P8 one predicate | two rules today (row above) | RECOMMENDED TEMPLATE IMPROVEMENT |
| P9 gross | daily `M/20260907160000:86-93`; legacy hours rule `M/20260722210000:113-114` | daily GENERIC; monthly has no reference formula |
| P10 money | `src/lib/hr/payroll.ts:38-68`; signed-parse gap `src/components/hr/payroll-summary-button.tsx:31-36` | GENERIC; signed parsing RECOMMENDED TEMPLATE IMPROVEMENT |
| P11, P12 deductions, net | `M/20260722210000:27-28`, `:93`, `:125` | lump sum GENERIC; net >= 0 CONFIGURABLE |
| P13, P14 snapshot | `M/20260722210000:15-68`; newest row wins `src/lib/hr/payslip.ts:69-71`, `:78-79` | live body and six columns RECONSTRUCTED |
| P13, P14 freeze, uniqueness | no trigger, no unique index `M/20260722210000:41-44`, `:62-65` | RECOMMENDED TEMPLATE IMPROVEMENT |
| P15 mark paid, void | `src/lib/hr/payslip-actions.ts:99-135` versus policy `M/20260722210000:62-65` | live policy NEEDS VERIFICATION; void NOT IN THE REFERENCE |
| P16 report scope | invoker body `M/20260907160000:29-34`; filter `:100`; private bonus call `:85`, `:90` | filter GENERIC; filter inside `payroll_lines`: RECOMMENDED TEMPLATE IMPROVEMENT |
| P16 grants | an invoker report's caller needs EXECUTE on the private function it calls (SECURITY.md 8.2) | GENERIC constraint; live EXECUTE grants NEEDS VERIFICATION |
| M5, S1 grant scope | PENDING (not live) loop revokes public DEFINER functions only `M/20260916120000:65-66`, `:87`; re-grant `:12-14` | every-function revoke: RECOMMENDED TEMPLATE IMPROVEMENT |
| R7, R8 precision | minute input `src/components/hr/review-attendance-view.tsx:674-679`, `:707`; exact check `M/20260907130000:48-50` | RECOMMENDED TEMPLATE IMPROVEMENT (RD9) |
| P17 documents | print CSS `src/components/hr/payslip-button.tsx:26-36` | branding PROJECT-SPECIFIC; multi-page print NEEDS VERIFICATION |
| P18 summary | one mixed total `src/components/hr/payroll-summary-button.tsx:54-60` | separate totals: RECOMMENDED TEMPLATE IMPROVEMENT |
| M6 return type | `M/20260721100000:10-12`, `:18`, `:73-74` | GENERIC pattern |
| M8 rebuildable schema | the pgTAP suite numbered 26 in `supabase/tests/` reads a removed report column (lines 142-148) | a replay from the repository NEEDS VERIFICATION |
| T4 content tests | `tests/unit/security-hardening.test.ts:218-286` | GENERIC pattern |
| T5 sweep | `tests/integration/phase11-authorization-boundary.test.ts:27-31` | RECOMMENDED TEMPLATE IMPROVEMENT |
| U7 read errors | `src/lib/hr/attendance.ts:623-635` | RECOMMENDED TEMPLATE IMPROVEMENT |
| U8 dialogs | Escape listener per open dialog `src/components/ui/modal.tsx:134-146`; mark paid `src/components/hr/payslip-button.tsx:234-238` | RECOMMENDED TEMPLATE IMPROVEMENT |

## Items removed from the prompt as PROJECT-SPECIFIC

These belong to the source business. They are described here without their values; the values are listed in
CONFIGURATION.md section 9 and INTEGRATION_GUIDE.md section 1.2.

- The business timezone name and the fixed UTC offset used for day bounds, and the migration and module names that
  embed the zone (replaced by `<TIMEZONE>` and the rule "zone name only").
- The currency symbol and ISO code, and the flat night amount printed inside labels (replaced by `<CURRENCY>`,
  `<CURRENCY_SYMBOL>` and labels built from `payroll.nightRule.bonusAmount`).
- The night threshold hour, the flat night amount, the overtime display threshold, the daily rate basis and the default
  pay frequency as defaults (set at onboarding instead).
- The reference permission-key names, the reference Admin role key and the role-title gates (replaced by the keys of
  Step 4, mapped to host names in Step 1).
- The decision to keep Super Admins off the roster and payroll, recorded in a migration header that names real account
  holders (replaced by `exclusions.excludedRoles` and the timekeeping exemption flag).
- The demo-account seed pattern based on an email domain (the demo flag stays; the pattern is not copied).
- The single approved-device wording, the brand-prefixed device cookie and storage-key names (replaced by
  `attendance.device.defaultLabel` and `branding.cookieNamePrefix`).
- Company name, logo text, accent color, brand-named design tokens and the brand-prefixed payslip and export file names
  (replaced by `branding.*` and `payroll.payslip.fileNamePattern`).
- A primary Super Admin identified by an email constant (replaced by a profile flag in the host identity module).
- The approval queue housed in a business module, with a request permission shared with business approvals (replaced
  by the optional request path of R10).
- Internal specification-section references, provisional-policy rows and dated owner-decision comments.
- A selfie purge script that embeds a production project URL, and test fixtures that pair a real-looking name with
  salary figures.
