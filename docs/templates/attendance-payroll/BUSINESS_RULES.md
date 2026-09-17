# Attendance and Payroll Template: Business Rules (Phases 5 and 6)

This document states the business rules of the reference implementation's attendance clock (Part A) and of its
Review Attendance workflow (Part B), so that a system built for another client can reuse the rules that hold up,
turn policy values into client settings, and avoid inheriting the defects. Each rule is described as the code
actually behaves, with `file:line` citations, and is then judged for reuse and configurability. Where the repository
cannot settle a point, the text says so and names the check that would. Nothing in this document is a change to the
production system: every improvement is a requirement for the template only. Sibling documents that cite
"ATTENDANCE.md" mean Part A of this file, and "REVIEW_ATTENDANCE.md" means Part B.

## How to read this

Labels used throughout:

- CURRENT = how the reference implementation behaves today, with a `file:line` citation.
- GENERIC = the reusable form of the same rule.
- PROJECT-SPECIFIC = tied to the source business; must not be copied into another client's system silently.
- CONFIGURABLE = should become a client setting.
- NEEDS VERIFICATION = the repository cannot settle it; the text says what would (usually a read-only catalog query
  or a browser check run by whoever owns the correct project).
- RECONSTRUCTED = a live database object whose DDL is missing from the repository; its shape is inferred from app
  code, comments and later migrations.
- PENDING (not live) = content of migrations `20260916120000`, `20260916130000` and `20260917120000`, written but not
  applied to production. Only `20260916120000` changes attendance objects; `20260916130000` adds an `audit_events`
  index (`M/20260916130000:12-13`) and `20260917120000` touches no attendance object.
- RECOMMENDED TEMPLATE IMPROVEMENT = a gap or defect in the reference implementation that the template should fix.

Part A rule format. Every rule has exactly four fields:

- CURRENT RULE: the behaviour, with citations and any RECONSTRUCTED, PENDING or NEEDS VERIFICATION caveats.
- WHY IT EXISTS: the reason given by a code comment, migration comment or repository document. When none exists the
  field says "rationale not documented in the repo". Four attendance and payroll migrations cite a governing
  specification section 12 times for the attendance and payroll policy (a fifth migration cites the same section once
  for an unrelated module), but that section is not in the repository (the specification file in the repo has no such
  section), so the reasons behind thresholds and amounts cannot be recovered and are treated here as unexplained
  client policy.
- REUSABLE AS-IS?: Yes, No, or With changes. This field carries the GENERIC form of the rule: for Yes the GENERIC
  form is the CURRENT rule; for With changes and No the listed changes describe the GENERIC form.
- CONFIGURABLE FOR CLIENT?: No, or Yes with the configuration key and its type. When CONFIGURATION.md fixes a value
  (a literal type in its section 2, or an item of its section 5 "Not configurable by design"), the field says No and
  names that item instead of proposing a key.

Role vocabulary: database role keys are `owner`, `selected_admin` and `staff`; the user interface calls them
Super Admin (role key owner), Admin (role key selected_admin) and Staff (role key staff). After this paragraph the
document says Super Admin, Admin and Staff. Code comments quoted from the repository say "Owner" and "Selected Admin".

Permission keys (CURRENT): `hr_attendance` opens the Attendance (clock) page and the kiosk roster;
`hr_review_attendance` opens Review Attendance and lets its holder read every attendance row; `hr_payroll` opens
Payroll. The Super Admin holds every key implicitly (`permissions.ts:127-133`; `guard.ts:174-180`).

Key names for the template: configuration keys, their types and their fixed values are those of CONFIGURATION.md
section 2, the schema of record; this document introduces no key of its own. Permission keys are those of
PERMISSIONS.md section 4.2, which CONFIGURATION.md section 2.3 uses unchanged (for example `attendance.clock_operate`,
`attendance.correct`). The one key outside PERMISSIONS.md section 4.2 is `attendance.delete.request`: CONFIGURATION.md
section 2.3 seeds it only when `attendance.deletion.requestApprovalPath` (section 2.4) is true, and PERMISSIONS.md
section 4.2 drops the request path by default.

Quoting conventions: SQL is quoted verbatim except that the business-timezone literal is replaced by `<business-tz>`
and the currency symbol by `<cur>`. The real literals appear only in the PROJECT-SPECIFIC section at the end.
Regular expressions are described in words; this file contains no backslash characters.

Sibling documents (details are not repeated here): DATABASE.md (tables, RLS, functions, generic model),
PERMISSIONS.md (capability matrix and generic keys), PAYROLL.md (pay engine), UI_UX.md (screens and components),
CONFIGURATION.md (settings schema), TESTING_CHECKLIST.md (tests), IMPLEMENTATION_PROMPT.md (build prompt).
DATABASE.md section 5 is the generic data model. This document names the subject beside each subsection number it
cites: 5.2 `employees` (with the eligibility predicate and `timekeeping_exempt`), 5.3 `attendance_sessions` (soft
delete, `edited_at`), 5.5 `attendance_day_reviews`, 5.7 `attendance_photos`, 5.11 `audit_events`, 5.13 the function
set. Configuration key names follow CONFIGURATION.md, the schema of record, where DATABASE.md words a key differently.

### Citation key

| Short form | Full path |
|---|---|
| `M/20260715120100` | `supabase/migrations/20260715120100_phase1_identity_access.sql` |
| `M/20260715130000` | `supabase/migrations/20260715130000_phase2_authz_helpers.sql` |
| `M/20260715130100` | `supabase/migrations/20260715130100_phase2_rls_policies.sql` |
| `M/20260716300000` | `supabase/migrations/20260716300000_attachments_storage.sql` |
| `M/20260717120000` | `supabase/migrations/20260717120000_hr_attendance.sql` |
| `M/20260722150000` | `supabase/migrations/20260722150000_team_management_phase2_devices.sql` |
| `M/20260722160000` | `supabase/migrations/20260722160000_payroll_exclude_demo_accounts.sql` |
| `M/20260722200000` | `supabase/migrations/20260722200000_attendance_overtime_and_selfie.sql` |
| `M/20260729120000` | `supabase/migrations/20260729120000_portal_access_permissions.sql` |
| `M/20260731130000` | `supabase/migrations/20260731130000_enable_realtime_dashboard_tables.sql` |
| `M/20260804140000` | `supabase/migrations/20260804140000_attendance_review_by_permission.sql` |
| `M/20260805160000` | `supabase/migrations/20260805160000_list_clock_staff.sql` |
| `M/20260821140000` | `supabase/migrations/20260821140000_merge_permissive_select_policies.sql` |
| `M/20260907120000` | the kiosk clock-in migration `supabase/migrations/20260907120000_*.sql` (full name in the PROJECT-SPECIFIC list) |
| `M/20260907130000` | `supabase/migrations/20260907130000_correct_attendance_clock_out.sql` |
| `M/20260907160000` | `supabase/migrations/20260907160000_exclude_owners_from_timekeeping.sql` |
| `M/20260916120000` | `supabase/migrations/20260916120000_security_hardening_definer_grants_owner_guards.sql` (PENDING) |
| `M/20260916130000` | `supabase/migrations/20260916130000_hotpath_indexes_audit_payments_customers.sql` (PENDING) |
| `attendance.ts` | `src/lib/hr/attendance.ts` |
| `paging.ts` | `src/lib/hr/attendance-paging.ts` |
| `sessions.ts` | `src/lib/hr/sessions.ts` |
| `hr-format.ts` | `src/lib/hr/format.ts` |
| `actions.ts` | `src/lib/hr/actions.ts` |
| `devices.ts` | `src/lib/hr/devices.ts` |
| `rate.ts` | `src/lib/hr/rate.ts` |
| `clock.tsx` | `src/components/hr/attendance-clock.tsx` |
| `records.tsx` | `src/components/hr/attendance-records.tsx` |
| `day-details.tsx` | `src/components/hr/attendance-day-details.tsx` |
| `review-view.tsx` | `src/components/hr/review-attendance-view.tsx` |
| `device-manager.tsx` | `src/components/hr/device-manager.tsx` |
| `attendance-page.tsx` | `src/app/(app)/admin/attendance/page.tsx` |
| `review-page.tsx` | `src/app/(app)/admin/attendance/review/page.tsx` |
| `approvals-page.tsx` | `src/app/(app)/approvals/page.tsx` |
| `guard.ts` | `src/lib/authz/guard.ts` |
| `permissions.ts` | `src/lib/authz/permissions.ts` |
| `access-catalogue.ts` | `src/lib/authz/access-catalogue.ts` |
| `request-deletion.ts` | `src/lib/authz/request-deletion.ts` |
| `navigation.ts` | `src/components/shell/navigation.ts` |
| `service.ts` | `src/lib/fulfillment/service.ts` (hosts the generic approval queue) |
| `log.ts` | `src/lib/audit/log.ts` |
| `upload.ts` | `src/lib/attachments/upload.ts` |
| `image.ts` | `src/lib/attachments/image.ts` |
| `server.ts` | `src/lib/supabase/server.ts` |
| `retry-fetch.ts` | `src/lib/supabase/retry-fetch.ts` |
| `data-export.ts` | `src/lib/export/data-export.ts` |
| `activity-panel.tsx` | `src/components/live/recent-activity-panel.tsx` |
| `live-ops-actions.ts` | `src/lib/live/live-ops-actions.ts` |
| `dashboard-service.ts` | `src/lib/dashboard/service.ts` |
| `live-ops-page.tsx` | `src/app/(app)/settings/live-operations/page.tsx` |
| `next.config.ts` | `next.config.ts` |
| `ui-sot` | `docs/FINAL-UI-SOURCE-OF-TRUTH.md` |
| `audit-doc` | `docs/SYSTEM-AUDIT-2026-09-16.md` |
| `purge-script` | `scripts/purge-attendance-selfies.mjs` |
| `pgtap-26` | `supabase/tests/26_hr_attendance.test.sql` |

---

## Key facts shared by every document in this set

- Clocking is a shared KIOSK, not self-service: a signed-in operator who holds `hr_attendance` picks a member from
  `list_clock_staff()` and clocks that member in or out (`clock.tsx:63-65, 207-235`; `actions.ts:85`;
  `M/20260907160000:9-27`). The operator is not the person clocked.
- One open session per member, enforced by a unique partial index (`M/20260717120000:41-45`).
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:40-46`).
- A day is the group of sessions with the same member and `work_date`; the day total is the sum of completed
  sessions, gaps excluded (`sessions.ts:4-17, 90-91`).
- Two DIFFERENT night rules exist. The session flag: clock-in hour >= 22 gives a flat 300.00 on the row, set by a
  BEFORE INSERT trigger (`M/20260722200000:26-49`). The payroll rule: distinct work dates with a clock-out at or after
  22:00, times `app_private.night_ot_bonus()` (`M/20260907160000:41, 55, 85-93`; the function is RECONSTRUCTED).
- Pay = round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2) (`M/20260907160000:86-93`). Deductions are
  a single lump sum >= 0 entered at payslip generation; a payslip is a frozen snapshot with `payment_status` pending
  then paid. PAYROLL.md owns these rules.
- There is no approval or finalization step for attendance and no period lock (B7).
- Only the clock-out can be corrected: Super Admin or Admin by role, reason required, in-place update, the old value
  kept only in a best-effort app audit event (A9, B8).
- Delete is a hard delete (B6).
- Device approval: a hashed token in an httpOnly cookie, enforced in server TypeScript only; the live database has no
  check (PENDING adds a clock-in check); fail-open when no device is registered (A11).
- Exclusions: Super Admins are excluded from the roster and from payroll but are still accepted as a `kiosk_clock_in`
  target; demo accounts are excluded from payroll and refused as a clock-in target, but CURRENT `list_clock_staff`
  still lists them (A14).

---

## Part A. Attendance rules (Phase 5)

### A0. Summary

| Rule | Reusable as-is? | Configurable for client? |
|---|---|---|
| A1 First Clock In of a day | With changes | Yes |
| A2 Clock Out | With changes | Yes |
| A3 Multiple sessions per day (Continue Duty) | Yes | Yes |
| A4 Open session limit | Yes | No |
| A5 Overnight shifts and crossing midnight | With changes | Yes (night pay only; dating is fixed) |
| A6 `work_date` and the business timezone | With changes | Yes |
| A7 Total worked | With changes (round once) | No |
| A8 Missing Clock Out | With changes | Yes |
| A9 Corrections | With changes | Yes (who and time window; reason and clock-out-only are fixed) |
| A10 Open / Complete status | With changes (one label set) | Yes (labels only) |
| A11 Device approval | With changes | Yes (where the check lives is fixed) |
| A12 Selfie | With changes | Yes |
| A13 Night flag versus payroll night rule | No | Yes |
| A14 Super Admin and demo exclusions | With changes | Yes (roles only; demo exclusion is fixed) |
| A15 No automatic retry of a clock write | Yes | No |

### A1. First Clock In of a day

CURRENT RULE

- Page and roster need `hr_attendance`: the page answers 404 without it (`attendance-page.tsx:43`); the roster RPC
  raises unless `app_private.has_permission('hr_attendance')` and returns active profiles whose role key is not
  owner, ordered by name (`M/20260907160000:16-25`).
- The write path does not re-check that permission. `clockInAction` has no guard (`actions.ts:81-94`),
  `kioskClockIn` calls only `requireActiveStaff()` (`attendance.ts:158`), and the RPC checks only
  `app_private.is_active_staff()` (`M/20260907120000:25-28`). Any active signed-in account that reaches the action or
  the RPC can clock any eligible member.
- With a member selected, no open session and no clock-out on today's business date, the kiosk offers Clock In
  (`clock.tsx:335-352`). Pressing it opens the selfie step (A12) and then calls `clockInAction`.
- Server order: active-staff check and an empty-id refusal "Select a team member first." (`attendance.ts:158-159`),
  the device gate (A11; `attendance.ts:161-162`), then `kiosk_clock_in(p_staff_id, p_device_id, p_note)`
  (`attendance.ts:165-169`).
- The RPC refuses a target that does not exist ("That team member could not be found.") or is inactive or demo
  ("That team member is inactive and cannot clock in.") (`M/20260907120000:30-37`). It inserts the row with an explicit
  business-date `work_date` (A6; `M/20260907120000:40-47`) and turns a second open session into a friendly error
  (A4; `M/20260907120000:48-50`). It does not refuse a Super Admin target (A14).
- `time_in` is the column default `now()` (`M/20260717120000:26`); the kiosk never sends a time. The BEFORE INSERT
  trigger then sets the night flag (A13).
- On success the domain reads the night flag back on a best-effort basis (`attendance.ts:179-186`), writes the audit
  event `attendance.clock_in` (B9), returns "Clocked in." or a night variant naming the amount
  (`attendance.ts:198-206`), and the action revalidates the page (`actions.ts:91`).
- The read-back runs through the operator's user-scoped client, so `attendance_read` applies: it returns another
  member's row only to the Super Admin or an `hr_review_attendance` holder (`M/20260804140000:8-14`); the code comment
  says the result is "visible to the Owner" (`attendance.ts:179`). For a kiosk operator without
  `hr_review_attendance` who clocks in someone else, `maybeSingle()` returns null and `isOvertime` is false
  (`attendance.ts:180-185`). The night success message is then not shown and `overtime_amount` is left out of the
  audit context (`attendance.ts:192-195, 200-202`), even when the trigger set the flag on the row. The row itself is
  correct; only the message and the audit context depend on who operates the kiosk.
- "First of the day" is not a server concept: Continue Duty (A3) calls the same RPC. There is no schedule, shift
  start, lateness, grace period or undertime logic; late and undertime handling was listed as deferred work and never
  built (`ui-sot:208-212`).
- Grants: the live clock-in migration contains no revoke or grant statement (`M/20260907120000:14-54`). PENDING
  (not live) revokes PUBLIC and anon and grants `authenticated` and `service_role` (`M/20260916120000:487-488`).

WHY IT EXISTS

- The attendance table replaces an unreliable biometric device with a "tamper-evident digital record"
  (`M/20260717120000:4-5`). No comment ties the use of server time to preventing backdating explicitly, although the
  night trigger says the decision is made "from the real clock-in instant, never from client input"
  (`M/20260722200000:4-5`).
- The kiosk roster RPC was added so an account granted `hr_attendance`, not only the Super Admin, can operate the
  kiosk (`M/20260805160000:1-10`). The dropdown shows names only because roles "leaked the org chart onto a shared
  kiosk screen" (`clock.tsx:226-229`).
- Why the write path skips the permission: rationale not documented in the repo. The roster migration assumes the
  clock "already allows any active staff on the approved device" (`M/20260805160000:2-4`).

REUSABLE AS-IS? With changes (GENERIC form, each a RECOMMENDED TEMPLATE IMPROVEMENT):

- enforce the kiosk-operator permission in the server action and inside the clock-in RPC (PERMISSIONS.md section 4.2;
  CONFIGURATION.md section 5 item 9);
- check the device token and the eligibility predicate inside the RPC (A11, A14);
- the operator message and the audit context never depend on a stored flag or on a read-back under the operator's
  RLS: `kiosk_clock_in` returns only the session id (DATABASE.md section 5.13), and any night notice is derived from
  `app_private.is_night_session` under the configured anchor (with the clock-out anchor nothing is known at clock-in);
- ship explicit `revoke ... from public, anon` and `grant execute ... to authenticated, service_role` with the function.

CONFIGURABLE FOR CLIENT? Yes:

- who may operate the kiosk: permission key `attendance.clock_operate` (PERMISSIONS.md section 4.2; CONFIGURATION.md
  section 2.3), granted per member and seeded per role through `permissions.defaultGrants` (list of permission keys);
- `attendance.device.mode`, enum 'off' | 'auto' | 'required' (A11);
- `attendance.selfie.mode`, enum 'off' | 'optional' | 'required' (A12; 'required' is not built and fails configuration
  validation, CONFIGURATION.md section 2.9 rule 8);
- `locale.timezone`, IANA zone name (A6).
- Not configurable: the note length. It is an engine constant that stays in code (CONFIGURATION.md section 4, the
  paragraph after the table; CHECK 500 today, `M/20260717120000:28`; the kiosk never sends a note).
- Schedules, lateness and grace periods are not implemented; CONFIGURATION.md has no key for them.

### A2. Clock Out

CURRENT RULE

- The kiosk offers Clock Out only when the selected member has an open session that the OPERATOR can read
  (`clock.tsx:66-67, 300-318`). The open-session read runs as the operator under RLS (`attendance.ts:111-122`), and
  `attendance_read` returns other members' rows only to the Super Admin or an `hr_review_attendance` holder
  (`M/20260804140000:8-14`). An operator with `hr_attendance` alone is never offered Clock Out for anyone else.
- Flow: selfie step (A12), then `clockOutAction` (`actions.ts:96-105`), then `kioskClockOut`: `requireActiveStaff()`,
  empty-id refusal, device gate, and `kiosk_clock_out(p_staff_id)` (`attendance.ts:210-220`). The RPC takes no device
  parameter. It returns the closed record id, which the kiosk uses to attach the clock-out selfie
  (`actions.ts:100-104`). Audit event `attendance.clock_out` with context `{ for_staff }` (`attendance.ts:229-235`).
- RECONSTRUCTED: `kiosk_clock_out` has no DDL in the repository. Its expected effect is to set `time_out = now()` on
  the member's single open session (the partial index guarantees at most one). Its authorization, error messages,
  security mode and grants are unknown; a migration comment says the clock "already allows any active staff on the
  approved device" (`M/20260805160000:2-4`). NEEDS VERIFICATION:
  `select pg_get_functiondef('public.kiosk_clock_out(uuid)'::regprocedure);`
- No minimum or maximum session length exists in repository-visible code.

WHY IT EXISTS

- Rationale not documented in the repo beyond the page description "Clock in and out." (`attendance-page.tsx:88`).
  The status reads are described as RLS-scoped (`attendance.ts:128`), with no reason given for hiding other members'
  state from a kiosk operator (see A3).

REUSABLE AS-IS? With changes (GENERIC form):

- ship the clock-out RPC DDL (RECOMMENDED TEMPLATE IMPROVEMENT; DATABASE.md section 5.13, function set);
- check the operator permission and the device token inside the RPC (A1, A11);
- serve per-member kiosk status through a permission-scoped definer reader so any kiosk operator sees who is clocked
  in (RECOMMENDED TEMPLATE IMPROVEMENT; DATABASE.md section 5.13, function set);
- flag very long sessions for review (A8).

CONFIGURABLE FOR CLIENT? Yes:

- `attendance.maxSessionHours`, number above 0 or null (flags a long session; never closes it);
- `attendance.device.mode` and `attendance.selfie.mode` as in A1.

### A3. Multiple sessions per day (Continue Duty)

CURRENT RULE

- A day may hold any number of sessions; each `attendance_records` row is one session (`sessions.ts:4-17`).
- When the selected member has no open session and a clock-out whose `work_date` equals today's business date, the
  kiosk offers Continue Duty (`clock.tsx:68-72, 319-334`; last clock-out read `attendance.ts:124-146`). A confirmation
  modal explains that a new session is added and the gap is not counted (`clock.tsx:357-392`); confirming runs the
  same selfie step and the same clock-in action and RPC (`clock.tsx:372-377`). The server does not distinguish a
  continued session.
- No column links sessions. Days are grouped by `staff_profile_id` plus `work_date` (`sessions.ts:65-72`); sessions
  are ordered by `time_in`, numbered from 1, and the second and later are marked `continued` (`sessions.ts:76-83`).
  Off-duty gaps are computed for display and never added to the total (`sessions.ts:93-102`).
- The last-clock-out read is RLS-scoped like the open-session read. An operator without `hr_review_attendance` is
  never offered Continue Duty for another member, but the plain Clock In they see calls the same RPC and creates the
  same second session, so only the confirmation text is lost.
- Tests: `tests/unit/attendance-clock.test.tsx:48-65` (Continue Duty behind a confirmation);
  `tests/unit/attendance-sessions.test.ts:28-45` (gap excluded).

WHY IT EXISTS

- The kiosk comment describes it as "a NEW session on the same attendance day" rather than a duplicate day
  (`clock.tsx:68-69`), and the confirmation text says the gap since the last clock-out is off-duty and not counted
  (`clock.tsx:389-391`). The grouping helper states that a gap is never counted so that the screen and payroll agree
  (`sessions.ts:12-16`).

REUSABLE AS-IS? Yes.

CONFIGURABLE FOR CLIENT? Yes: `attendance.allowMultipleSessionsPerDay`, boolean (true today; CONFIGURATION.md section
2.4, where false needs a refusal inside the clock-in RPC). A maximum number of sessions per day or a minimum gap does
not exist, and CONFIGURATION.md has no key for it.

### A4. Open session limit

CURRENT RULE

- At most one open session (`time_out is null`) per member across ALL dates, enforced by the unique partial index
  `attendance_one_open_session_per_staff on (staff_profile_id) where time_out is null` (`M/20260717120000:41-45`).
- `kiosk_clock_in` turns the `unique_violation` into "That team member is already clocked in. Clock out first."
  (`M/20260907120000:48-50`).
- The index also blocks a second session created by a double tap, a repeated request or a second device.
- pgTAP proves the index exists and a second open insert fails with `23505`, on the direct-insert path, not through
  the kiosk RPC (`pgtap-26:56-61, 82-93`).

WHY IT EXISTS

- "you cannot clock in twice without clocking out" (`M/20260717120000:41-42`).

REUSABLE AS-IS? Yes. This is the core integrity invariant. If the template adds soft delete, the index must ignore
soft-deleted rows (DATABASE.md section 5.3, `attendance_sessions`).

CONFIGURABLE FOR CLIENT? No (engine rule, CONFIGURATION.md section 5 item 1; section 2.4 lists
`attendance.maxOpenSessionsPerEmployee` as fixed 1).

### A5. Overnight shifts and crossing midnight

CURRENT RULE

- A session may cross midnight. The only time constraint is `time_out is null or time_out >= time_in`
  (`M/20260717120000:32`).
- The whole session belongs to the business date of its CLOCK-IN: that is the `work_date` the kiosk stamps
  (`M/20260907120000:45`). It is not split at midnight or at a payroll period boundary. Its full duration counts on
  that date in the day total (`sessions.ts:68, 90-91`) and in payroll hours (`M/20260907160000:39, 44`).
- The review and history lists filter dates on `time_in` (`attendance.ts:615-616`), so the session appears on its
  clock-in day there too.
- Continue Duty looks for a clock-out with `work_date` = today (`attendance.ts:133-137`). After a session that started
  yesterday and ended today, the kiosk offers plain Clock In, which runs the same RPC.
- Payroll night rule effect: payroll judges the night bonus on the CLOCK-OUT time of day,
  `((a.time_out at time zone '<business-tz>')::time >= time '22:00')` (`M/20260907160000:41`). A session from 22:15 to
  00:30 carries the session night flag (clock-in hour 22, A13) but earns no payroll night bonus (00:30 is before
  22:00). A session ending at 23:59 earns it. PAYROLL.md section 4.4 covers the pay side.

WHY IT EXISTS

- Rationale not documented in the repo. Whether a shift ending after midnight is meant to lose the night bonus is
  NEEDS VERIFICATION with the client's policy; the repository cannot settle it.

REUSABLE AS-IS? With changes (GENERIC form): keep clock-in dating as it is, state it as an engine rule, decide
explicitly how a cross-midnight session is paid, and evaluate one night rule in one place (A13; RECOMMENDED TEMPLATE
IMPROVEMENT).

CONFIGURABLE FOR CLIENT? Yes, for night pay only:

- dating is not configurable: `attendance.sessionCrossesMidnightPolicy` is fixed `clock_in_date` (CONFIGURATION.md
  section 2.4) and period membership by `work_date` is an engine rule (CONFIGURATION.md section 5 item 7); splitting a
  session at midnight is not implemented and has no key;
- `payroll.nightRule.anchor`, enum 'clock_in' | 'clock_out';
- `payroll.nightRule.windowEnd`, "HH:MM" or null (lets a clock-out after midnight count as night).

### A6. How `work_date` and the business timezone are assigned

CURRENT RULE

- SQL, kiosk path (live): `kiosk_clock_in` sets `work_date = (now() at time zone '<business-tz>')::date` explicitly
  (`M/20260907120000:40-46`).
- SQL, column default (live): `work_date date not null default current_date` (`M/20260717120000:25`), which the fix
  migration describes as UTC (`M/20260907120000:3`). It applies to any insert that omits `work_date`: the dead
  Super-Admin-only direct clock-in (`attendance.ts:252-304`, no caller) and any direct REST insert (B10).
- PENDING (not live): the default becomes `((now() at time zone '<business-tz>')::date)`; existing rows are not
  rewritten (`M/20260916120000:363-368`).
- TypeScript: "today" is computed with `toLocaleDateString('en-CA', { timeZone })` (`paging.ts:41, 46-48`;
  `attendance.ts:133`). Day bounds for list filters are built from the date plus a FIXED UTC offset string
  (`paging.ts:42-43, 72-80`), which the code justifies because the business zone has no daylight saving
  (`paging.ts:42`).
- Rows written through the kiosk before the clock-in fix may carry the UTC date. The list reader filters on `time_in`
  partly to compensate (`attendance.ts:588-590`); that comment is now stale for new kiosk rows.
- Display: dates show the stored `work_date` string (`paging.ts:166-174`); times render in the VIEWER's browser
  timezone and locale (`paging.ts:176-179`; `clock.tsx:305`). The correction input converts a `datetime-local` value
  with the browser's timezone (`review-view.tsx:674-679, 713`).
- Date bases differ: lists filter `time_in` (`attendance.ts:615-616`), payroll filters `work_date`
  (`M/20260907160000:44`), the workbook export filters `work_date` (`data-export.ts:533`).

WHY IT EXISTS

- The fix migration explains that an early-morning clock-in (for example 07:20 local, 23:20 UTC the day before) was
  "filed one calendar day off its real ... day, which mis-groups the day and can miscount days_worked"
  (`M/20260907120000:3-6`).

REUSABLE AS-IS? With changes (GENERIC form): one tenant timezone setting read by SQL and TypeScript; DST-safe day
bounds computed from the zone, not a fixed offset; one date basis for lists, payroll and export; the column default
set from the setting (RECOMMENDED TEMPLATE IMPROVEMENT).

CONFIGURABLE FOR CLIENT? Yes:

- `locale.timezone`, IANA zone name (read by both layers; the settings row wins, CONFIGURATION.md section 2.2);
- `locale.showTimesInBusinessTimezone`, boolean;
- `review.dateFilterBasis`, enum 'time_in' | 'work_date' (the template default is 'work_date' everywhere).

### A7. Total worked

CURRENT RULE

- Day total = SUM over completed sessions of (`time_out` - `time_in`); never final clock-out minus first clock-in.
  Open sessions contribute 0; gaps are excluded (`sessions.ts:12-16, 90-91`).
- TypeScript rounding: each session is rounded to 2 decimal hours, negative or invalid spans become null
  (`hr-format.ts:8-13`); the day sum is rounded again to 2 decimals (`sessions.ts:90-91`).
- SQL rounding (payroll): per-session hours are left unrounded, `round(coalesce(total_hours, 0), 2)` is applied to the
  period total only (`M/20260907160000:39, 49, 79`). Each on-screen session value can be off by up to 0.005 h, and
  those errors are summed before payroll's single rounding, so the sum of the day totals for a period can differ from
  the payroll total by up to 0.005 h per session: the worst case grows with the number of sessions in the period
  (20 sessions: up to 0.1 h), although the errors usually partly cancel.
- Display: "8h 30m" style (`hr-format.ts:16-21`); a phone card for an open day reads "Completed so far"
  (`records.tsx:420`).
- Hours do not drive pay in the current model (pay is days x daily rate plus night bonuses; PAYROLL.md section 3).
  "Overtime hours" in payroll are `sum(greatest(hours - 8, 0))` per session, for display only
  (`M/20260907160000:50-51`).
- Test: `tests/unit/attendance-sessions.test.ts:28-45` (10 hours, not 12).

WHY IT EXISTS

- "an off-duty gap between sessions is NEVER counted. This mirrors exactly how the database's report_payroll already
  sums hours, so the on-screen total and payroll agree." (`sessions.ts:14-16`)

REUSABLE AS-IS? With changes (GENERIC form): keep the summation rule and round once, in one place, so the screen and
payroll cannot drift (RECOMMENDED TEMPLATE IMPROVEMENT).

CONFIGURABLE FOR CLIENT? No. The summation rule is an engine rule (CONFIGURATION.md section 5 item 3), and the rounding
is fixed: `payroll.rounding.hoursScale` fixed 2 and `payroll.rounding.roundOnce` fixed true (CONFIGURATION.md
section 2.6). A related payroll setting is `payroll.minHoursForDay`, number >= 0 (CONFIGURATION.md section 2.6).
Unpaid-break deduction does not exist, and CONFIGURATION.md has no key for it.

### A8. Missing Clock Out

CURRENT RULE

- Nothing closes a forgotten session: no auto-close, no maximum duration, and no scheduled job references attendance
  (the cron routes under `src/app/api/cron` contain no attendance code).
- The open session stays open across days and blocks that member from clocking in again (A4).
- Payroll ignores it: `where a.time_out is not null` (`M/20260907160000:43`), so it adds no hours and no day.
- The kiosk shows "Clocked in since" plus a time rendered with `toLocaleTimeString()` and no date
  (`clock.tsx:302-306`), so a session opened days ago looks like today's.
- The team summary card "Clocked in now" counts open sessions of any date (`paging.ts:130-131, 141-150`).
- Remedies: (a) clock the member out at the kiosk; the session then spans days and its full span counts on the
  clock-in date (A5); (b) a Super Admin or Admin uses "Set clock-out" in Review Attendance (A9;
  `review-view.tsx:681-686, 723`); (c) delete the session (hard delete, B6). An operator without
  `hr_review_attendance` cannot see another member's open session at the kiosk (A2).

WHY IT EXISTS

- The correction RPC exists so a manager can "CLOSE a forgotten open session (unblocking that staff member from
  clocking in again) ... without discarding the record" (`M/20260907130000:3-5`). The absence of auto-close:
  rationale not documented in the repo.

REUSABLE AS-IS? With changes (GENERIC form): show the date for an open session that did not start today; flag
sessions longer than a threshold for review; keep the no-auto-close behaviour (RECOMMENDED TEMPLATE IMPROVEMENT).

CONFIGURABLE FOR CLIENT? Yes: `attendance.maxSessionHours`, number above 0 or null (flag only, never auto-close;
CONFIGURATION.md section 2.4).

### A9. Corrections

CURRENT RULE

- Only the CLOCK-OUT of one session can be changed, through
  `correct_attendance_clock_out(p_record_id uuid, p_time_out timestamptz, p_reason text)`, SECURITY DEFINER,
  `search_path ''`, EXECUTE revoked from anon and PUBLIC and granted to `authenticated` and `service_role`
  (`M/20260907130000:13-22, 65-68`). Clock-in is never editable; there is no note edit and no "add a missed session".
- Authority is by ROLE, not by permission: UI `canManage` = role owner or selected_admin (`review-page.tsx:35-36`);
  domain `requireOwnerOrAdmin()` (`attendance.ts:405-419`; `guard.ts:325-335`); SQL
  `v_role is null or v_role not in ('owner', 'selected_admin')` refuses (`M/20260907130000:29-33`). The action and RPC
  never check `hr_review_attendance`.
- Validations, in order: reason not blank (client `review-view.tsx:740`, action `actions.ts:174`, domain
  `attendance.ts:421-422`, SQL `M/20260907130000:27, 35-37`); valid date (`attendance.ts:423-426`); record exists
  (`M/20260907130000:39-43`); new time not null, not before clock-in, not in the future (`M/20260907130000:45-53`);
  table CHECK `time_out >= time_in` (`M/20260717120000:32`).
- Not validated anywhere in the repository: overlap with the member's previous or next session, a maximum length, the
  same `work_date`, a changed value, a row lock (the read has no `for update`, `M/20260907130000:39-40`), or an
  issued payslip for the period.
- Effect: UPDATE in place of `time_out`, `edited_by = app_private.current_staff_id()`, `edit_reason`
  (`M/20260907130000:55-59`); the RPC returns the OLD `time_out` (`M/20260907130000:61`), which the app writes into
  the `attendance.clock_out_corrected` audit context (`attendance.ts:447-456`). History effects are in B8.
- The night flag is not recomputed: the trigger fires on INSERT only (`M/20260722200000:46-49`); payroll's clock-out
  night rule does change (A13).
- Minute-truncation defect. The modal prefills `toLocalInputValue(row.timeOut ?? row.timeIn)`, which keeps only
  `YYYY-MM-DDTHH:mm` (`review-view.tsx:674-679, 707`), and submits `new Date(localValue).toISOString()`
  (`review-view.tsx:713`). For an OPEN session, `time_in` normally carries seconds, so an unchanged save is earlier
  than clock-in and the RPC refuses it with "Clock-out cannot be before clock-in." (`M/20260907130000:48-50`). For a
  COMPLETED session, an unchanged save is accepted and silently rewrites `time_out` to the start of its minute while
  stamping `edited_by` and `edit_reason`. A zero-length session results only when `time_in` falls exactly on a whole
  minute. The unit test asserts the prefill shape only (`tests/unit/attendance-clock-out-correct.test.tsx:75-80`).
- Live gap: `app_private.current_staff_role()` does not check `is_active` (`M/20260715130000:47-58`), so a deactivated
  Super Admin or Admin whose JWT is still valid passes the SQL gate (the app layer redirects them,
  `guard.ts:145-147`). PENDING (not live) returns the sentinel 'inactive' (`M/20260916120000:46-57`).
- The table forces RLS (`M/20260717120000:48`); the definer can update a row the caller cannot read only if the
  function owner bypasses RLS. NEEDS VERIFICATION: `proowner` and `rolbypassrls` for the function.

WHY IT EXISTS

- "The only correction available today is a permanent DELETE." The RPC adds "a targeted, audited clock-out
  correction" to close a forgotten session or shorten an over-long one without discarding the record
  (`M/20260907130000:3-5`). Payroll is derived and recomputes; issued payslips are frozen (`M/20260907130000:10-11`).
- Why only clock-out and why by role: rationale not documented in the repo beyond "Authority mirrors
  delete_attendance_record" (`M/20260907130000:7`).

REUSABLE AS-IS? With changes (GENERIC form, all RECOMMENDED TEMPLATE IMPROVEMENT):

- authority from a permission key checked in the RPC, with an explicit NULL branch and an active-profile check;
- one precision, the minute, in the UI, the server action and SQL: prefill an open session with clock-in rounded up
  to the next minute and a completed one with the stored clock-out truncated to its minute; the same minute counts as
  unchanged and is refused; a value that is not a whole minute is refused; Save stays disabled until the minute
  changes (IMPLEMENTATION_PROMPT.md R7 and R8);
- refuse overlaps with adjacent sessions; lock the row while correcting (CONFIGURATION.md section 5 item 13);
- store `edited_at` and write the correction's audit row (old and new value) inside SQL; that append-only row is the
  correction history (B8; DATABASE.md section 5.11; CONFIGURATION.md section 5 item 19);
- compute the night result on read, with no stored flag, so a correction needs no recomputation (A13;
  CONFIGURATION.md section 5 item 14);
- refuse corrections to a locked period when a lock is configured (B7).

CONFIGURABLE FOR CLIENT? Yes, for who may correct and how far back:

- who may correct: permission key `attendance.correct` (PERMISSIONS.md section 4.2; CONFIGURATION.md section 2.3),
  granted per member and seeded per role through `permissions.defaultGrants`;
- `attendance.correction.maxWindowDays`, integer 1 or more, or null (CONFIGURATION.md section 2.4);
- the period lock that also refuses corrections is `payroll.lockPeriodAfterPayslip`, enum 'off' | 'generated' | 'paid'
  (CONFIGURATION.md section 2.6; B7).
- Not configurable: clock-out as the only correctable time (`attendance.correction.allowClockInCorrection` fixed false,
  CONFIGURATION.md section 2.4; engine rule, section 5 item 11); the reason (`attendance.correction.requireReason`
  fixed true, section 2.4; engine rule, section 5 item 12); keeping the old value (engine rule, section 5 item 19);
  the night result (computed on read, section 5 item 14, so there is nothing to recompute).

### A10. Open / Complete status

CURRENT RULE

- Status is DERIVED, never stored: a session is open when `time_out is null`; a day is open when any session is open
  (`sessions.ts:89`); a day's final out is null while open (`sessions.ts:112`).
- Labels differ by screen: the Attendance page shows "Clocked in" and "Completed" (`records.tsx:501-508`); Review
  Attendance shows "Open" and "Complete" (`review-view.tsx:509-515`).
- The status filter applies per SESSION row in SQL (`attendance.ts:618-619`). The whole-day completion query is not
  filtered (`attendance.ts:641-656`), so the Completed tab can show a day badged Open when an open sibling session
  exists.
- The `attendance_records.status` column exists (`M/20260722150000:12`) but no code reads or writes it. No review or
  flag state is stored (`paging.ts:136-139`; `review-view.tsx:70-71`).

WHY IT EXISTS

- "'Open' is a STATUS, not a fake clock-out time" (`records.tsx:44-45`). "Needs Review" is absent because no
  authoritative review state is stored on a record (`review-view.tsx:70-71`).

REUSABLE AS-IS? With changes (GENERIC form): keep the derivation (an engine rule, CONFIGURATION.md section 5 item 5),
use one label set on both screens, and either drop the unused `status` column or give it a defined meaning
(RECOMMENDED TEMPLATE IMPROVEMENT).

CONFIGURABLE FOR CLIENT? Yes, labels only: `review.statusLabels`, object `{ open, completed }` of strings, one set for
both screens (CONFIGURATION.md section 2.5). The derivation itself is not configurable.

### A11. Device approval

CURRENT RULE

- Registration (Super Admin only): the server mints a 32-byte random token (`devices.ts:75`); the RPC stores only its
  SHA-256 hex hash (`M/20260722150000:50-53`); the raw token goes into an httpOnly, secure, sameSite lax cookie, path
  `/`, lifetime one year (`devices.ts:83-89`). TypeScript `requireOwner()` (`devices.ts:69, 104`) and an SQL active
  role-key-owner check (`M/20260722150000:46-48, 75-77`) guard register and revoke.
- One active device: registering first deactivates EVERY active device (`M/20260722150000:49`).
- Gating is on while any active device exists (`M/20260722150000:66-69`). `verify_attendance_device` matches the hash
  among active devices and checks `is_active` only (`M/20260722150000:58-63`).
- Enforcement is in server TypeScript: `requireApprovedDevice` runs before both RPCs (`attendance.ts:28-48, 161, 214`).
  A refused attempt writes audit `attendance.blocked_device`, outcome denied, with the STAFF id as `entity_id`
  (`attendance.ts:36-42`).
- The live database does not enforce it: `kiosk_clock_in` stores whatever `p_device_id` it receives
  (`M/20260907120000:14-54`), and `kiosk_clock_out` takes no device parameter (`attendance.ts:218-220`).
- PENDING (not live): `kiosk_clock_in` refuses a null, unknown or revoked device id while any active device exists
  (`M/20260916120000:451-459`). Residual stated in the migration: a device id is readable in staff's own attendance
  rows, so binding to the token needs a signature change (`M/20260916120000:431-432`). Clock-out stays app-gated.
- Fail-open: with no registered device, any browser may clock and `device_id` is stored NULL (`devices.ts:21-22`); if
  the gating RPC errors, `response.data === true` is false and gating reads as off (`devices.ts:40-41`); revoking the
  last device switches gating off (`M/20260722150000:78`). A missing or invalid cookie fails closed
  (`devices.ts:45-53`).
- The cookie belongs to the browser, not to a user: anyone signed in on that browser passes. Sign-in itself has no
  device gate, derived from the absence of any device check outside the clock path: the sign-in action is a password
  sign-in followed by a redirect (`src/lib/auth/actions.ts:50-127`), and a repository search finds
  `requireApprovedDevice` called only by the clock functions (`attendance.ts:161, 214, 261, 313`) and the device state
  read only for the page banner (`attendance-page.tsx:76`).
- The page shows an informational banner on a non-approved device but does not disable the clock buttons
  (`attendance-page.tsx:81, 91-105`). Revoke is a single submit with no confirmation (`device-manager.tsx:136-146`).

WHY IT EXISTS

- Only one administrator-approved device may clock in or out (`devices.ts:14`). Gating is "NON-BREAKING": until a
  device is registered, clock-in "behaves exactly as before - no one is locked out" (`devices.ts:21-22`;
  `M/20260722150000:1-3`). The raw token is never stored (`M/20260722150000:4`).

REUSABLE AS-IS? With changes (GENERIC form, RECOMMENDED TEMPLATE IMPROVEMENT):

- verify the token hash inside BOTH clock RPCs, not a device id;
- fail closed on a gating-read error; make "gate required" an explicit setting rather than "a device exists";
- allow more than one active device when the client has several sites;
- confirm before revoking; force RLS and declare grants on the device table.

CONFIGURABLE FOR CLIENT? Yes (keys of CONFIGURATION.md sections 2.1, 2.3 and 2.4):

- `attendance.device.mode`, enum 'off' | 'auto' | 'required';
- `attendance.device.failMode`, enum 'open' | 'closed' (governs only the server pre-check once the RPC checks the
  token);
- `attendance.device.maxActiveDevices`, integer >= 1;
- `attendance.device.cookieMaxAgeDays`, integer > 0;
- `attendance.device.defaultLabel`, string;
- who may manage devices: permission key `attendance.devices.manage` (PERMISSIONS.md section 4.2);
- the cookie name prefix: `branding.cookieNamePrefix`, string.
- Not configurable: where the check lives. It belongs inside both kiosk RPCs, bound to the token (engine rule,
  CONFIGURATION.md section 2.4 and section 5 item 10).

### A12. Selfie

CURRENT RULE

- Clock In, Continue Duty and Clock Out all open the front camera (`clock.tsx:106-128`) and wait for Capture. While
  the camera works there is no skip button.
- "Clock in without photo" / "Clock out without photo" appears only when the camera API is missing or permission is
  denied (`clock.tsx:111-115, 124-127, 275-286`). A capture or encode failure also proceeds without a photo
  (`clock.tsx:188-202`).
- The frame is resized to a 1600 px edge and JPEG quality 0.82 (`image.ts:18, 21`).
- The clock action runs FIRST; the selfie uploads afterwards as an `attachments` row related to the record id
  (`clock.tsx:157-166`). An upload failure appends a soft notice and the clock event stands (`clock.tsx:167-173`).
- The server never requires a selfie. The upload accepts any `attendance_record` uuid from any active staff member
  (`upload.ts:72, 78-83`); metadata and storage objects are readable by any active staff member
  (`M/20260716300000:127-129, 159-161`), which the security audit lists as open (`audit-doc:128`).
- In versus out is decided only by the file name: the writer names the file `clock-in-selfie-...` or
  `clock-out-selfie-...` (`clock.tsx:158, 164`), and the reader treats a name containing `clock-out` as the out photo
  (`attendance.ts:553`). When a slot has more than one upload, the photo shown is not deterministic: rows are read in
  `uploaded_at` order (`attendance.ts:531`), but each slot is assigned only after an awaited `createSignedUrl` call
  inside `Promise.all` (`attendance.ts:542-557`), so the upload whose signing call resolves last wins, which is not
  necessarily the latest upload. The columns `clock_in_photo` and `clock_out_photo` exist but are unused
  (`M/20260722150000:8-9`).
- Review reads selfies lazily for the opened day through `loadAttendanceSelfiesAction`, gated on
  `hr_review_attendance` (`actions.ts:45-50`), as 300-second signed URLs with a download disposition
  (`attendance.ts:544-549`).
- Deleting a record leaves its selfie in storage (`attendance.ts:345-346`). No retention job exists in the repository.
  According to the purge script's comment, a live-only storage trigger blocks SQL deletes, so blobs are removed
  through the Storage API with the service-role key (`purge-script:7-9, 49`). No migration defines that trigger:
  NEEDS VERIFICATION (list the non-internal triggers on `storage.objects`).
- Deployment prerequisite: every response carries `Permissions-Policy: camera=(self), ...`
  (`next.config.ts:38, 45-48`). A header that denies the camera to the app's own origin (for example `camera=()`)
  makes `getUserMedia` fail and every clock event falls back to "without photo"; keep `camera=(self)` explicit.
  Whether omitting the header is harmless depends on the browser's default allowlist: NEEDS VERIFICATION in a browser.

WHY IT EXISTS

- "Clock-in itself is never blocked by a camera problem" and the fallback "is honestly labelled"
  (`clock.tsx:19-21`). "The clock action already succeeded; a selfie hiccup is reported softly" (`clock.tsx:167-168`).

REUSABLE AS-IS? With changes (GENERIC form, RECOMMENDED TEMPLATE IMPROVEMENT):

- an explicit in/out kind with a real foreign key, and at most one photo per session and kind, so the photo shown is
  deterministic (DATABASE.md section 5.7, `attendance_photos`; CONFIGURATION.md section 5 item 21);
- read limited to reviewers and the subject, in RLS and storage policies;
- attach only through `attach_attendance_photo`, which requires `attendance.clock_operate`, a caller who is the
  operator recorded on that session for that kind (`clock_in_by` or `clock_out_by`), and a storage path under that
  session prefix for that kind (DATABASE.md section 5.13; IMPLEMENTATION_PROMPT.md PH4);
- a server-side requirement if a 'required' mode is ever built ('required' is not built in the template and fails
  configuration validation, CONFIGURATION.md section 2.9 rule 8);
- a retention decision with a service-role job, and deletion of the photo with its session.

CONFIGURABLE FOR CLIENT? Yes (keys of CONFIGURATION.md sections 2.4 and 2.7):

- `attendance.selfie.mode`, enum 'off' | 'optional' | 'required' ('required' is not built and fails configuration
  validation, CONFIGURATION.md section 2.9 rule 8);
- `attendance.selfie.facingMode`, enum 'user' | 'environment';
- `attendance.selfie.maxEdgePx`, integer > 0, and `attendance.selfie.jpegQuality`, number 0 to 1;
- `retention.selfieRetentionDays`, integer 1 or more, or null;
- `retention.signedUrlTtlSeconds`, integer > 0;
- `retention.deleteSelfieWithRecord`, boolean.
- Not configurable: who may view photos. Reads are limited to the subject and holders of the permission key
  `attendance.review` (CONFIGURATION.md section 2.4; PERMISSIONS.md sections 4.2 and 4.4). The in/out kind is an
  engine rule (CONFIGURATION.md section 5 item 21).

### A13. Night flag on the session versus the payroll night rule

CURRENT RULE

- Session flag. Trigger `attendance_apply_overtime_biu`, BEFORE INSERT only (`M/20260722200000:46-49`):
  `v_hour := extract(hour from (coalesce(new.time_in, now()) at time zone '<business-tz>'))`; when `v_hour >= 22` it
  sets `is_overtime = true` and `overtime_amount = 300.00`, otherwise false and 0, overwriting any client value
  (`M/20260722200000:26-44`). A clock-in from 22:00 to 23:59 is flagged; 00:00 or later is not. An UPDATE never
  recomputes it.
- Uses of the flag: the kiosk success message and the `overtime_amount` field of the `attendance.clock_in` audit
  context (`attendance.ts:188-202`), both fed by a read-back under the operator's RLS, so both are missing when the
  operator lacks `hr_review_attendance` and clocks in someone else, even though the row is flagged (A1); the Review
  "OT" badge and the per-session
  night line, where a day takes the MAXIMUM amount of its sessions, so once per day (`sessions.ts:54-63, 116-118`;
  `review-view.tsx:530-537, 619-623`); the attendance sheet of the workbook export (`data-export.ts:529`).
- Payroll rule. `report_payroll` sets `night_out` when the CLOCK-OUT time of day in the business timezone is at or
  after 22:00 (`M/20260907160000:41`), counts `night_shifts = count(distinct work_date) filter (where night_out)`
  (`M/20260907160000:55`), and pays `night_shifts x app_private.night_ot_bonus()` inside
  `round(days_worked x rate + night_shifts x night_ot_bonus(), 2)` (`M/20260907160000:85-93`).
  `app_private.night_ot_bonus()` is RECONSTRUCTED (no DDL in the repository).
- The two disagree: 14:00 to 22:30 is paid a bonus with no badge; 22:15 to 23:00 shows the badge and is paid; 22:15 to
  00:30 shows the badge and is not paid. A correction that moves `time_out` across 22:00 changes pay but not the
  badge. The correction migration comment says the bonus "keys off clock-in" (`M/20260907130000:9-10`), which matches
  the flag only.
- NEEDS VERIFICATION: whether an out-of-band migration replaced the live trigger body:
  `select pg_get_functiondef('public.attendance_apply_overtime'::regproc);`

WHY IT EXISTS

- The flag is decided "by the DATABASE from the real clock-in instant, never from client input"
  (`M/20260722200000:4-5`). The amount and the 22:00 threshold were registered as provisional, awaiting confirmation by
  the business (`M/20260722200000:70-73`). Once per day: "a day with two late sessions still earns exactly
  one" bonus (`M/20260907160000:53-55`). Why payroll moved to clock-out: rationale not documented in the repo.

REUSABLE AS-IS? No. GENERIC form: choose one night rule, evaluate it in one place (SQL), compute the display flag from
the same rule on read, and never hard-code the amount or threshold. The operator message and the audit context never
depend on a stored flag or on a read-back under the operator's RLS: `kiosk_clock_in` returns only the session id
(DATABASE.md section 5.13), and any night notice is derived from `app_private.is_night_session` under the configured
anchor (with the clock-out anchor nothing is known at clock-in) (RECOMMENDED TEMPLATE IMPROVEMENT; PAYROLL.md section 4;
CONFIGURATION.md section 5 item 14).

CONFIGURABLE FOR CLIENT? Yes (keys of CONFIGURATION.md section 2.6):

- `payroll.nightRule.enabled`, boolean;
- `payroll.nightRule.anchor`, enum 'clock_in' | 'clock_out';
- `payroll.nightRule.thresholdTime`, "HH:MM";
- `payroll.nightRule.windowEnd`, "HH:MM" or null;
- `payroll.nightRule.bonusAmount`, money string, 0 or more. The key is effective-dated and read as in force on the
  session's `work_date`: a change never re-prices earlier days or an issued payslip (CONFIGURATION.md section 1.4;
  DATABASE.md section 5.12);
- `payroll.nightRule.oncePerDay`, boolean.
- Not configurable: having one predicate computed on read, with no trigger and no stored flag (engine rule,
  CONFIGURATION.md section 5 item 14).

### A14. Super Admin and demo account exclusions

CURRENT RULE

- Super Admins (role key owner) are removed from the kiosk roster (`M/20260907160000:24`), from `report_payroll`
  (`M/20260907160000:99`) and from the Employee Rates reader (`rate.ts:137`). `kiosk_clock_in` does NOT refuse an
  owner target (`M/20260907120000:30-37`; PENDING is the same, `M/20260916120000:461-468`), so for clocking the
  exclusion is roster-level only. The Super-Admin-only self clock functions have no caller (`attendance.ts:252-339`).
- Demo accounts (`staff_profiles.is_demo`) are refused as clock-in TARGETS with the message "inactive and cannot clock
  in" (`M/20260907120000:35-37`) and excluded from payroll (`M/20260907160000:98`) and Employee Rates (`rate.ts:136`).
  `list_clock_staff` does not filter `is_demo` (`M/20260907160000:21-25`), so a demo profile is listed and then refused
  with a misleading message. Demo OPERATORS are redirected by `requireActiveStaff()` unless demo login is enabled
  (`guard.ts:149-154`).
- Inactive profiles are excluded from the roster (`M/20260907160000:23`) and payroll (`M/20260907160000:97`) and
  refused as a target.
- Because the review filters are built from the roster, rows of Super Admins and deactivated members still appear
  under "All employees" but cannot be isolated by name search or the employee dropdown (B2).

WHY IT EXISTS

- The Super Admins "do NOT clock in/out and are not on payroll" (`M/20260907160000:3-4`; the comment names real
  people, not copied). Demo accounts stay active so demo login works; "they are simply not real employees"
  (`M/20260722160000:3-4`).

REUSABLE AS-IS? With changes (GENERIC form): one eligibility predicate (active, not demo, not `timekeeping_exempt`)
applied identically in the roster, both clock RPCs, payroll and rates, reading a per-profile flag rather than a role
title (RECOMMENDED TEMPLATE IMPROVEMENT; CONFIGURATION.md section 2.3; DATABASE.md section 5.2, `employees`).

CONFIGURABLE FOR CLIENT? Yes, for roles only:

- `exclusions.excludedRoles`, list of role keys; it sets the `timekeeping_exempt` profile flag at seed time and when a
  profile enters a listed role (CONFIGURATION.md section 2.3).
- Not configurable: the demo exclusion (`exclusions.excludeDemoAccounts` fixed true, applied to the roster as well,
  CONFIGURATION.md section 2.3) and the per-profile flag itself, which is part of the eligibility predicate, not a key.

### A15. No automatic retry of a clock write

CURRENT RULE

- The user-scoped server client installs `createRetryingFetch()` (`server.ts:26-30`). Only GET and HEAD are retried
  (`retry-fetch.ts:58-60, 82`), up to three attempts in total (`retry-fetch.ts:43-44, 75`) on 429, 502, 503 or 504 or
  a thrown network error (`retry-fetch.ts:40, 99-108`).
- Supabase RPCs are POST, so `kiosk_clock_in`, `kiosk_clock_out`, the correction and the delete are never retried
  automatically. The selfie upload is not retried either.
- The kiosk shows the server error (`clock.tsx:151-154`) or "Could not clock in. Please try again." on a thrown error
  (`clock.tsx:181-183`); the operator must press again. Buttons are disabled while pending (`clock.tsx:269, 279, 291`).
- If a clock-in response is lost after the insert succeeded, a repeated press is refused by the one-open-session
  index (A4). The message a repeated clock-out would get is unknown because `kiosk_clock_out` is RECONSTRUCTED.

WHY IT EXISTS

- A POST "may have ALREADY been applied on the server even though its response was lost in transit"; re-sending
  could apply a write twice, so writes and RPCs are never retried, "by design - correctness beats a retry"
  (`retry-fetch.ts:20-29`).

REUSABLE AS-IS? Yes.

CONFIGURABLE FOR CLIENT? No (engine rule, CONFIGURATION.md section 5 item 20).

---

## Part B. Review Attendance workflow (Phase 6)

### B1. How an Admin sees attendance

- Gate: route `/admin/attendance/review` maps to `hr_review_attendance` (`navigation.ts:92`); the server page answers
  404 without it (`review-page.tsx:22`) and then calls `requireActiveStaff()` (`review-page.tsx:23`). Being an Admin
  is not enough: an Admin, or a Staff member, needs the grant; the Super Admin holds it implicitly.
- Data scope: `attendance_read` lets a holder read EVERY attendance row; everyone else reads only their own
  (`M/20260804140000:8-14`).
- First paint: the server reads page 1 of the last 7 days (business today minus 6 through today,
  `paging.ts:57-65`), status all, 25 rows, in parallel with the roster (`review-page.tsx:25-33`).
- Later pages and filter changes: `loadReviewAttendancePageAction`, gated by
  `requirePermission('hr_review_attendance')` (`actions.ts:72-79`). Page sizes 25, 50, 100; default 25
  (`paging.ts:14-16`). `page` and `pageSize` are typed but not validated at runtime.
- Reader: an exact HEAD count, then the page ordered by `time_in desc` with `range`, then a completion query that
  loads every other session of the (member, work date) pairs on the page (`attendance.ts:596-659`). A count error
  returns an empty page (`attendance.ts:626`) and a row error returns no rows (`attendance.ts:635`), so a read failure
  shows the empty state, not an error.
- Day grouping: rows become one entry per member and work date (`sessions.ts:65-129`); a day is shown on the page that
  holds its newest filtered session (`paging.ts:106-125`).
- Counts are SESSION rows: the label reads "Showing <first>-<last> of <N> records" (`review-view.tsx:326-330`) while
  the table shows days, so a page can list fewer than the page size.
- Table columns: Employee, Date, Time (first in -> final out), Total worked, Status, Details
  (`review-view.tsx:357-364`); badges "<n> sessions" and "OT <amount>" appear only when they apply
  (`review-view.tsx:517-540`). Phones get one card per day (`review-view.tsx:403-444`).
- Details modal: per session the number, a "Continued Duty" chip, duration, in -> out or "still clocked in", in and
  out selfie thumbnails, the night line, and (only when `canManage`) "Set/Correct clock-out" and "Delete"
  (`review-view.tsx:547-646`). The reader selects `note` (`attendance.ts:562-563, 574`), but the modal never renders
  it (`review-view.tsx:547-646`). `edited_by`, `edit_reason` and `device_id` are not selected at all
  (`attendance.ts:562-563`), so they cannot be shown.
- Filters live in React state only, not in the URL (`review-view.tsx:90-104`). The team summary cards are on the
  Attendance page, not on Review (`attendance-page.tsx:121`).
- `canManage` is computed from the role (`review-page.tsx:35-36`), but the component prop defaults to `true`
  (`review-view.tsx:81`). The server still guards every write; the default is a hazard for reuse.
- After a correction or delete the client calls `router.refresh()` (`review-view.tsx:697-704, 816-823`). By code
  reading the table reloads (the refreshed roster prop gives the memoised filters a new identity,
  `review-view.tsx:125-133, 142-162`), but the open Details modal keeps the pre-correction day object
  (`review-view.tsx:107, 495-503`). This rests on server-component prop identity: NEEDS VERIFICATION in a browser.

### B2. Filtering

| Filter | Control and default | Applied where | Evidence |
|---|---|---|---|
| Status | tabs Open, Completed, All; default All | SQL on session rows (`time_out` null or not) | `review-view.tsx:72-76, 90`; `attendance.ts:618-619` |
| Date range | Today, Last 7 days (default), This month, Custom | SQL on `time_in` within business-day bounds | `review-view.tsx:63-68, 172-178`; `paging.ts:57-80` |
| Custom dates | two date inputs; clearing one removes that bound | same as above | `review-view.tsx:206-237, 132`; `attendance.ts:615-616` |
| Employee dropdown | "All employees" plus the roster | SQL `staff_profile_id in (...)` | `review-view.tsx:239-257, 127`; `attendance.ts:617` |
| Employee search | text, 300 ms debounce | roster name match gives ids, then SQL `in` | `review-view.tsx:119-133`; `paging.ts:156-163` |
| Page and size | Rows 25/50/100, Previous, Next | SQL `range`; a filter change resets to page 1 | `review-view.tsx:135-140`; `attendance.ts:629-634` |

Details and consequences:

- Dates filter the fixed-offset business-day bounds of `time_in`, not `work_date` (`paging.ts:72-80`). Payroll uses
  `work_date` (`M/20260907160000:44`), so a row whose stored date disagrees with its clock-in day can appear under one
  day in Review and another in payroll (A6).
- The name search is a CLIENT-side substring match against the roster; when both search and dropdown are set their
  ids are intersected; no match sends an explicit empty list and the reader returns an empty page without querying
  (`review-view.tsx:125-133`; `attendance.ts:604`).
- The roster is `list_clock_staff()`, which requires `hr_attendance`, a different key from the page's
  (`M/20260907160000:16-19`). For a reviewer without `hr_attendance` the RPC raises, `listClockStaff` returns an empty
  list (`attendance.ts:102`), the dropdown shows only "All employees", and every name search returns "No records".
- The roster excludes Super Admins and inactive profiles (`M/20260907160000:23-24`); their rows are visible under
  "All employees" but cannot be isolated by name. Demo profiles are included (A14).
- Status is filtered per session, but whole days are rendered from an unfiltered completion set, so the Completed tab
  can show a day badged Open (A10).

### B3. Employee names are hidden from non-Super-Admin reviewers

- The page reader embeds the name with `staff:staff_profiles!staff_profile_id ( full_name )` (`attendance.ts:562-563`).
- `staff_profiles_read` is `app_private.is_owner() or auth_user_id = (select auth.uid())` (`M/20260821140000:21-22`),
  the only later SELECT policy on that table in the repository; there is no reviewer branch.
- For an `hr_review_attendance` holder who is not the Super Admin the embed is null for every other member, so the UI
  renders "-" style placeholders in the Employee column and cards (`review-view.tsx:373, 413`), "Staff" in the Details
  title (`review-view.tsx:564`), and "This staff member" or "this staff member" in the correction and delete dialogs
  (`review-view.tsx:751, 868`). The same embed is used by the Attendance page history and the workbook export
  (`data-export.ts:529, 537-540`).
- Consequence: an Admin who holds the review permission can correct or delete a session without the screen saying
  whose it is. The employee dropdown still lists names only when the reviewer also holds `hr_attendance` (B2).
- NEEDS VERIFICATION only for "has production added another `staff_profiles` SELECT policy?":
  `select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.staff_profiles'::regclass and polcmd = 'r';`
- RECOMMENDED TEMPLATE IMPROVEMENT: serve review rows through a permission-scoped definer reader that returns names,
  mirroring `list_clock_staff` (DATABASE.md section 5.13, function set; PERMISSIONS.md section 4.1 principle 6),
  or add a reviewer branch to the profile read policy.

### B4. What can be reviewed, corrected or deleted, and by whom

Authority for corrections and deletions is ROLE-based, not permission-based. `hr_review_attendance` only opens the
page and widens reads; its seeded description "Review and correct attendance records." (`M/20260729120000:33`)
overstates it.

| # | Capability | Staff | Admin | Super Admin | Enforced where (CURRENT) |
|---|---|---|---|---|---|
| 1 | Open Review, read every row | with `hr_review_attendance` | with `hr_review_attendance` | yes (implicit) | `review-page.tsx:22`; RLS `M/20260804140000:8-14` |
| 2 | See other members' names in rows | no (B3) | no (B3) | yes | `M/20260821140000:21-22` |
| 3 | Open Details and selfies | with the grant | with the grant | yes | `actions.ts:45-50` (storage RLS is wider, A12) |
| 4 | Correct a clock-out | no | yes, by role | yes | UI `review-page.tsx:35-36`; `attendance.ts:405-406`; `M/20260907130000:29-33` |
| 5 | Delete directly on Review | no | yes, by role | yes | UI `review-view.tsx:624-629`; `attendance.ts:352`; SQL RECONSTRUCTED |
| 6 | Delete directly on Attendance | no | no: "Request delete" shown | yes | UI only, `day-details.tsx:138-150` |
| 7 | Request a deletion | button not shown | shown; needs `initiate_high_risk_action` | not shown | `service.ts:502`; `M/20260715130100:566-571` |
| 8 | Decide and execute a request | no | no | yes | `approvals-page.tsx:24`; `service.ts:653`; `M/20260715130100:576-579` |
| 9 | Approve or finalize attendance | not implemented | not implemented | not implemented | B7 |

Notes:

- Rows 4 and 5: the server action and RPC never check `hr_review_attendance`, so an Admin without the grant can still
  correct or delete any record id by calling the action directly. PERMISSIONS.md section 3 has the per-layer detail.
- Row 6 versus row 5 is the delete-path inconsistency (B6): the same Admin is routed to approval on one screen and
  deletes directly on the other, and the server accepts the direct delete from both screens (`attendance.ts:352`).
- Row 7: the request action has no role check of its own (`actions.ts:190-204`); the UI hides the button from Staff.

### B5. Correction workflow (Set or Correct clock-out)

1. A Super Admin or Admin opens Details and presses "Set clock-out" (open session) or "Correct clock-out"
   (`review-view.tsx:717-724`).
2. The modal states the clock-in (and clock-out) in the browser's locale, prefills the new clock-out (A9 defect) and
   requires a reason; Save stays disabled while pending, without a time, or with a blank reason
   (`review-view.tsx:726-796, 740`).
3. The action checks the three fields are present (`actions.ts:169-174`), the domain re-checks the role, trims the
   reason and parses the date (`attendance.ts:405-427`), and the RPC re-checks role, reason, existence and bounds
   (`M/20260907130000:29-53`).
4. The row is updated in place and the old value is returned (`M/20260907130000:55-61`); the app writes
   `attendance.clock_out_corrected` (B9) and revalidates Review, Attendance and Payroll (`actions.ts:179-182`).
5. The modal closes and the page refreshes (`review-view.tsx:697-704`); the open Details modal can still show the old
   times (B1).

Error messages from the RPC: "A correction reason is required.", "That attendance record could not be found.",
"Enter a clock-out time.", "Clock-out cannot be before clock-in.", "Clock-out cannot be in the future."
(`M/20260907130000:35-53`). Gaps that are not validated are listed in A9.

### B6. Deletion

- Hard delete through `delete_attendance_record(p_record_id)` (`attendance.ts:367-370`). RECONSTRUCTED: no DDL in the
  repository; comments say it re-checks role owner or selected_admin in SQL (`attendance.ts:342-344`;
  `guard.ts:320-323`; `M/20260907130000:7`). `authenticated` has no DELETE grant on the table
  (`M/20260717120000:74-75`), so the delete can only happen inside a definer function. NEEDS VERIFICATION:
  `select pg_get_functiondef('public.delete_attendance_record(uuid)'::regprocedure);`
- Confirmation: the client disables the button until `DELETE` is typed (`review-view.tsx:857`) and the action refuses
  any other value (`actions.ts:146-148`).
- No state condition exists in repository code: open or closed sessions, and periods with issued or paid payslips,
  can all be deleted.
- The selfie is left in storage (`attendance.ts:345-346`). The deleted values are not kept anywhere in
  repository-visible code; the audit context is only `{ permanent: true }` (`attendance.ts:383-388`).
- The action revalidates Attendance, Review and Payroll (`actions.ts:153-155`). Stale comments still say attendance is
  never deleted (`attendance.ts:53`; `M/20260717120000:63-64`).
- Delete-path inconsistency between the two screens: Review shows a direct Delete to both Super Admin and Admin
  (`review-view.tsx:624-629, 807-894`); the Attendance page shows the direct Delete only to the Super Admin and a
  "Request delete" button to an Admin (`day-details.tsx:138-150`). Because the server accepts a direct delete from an
  Admin (`attendance.ts:352`), the request path is a UI convention, not a control.
- Request path (Attendance page, Admin): `requestAttendanceDeletionAction` (`actions.ts:190-204`) builds the text
  "Delete attendance record (<name or 'staff'> <separator> <work_date>): <reason>" (`actions.ts:199`;
  `request-deletion.ts:22-26`; `day-details.tsx:141`) and calls `requestOwnerApproval`, which requires `initiate_high_risk_action`
  (`service.ts:502`) and inserts an `owner_approval_requests` row with status `pending_owner_approval`
  (`service.ts:523-535`). Only the Super Admin can open the approvals page (`approvals-page.tsx:24`). Deciding an
  attendance request does not execute it (`service.ts:604-619`); a separate execute step calls
  `delete_attendance_record` (`service.ts:735-739`). Request rows, whose reason carries a name and date, are readable
  by every active staff member (`M/20260715130100:560-561`).
- The request grant fails by default in a fresh install and has one hidden grant path. `initiate_high_risk_action` is
  seeded (`M/20260715120100:78-80`) and used by the insert policy (`M/20260715130100:569`), but it is not in the Manage
  Access catalogue (the Team Management module lists only the three `hr_*` keys, `access-catalogue.ts:124-126`) and no
  migration grants it, so until someone grants it every Admin request fails with an authorization error.
- The only screen that can grant it is the legacy staff console at `/admin/staff` (outside the app, a Super Admin
  session could also write the grant row directly, since the insert policy below allows it). The page renders the console for
  the Super Admin only (`src/app/(app)/admin/staff/page.tsx:31-41, 99`). No sidebar entry points to it: the one link
  is in a header component that nothing renders (`src/components/shell/app-header.tsx:50-57`), so it opens by URL.
  Its "Grant a permission" select lists every value of `PERMISSIONS` the account does not hold
  (`src/components/admin/staff-console.tsx:35, 109, 173-195`), and that list includes this key (`permissions.ts:41`).
  The grant action accepts any `PERMISSIONS` value (`src/lib/authz/actions.ts:38-42, 48-60`), and the domain function
  calls `requireOwner()` and upserts the row into `staff_permission_grants`
  (`src/lib/authz/account-management.ts:35-49`), which the Super Admin's insert policy allows
  (`M/20260715130100:27, 90-91`). A later Manage Access save keeps the grant, because keys outside the catalogue are
  preserved (`src/lib/authz/team-accounts.ts:247-255`). The Admin request path therefore works only after a Super
  Admin grants the key on that legacy page. Whether any such grant exists live is NEEDS VERIFICATION (count only):
  `select count(*) from staff_permission_grants where permission_key = 'initiate_high_risk_action';`
- RECOMMENDED TEMPLATE IMPROVEMENT: one deletion policy for both screens, enforced in the RPC on the permission key
  `attendance.delete` (PERMISSIONS.md section 4.2); ship the delete RPC DDL; remove the photo with its session.
  The request path is a client setting: `attendance.deletion.requestApprovalPath`, boolean (CONFIGURATION.md section
  2.4). When it is true, `attendance.delete.request` is seeded and must appear in the access catalogue
  (CONFIGURATION.md section 2.3), so it is never grantable only from a hidden page; when it is false, no request key
  is seeded and no request control renders.
  PERMISSIONS.md section 4.2 drops the request path by default. Deletion mode is `attendance.deletion.mode`, enum
  'hard' | 'soft', template default 'soft' (DATABASE.md section 5.3, `attendance_sessions`), and the reason is fixed
  required (`attendance.deletion.requireReason` fixed true, CONFIGURATION.md section 2.4).

### B7. Approval and finalization

- There is NO approval, sign-off, flag, finalization or period lock for attendance.
  - The `status` column is unused (A10).
  - "Needs Review" is deliberately absent (`review-view.tsx:70-71`).
  - "payroll from APPROVED attendance only" was listed as deferred work in the UI design record (`ui-sot:208-212`) and
    was never built: `report_payroll` reads every completed session in the period (`M/20260907160000:42-44`).
  - The comment "Review Attendance remains the place for review/approval" (`day-details.tsx:27-28`) describes
    something that does not exist.
- Corrections and deletions remain possible after a payslip is issued; the payslip is a frozen snapshot and silently
  diverges from the recomputed payroll (`M/20260907130000:10-11`; PAYROLL.md section 8).
- The only approval-shaped flow is the Admin delete request on the Attendance page (B6), which goes through the
  generic approvals module, not an attendance review.
- RECOMMENDED TEMPLATE IMPROVEMENT: an optional day-level review table `attendance_day_reviews` with two states,
  pending and approved (DATABASE.md section 5.5), a payroll gate on approved days, and a period lock that the correction
  and delete RPCs respect; the lock reads current payslips and needs no state. Settings (CONFIGURATION.md section 2.6): `payroll.approvalRequired`, boolean,
  default false; `payroll.lockPeriodAfterPayslip`, enum 'off' | 'generated' | 'paid', default 'off'. The defaults keep
  the reference behaviour available.

### B8. How corrections affect history

| Data | Where it is kept (CURRENT) | On a repeated correction |
|---|---|---|
| New `time_out` | same row, UPDATE in place (`M/20260907130000:55-59`) | overwritten |
| Editor | `edited_by` = `app_private.current_staff_id()` (`M/20260907130000:57`) | overwritten: last editor only |
| Reason | `edit_reason` (`M/20260907130000:58`) | overwritten: last reason only |
| Edit time | no `edited_at` or `updated_at` column (`M/20260717120000:22-33`; `M/20260722150000:6-12`) | only the audit event time |
| Old `time_out` | returned by the RPC, written only into the app audit context (`attendance.ts:447-456`) | one event per edit, best effort |
| Deleted row values | not stored; audit context `{ permanent: true }` (`attendance.ts:383-388`) | lost |

- No new row and no version table are written. `edited_by` and `edit_reason` are never displayed (not selected by the
  reader, `attendance.ts:562-563`) and never exported (`data-export.ts:529`).
- A direct table UPDATE that RLS allows (B10) changes times without touching `edited_by` or `edit_reason`; no trigger
  forces them.
- Downstream: payroll is derived and recomputes on the next read, so closing an open session can add a paid day and
  moving `time_out` across 22:00 can add or remove a night bonus (`M/20260907160000:41-55`); the session night flag
  does not change (A13); issued payslips do not change (B7).
- `attendance_records` is in the realtime publication (`M/20260731130000:27`). The app shell mounts one sync provider
  (`src/components/shell/app-shell.tsx:47`) that calls `router.refresh()` on realtime changes to published tables
  (`src/components/shell/dashboard-sync.tsx:19-45, 86-97`). Realtime delivery is filtered by RLS, so lists reload only
  for viewers who can read the changed row: an operator without `hr_review_attendance` is not nudged by another
  member's session. An open Details modal still shows the old values after a refresh (B1).
- RECOMMENDED TEMPLATE IMPROVEMENT: `edited_at`, and an append-only correction history written inside the RPC (old
  value, new value, editor, reason, time), so the trail does not depend on a best-effort app call. The history is the
  correction function's success row in `audit_events`, which is append-only; the template adds no separate
  edit-history table (DATABASE.md section 5.11). Keeping the old
  value is an engine rule, not a configuration key (CONFIGURATION.md section 5 item 19).

### B9. Audit trail

All attendance audit rows in repository-visible code are written by the APP through `recordAuditEvent`. The
repository-visible attendance functions write none (`M/20260907120000:14-54`; `M/20260907130000:13-63`); whether the
RECONSTRUCTED `kiosk_clock_out` and `delete_attendance_record` write any is NEEDS VERIFICATION (`pg_get_functiondef`
queries 1 and 2 in the NEEDS VERIFICATION list). The writer never throws and returns early without a user
(`log.ts:32-38, 49-51, 75-78`), so an action can succeed with no audit row. Each row stores `actor_auth_uid`,
`actor_kind` 'staff', `actor_label` "<full name> (<role key>)", `action`, `entity_type`, `entity_id`, `outcome`
(default succeeded), `reason` and `context` (`log.ts:60-74`). Inserts must be self-attributed by an active staff
member (`M/20260715130100:664-670`).

| Action | Outcomes | Entity | Reason or context | Evidence |
|---|---|---|---|---|
| `attendance.clock_in` | succeeded | record id | context `{ for_staff, overtime_amount }`; the amount only when the RLS-scoped read-back sees the flag (A1) | `attendance.ts:180-196` |
| `attendance.clock_out` | succeeded | record id | context `{ for_staff }` | `attendance.ts:230-235` |
| `attendance.blocked_device` | denied | type attendance_record, id = STAFF id | reason names the blocked event | `attendance.ts:36-42` |
| `attendance.clock_out_corrected` | denied, failed | record id | reason = guard or database message | `attendance.ts:408-416, 436-444` |
| `attendance.clock_out_corrected` | succeeded | record id | context `{ old_time_out, new_time_out, reason }` | `attendance.ts:447-456` |
| `attendance.delete` | denied, failed, succeeded | record id | succeeded: context `{ permanent: true }` | `attendance.ts:354-388` |
| `attendance.device_register` | succeeded | type attendance_device | context `{ label }` | `devices.ts:91-95` |
| `attendance.device_revoke` | succeeded | device id | none | `devices.ts:113-117` |
| `attachment.upload` | failed (storage) | type attendance_record, id = the session (not the attachment) | reason = storage error; `{ purpose, source }` | `upload.ts:119-126` |
| `attachment.upload` | failed (metadata) | same | reason = insert error; context `{ purpose, source, orphanPath }` | `upload.ts:155-162` |
| `attachment.upload` | succeeded | same | context `{ purpose, source, byteSize, path }` | `upload.ts:172-178` |
| `owner_approval.request` | denied | the TARGET: type attendance_record, id = the session | reason = authorization message; no context | `service.ts:504-511` |
| `owner_approval.request` | succeeded | type owner_approval_request, id = the request | reason text; context in the note below | `service.ts:541-553` |
| `owner_approval.decide` | denied | request id | reason = authorization message; no context | `service.ts:572-578` |
| `owner_approval.decide` | succeeded | request id | reason = decision note; context `{ decision, action_kind, executed }` | `service.ts:621-627` |
| `owner_approval.execute` | denied | request id | reason = authorization message; no context | `service.ts:656-662` |
| `owner_approval.execute` | failed (request not approved) | request id | reason = `That request is <status>. Only an approved request can be executed.`; no context | `service.ts:679-687` |
| `owner_approval.execute` | failed (delete RPC error) | request id | reason = database error message; no context | `service.ts:799-806` |
| `owner_approval.execute` | succeeded | request id | context `{ action_kind, target_entity_id, state_revalidated, executes_once }` | `service.ts:823-833` |

- `owner_approval.request` context on success: `{ action_kind, target_entity_id, executed: false,
  requires_owner_decision: true }` (`service.ts:546-552`). On denial the row names the attendance record itself, so
  a denied request appears in the trail against the session, while a successful request appears against the request.
- Some approval outcomes write no audit row: a decide whose update matches no pending request (`service.ts:597-602`),
  an execute on a request that is not found (`service.ts:677`) or already executed (`service.ts:691-697`), and an
  execute whose "mark executed" update fails after the delete ran (`service.ts:819-821`).
- Who can read: live policy lets any active staff member read every audit row, including correction reasons and
  amounts (`M/20260715130100:661-662`). PENDING (not live) narrows reads to the Super Admin, the Admin role title,
  `view_settings` holders, and order-history rows for everyone (`M/20260916120000:290-298`).
- No attendance-specific audit screen exists. Two general views show attendance rows among everything else:
  - The Recent Activity panel on Settings > Live Operations, a page that opens only for the Super Admin
    (`live-ops-page.tsx:28-31`). It is collapsed by default and loads on demand (`activity-panel.tsx:56-58, 77`),
    then lists the latest 100 `audit_events` rows of any action, newest first (`dashboard-service.ts:409-416`). Each
    row shows the action, entity type, outcome, actor label, time and reason (`activity-panel.tsx:137-156`). The
    context is not selected (`dashboard-service.ts:414`), so the old and new clock-out values, the correction reason
    (a successful correction stores it in the context, not in `reason`, `attendance.ts:447-456`), amounts and
    `for_staff` are hidden; there is no attendance filter.
  - The Super-Admin-only "Audit Log" sheet of the workbook export, which includes the context
    (`data-export.ts:935-945`).
- The server action behind the panel, `listRecentActivityAction`, has no guard of its own (`live-ops-actions.ts:51-53`);
  the page gate protects only the screen. What any caller of the action receives is decided by the `audit_read` RLS
  policy, which live admits every active staff member (`M/20260715130100:661-662`).
- RECOMMENDED TEMPLATE IMPROVEMENT: write success audit rows inside the RPCs, in the same transaction as the change,
  and refusal rows by a typed refusal (the RPC returns instead of raising) or by the server layer after the error
  returns, never by inserting and then raising (SERVER_API.md section 9.1 rule 8); use a staff or
  device entity type for blocked-device events, keep money out of audit context unless configured
  (`audit.payloadIncludesAmounts`, boolean, CONFIGURATION.md section 2.7), guard every audit-reading server action on
  the server, and restrict audit reads in the read policy. Read access is not a configuration key (CONFIGURATION.md
  section 2.7; DATABASE.md section 5.11, `audit_events`).

### B10. What Staff can and cannot modify

App layer (CURRENT):

- A Staff member cannot correct or delete: the controls are hidden and the server refuses by role
  (`review-page.tsx:35-36`; `attendance.ts:352, 405-406`; `M/20260907130000:29-33`).
- With `hr_review_attendance`, a Staff member can open Review, read every row and every selfie (B4 rows 1 and 3).
- Any active staff member who can reach the clock server actions can clock any active, non-demo member in or out: the
  write path checks only active staff (A1). With a registered device the TypeScript device gate still applies.
- Any active staff member can attach an image to any attendance record id (`upload.ts:72, 78-83`;
  `M/20260716300000:137-142`). Review shows one upload per in/out slot, chosen by whichever signing call resolves
  last, so an extra upload whose file name contains `clock-out` (or does not) can replace the photo a reviewer sees
  (`attendance.ts:531, 542-557`; A12).
- Request deletion: hidden from Staff in the UI; the action itself has no role check and depends on
  `initiate_high_risk_action` (B6).

Database layer (repository view; NEEDS VERIFICATION against the live catalog):

- `attendance_insert` allows a signed-in member to insert rows for their own profile
  (`with check (staff_profile_id = app_private.current_staff_id())`, `M/20260717120000:59-61`).
- `attendance_update` allows updating any column of their own rows (the Super Admin: any row), with a table-wide
  `grant select, insert, update ... to authenticated` and no column restriction (`M/20260717120000:65-75`).
- The night trigger fires on INSERT only (`M/20260722200000:46-49`), so an update can change `is_overtime` and
  `overtime_amount`. Remaining limits are the CHECKs (`time_out >= time_in`, `overtime_amount >= 0`), the
  one-open-session index and the `edited_by` foreign key.
- Effect if live: a member calling the REST API directly could create or rewrite their own sessions (for example
  backdate `time_in`), bypassing the kiosk, the device gate, the selfie and the audit log, and feeding payroll.
- `app_private.current_staff_id()` does not check `is_active` (`M/20260715130000:28-39`), so the self branches also
  work for a deactivated account whose JWT is still valid. PENDING does not change any of this.
- There is no DELETE grant (`M/20260717120000:75`; `pgtap-26:47-51`).
- Verification (read-only):
  `select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) from pg_policy where polrelid = 'public.attendance_records'::regclass;`
  plus `information_schema.role_table_grants` and `information_schema.column_privileges` for `attendance_records`, and
  `select tgname from pg_trigger where tgrelid = 'public.attendance_records'::regclass and not tgisinternal;`
- RECOMMENDED TEMPLATE IMPROVEMENT: no INSERT, UPDATE or DELETE policy or grant for `authenticated` on attendance
  sessions; every write through definer RPCs that check the permission, the device and the target (DATABASE.md
  section 5.3, `attendance_sessions`; CONFIGURATION.md section 5 item 8; PERMISSIONS.md section 4.1 principle 4).

### B11. Generic workflow adapted to the real behaviour

GENERIC workflow. The five stages below are the reusable form; each row sets the CURRENT behaviour of the reference
implementation against that stage, and the Status column says how much of the stage exists. Stage 4 is NOT
IMPLEMENTED and is a RECOMMENDED TEMPLATE IMPROVEMENT (B7).

```
Employee session  ->  Review  ->  Correction (if authorized)  ->  [Approval / Final]  ->  Payroll
   kiosk clock          Review page    clock-out only, by role        NOT IMPLEMENTED        derived on read
```

| Stage | CURRENT behaviour | Status | Honest gap |
|---|---|---|---|
| 1. Employee session | kiosk clock in and out; server time; one open session; optional selfie (A1-A4, A12) | PARTIAL | permission and device not enforced in the DB; own-row writes open (B10) |
| 2. Review | server-paged day view with filters and selfies (B1-B2) | PARTIAL | no review state; names hidden from non-Super-Admin reviewers (B3); read errors look empty |
| 3a. Correction | clock-out only, Super Admin or Admin by role, reason required, in place (A9, B5) | PARTIAL | no clock-in fix, no overlap check, minute truncation, shallow history (B8) |
| 3b. Deletion | hard delete; Admin request path fails by default (key grantable only on a hidden legacy page) (B6) | PARTIAL | inconsistent screens; deleted values and selfie retention not handled |
| 4. Approval / Final | none (B7) | NOT IMPLEMENTED | RECOMMENDED TEMPLATE IMPROVEMENT: optional day review and period lock |
| 5. Payroll | `report_payroll` reads every completed session on each read; payslips are frozen | IMPLEMENTED (no gate) | later corrections diverge from issued payslips (PAYROLL.md) |

Honest gaps against the GENERIC review workflow:

1. No stored review, flag, approval or lock state; payroll uses every completed session.
2. Corrections and deletions are allowed after payslips are issued, with no warning.
3. Correction covers the clock-out only; there is no clock-in correction and no way to add a missed session.
4. Authority for correction and deletion comes from the role title, not from `hr_review_attendance`.
5. The two screens disagree on how an Admin deletes, and the request key cannot be granted from Manage Access, only
   from a hidden legacy console (B6).
6. History keeps only the last editor and reason on the row; old values live only in best-effort app audit rows;
   deleted values are not kept.
7. Non-Super-Admin reviewers see no employee names, and a reviewer without `hr_attendance` cannot filter by employee.
8. The review "OT" badge and the payroll night bonus follow different rules.
9. Counts are sessions while the table shows days; read failures render as empty results.
10. Repository RLS lets members write their own attendance rows directly (live state NEEDS VERIFICATION).

### B12. RECOMMENDED TEMPLATE IMPROVEMENTS (attendance and review, consolidated)

None of these is a change to the production system. Each names the rule it comes from and the sibling document that
carries the design.

Clocking integrity

1. Enforce the kiosk-operator permission `attendance.clock_operate` in the server actions and inside both clock RPCs
   (A1; PERMISSIONS.md 4.2; CONFIGURATION.md section 5 item 9).
2. Ship full DDL, grants and pgTAP tests for the clock-out and delete RPCs, which are RECONSTRUCTED today (A2, B6;
   DATABASE.md 5.13, function set; TESTING_CHECKLIST.md).
3. Remove direct INSERT and UPDATE on attendance sessions for `authenticated`; write only through definer RPCs (B10).
4. Add an active-profile check to every self branch and a NULL-safe, active-aware role or permission gate to every
   definer function (A9, B10).
5. Serve per-member kiosk status (open session, last clock-out today) through a permission-scoped definer reader so
   every kiosk operator can clock members out (A2, A3; DATABASE.md 5.13, function set).
6. Keep the no-automatic-retry rule for writes and document it as an engine rule (A15).

Sessions, dates and totals

7. One tenant timezone setting read by SQL and TypeScript; DST-safe day bounds; column default from the setting (A6).
8. One date basis for lists, payroll and export (A6, B2; `review.dateFilterBasis`).
9. Round worked hours once, in one place (A7).
10. Show the start date of an open session that did not start today; flag sessions beyond `attendance.maxSessionHours`
    for review, never auto-close (A8).
11. Keep clock-in dating of a cross-midnight session as an engine rule (CONFIGURATION.md section 5 item 7) and
    configure how such a session is paid (`payroll.nightRule.windowEnd`; A5).

Night rule

12. One night rule, evaluated in SQL, with the display flag derived from the same rule; no hard-coded threshold or
    amount; correct kiosk and payslip wording (A13; PAYROLL.md 4). The operator message and the audit context never
    depend on a stored flag or on a read-back under the operator's RLS: `kiosk_clock_in` returns only the session id
    (DATABASE.md section 5.13), and any night notice is derived from `app_private.is_night_session` under the
    configured anchor (with the clock-out anchor nothing is known at clock-in) (A1).

Device

13. Token-bound device check inside both clock RPCs; fail closed; explicit gate mode; N active devices; confirmation
    on revoke; forced RLS on the device table; a staff or device entity type for blocked attempts (A11, B9).

Selfie

14. Explicit in/out photo kind with a foreign key and at most one photo per session and kind, so the photo shown is
    deterministic; reviewer-and-subject read policies; attach only through `attach_attendance_photo`, which requires
    `attendance.clock_operate`, a caller who is the operator recorded on that session for that kind (`clock_in_by` or
    `clock_out_by`), and a storage path under that session prefix for that kind (DATABASE.md section 5.13;
    IMPLEMENTATION_PROMPT.md PH4); server-side requirement when configured; retention job and deletion with the session
    (A12; DATABASE.md 5.7, `attendance_photos`).
15. Document the camera Permissions-Policy header as a deployment prerequisite (A12).

Exclusions

16. One eligibility predicate (active, not demo, not `timekeeping_exempt`) applied to the roster, both clock RPCs,
    payroll and rates; fix the roster listing demo profiles (A14; DATABASE.md 5.2, `employees`).

Review visibility

17. Return employee names through a permission-scoped reader, or add a reviewer branch to the profile read policy
    (B3).
18. Give the review page a roster that does not require `hr_attendance` (B2).
19. Show read errors as errors, not as empty results; label counts as sessions or count days (B1).
20. Default `canManage` to false and derive it from permissions on the server (B1).
21. Keep one set of status labels for both screens; drop or define the unused `status` column (A10).

Correction

22. Permission-based correction authority checked in the RPC (A9, B4).
23. Fix the minute-truncation prefill, treat the same minute as unchanged, refuse a value that is not a whole minute,
    and disable Save until the minute changes (A9).
24. Refuse overlaps with adjacent sessions; lock the row during the update (A9).
25. Store `edited_at` and an append-only correction history inside the RPC (the correction's own audit row, DATABASE.md
    section 5.11); show correction markers in Review
    (A9, B8).
26. Decide whether a clock-in correction or an "add missed session" action is in scope; if it is, ship it as a
    separate audited RPC, not a flag (A9; CONFIGURATION.md section 5 item 11).

Deletion

27. One deletion policy for both screens, enforced in the RPC on `attendance.delete` (PERMISSIONS.md 4.2); the
    request path is `attendance.deletion.requestApprovalPath` (CONFIGURATION.md 2.4): when true,
    `attendance.delete.request` is seeded and listed in the access catalogue (CONFIGURATION.md 2.3); PERMISSIONS.md
    4.2 drops the request path by default (B6).
28. Prefer soft delete with a reason (`attendance.deletion.mode`); keep deleted values; remove or retain the photo by
    policy (`retention.deleteSelfieWithRecord`) (B6; DATABASE.md 5.3, `attendance_sessions`).

Approval, lock and audit

29. Optional day-level review with a payroll gate and a period lock respected by correction and deletion (B7;
    DATABASE.md 5.5, `attendance_day_reviews`; `payroll.approvalRequired`, `payroll.lockPeriodAfterPayslip`).
30. Write attendance audit rows inside the RPCs; restrict audit reads in the read policy (DATABASE.md 5.11,
    `audit_events`; not a configuration key, CONFIGURATION.md 2.7); guard every audit-reading server action on the server; keep money out of audit
    context unless `audit.payloadIncludesAmounts` is true (B9).

Comments and tests

31. Refresh stale comments before copying code: the Attendance page docstring calls clocking self-service
    (`attendance-page.tsx:34-35`) and its header says only the Super Admin sees all (`attendance-page.tsx:88`);
    "Attendance is never deleted" (`attendance.ts:53`); selfies "RLS-scoped exactly like the records"
    (`attendance.ts:469-470`); the correction migration's clock-in night comment (`M/20260907130000:9-10`).
32. Replace the stale pgTAP suite (it reads `hourly_rate` from `report_payroll`, `pgtap-26:142-148`) with behavioural
    tests for the clock RPCs, the device gate, roster exclusions, correction and deletion; keep file-content tests for
    unapplied migrations (`tests/unit/security-hardening.test.ts:218-286` pins the PENDING device refusal); extend the
    authorization sweep to RPC-only writers, since its write detector matches only insert, update and delete calls
    (`tests/integration/phase11-authorization-boundary.test.ts:27-31`).

---

## NEEDS VERIFICATION (read-only checks for whoever owns the correct project)

Run only against the project that owns the reference data; the connected accounts in this workspace belong to a
different client.

1. `kiosk_clock_out` body, security mode, grants and messages:
   `select pg_get_functiondef('public.kiosk_clock_out(uuid)'::regprocedure);`
2. `delete_attendance_record` body and role gate:
   `select pg_get_functiondef('public.delete_attendance_record(uuid)'::regprocedure);`
3. Live policies, grants, column privileges and triggers on `attendance_records` (B10 queries).
4. Whether production has a second `staff_profiles` SELECT policy (B3 query).
5. Whether any grant of `initiate_high_risk_action` exists (B6 count query).
6. Function owner (`proowner`) and that role's BYPASSRLS attribute for the definer functions that write the forced-RLS
   table:
   `select p.proname, r.rolname, r.rolbypassrls from pg_proc p join pg_roles r on r.oid = p.proowner`
   `where p.proname in ('kiosk_clock_in', 'kiosk_clock_out', 'correct_attendance_clock_out', 'delete_attendance_record');`
7. Live trigger function body for the night flag (A13 query) and `app_private.night_ot_bonus()` (PAYROLL.md).
8. Browser check for B1: correct a record and confirm the table row updates while the open Details modal keeps the
   old times.
9. Whether a shift ending after midnight is meant to lose the night bonus (A5): a policy question for the client.
10. Whether the storage trigger that blocks SQL deletes of selfie blobs exists live (A12):
    `select tgname from pg_trigger where tgrelid = 'storage.objects'::regclass and not tgisinternal;`

---

## PROJECT-SPECIFIC values removed from this template

This is the only place in this document where the source system's timezone, currency and naming literals appear.
None of them may be copied into another client's system.

| Item | Reference value | Where it lives | Template replacement |
|---|---|---|---|
| Business timezone | `Asia/Manila` (`<business-tz>` above) | `paging.ts:41`; `attendance.ts:133`; `M/20260722200000:34`; `M/20260907120000:45`; `M/20260907160000:41` | `locale.timezone` |
| Fixed UTC offset | `+08:00` | `paging.ts:42-43` | computed from `locale.timezone` |
| Clock-in migration file name | `20260907120000_kiosk_clock_in_manila_work_date.sql` | `supabase/migrations/` | neutral file name |
| Business-date helper module | `src/lib/format/manila-date.ts` | used by the payroll page defaults | city-neutral helper names |
| Currency | peso sign on screen (`<cur>` above), `PHP` in PDFs; kiosk message amount | `attendance.ts:201, 298` | `locale.currencySymbol`, `locale.currencyCode` |
| Night amount and threshold | 300.00 at 22:00, provisional | `M/20260722200000:35-37, 70-73`; `M/20260907160000:41` | `payroll.nightRule.*`, client policy |
| Device cookie name | `av_att_device` | `devices.ts:27` | `branding.cookieNamePrefix` |
| Device wording | "shop phone", "approved shop phone", label "Shop phone" | `devices.ts:14, 94`; `attendance.ts:41, 46`; `M/20260722150000:51` | `attendance.device.defaultLabel`, UI labels |
| Governing spec reference | "Bible section F": 12 references in 4 attendance and payroll migrations, 1 in an unrelated one; not in the repo | migration comments | removed; policy per client |
| Super Admin exclusion decision | an owner decision dated 2026-09-07; the comment names real people (not copied) | `M/20260907160000:1-7` | `exclusions.*`, decided per client |
| Demo account seed | one-off back-fill from an auth email pattern on a test domain (pattern not copied) | `M/20260722160000:10-15` | the `is_demo` flag stays; the seed does not |
| Biometric replacement motive | the attendance module replaced the business's biometric device | `M/20260717120000:4-5` | client-specific context |
| Approvals queue location | the generic approval queue lives in the fulfillment module and mixes business kinds | `service.ts:33-48, 735-739` | a neutral approvals module |
| Selfie purge script | embeds a production project URL and a key-handling runbook (not copied) | `purge-script` | a service-role retention job without embedded ids |
