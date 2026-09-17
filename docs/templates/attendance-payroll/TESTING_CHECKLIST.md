# Attendance and Payroll Template: Testing Checklist (Phase 16)

This checklist is the test contract for the reusable Attendance, Review Attendance and Payroll template. It inventories
what the reference implementation already tests and states what each existing case becomes in the template, lists the
behaviours that no test covers today (each one becomes a REQUIRED test), gives manual scripts per role with the expected
result of every step, lays out the automated plan (unit, database, integration, UI, responsive, print and PDF), and ends
with a security regression checklist. Every expected result is tied to the reference code by `file:line`. Where the
reference implementation is known to be wrong, the item records the CURRENT behaviour and states what the template must
assert instead, as a RECOMMENDED TEMPLATE IMPROVEMENT, so nothing is silently "fixed" in prose.

## How to read this

- Labels (used exactly as defined):
  - CURRENT: how the reference implementation behaves, cited `file:line`.
  - GENERIC: the reusable form the template implements and tests.
  - PROJECT-SPECIFIC: tied to the source business; collected in section 7, which removes those identifiers from the
    template. CURRENT rows in the key facts and in sections 1 to 4 may still quote this client's pay values (the flat night
    amount, the 22:00 threshold) because they describe how the reference behaves; the template reads them from configuration.
  - CONFIGURABLE: should become a client setting (schema in CONFIGURATION.md).
  - NEEDS VERIFICATION: the repository cannot settle it; the item says what would.
  - RECONSTRUCTED: a live database object (table, column, function or policy) whose DDL is missing from the repository.
  - PENDING (not live): content of migrations 20260916120000, 20260916130000 or 20260917120000, written but not applied.
    The label is always written in full in this document.
  - RECOMMENDED TEMPLATE IMPROVEMENT: a gap in the reference implementation that the template fixes (never a change to
    production). Every item whose template assertion differs from CURRENT behaviour carries this label.
- REQUIRED marks a test the template must ship before it is considered complete.
- Every item is a checkbox line; indented lines under a checkbox belong to that item. A box is ticked when:
  section 1, the existing case has been carried into the template suite with its disposition applied; sections 2, 4
  and 5, the test exists in the template build and passes; section 3, the step was run and matched the expected result
  (or the CURRENT difference was recorded); section 6, the query was run and its answer recorded.
- Dispositions (section 1 only): KEEP = port the case as it is, with synthetic fixtures. PARAM = port it, but drive the
  hard-coded value (timezone, currency, labels, night rule) from configuration. REWRITE = keep the intent, change the
  assertion or the path it exercises. REPLACE = the case asserts reference behaviour the template changes; the named item
  holds the new assertion. DROP = legacy behaviour the template does not carry.
- Id prefixes: T (behaviours with no test), M (manual preparation), S / K / A / SA (manual scripts), U / D / I / V / W / P
  (automated plan), Z (security), N (verification queries). No id starts with R, because DATABASE.md uses R ids for
  RECONSTRUCTED objects. Every other id set here is local too and may repeat a letter used elsewhere (for example the D,
  V, A, S, T and P ids of other documents); a reference to another document's id always names that document, for example
  IMPLEMENTATION_PROMPT.md T3.
- Roles: Super Admin (role key owner), Admin (role key selected_admin), Staff (role key staff). The Super Admin holds every
  permission key implicitly (`src/lib/authz/guard.ts:178-180`; `src/lib/authz/permissions.ts:131`). Admin and Staff hold
  only explicit grants (`permissions.ts:132`), and an unreadable grant list means no permissions (`guard.ts:189-192`).
- Permission keys: hr_attendance (open the Attendance page and read the kiosk roster), hr_review_attendance (open Review
  and read every attendance row), hr_payroll (open Payroll). Sections 1 to 3 use these reference keys. When testing a
  template build, substitute the GENERIC keys mapped in PERMISSIONS.md section 4.2 and the default grants of its section 5.
- Paths are repository-relative. A migration citation such as `20260907130000:29-33` means lines 29-33 of the file in
  `supabase/migrations/` whose name starts with that timestamp.
- Companion documents own their subjects and are not repeated here: DATABASE.md (tables, functions, generic model and its
  function set in section 5.13), PERMISSIONS.md (capability matrix, keys, enforcement contract), PAYROLL.md (formulas,
  payslips, summary), UI_UX.md (screens, states, and the component names used in 4.4), CONFIGURATION.md (settings), and
  IMPLEMENTATION_PROMPT.md (the build brief these tests validate).

### Key facts every section relies on

- [ ] Clocking is a shared kiosk, not self-service: a signed-in operator holding hr_attendance picks a member from
  `list_clock_staff` and clocks that member (`src/components/hr/attendance-clock.tsx:137-150`; `src/lib/hr/actions.ts:85`).
- [ ] One open session per member, enforced by a unique partial index (`20260717120000:41-45`). One row per session.
- [ ] `work_date` is the business-timezone date at clock-in (`20260907120000:40-46`).
- [ ] A day's total is the sum of its completed sessions; gaps are not counted (`src/lib/hr/sessions.ts:90-91`).
- [ ] Two different night rules exist. Session flag: a clock-in hour at or after 22 sets a flat 300 through a BEFORE
  INSERT trigger (`20260722200000:26-49`). Payroll: distinct work dates with a clock-out at or after 22:00, times
  `app_private.night_ot_bonus()` (`20260907160000:41, 53-55, 85-93`; the function is RECONSTRUCTED).
- [ ] Pay = round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2), NULL when there is no rate
  (`20260907160000:86-93`).
- [ ] Deductions are a single lump sum at or above zero, entered at payslip generation
  (`src/lib/hr/payslip-actions.ts:49-55`; `20260722210000:27, 93`).
- [ ] A payslip is a frozen snapshot whose payment_status goes pending then paid (`20260722210000:29-30`;
  `payslip-actions.ts:124-135`). There is no approval or finalization step for attendance and no period lock.
- [ ] Only the clock-out can be corrected: Super Admin or Admin by role, reason required, in-place update, and the old
  value survives only in a best-effort app audit event (`20260907130000:29-61`; `src/lib/hr/attendance.ts:447-456`).
- [ ] Delete is a hard delete through `delete_attendance_record`, which is RECONSTRUCTED (`attendance.ts:341-347`).
- [ ] Device approval is a hashed token in an httpOnly cookie (`src/lib/hr/devices.ts:75-89`; `20260722150000:52`),
  enforced in server TypeScript only (`attendance.ts:28-48`). The live database has no check; PENDING (not live) adds a
  clock-in check (`20260916120000:451-459`). The gate is open while no device is registered (`20260722150000:66-69`).
- [ ] Exclusions: Super Admins (role key owner) are left out of the kiosk roster, payroll and Employee Rates; demo accounts
  are left out of payroll and Employee Rates and refused as a clock-in target. CURRENT `list_clock_staff` still lists demo
  accounts (`20260907160000:21-25`) and `kiosk_clock_in` accepts a Super Admin target (`20260907120000:30-37`); both are
  RECOMMENDED TEMPLATE IMPROVEMENT items (T4).

---

## 1. Existing test inventory of the reference implementation

- [ ] Runner (CURRENT): Vitest with jsdom for every file (`vitest.config.ts:9`), including `tests/**/*.test.ts` and
  `tests/**/*.test.tsx` (`:12`) and excluding `tests/e2e/**` (`:22`). No browser end-to-end test exists.
- [ ] Runner (CURRENT): pgTAP suites run with `npx supabase test db` (`docs/SYSTEM-AUDIT-2026-09-16.md:363`); the audit
  could not run the pgTAP lifecycle suite in its environment (`:276-277`). Template: pgTAP runs in CI after a clean reset.
  RECOMMENDED TEMPLATE IMPROVEMENT.

### 1.1 pgTAP: `supabase/tests/26_hr_attendance.test.sql` (`plan(19)` at `:9`)

Fixtures are synthetic ids and test-domain addresses (`:12-23`); `pg_temp.act_as` sets the role and JWT claims (`:25-31`).

- [ ] 1 `:36` DROP. The legacy `staff_profiles.hourly_rate` column exists; it is no longer the pay basis (`src/lib/hr/rate.ts:146-147`).
- [ ] 2 `:41-46` KEEP. RLS is enabled and forced on `attendance_records`.
- [ ] 3 `:47` KEEP. `authenticated` has SELECT on `attendance_records`.
- [ ] 4 `:48` REPLACE. `authenticated` has INSERT; the template asserts it does not (Z5). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] 5 `:49` REPLACE. `authenticated` has UPDATE; the template asserts it does not (Z5). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] 6 `:50-51` KEEP. `authenticated` has no DELETE privilege.
- [ ] 7 `:56-61` KEEP. The partial unique index `attendance_one_open_session_per_staff` exists; add the behavioural D1.
- [ ] 8 `:66` KEEP. `report_payroll(date, date)` exists.
- [ ] 9 `:67-71` KEEP. `report_payroll` is SECURITY INVOKER (update if DATABASE.md section 5.13 changes the mode).
- [ ] 10 `:72-76` KEEP. `anon` cannot execute `report_payroll`.
- [ ] 11 `:82-86` REPLACE. A Staff member inserts an own open session by direct INSERT; template asserts refusal (D1, D2, Z5).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] 12 `:87-93` REWRITE. A second open session fails with 23505; re-express through `kiosk_clock_in` and its message (D1).
- [ ] 13 `:100-105` KEEP. Another Staff member sees 0 of those rows.
- [ ] 14 `:109-114` KEEP. The Super Admin sees the row.
- [ ] 15 `:122-126` DROP. The Super Admin updates the legacy `hourly_rate`.
- [ ] 16 `:127-132` DROP. The stored legacy rate equals 100.00.
- [ ] 17 `:134-140` REWRITE. A negative legacy rate fails with 23514; assert the same refusal on the rate table and RPC (D15).
- [ ] 18 `:142-148` REPLACE (stale). Reads `hourly_rate` from `report_payroll`, which now returns `daily_rate` (`20260907160000:30`); use D10.
- [ ] 19 `:153-163` REWRITE. A Staff update of the legacy rate affects 0 rows; assert the rate RPC gate instead (D15).

### 1.2 pgTAP: `supabase/tests/06_owner_device_mfa.test.sql` (`plan(29)` at `:5`)

- [ ] NOTE. Contains no attendance assertion. Its device cases (`:160-219`) target the login-device registry `trusted_devices`.
- [ ] NOTE. `:260-263` pins `role_device_limits.enforcement_implemented` as false; it is not the attendance device gate.
- [ ] KEEP as context only: it pins the three-role model the HR role gates depend on.

### 1.3 Vitest cases on the three screens (66 cases; Testing Library for `.tsx` files)

`tests/unit/attendance-clock-out-correct.test.tsx` (correction modal; actions mocked)

- [ ] `:75` REWRITE. An open session offers "Set clock-out" and prefills from the clock-in; template prefill is T35.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] `:82` KEEP. A completed session offers "Correct clock-out".
- [ ] `:89` KEEP. Save stays disabled until a reason is typed.
- [ ] `:99` REWRITE. Submits the record id, an ISO clock-out and the reason; also assert the business-timezone instant (V2).
- [ ] `:120` KEEP. The control is hidden when the viewer cannot manage; drive the flag from the correction key.

`tests/unit/attendance-clock.test.tsx` (kiosk state choice; actions mocked)

- [ ] `:25` KEEP. No attendance today offers Clock In only.
- [ ] `:33` KEEP. An open session offers Clock Out only, even with a clock-out earlier today.
- [ ] `:48` KEEP. A clock-out today offers Continue Duty behind a confirmation dialog.

`tests/unit/attendance-overtime.test.tsx` (157 lines)

- [ ] `:67` PARAM. Review columns are Employee, Date, Time, Total worked, Status, Details; OT badge only on the overtime day (T30).
- [ ] `:100` KEEP. Details lazy-loads the in and out selfie thumbnails from signed URLs.
- [ ] `:118` KEEP. The kiosk requires picking a member before Clock In appears.
- [ ] `:129` KEEP. Clock In reveals the selfie step; Cancel returns to idle.
- [ ] `:143` KEEP. An open session offers Clock Out, which opens the clock-out selfie step.

`tests/unit/attendance-paging.test.ts` (pure helpers)

- [ ] `:41` PARAM. "Today" is a single business day in the configured zone.
- [ ] `:44` PARAM. "Last 7 days" spans today minus 6 through today.
- [ ] `:47` PARAM. "This month" starts on the 1st.
- [ ] `:50` KEEP. Adding days crosses month boundaries.
- [ ] `:57` REPLACE. Day bounds use a fixed UTC offset (`src/lib/hr/attendance-paging.ts:42-43`); template derives them per zone (U7).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] `:63` KEEP. An unbounded range gives null bounds.
- [ ] `:69` KEEP. The open / completed status filter matches rows.
- [ ] `:77` KEEP. The staff filter matches rows.
- [ ] `:82` PARAM. The date filter uses the clock-in instant within business-day bounds (early-morning case).
- [ ] `:97` KEEP. A day split between the page and the completion set renders once with a 10h total, gap excluded.
- [ ] `:115` KEEP. A day renders only on the page holding its newest filtered session.
- [ ] `:132` KEEP. A day is dropped when its sessions on this page fail the status filter.
- [ ] `:139` KEEP. Today's summary counts present, clocked in now and completed.
- [ ] `:159` KEEP. An empty search gives no staff filter.
- [ ] `:162` KEEP. Name match is case-insensitive; no match gives an explicit empty list.
- [ ] `:166` KEEP. Page count is at least 1 and rounds up.

`tests/unit/attendance-records.test.tsx` (Attendance history; loader mocked)

- [ ] `:84` REWRITE. The first server page renders without a fetch and shows the count text; count what the list shows (V7).
- [ ] `:90` PARAM. An open day shows Final out as an em dash and a "Clocked in" badge, never "Open" in the time cell.
- [ ] `:101` PARAM. Exact column headers; a multi-session day shows a count marker instead of a Sessions column.
- [ ] `:124` KEEP. A status filter change re-queries the server at page 1.
- [ ] `:136` KEEP. Search debounces (fake timers) into a staff-id filter.
- [ ] `:154` KEEP. Next requests page 2 after "Page 1 of 3".
- [ ] `:163` KEEP. The staff filter is hidden when the member may not see the team; search stays visible.
- [ ] `:170` REWRITE. A thrown read failure shows an alert; also cover a read error returned as data (T18).

`tests/unit/attendance-sessions.test.ts` (day grouping)

- [ ] `:28` KEEP. Sums session durations and excludes the off-duty gap (10h, not 12h).
- [ ] `:47` KEEP. Orders sessions by clock-in when rows arrive out of order.
- [ ] `:57` KEEP. Keeps days separate; an open session adds no total and no final out.
- [ ] `:74` PARAM. The night bonus counts at most once per day in the display mirror; cap and anchor from config (T30).

`tests/unit/hr-format.test.ts`

- [ ] `:6` KEEP. Duration in fractional hours (8.5); align the rounding order with SQL (U2).
- [ ] `:12` KEEP. An open session has no duration.
- [ ] `:16` KEEP. A negative span has no duration.
- [ ] `:24` KEEP. Duration formatting "8h", "8h 30m", "0h".
- [ ] `:30` KEEP. An unknown duration renders as an em dash.
- [ ] `:36` DROP. The legacy hourly-rate normaliser keeps a valid string; replaced by the money parser tests (U5).
- [ ] `:43` DROP. Legacy "empty input clears the rate"; the live rate path refuses empty (`src/lib/hr/rate.ts:209-212`).
- [ ] `:49` REWRITE. Refuses negatives, letters and more than two decimals; assert the same on the live rate validation (U5).

`tests/unit/payslip-button.test.tsx` (payslip dialog; actions mocked)

- [ ] `:37` REWRITE. No snapshot plus the manage flag offers Generate and the deductions form; gate on the generate key (V5).
- [ ] `:52` REWRITE. A snapshot renders the document, whole-amount money, Download PDF, Print and Mark as Paid (V5; fixture note in 1.5).

`tests/unit/review-attendance-records.test.tsx` (127 lines; loader mocked)

- [ ] `:62` REWRITE. The first page renders without a fetch and shows the count text; count what the list shows (V7).
- [ ] `:70` PARAM. The Time column reads in to em dash for an open day; "Open" is a status badge outside the Time cell.
- [ ] `:84` KEEP. The sessions badge shows only for multi-session days.
- [ ] `:95` KEEP. Picking a status tab re-queries at page 1.
- [ ] `:105` KEEP. Next requests page 2.
- [ ] `:114` KEEP. Clean empty-state text.
- [ ] `:121` KEEP. A thrown read failure shows an alert.

Business-date helper test (its file name carries the business timezone; named in section 7)

- [ ] `:12` PARAM. "Today" is the business date, not the UTC date, in the early business-morning hours.
- [ ] `:21` PARAM. The date rolls over exactly at business midnight.
- [ ] `:27` KEEP. Equals the attendance "today" helper for the same instant (the template ships one helper).
- [ ] `:37` KEEP. Defaults to now and returns a YYYY-MM-DD string.
- [ ] `:44` PARAM. Month start handles business month and year rollover.
- [ ] `:52` KEEP. Month start never lands on the previous month's last day.
- [ ] `:64` KEEP. Adding days works across month, year and leap-day boundaries.
- [ ] `:73` KEEP. Equals the attendance add-days helper.

### 1.4 Tests that touch the area indirectly (all Vitest)

- [ ] `tests/unit/access-catalogue.test.ts:68-73, 83-86` KEEP. hr_payroll and hr_review_attendance never cascade (`:70`, `:84`);
  hr_attendance is not asserted there. Template: add hr_attendance to the case, and the request key if kept (T32).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] `tests/unit/member-access-controls.test.tsx:158-159, 182-192` KEEP. The HR toggles are independent in Manage Access.
- [ ] `tests/unit/app-shell.test.tsx:55-57, 80-82, 145-154` PARAM. Sidebar and More lists include the three HR items and routes.
- [ ] `tests/unit/ui-lock.test.tsx:40-42, 67-69` PARAM. Locked nav labels, routes and icons.
- [ ] `tests/unit/mobile-bottom-nav.test.tsx:156-158, 173, 190-192` KEEP. HR routes live in More; Payroll is hidden without hr_payroll.
- [ ] `tests/unit/phase2-authz.test.ts:102-104` KEEP. The three HR keys exist in TypeScript and in the migration seed.
- [ ] `tests/unit/phase2-authz.test.ts:362-366` KEEP. The policy migration revokes DELETE on all public tables from `authenticated`.
- [ ] `tests/unit/phase2-authz.test.ts:368-382` KEEP. The helpers migration pins `search_path` on every SECURITY DEFINER declaration.
- [ ] `tests/unit/security-guards.test.ts:120-138` REWRITE. A definer migration file must mention `set search_path`; file-level only (Z2).
- [ ] `tests/unit/export-sections.test.ts:30-31` KEEP. `attendance` and `payroll` are non-sensitive export sections.
- [ ] `tests/unit/phase7-fulfillment-approvals.test.ts:34, 48-49` REWRITE. `attendance_delete` is one of fourteen approval kinds.
- [ ] `tests/unit/dashboard-sync-ignore.test.ts:27` KEEP. Realtime changes on `attendance_records` trigger a refresh.
- [ ] `tests/unit/pwa-cache-policy.test.ts:53-68` KEEP. No page HTML is cached; `/admin/payroll` is one entry of a rule for all pages.
- [ ] `tests/unit/retry-fetch.test.ts:40, 61` KEEP. A POST (every RPC and write) is never retried, so a failed clock-in is not re-sent.
- [ ] `tests/unit/modal.test.tsx:40, 53` KEEP. Escape and overlay close a normal dialog; a critical dialog ignores both (V10 adds nesting).
- [ ] `tests/unit/stacked-table.test.ts:13` KEEP. Phone card labels come from the headers and skip the actions cell (W1).
- [ ] `tests/integration/phase11-authorization-boundary.test.ts:60-100` REWRITE. Static guard sweeps; gaps in 1.5, fix in I3.
- [ ] `tests/unit/security-hardening.test.ts:194-216` KEEP. Both PENDING (not live) migrations keep every dollar-quoted block
  balanced.
- [ ] `tests/unit/security-hardening.test.ts:218-286` KEEP (pattern). File-content pins for PENDING (not live) `20260916120000`;
  see 1.5.

### 1.5 Findings about the inventory (carry into the template)

- [ ] Stale pgTAP assertion. Case 18 (`supabase/tests/26_hr_attendance.test.sql:142-148`) reads `hourly_rate` from
  `report_payroll`, whose authoritative definition returns `daily_rate` and no `hourly_rate` (`20260907160000:30`). CURRENT:
  the suite is expected to error there. NEEDS VERIFICATION: run `npx supabase test db` on a scratch stack. The template
  asserts the daily formula (D10), never the legacy column. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] The only session-write pgTAP cases (11 and 12) use a direct table INSERT, which is the RLS gap the template closes
  (Z5). The template re-expresses them through the kiosk RPC. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Authorization sweep gap. `WRITE_CALL` (`tests/integration/phase11-authorization-boundary.test.ts:30`) matches only
  the literal call strings `.insert(`, `.update(` and `.delete(`, and the guard check is per file (`:94-99`). Found by grep:
  `src/lib/hr/rate.ts` is swept only because the dead `setHourlyRate` contains `.update(` (`rate.ts:52`) and a
  `requireActiveStaff` call (`:36`), while the live, unguarded `setSalaryRate` writes by RPC only (`:201-231`);
  `src/lib/hr/attendance.ts` is swept only because of the dead direct writes at `:270` and `:320`, while its live kiosk
  writers use RPCs (`:165`, `:218`); `src/lib/hr/devices.ts` writes only through RPCs (`:77`, `:110`) and is never swept;
  `src/lib/hr/payslip-actions.ts` writes with `.update(` (`:126`) but the action glob is `*/actions.ts` (`:61`) and the
  writer sweep skips every file ending in `actions.ts` (`:86-88`). RECOMMENDED TEMPLATE IMPROVEMENT: I3.
- [ ] The PENDING (not live) migration is covered by a file-content test, not a behavioural one. `tests/unit/security-hardening.test.ts`
  pins the `'inactive'` sentinel and rejects the old NULL-returning form (`:219-227`), pins section 2 as revoke-only
  (`:229-236`), the narrowed audit read (`:255-262`), and sections 8 to 10 including the exact kiosk device refusal text
  (`:272-286`). No behavioural or pgTAP test exercises any kiosk RPC. Keep the pattern for SQL the runner cannot execute and
  add D2 and T27. PENDING (not live).
- [ ] Fixture privacy. Several unit fixtures use person names; at least one matches a real account holder named in a
  migration comment, and the payslip fixture pairs a name with salary figures (`tests/unit/payslip-button.test.tsx:13-34`).
  Template fixtures use placeholders such as `<employee-1>` (Z14). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] The payslip fixture is not formula evidence: it declares a daily rate basis, yet its regular salary equals hours x rate,
  not days x rate (`payslip-button.test.tsx:20-26`). Use the D0 fixtures and D10 results as the oracle.
- [ ] No case covers device gating, the kiosk RPCs, roster exclusions, the night trigger, the `report_payroll` formula or
  output columns, payslip generation, mark paid, the live `staff_salary_rates` path, export sheets or the selfie fallback.
  What exists around those areas: pgTAP cases 8 to 10 assert only that `report_payroll` exists, is SECURITY INVOKER and is
  not executable by `anon` (`supabase/tests/26_hr_attendance.test.sql:66-76`); cases 15 to 19 exercise the legacy
  `hourly_rate` column (`:122-163`); `tests/unit/hr-format.test.ts:49` covers the legacy rate-string refusal. All gaps are in
  section 2.
- [ ] No end-to-end tests (`vitest.config.ts:22`). The section 3 scripts are the only end-to-end coverage until the
  template adds browser tests for the kiosk, correction and payslip flows. RECOMMENDED TEMPLATE IMPROVEMENT.

---

## 2. Behaviours with no test today: REQUIRED tests in the template

T1 to T28 are the untested behaviours found when the reference implementation was extracted. T29 to T36 were added by the
completeness review of that extraction. Each item names what the template test asserts. Where the reference behaviour is a
defect, the item states the assertion the template uses instead.

- [ ] T1 REQUIRED. Payroll formula. `report_payroll` returns computed_salary = round(days_worked x daily_rate +
  night_shifts x night_ot_bonus(), 2), NULL without a rate. Rate and frequency come from the newest `staff_salary_rates` row
  with effective_date at or before the period end and apply to the whole period (no proration); frequency defaults to
  weekly; hour totals round to 2 dp once. CURRENT `20260907160000:59-93`; `staff_salary_rates` and `night_ot_bonus()` are
  RECONSTRUCTED. Fixtures: D0, results: D10.
- [ ] T2 REQUIRED. Payroll night rule and cap: night_shifts = distinct work dates with a clock-out at or after 22:00
  business time (`20260907160000:41, 53-55`). Only the TypeScript display mirror is tested today
  (`tests/unit/attendance-sessions.test.ts:74`). Template: anchor, start time and window end are CONFIGURABLE (T30).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T3 REQUIRED. Session flag trigger: a clock-in hour at or after 22 sets `is_overtime` true and `overtime_amount`
  300.00, any other hour false and 0, overwriting client values; it fires BEFORE INSERT only (`20260722200000:26-49`).
  NEEDS VERIFICATION: a drift migration may have changed the live trigger (N1). Template: no stored flag and no trigger; the
  night result is computed on read by one predicate (D4, U3). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T4 REQUIRED. Exclusions. CURRENT: `report_payroll` excludes inactive, demo and Super Admin (`20260907160000:97-99`);
  `list_clock_staff` excludes Super Admin and inactive but not demo (`:21-25`); `kiosk_clock_in` refuses unknown, inactive
  and demo targets but not a Super Admin (`20260907120000:30-37`); Employee Rates excludes all three
  (`src/lib/hr/rate.ts:134-137`). RECOMMENDED TEMPLATE IMPROVEMENT: one exemption rule; the test asserts roster, clock RPCs,
  payroll and rates agree.
- [ ] T5 REQUIRED. `kiosk_clock_in`: refuses a non-active operator (`20260907120000:25-28`); refuses an unknown, inactive or
  demo target with the exact messages (`:30-37`); stamps the business date (`:45`); turns a unique violation into "That
  team member is already clocked in. Clock out first." (`:48-50`). PENDING (not live): refuses a null, unknown or revoked device id
  while any device is active (`20260916120000:451-459`). RECOMMENDED TEMPLATE IMPROVEMENT: the operator must hold the kiosk
  key (CURRENT checks active staff only, `src/lib/hr/attendance.ts:158`).
- [ ] T6 REQUIRED. `kiosk_clock_out` is RECONSTRUCTED: no DDL, called with only `p_staff_id`, returns the closed record id
  (`attendance.ts:218-236`). The template ships the DDL and asserts: closes exactly the target's open session, returns its
  id, refuses when none is open, refuses an inactive operator or one without the kiosk key, and checks the device (CURRENT
  app-only, `:214-215`). RECOMMENDED TEMPLATE IMPROVEMENT: the kiosk key and device checks inside the RPC.
- [ ] T7 REQUIRED. `correct_attendance_clock_out`: role gate including the NULL-role branch (`20260907130000:29-33`); blank
  reason (`:35-37`); unknown record (`:39-43`); null, before-clock-in and future values (`:45-53`), each with its exact
  message; writes `time_out`, `edited_by`, `edit_reason` (`:55-59`); returns the old `time_out` (`:61`); leaves
  `is_overtime` and `overtime_amount` untouched. Only the modal wiring is tested today.
- [ ] T8 REQUIRED. Delete: `delete_attendance_record` is RECONSTRUCTED (called at `attendance.ts:368-370` and
  `src/lib/fulfillment/service.ts:735-739`). Assert the role gate, the delete per the configured deletion mode (CURRENT hard;
  D6), the server-side typed-word check (`src/lib/hr/actions.ts:146-148`) and the approval executor path. CURRENT leaves the
  day's selfies orphaned
  (`attendance.ts:345-346`); the template decides selfie handling and asserts it. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T9 REQUIRED. Request deletion: the Admin path on the Attendance page (`src/components/hr/attendance-day-details.tsx:138-150`;
  `actions.ts:190-204`) creates a pending request and deletes nothing; the Super Admin decides, then executes. CURRENT: the
  request key `initiate_high_risk_action` is absent from Manage Access and from every migration, and is grantable only on the
  legacy Super Admin console, so the request fails by default on a fresh install and succeeds once the Super Admin grants the
  key there (T32; manual scripts A16 and A16b). Assert both the refusal without the key and the pending request with it.
- [ ] T10 REQUIRED. Device gating end to end: register deactivates every active device and stores only the sha256 hash
  (`20260722150000:49-53`); the cookie is httpOnly, secure, sameSite lax, path /, one year (`src/lib/hr/devices.ts:83-89`);
  verify matches active devices only (`20260722150000:58-63`); revoke sets `is_active` false and `revoked_at` (`:72-79`);
  a refusal is audited as `attendance.blocked_device`, outcome denied, with the staff id as entity id (`attendance.ts:28-48`).
  CURRENT gating is on only while an active device exists (`20260722150000:66-69`) and a gating read error counts as no gating
  (`devices.ts:38-42`); the template asserts the configured gating mode (K13) and fails closed on a read error (Z11).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T11 REQUIRED. Read scope: `attendance_read` returns every row to the Super Admin and to hr_review_attendance holders
  and only own rows otherwise (`20260804140000:8-14`); `list_clock_staff` raises `insufficient_privilege` without
  hr_attendance (`20260907160000:16-19`).
- [ ] T12 REQUIRED. Snapshots: `payroll_snapshots` RLS (read own or Super Admin; insert and update Super Admin; no delete:
  `20260722210000:51-68`); `generate_payslip_snapshot` figures and the deductions clamp (`:93`); refusal without a payroll row
  (`:102-104`); a later rate change or attendance correction leaves an issued snapshot unchanged. The repo body reads
  `hourly_rate` (`:97`), which the current `report_payroll` no longer returns, so the live body is RECONSTRUCTED.
- [ ] T13 REQUIRED. Mark paid: only a pending snapshot flips (`src/lib/hr/payslip-actions.ts:124-135`); `payment_date`,
  `paid_at` and `paid_by` are written (`:127-130`; `paid_at` and `paid_by` have no repo DDL and are RECONSTRUCTED columns,
  N8); a repeat returns "Could not mark the payslip as paid. It may already be paid." (`:137-143`); the action allows Super
  Admin or Admin (`:106`) while the repo update policy allows the Super Admin only (`20260722210000:62-65`), see T31.
- [ ] T14 REQUIRED. Rate save validation: an amount of one to ten digits with an optional dot and one or two decimals
  (`src/lib/hr/rate.ts:209-212`); frequency weekly, bi_weekly or monthly (`:213-216`); a required YYYY-MM-DD effective
  date (`:217-220`); and the role gate of `set_staff_salary_rate` (RECONSTRUCTED; the TypeScript path has no guard, `:201-231`).
  The `staff_salary_rates` columns and CHECK constraints are RECONSTRUCTED too (N8). RECOMMENDED TEMPLATE IMPROVEMENT: the
  action is guarded as well (I2).
- [ ] T15 REQUIRED. Current rate: `listEmployeeRates` keeps the newest row per member with no effective-date-at-or-before-today
  filter, so a future-dated rate shows as current (`rate.ts:139-143`). The template asserts its CONFIGURABLE choice.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T16 REQUIRED. PDF helpers: file-name sanitising (`src/lib/hr/payslip-pdf.ts:33-49`), the PDF money formatter including a
  negative value (`:21-31`), and that every label renders with the font in use (the night label at `:106` contains a glyph the
  file's own comment says the built-in fonts lack, `:12-14`). RECOMMENDED TEMPLATE IMPROVEMENT: a label set the font covers.
- [ ] T17 REQUIRED. Payroll Summary total: net where a snapshot exists, else gross, summed in integer minor units
  (`src/components/hr/payroll-summary-button.tsx:54-60`); visible only to the Super Admin and only when rows exist
  (`src/components/hr/attendance-view.tsx:98-105`); the fixture includes a negative net (T33).
- [ ] T18 REQUIRED. Server paging reader: filters on the clock-in instant within business-day bounds (`attendance.ts:606,
  615-619`), the exact HEAD count (`:623-627`), and the completion query with no status or date filter (`:641-656`). CURRENT
  turns a count error into an empty page and a row error into an empty row list (`:626`, `:635`), so the UI shows an empty
  state. RECOMMENDED TEMPLATE IMPROVEMENT: both surface as a read error.
- [ ] T19 REQUIRED. Kiosk status for an operator without hr_review_attendance: `listOpenSessions` and `listLastClockOutToday`
  read under RLS (`attendance.ts:111-146`), so every other member looks not clocked in. Clock Out is never offered for them;
  Continue Duty is not offered either, but the Clock In fallback runs the same RPC and creates the same second session;
  Clock In on an already-open member fails with the database message. The overtime read-back after `kiosk_clock_in` also runs
  under RLS (`attendance.ts:179-186`), so clocking another member in at or after 22:00 gives a plain "Clocked in." notice and
  an audit context without `overtime_amount` (`:188-206`; manual K18b). Template: a permission-scoped definer status reader,
  and any night notice comes from the one night predicate, not from a read-back. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T20 REQUIRED. Selfie flow: the FormData fields after a successful clock event (`src/components/hr/attendance-clock.tsx:157-166`);
  an upload failure that the server action returns as `error` appended as a soft notice while the clock event stands
  (`:167-173`); "Clock in/out without photo" when the camera API is missing or permission is denied (`:111-127`, `:275-286`);
  an encode failure proceeds without a photo (`:198-201`). CURRENT defect: the selfie upload is a separate server action
  (`src/lib/attachments/actions.ts:1, 27`) awaited inside the same `try` as the clock action (`attendance-clock.tsx:144-166`).
  If that call throws (a failed or blocked POST), the outer `catch` shows "Could not clock in. Please try again." (or out)
  as an error (`:181-182`) although the session row is already committed; the camera step stays open, and a second Capture
  fails with "already clocked in" (clock-in) or is refused because no session is open (clock-out; the RECONSTRUCTED RPC's
  message is unknown, and a null result reads "Could not clock out.", `attendance.ts:221-227`). The test mocks the upload
  action to reject and asserts a success notice with a selfie warning, no clock error, and a return to idle.
  RECOMMENDED TEMPLATE IMPROVEMENT: wrap the selfie upload in its own `try`/`catch` so an upload failure never reads as a
  clock failure.
- [ ] T21 REQUIRED. Selfie authorization: `loadAttendanceSelfiesAction` requires hr_review_attendance (`actions.ts:45-50`), but
  attachment metadata and storage objects are readable and insertable by any active staff member
  (`20260716300000:127-142, 159-165`). RECOMMENDED TEMPLATE IMPROVEMENT: read by reviewers and the subject; insert only by
  the operator recorded for that kind, under that session path prefix: attach only through `attach_attendance_photo`,
  which requires `attendance.clock_operate`, a caller who is the operator recorded on that session for that kind
  (`clock_in_by` or `clock_out_by`), and a storage path under that session prefix for that kind (DATABASE.md section
  5.13; IMPLEMENTATION_PROMPT.md PH4).
- [ ] T22 REQUIRED. Server-action gates: `loadAttendancePageAction` requires hr_attendance (`actions.ts:62`);
  `loadReviewAttendancePageAction` requires hr_review_attendance (`:77`); CURRENT `clockInAction` and `clockOutAction` check
  no key (`:81-105`). The template asserts the kiosk key on both. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T23 REQUIRED. Page gates: each page calls `notFound()` without its key (`src/app/(app)/admin/attendance/page.tsx:43`;
  `src/app/(app)/admin/attendance/review/page.tsx:22`; `src/app/(app)/admin/payroll/page.tsx:30`); and the role-derived flags
  `canManage` (`attendance/page.tsx:79`; `review/page.tsx:35-36`) and `canManagePayroll` (`payroll/page.tsx:41-44`).
- [ ] T24 REQUIRED. Export sheets: the Attendance sheet columns and its `work_date` range filter, and the Payroll sheet mapping
  of `daily_rate` and `night_shifts` (`src/lib/export/data-export.ts:522-602`); the comment at `:569-572` records a past
  mapping bug with no test.
- [ ] T25 REQUIRED. Timezone edges: a session crossing midnight belongs wholly to its clock-in `work_date`; an insert that
  omits `work_date` gets the business date (CURRENT column default is the server UTC date, `20260717120000:25`;
  PENDING (not live) changes it, `20260916120000:367-368`); a reviewer in another browser zone submits the intended instant
  (CURRENT converts with the browser zone, `src/components/hr/review-attendance-view.tsx:674-679, 713`).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T26 REQUIRED. Continue Duty past the confirmation: confirm, camera, `clockInAction`, a second session with the same
  `work_date`, and Session 2 with the "Continued Duty" chip in Details (`attendance-clock.tsx:319-334, 355-392`).
- [ ] T27 REQUIRED. PENDING (not live) `20260916120000` behaviour: the `'inactive'` sentinel refuses a deactivated Super Admin or Admin
  JWT in the correction gate (section 1, `:46-57`); the business-date column default (section 8); the clock-in device check
  (section 10). Only the content test in 1.5 exists. PENDING (not live).
- [ ] T28 REQUIRED. Schema replay from migrations alone. CURRENT `20260907160000:29` runs CREATE OR REPLACE on a
  `report_payroll` whose result columns differ from the previous repo definition, and references `staff_salary_rates` and
  `night_ot_bonus()`, which no repo migration creates, so a fresh replay most likely fails. NEEDS VERIFICATION with a scratch
  `supabase db reset`. Template CI: reset, then the pgTAP suite (D18). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] T29 REQUIRED (added). Camera header: responses carry `Permissions-Policy` with `camera=(self)` (`next.config.ts:45-48`).
  A header that denies the camera to the app's own origin (for example `camera=()`) makes `getUserMedia` fail and every clock
  event falls back to "without photo"; keep `camera=(self)` explicit. Whether omitting the header is harmless depends on the
  browser's default allowlist: NEEDS VERIFICATION in a browser.
- [ ] T30 REQUIRED (added). RECOMMENDED TEMPLATE IMPROVEMENT. Night rule parity: with one CONFIGURABLE anchor, the
  session flag, the Review OT badge and the payroll count pick the same days for the same fixtures. CURRENT disagrees:
  14:00 to 22:30 is paid but has no badge, and 22:15 to 00:30 has a badge but is not paid (`20260722200000:34-35` versus
  `20260907160000:41`).
- [ ] T31 REQUIRED (added). RECOMMENDED TEMPLATE IMPROVEMENT. Authority parity for generate, mark paid and rate edit across
  UI, action and database. CURRENT: the page shows the deductions form and Mark as Paid to an Admin (`payroll/page.tsx:43`;
  `src/components/hr/payslip-button.tsx:234-238, 276-293`); generate requires the Super Admin (`payslip-actions.ts:28`);
  mark paid allows Admin in the action (`:106`) but not in the repo policy (`20260722210000:62-65`); the rate RPC gate is
  RECONSTRUCTED.
- [ ] T32 REQUIRED (added). Request key grantability: `initiate_high_risk_action` is seeded (`20260715120100:79`) and required by
  `requestOwnerApproval` (`src/lib/fulfillment/service.ts:502`). CURRENT: it is absent from the Manage Access catalogue
  (`src/lib/authz/access-catalogue.ts:37-129`) and from every migration, and grantable only on the legacy Super Admin console
  at `/admin/staff` (Super Admin only, `src/app/(app)/admin/staff/page.tsx:34-41`), whose "Grant a permission" select is built
  from every `PERMISSIONS` value (`src/components/admin/staff-console.tsx:35, 173-195`; key at `src/lib/authz/permissions.ts:41`)
  and whose action accepts any such value (`src/lib/authz/actions.ts:36-60`). So the request fails by default on a fresh
  install. RECOMMENDED TEMPLATE IMPROVEMENT: list the request key in the access catalogue or drop the request path; the test
  asserts the chosen path works on a fresh install through the normal access screen.
- [ ] T33 REQUIRED (added). RECOMMENDED TEMPLATE IMPROVEMENT. Negative net: `net_salary` has no check
  (`20260722210000:28`), and the summary parser zeroes a signed whole part but keeps the fraction
  (`payroll-summary-button.tsx:32-36`), so a net of -100.50 adds +0.50 to the printed total. The template asserts a signed
  minor-unit parser, or a `net_salary >= 0` check, per its CONFIGURABLE choice.
- [ ] T34 REQUIRED (added). RECOMMENDED TEMPLATE IMPROVEMENT. Reviewer names: the page reader embeds
  `staff_profiles.full_name` (`attendance.ts:562-563`), but `staff_profiles_read` is Super-Admin-or-self
  (`20260821140000:21-22`), so a non-Super-Admin reviewer sees an em dash for every other member. The template serves names
  through a permission-scoped definer reader and asserts an Admin reviewer sees real names. NEEDS VERIFICATION only for
  whether production added another `staff_profiles` read policy (N2).
- [ ] T35 REQUIRED (added). RECOMMENDED TEMPLATE IMPROVEMENT. Correction prefill: the input is seeded from `time_out`, else
  `time_in`, truncated to the minute (`review-attendance-view.tsx:674-679, 706-710`). An unchanged save on an open session
  is refused as "Clock-out cannot be before clock-in." whenever `time_in` has seconds (`20260907130000:48-50`); on a
  completed session it silently rewrites `time_out` to the start of its minute. Template: seed an open session from `time_in` rounded up to
  the next minute and a completed one from `time_out` truncated to its minute; the same minute counts as unchanged; Save
  disabled until the minute changes; the server refuses a value that is not a whole minute (U11, D5).
- [ ] T36 REQUIRED (added, CONFIGURABLE). RECOMMENDED TEMPLATE IMPROVEMENT. Selfie retention: no cron route under
  `src/app/api/cron/` references attendance, and storage objects cannot be deleted from SQL in the reference stack
  (`scripts/purge-attendance-selfies.mjs:7-9`). If the client needs retention, the template ships a service-role job and
  tests that it deletes only the attendance prefix and skips blobs a live row still references (the reference script's
  guards, `:13-20`, have no test).

---

## 3. Manual test scripts per role

### 3.0 Preparation

- [ ] M1. Use a scratch stack only; never production accounts or data. Accounts: `<super-admin>` (role key owner),
  `<admin>` (selected_admin, no grants), `<staff-a>` (staff, no grants), `<staff-b>` (staff, holds hr_attendance and
  hr_review_attendance), `<staff-c>` (inactive), `<demo-1>` (is_demo true). Synthetic names only.
- [ ] M2. Two browsers or profiles (A and B) over HTTPS; the device cookie is `secure` (`src/lib/hr/devices.ts:83-89`).
- [ ] M3. A way to create sessions at chosen instants (privileged inserts on the scratch database) for the night and midnight
  steps; otherwise mark those steps "covered by D10 and D11".
- [ ] M4. Read access to the scratch database to inspect `attendance_records`, `attachments`, `payroll_snapshots`,
  `audit_events` and `owner_approval_requests` after each write. The UI never shows `edited_by`, `edit_reason`, `paid_at`,
  `paid_by` or the audit context payload (old `time_out`, reasons, figures): the attendance row select has no edit columns
  (`src/lib/hr/attendance.ts:562-563`), and the payslip selects have no `paid_at` or `paid_by` (`src/lib/hr/payslip.ts:52-53`;
  `src/lib/hr/payslip-actions.ts:79`). Audit rows themselves are visible in part: the Super Admin's legacy staff page lists
  each account's trail as action, entity type and outcome (`src/lib/authz/account-management.ts:463-490`;
  `src/app/(app)/admin/staff/page.tsx:53`), and a dashboard reader lists recent events without their context
  (`src/lib/dashboard/service.ts:402-416`). Database read access is still required for the context.
- [ ] M5. A way to call RPCs and REST as a given signed-in user (for example a small supabase-js script using that user's
  session) for the "direct call" steps. Never with a service key.

### 3.1 STAFF (role key staff), as `<staff-a>`

- [ ] S1. Sign in.
  Expected: the dashboard opens; the sidebar and the phone More sheet show none of Attendance, Review Attendance or Payroll
  (`src/components/shell/navigation.ts:91-93, 264-275`).
- [ ] S2. Open `/admin/attendance` without hr_attendance.
  Expected: "Page not found", not a redirect and not a 403 screen (`src/app/(app)/admin/attendance/page.tsx:43`;
  `src/app/not-found.tsx:5-21`).
- [ ] S3. The Super Admin grants hr_attendance; reopen the page.
  Expected: the page opens with the kiosk card and roster (see K1); the history lists only `<staff-a>`'s days
  (`20260804140000:8-14`); no staff filter (`src/components/hr/attendance-records.tsx:228`), no summary tiles
  (`attendance/page.tsx:49, 121`), no device manager (`:107`).
- [ ] S4. Type another member's name in the history search.
  Expected: an empty result; nothing about that member appears (names match roster ids, `src/lib/hr/attendance-paging.ts:156-163`,
  and RLS returns no rows for them).
- [ ] S5. Direct read (M5): select `attendance_records` rows of another member.
  Expected: 0 rows (`20260804140000:8-14`; pgTAP case 13).
- [ ] S6. Open one of your own days in Details.
  Expected: sessions, gaps and the total; no Delete and no Request delete (`attendance/page.tsx:79`;
  `src/components/hr/attendance-day-details.tsx:83-87`).
- [ ] S7. Direct call (M5): `correct_attendance_clock_out` on your own record, then `delete_attendance_record`.
  Expected: both refused. The correction gate refuses any role other than Super Admin or Admin (`20260907130000:29-33`) and
  writes no audit row (the RPC has no insert, `:13-63`); the delete gate is RECONSTRUCTED (NEEDS VERIFICATION, N1). The
  action path and its denied audit rows (`attendance.ts:354-362, 408-416`) are covered by I2 and I8.
- [ ] S8. Open `/admin/attendance/review` without hr_review_attendance.
  Expected: "Page not found" (`src/app/(app)/admin/attendance/review/page.tsx:22`).
- [ ] S9. Open `/admin/payroll` without hr_payroll.
  Expected: "Page not found" (`src/app/(app)/admin/payroll/page.tsx:30`).
- [ ] S10. The Super Admin grants hr_payroll; reopen Payroll.
  Expected: exactly one row, your own (`20260907160000:100`); no Payroll / Employee Rates tab bar
  (`src/components/hr/payroll-tabs.tsx:49`); no inline rate editor (`src/components/hr/attendance-view.tsx:182`); no Print
  Payroll Summary (`:98`).
- [ ] S11. Open the payslip dialog on your row when no payslip exists.
  Expected GENERIC: read-only text, no Generate control. CURRENT: the text says none has been generated, but the footer still
  offers "Generate payslip" (`src/components/hr/payslip-button.tsx:240-249, 294-299`); pressing it is refused by
  `requireOwner` (`src/lib/hr/payslip-actions.ts:28`). RECOMMENDED TEMPLATE IMPROVEMENT; record the message.
- [ ] S12. With a payslip for your row, open it.
  Expected: the frozen document with Download PDF and Print; no Mark as Paid (`payslip-button.tsx:234-238`).
- [ ] S13. Remove hr_attendance, then (M5) call `kiosk_clock_in` for any active member.
  Expected GENERIC: refused. CURRENT: succeeds for any active staff member (`attendance.ts:158`; `20260907120000:25-28`).
  RECOMMENDED TEMPLATE IMPROVEMENT (T5, T22).
- [ ] S14. Direct table write (M5): update your own `attendance_records.time_in`, or insert an own row with arbitrary times.
  Expected GENERIC: refused. CURRENT per repo: allowed (`20260717120000:59-75`), and the night trigger does not fire on
  UPDATE (`20260722200000:46-49`). NEEDS VERIFICATION against the live catalog (N2). RECOMMENDED TEMPLATE IMPROVEMENT (Z5).
- [ ] S15. Direct read (M5): select `attachments` rows with `related_entity_type = 'attendance_record'`.
  Expected GENERIC: only rows about your own records. CURRENT: every row for any active staff member
  (`20260716300000:127-129`), and bucket objects likewise (`:159-161`). RECOMMENDED TEMPLATE IMPROVEMENT (T21).
- [ ] S16. Direct read (M5): select `audit_events` whose action starts with `payroll.`.
  Expected GENERIC: refused for Staff. CURRENT live policy: readable by any active staff member (`20260715130100:661-662`),
  including rates and net pay in the context (`src/lib/hr/rate.ts:233-238`; `payslip-actions.ts:88-93`). PENDING (not live)
  narrows the read (`20260916120000:290-298`). RECOMMENDED TEMPLATE IMPROVEMENT (Z10).

### 3.2 KIOSK OPERATOR (any signed-in account holding hr_attendance)

Run as `<staff-b>` (hr_attendance and hr_review_attendance) unless a step names another operator. K17 and K18b run as an
operator holding hr_attendance only (for example `<staff-a>` between S3 and S13); repeat K5 as that operator for a member other
than the operator and expect the K17 result, because that operator's status reads are scoped by RLS (T19).

Run order. The device steps share state with the Super Admin script and must run in this order: K10, SA2, K11, K12, SA3,
SA4, K13. Registering a device deactivates every other active device (`20260722150000:49`), so running SA3 before K12 leaves
browser A blocked and K12 fails.

- [ ] K1. Open the kiosk and the member dropdown.
  Expected: active members only; no Super Admin; `<staff-c>` absent; names without roles (`20260907160000:21-25`;
  `src/components/hr/attendance-clock.tsx:226-229`). CURRENT DEFECT: `<demo-1>` is listed, and clocking it in is refused with
  "That team member is inactive and cannot clock in." (`20260907120000:35-37`). Template excludes it (T4).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] K2. With nobody selected.
  Expected: the prompt to select who is signing in and no clock buttons (`attendance-clock.tsx:207-244`).
- [ ] K3. Select `<staff-a>`, press Clock In, allow the camera, press Capture.
  Expected: notice "Clocked in."; the status shows clocked in since a time, with Clock Out; a new row with `time_out` null,
  `work_date` = today's business date and `device_id` null while no device is registered; an `attachments` row for the record
  whose file name contains `clock-in`; audit `attendance.clock_in` with `for_staff` (`src/lib/hr/attendance.ts:154-207`;
  `attendance-clock.tsx:157-166`). CURRENT: the time uses `toLocaleTimeString()` without options, so seconds usually show
  and no date (`attendance-clock.tsx:302-306`). RECOMMENDED TEMPLATE IMPROVEMENT: one time format, with the date when the
  session did not start today (V1).
- [ ] K4. Clock `<staff-a>` in again (second tab, or M5).
  Expected: "That team member is already clocked in. Clock out first." (`20260907120000:48-50`), backed by the unique
  partial index (`20260717120000:41-45`).
- [ ] K5. Press Clock Out for `<staff-a>`, press Capture.
  Expected: "Clocked out."; `time_out` is set by the server (RPC RECONSTRUCTED, T6); the status reads clocked out at a time
  with Continue Duty (`attendance-clock.tsx:319-334`); a second attachment whose file name contains `clock-out`; audit
  `attendance.clock_out` (`attendance.ts:210-237`); the history shows the day completed.
- [ ] K6. Press Continue Duty, confirm, Capture.
  Expected: the confirmation says a new session is added and the gap is off duty and not counted
  (`attendance-clock.tsx:355-392`); a second row with the same `work_date`; Details shows Session 1 and Session 2 with a
  "Continued Duty" chip and an off-duty gap marked not counted (`src/lib/hr/sessions.ts:65-129`).
- [ ] K7. Clock the second session out and compare the day total.
  Expected: the total is the sum of both sessions, gap excluded; for 09:00-12:00 and 13:00-17:00 expect 7h, not 8h
  (`sessions.ts:90-91`); the history shows a session-count marker (`attendance-records.tsx:360-368`).
- [ ] K8. Deny the camera permission in the browser, then press Clock In.
  Expected: a notice that the camera is unavailable and a "Clock in without photo" button; pressing it clocks in with no
  attachment (`attendance-clock.tsx:111-127, 275-286`). CURRENT: no skip option while the camera works (the template makes
  the selfie mode CONFIGURABLE). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] K9. Selfie upload failure, two cases. The browser never talks to Storage: the selfie goes to a server action by POST
  (`src/lib/attachments/actions.ts:1, 27`) and the server writes Storage (`src/lib/attachments/upload.ts:110-127`).
  (a) A failure the action returns as an error. On the scratch stack only, make the server-side write fail, for example by
  temporarily removing the Storage insert policy of the attachments bucket, then clock a member in and Capture.
  Expected CURRENT: the clock event stands and the notice appends "(Selfie could not be saved: ...)"
  (`attendance-clock.tsx:167-173`; the returned errors are at `upload.ts:114-127, 150-163`); the kiosk returns to idle.
  Restore the policy afterwards.
  (b) A failed POST of the upload action itself. Clock and upload both POST to the page URL, so URL blocking cannot separate
  them: in a development build, set a devtools breakpoint on the `uploadAttachmentAction` call (`attendance-clock.tsx:166`),
  press Capture, switch the Network panel to Offline when the breakpoint hits, resume, then go back online.
  Expected CURRENT: the error "Could not clock in. Please try again." (`:181-182`) while the session row already exists in
  `attendance_records` (check it, M4) with no `attachments` row; the camera step stays open; a second Capture fails with
  "That team member is already clocked in. Clock out first." Repeat for a clock-out and record the message.
  RECOMMENDED TEMPLATE IMPROVEMENT (T20, V1): the upload has its own `try`/`catch`, and case (b) shows the clock success
  with a selfie warning.
- [ ] K10. Device gating off (no registered device).
  Expected: no blocked banner; any browser clocks in and out; `device_id` stays null (`src/lib/hr/devices.ts:21-22`;
  `20260722150000:66-69`).
- [ ] K11. Gating on (run after SA2, which registered browser A); open the kiosk in browser B, select `<admin>` (a member with no
  open session and no clock-out today) and press Clock In.
  Expected: the blocked banner "This device cannot clock in/out" (`attendance/page.tsx:91-105`); Clock In is refused
  with the device message (`attendance.ts:43-47`) and audited `attendance.blocked_device`, outcome denied, entity id = the
  staff id (`:36-42`). CURRENT: the clock buttons stay enabled; RECOMMENDED TEMPLATE IMPROVEMENT: disable them (V6).
- [ ] K12. From the currently active device, browser A (run before SA3), clock `<admin>` in.
  Expected: success; `device_id` equals browser A's `attendance_devices` id. Leave the session open for K13.
- [ ] K13. Run after SA3 (browser B registered, browser A deactivated) and SA4 (browser B revoked, so no device is active).
  From browser B, clock `<admin>` out.
  Expected GENERIC: still refused while gating is configured on (the device rule covers both clock events). CURRENT: gating
  turns off (`20260722150000:66-69`), the app device check passes (`attendance.ts:214-215`) and the clock-out succeeds.
  RECOMMENDED TEMPLATE IMPROVEMENT: the gating mode is a CONFIGURABLE setting, not "a device exists".
- [ ] K14. PENDING (not live): with `20260916120000` applied and a device active, call `kiosk_clock_in` with a random device id (M5).
  Expected: "This device is not an approved time clock." (`20260916120000:451-459`). Clock-out stays app-gated only.
- [ ] K15. Insert one session starting at 22:00 business time and another at 21:59 (M3 privileged inserts).
  Expected: the 22:00 row has `is_overtime` true and `overtime_amount` equal to the flat amount; the 21:59 row has false and
  0 (`20260722200000:33-41`). A direct insert produces no kiosk notice; the notice is checked in K18 and K18b.
- [ ] K16. Leave a session open past midnight; open the kiosk the next day.
  Expected CURRENT: the status shows a time with no date (`attendance-clock.tsx:302-306`); Clock In stays blocked until a
  clock-out or a correction (unique index); Continue Duty is not offered for a session that began yesterday, because the
  reader uses today's `work_date` (`attendance.ts:130-146`). RECOMMENDED TEMPLATE IMPROVEMENT: show the date, flag long sessions.
- [ ] K17. As an operator holding hr_attendance only, select a member another operator clocked in.
  Expected CURRENT (T19): shown as not clocked in; Clock Out not offered; Clock In refused with the "already clocked in"
  message; for a member clocked out today, Continue Duty is not offered but Clock In creates the same second session
  (`attendance.ts:111-146`; `20260804140000:8-14`). Expected GENERIC: the correct status for every member.
  RECOMMENDED TEMPLATE IMPROVEMENT (I11).
- [ ] K18. At or after 22:00 business time, as `<staff-b>` (holds hr_review_attendance), clock another member in through the
  kiosk (a real clock-in, not an M3 insert).
  Expected: the notice reads as clocked in and mentions the overtime amount, and audit `attendance.clock_in` carries
  `overtime_amount` (`attendance.ts:179-206`); the new row is flagged as in K15. If the step cannot be run at that hour, record
  it as not run; U3 and D10 cover the template's computed night result, not the notice.
- [ ] K18b. Same hour, as an operator holding hr_attendance only, clock in a member other than yourself.
  Expected CURRENT: a plain "Clocked in." with no amount, and an audit context without `overtime_amount`, although the row is
  flagged. The read-back of the flag after the RPC runs under RLS (`attendance.ts:179-186`), and this operator cannot read
  another member's row (`20260804140000:8-14`). Clocking yourself in shows the amount, because the row is your own.
  Expected GENERIC: the notice and audit context agree with the night predicate for every operator (no stored flag exists);
  the clock-in function returns only the session id. RECOMMENDED TEMPLATE IMPROVEMENT (T19).

### 3.3 ADMIN (role key selected_admin), as `<admin>`

- [ ] A1. With no grants, open the three pages.
  Expected: "Page not found" for all three; the role implies no key (`src/lib/authz/permissions.ts:131-132`;
  `src/lib/authz/guard.ts:182-197`).
- [ ] A2. Grant hr_review_attendance only; open Review.
  Expected: every member's days are listed; the Employee dropdown offers only "All employees" and any name search gives an
  empty result, because the roster RPC needs hr_attendance (`20260907160000:16-19`) and the reader returns an empty list on
  error (`src/lib/hr/attendance.ts:96-108`). CURRENT DEFECT: other members' names render as an em dash (T34). Then grant
  hr_attendance and confirm the dropdown fills. RECOMMENDED TEMPLATE IMPROVEMENT: names for every reviewer (T34).
- [ ] A3. Status tabs Open, Completed, All (default All).
  Expected: each pick re-queries at page 1 and the count text changes; Open lists days with an open session
  (`src/components/hr/review-attendance-view.tsx:72-76, 90`; `attendance.ts:618-619`). CURRENT quirk: on Completed, a day can
  show the Open badge when an open sibling session exists (the completion query has no status filter, `attendance.ts:641-656`).
- [ ] A4. Date presets Today, Last 7 days (default), This month, Custom.
  Expected: rows whose clock-in falls inside the business-day bounds of the range; clearing one custom field drops that
  bound (`src/lib/hr/attendance-paging.ts:57-80`; `attendance.ts:606, 615-616`).
- [ ] A5. Employee dropdown and name search together.
  Expected: the intersection; a search with no match shows an empty result without a query
  (`review-attendance-view.tsx:125-133`; `attendance.ts:604`).
- [ ] A6. Open Details on an open day and press "Set clock-out".
  Expected: a dialog titled "Set clock-out time"; Save disabled until a time and a non-blank reason exist
  (`review-attendance-view.tsx:723-742`; `tests/unit/attendance-clock-out-correct.test.tsx:89`).
- [ ] A7. Save with the prefilled time unchanged and a reason.
  Expected GENERIC: Save stays disabled until the value changes. CURRENT: refused with "Clock-out cannot be before
  clock-in." when the clock-in has seconds (T35). Record it. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] A8. Call the RPC with a whitespace-only reason (M5).
  Expected: "A correction reason is required." (`20260907130000:35-37`); the action refuses a missing reason too
  (`src/lib/hr/actions.ts:174`).
- [ ] A9. Save a time earlier than the clock-in.
  Expected: "Clock-out cannot be before clock-in." (`20260907130000:48-50`).
- [ ] A10. Save a future time (the input has no maximum, `review-attendance-view.tsx:766-773`).
  Expected: "Clock-out cannot be in the future." (`20260907130000:51-53`).
- [ ] A11. Save a valid time with a reason.
  Expected: "Clock-out corrected."; the same row has the new `time_out`, `edited_by` = `<admin>`'s profile id and
  `edit_reason`; `is_overtime` and `overtime_amount` unchanged; audit `attendance.clock_out_corrected` with `old_time_out`,
  `new_time_out` and `reason` (`attendance.ts:447-456`). The list row updates without changing filters
  (NEEDS VERIFICATION in a browser); the still-open Details dialog keeps the old times until reopened
  (`review-attendance-view.tsx:107, 495-503`).
- [ ] A12. Correct a completed clock-out across 22:00 business time, then open Payroll for that period.
  Expected CURRENT: the payroll night count changes (`20260907160000:41`) while the Review OT badge does not (the flag is set
  on INSERT only, `20260722200000:46-49`). Record it; the template asserts parity (T30). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] A13. Correct a session so that it ends after the same member's next session starts.
  Expected GENERIC: refused as overlapping. CURRENT: accepted, and the overlap is counted twice (no overlap check in
  `20260907130000:13-63`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] A14. Delete from Review Details: type `delete`, then `DELETE`.
  Expected: the button enables only on the exact word (`review-attendance-view.tsx:857`); "Attendance record permanently
  deleted."; the row is gone (RPC RECONSTRUCTED); the day's selfies stay as orphans (`attendance.ts:345-346`); audit
  `attendance.delete` with `permanent: true` (`:383-388`); the server re-checks the word (`actions.ts:146-148`).
- [ ] A15. Correct or delete a session inside a period that already has a paid payslip.
  Expected CURRENT: allowed; the derived payroll changes and the snapshot does not (no period lock). Record it; the template
  makes a period lock CONFIGURABLE and tests it in D19. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] A16. On the Attendance page (not Review), open a member's Details and send "Request delete" with a reason.
  Expected GENERIC: a pending `owner_approval_requests` row of kind `attendance_delete`, nothing deleted, audit
  `owner_approval.request`. CURRENT (default, key not granted): the button replaces Delete for a non-Super-Admin
  (`attendance-day-details.tsx:138-150`), but the request is refused because `<admin>` lacks `initiate_high_risk_action`
  (`src/lib/fulfillment/service.ts:502`); an `owner_approval.request` audit row with outcome denied is written (`:505-512`);
  nothing is inserted or deleted. The key is absent from Manage Access and from every migration (T32). Also record the
  inconsistency with A14: the same Admin deletes directly on Review. RECOMMENDED TEMPLATE IMPROVEMENT: one deletion policy
  on every screen (V4, T32).
- [ ] A16b. Variant with the key. As `<super-admin>`, open `/admin/staff` by URL (Super Admin only, no sidebar entry,
  `src/app/(app)/admin/staff/page.tsx:34-41`) and pick `initiate_high_risk_action` in `<admin>`'s "Grant a permission" select
  (`src/components/admin/staff-console.tsx:35, 173-195`). Then, as `<admin>`, repeat A16.
  Expected CURRENT: the grant succeeds with audit `team_member.permission_grant` (`src/lib/authz/account-management.ts:35-68`);
  the request creates one `owner_approval_requests` row with kind `attendance_delete`, status `pending_owner_approval` and
  `<admin>` as requester (`service.ts:522-535`; reason prefixed by `src/lib/authz/request-deletion.ts:22-26`); the attendance
  row still exists; audit `owner_approval.request` with `executed` false (`service.ts:541-553`). Leave the request pending
  for SA13.
- [ ] A17. Grant hr_payroll; open Payroll.
  Expected CURRENT: the tab bar appears (`src/app/(app)/admin/payroll/page.tsx:43-44`), but the table holds only `<admin>`'s
  own row (`20260907160000:100`) and Employee Rates lists only `<admin>` (`20260821140000:21-22`).
  RECOMMENDED TEMPLATE IMPROVEMENT: a view-all key (PERMISSIONS.md section 4.2).
- [ ] A18. Employee Rates, Edit rate: clear the effective date and save.
  Expected: "An effective date is required." (`src/lib/hr/rate.ts:217-220`). The money input already blocks letters and a
  third decimal (`src/components/ui/money-input.tsx:20-30`); their server refusal is covered by T14. With valid input: CURRENT
  the TypeScript path has no role guard; whether the database refuses an Admin is NEEDS VERIFICATION (RECONSTRUCTED RPC, N1).
  RECOMMENDED TEMPLATE IMPROVEMENT: the action guard (T14, I2).
- [ ] A19. Press "Generate Payslip" on your own row.
  Expected CURRENT: the deductions form is shown (`payslip-button.tsx:276-293`; manage flag from `payroll/page.tsx:43`), but
  the action is refused by `requireOwner` (`payslip-actions.ts:28`) and the error shows in the dialog.
  RECOMMENDED TEMPLATE IMPROVEMENT: show only what the server allows (T31).
- [ ] A20. Mark-paid conflict: with a pending payslip on your row (generated by the Super Admin), press Mark as Paid.
  Expected CURRENT (repo policy): the action passes `requireOwnerOrAdmin` (`payslip-actions.ts:106`), the update matches 0 rows
  under the Super-Admin-only policy (`20260722210000:62-65`), and the dialog shows "Could not mark the payslip as paid. It
  may already be paid." NEEDS VERIFICATION: the live policy may be wider (N2). The template asserts one agreed rule (T31).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] A21. Precondition: the Super Admin grants `view_reports` to `<admin>`; without it the Reports page returns "Page not found"
  (`src/app/(app)/reports/page.tsx:33`). Open Reports and use the full-data export button, which is shown by role to a Super
  Admin or an Admin (`:44, 67-69`).
  Expected CURRENT: allowed by role (`src/app/api/export/all/route.ts:18`); the Attendance sheet holds only your rows unless
  hr_review_attendance is held (`src/lib/export/data-export.ts:522-536`); the Payroll sheet holds your row; the Team sheet
  with rates is absent (`src/lib/export/sections.ts:24`). RECOMMENDED TEMPLATE IMPROVEMENT: the export key (I10).

### 3.4 SUPER ADMIN (role key owner), as `<super-admin>`

- [ ] SA1. Sign in with no explicit grants.
  Expected: all three pages open (`src/lib/authz/guard.ts:178-180`); the device manager shows on Attendance
  (`src/app/(app)/admin/attendance/page.tsx:107`); `<super-admin>` is absent from the roster, the payroll table and Employee
  Rates (`20260907160000:24, 99`; `src/lib/hr/rate.ts:137`).
- [ ] SA2. Register this device (browser A) with a label. Device run order: K10, SA2, K11, K12, SA3, SA4, K13 (section 3.2).
  Expected: a success notice and the approved status; the cookie is httpOnly, secure, sameSite lax, one year
  (`src/lib/hr/devices.ts:83-89`); a new `attendance_devices` row with a 64-character hex `token_hash` and `registered_by`;
  audit `attendance.device_register` with the label (`20260722150000:42-55`; `devices.ts:91-95`).
- [ ] SA3. Register browser B as well (run after K12).
  Expected: B is the only active device; A's row has `is_active` false and `revoked_at` set (`20260722150000:49`); A now shows
  the blocked banner.
- [ ] SA4. From the approved browser (browser B after SA3), open Manage and revoke the active device (run before K13).
  Expected CURRENT: one tap with no confirmation (`src/components/hr/device-manager.tsx:136-146`); the row is inactive with
  `revoked_at`; audit `attendance.device_revoke`; gating turns off (K13). The device list is reachable only from an approved
  browser (the Manage toggle renders only in the approved branch, `device-manager.tsx:75-90`).
  RECOMMENDED TEMPLATE IMPROVEMENT: confirm before revoke, and allow managing devices from any browser (V6).
- [ ] SA5. Review page: Set or Correct clock-out and Delete are available for every member; repeat A6 to A14.
- [ ] SA6. Payroll period.
  Expected: default From = first day of the business month and To = business today (`payroll/page.tsx:32-34`); From later
  than To gives zero totals, not an error (`20260907160000:44`); a malformed date shows "Payroll unavailable"
  (`src/components/hr/attendance-view.tsx:108-112`).
- [ ] SA7. Row contents for `<staff-a>` after K3 to K7 and a rate.
  Expected: Salary = round(days x rate + nights x bonus, 2) or "No rate set"; Overtime Hours = hours beyond 8 per session.
  CURRENT: the "Regular Hours" column shows total hours, and Status reads "Unpaid" even when no payslip exists
  (`attendance-view.tsx:164-220`). The template uses "Total hours" and a three-state pay status (V8).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] SA8. Set a rate inline, then again on Employee Rates.
  Expected: each save appends a `staff_salary_rates` row and writes audit `payroll.set_salary_rate` (`rate.ts:193-199,
  233-238`); Salary recomputes on reload. CURRENT: the inline editor defaults the effective date to the device's local date,
  the tab to the business date (`attendance-view.tsx:44-50`; `src/components/hr/employee-rates-view.tsx:43`); a future-dated
  rate shows as current (`rate.ts:139-143`). Record both. RECOMMENDED TEMPLATE IMPROVEMENT (V9, T15).
- [ ] SA9. Generate a payslip with deductions 0.
  Expected: the frozen document opens; a `payroll_snapshots` row with `generated_by` and payment_status pending; audit
  `payroll.payslip_generated` with `from`, `to`, `net_salary` (`src/lib/hr/payslip-actions.ts:88-93`); the row button reads
  "View payslip" (`src/components/hr/payslip-button.tsx:252-261`). The live generator body is RECONSTRUCTED (T12).
- [ ] SA10. Deductions: try to type a minus sign, then a third decimal.
  Expected: the money input blocks both (`src/components/ui/money-input.tsx:20-30`). Server refusal ("Deductions must be a
  non-negative amount like 0 or 500.00.", `payslip-actions.ts:49-55`) and the SQL clamp and check (`20260722210000:27, 93`)
  are covered by I2 and D12.
- [ ] SA11. Deductions larger than gross.
  Expected CURRENT: generation succeeds with a negative `net_salary` (`20260722210000:28, 125`; repo body; the live body is
  RECONSTRUCTED, NEEDS VERIFICATION, N1), and the Payroll Summary total is wrong (T33). Expected GENERIC: refused, or summed
  correctly, per the CONFIGURABLE choice. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] SA12. Mark as Paid.
  Expected: status Paid with the business date; `paid_at` and `paid_by` set (RECONSTRUCTED columns, N8); audit
  `payroll.payslip_marked_paid`
  (`payslip-actions.ts:99-154`); a repeat returns the "may already be paid" error; no un-pay path. CURRENT: no confirmation;
  RECOMMENDED TEMPLATE IMPROVEMENT: a confirmation step (V5).
- [ ] SA13. Approvals (run after A16b): open `/approvals` (Super Admin only, `src/app/(app)/approvals/page.tsx:22-25`); approve,
  then execute the pending `attendance_delete` request created in A16b.
  Expected: the record is deleted through `delete_attendance_record` (`src/lib/fulfillment/service.ts:735-739`); audit rows
  `owner_approval.decide` and `owner_approval.execute`, and no `attendance.delete` row on this path; a second execute is
  refused (`service.ts:691`).
- [ ] SA14. Download PDF and Print on a payslip.
  Expected: an A5 PDF (`src/lib/hr/payslip-pdf.ts:51-53`) named by the template's pattern (the reference prefix is
  PROJECT-SPECIFIC, section 7); amounts with a currency code and two decimals (`:21-31`). NEEDS VERIFICATION: open the file and
  check the night-shift label for a broken glyph (`:106` versus `:12-14`). Print shows only the payslip (`payslip-button.tsx:24-36`).
- [ ] SA15. Print Payroll Summary.
  Expected: offered only to the Super Admin and only when rows exist (`attendance-view.tsx:98-105`); the sheet lists every row
  and "Total payroll" = net where a payslip exists, else gross (`src/components/hr/payroll-summary-button.tsx:54-60`).
  NEEDS VERIFICATION: with more rows than one page, does the print paginate (the container is `position: fixed`, `:18-29`)?
- [ ] SA16. Manage Access: toggle hr_attendance, hr_review_attendance and hr_payroll for `<staff-a>` one at a time.
  Expected: independent toggles (`src/lib/authz/access-catalogue.ts:116-128`); nav items and page gates follow on the next
  request. CURRENT DEFECT: Manage Access has no toggle for `initiate_high_risk_action`; the key can be granted only on the
  legacy `/admin/staff` console (A16b, T32). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] SA17. Direct call (M5): `kiosk_clock_in` with the Super Admin's own profile id as the target.
  Expected GENERIC: refused. CURRENT: accepted, because the exclusion is roster-only (`20260907120000:30-37`). T4.
  RECOMMENDED TEMPLATE IMPROVEMENT.

---

## 4. Automated test plan for the template

Template builds use the DATABASE.md section 5.14 names: `attendance_records` = `attendance_sessions`, `attachments` =
`attendance_photos`, `staff_salary_rates` = `employee_pay_rates`, `staff_profiles` = `employees`, `device_id` =
`clock_in_device_id` and `clock_out_device_id`, `attendance_one_open_session_per_staff` = `attendance_sessions_one_open_uq`,
`computed_salary` = `gross_total`, `daily_rate` = `rate_amount` (PAYROLL.md section 11). The items below keep the reference
names where they also describe CURRENT; section 5 uses the same mapping.

### 4.1 Unit (Vitest)

- [ ] U1. Session grouping: sort by clock-in, number sessions, mark the second and later as continued, compute gaps, open
  flag, and no final out while open (mirror of `src/lib/hr/sessions.ts:65-129`; keep the cases in 1.3).
- [ ] U2. Day totals and rounding order: open sessions add 0, negative spans are ignored, and the screen total equals the SQL
  total. CURRENT rounds each session to 2 dp and then the sum (`src/lib/hr/format.ts:8-13`; `sessions.ts:90-91`), while SQL
  rounds the sum once (`20260907160000:79`). Arithmetic from the cited code: three completed sessions of 10 min 18 s each
  give 0.51 h on screen and 0.52 h in SQL. Template rounds once, in one place. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] U3. Night rule for both anchors, driven by configuration, over the D0 sessions: assert the set of qualifying work dates
  ({d3, d5, d6} for the clock-out anchor, {d4, d6} for the clock-in anchor, with a 22:00 start and no after-midnight window);
  the badge helper and the pay helper return the same set for the same anchor. RECOMMENDED TEMPLATE IMPROVEMENT (T30).
- [ ] U4. Money never becomes a float: amounts stay strings or integer minor units end to end (as `src/lib/hr/payroll.ts:38-68`
  does today); round money to 2 dp once.
- [ ] U5. Signed money parsing: "0" gives 0, "1234.5" gives 123450, "-100.50" gives -10050, "-0.50" gives -50; "abc" and
  "1.234" are refused; the summary total with one negative net equals the signed sum (T33); the PDF formatter keeps the sign
  (CURRENT does, `src/lib/hr/payslip-pdf.ts:24, 30`); the rate validator refuses negatives, letters and a third decimal (T14).
  RECOMMENDED TEMPLATE IMPROVEMENT: the signed summary parser (CURRENT drops the sign, T33).
- [ ] U6. Configuration validation against CONFIGURATION.md section 2.9, one failing case per rule (plus one passing
  configuration): rule 1, an unknown timezone name; rule 2, an "HH:MM" value with hour 24 or minute 60; rule 3, a money value
  with three decimals and a negative `bonusAmount`; rule 4, `defaultFrequency` outside `payFrequencies`, an empty
  `payFrequencies`, and a listed frequency without a label; rule 5, `defaultPageSize` outside `pageSizes`, a non-positive page
  size, and `defaultRangeDays` 0; rule 6, a grant key outside PERMISSIONS.md section 4.2, `owner` listed, and a grant set that
  breaks a PERMISSIONS.md 4.3 dependency; rule 7, a selfie mode other than `off` with a null retention; rule 8, selfie mode
  `required` and `deductionsModel` `itemized`; rule 9, a non-zero `overtimePayMultiplier`; rule 10, `approvalRequired` true
  without the day-review module and a lock value other than `off` without the lock checks; rule 11, `requestApprovalPath`
  true without the host approvals module; rule 12, a four-character `logoText`, a malformed `brandColor`, and illegal
  characters in `cookieNamePrefix` and `documentFilePrefix`; rule 13, `periodDefault` `current_preset` with no preset;
  rule 14, `rateBasis` `monthly`; rule 15, each onboarding key left null or empty, and a null night anchor or threshold
  while the night rule is enabled. Store limits and engine check (CONFIGURATION.md section 2.9, after rule 15), one failing
  case each: `overtimeDisplayThresholdHours` 0 and 24.5; `minHoursForDay` -1 and 25; a `bonusAmount` with eleven integer
  digits; `maxActiveDevices` 0, 1001 and 1.5; `maxWindowDays` 0, 3651 and 2.5; a blank and an 81-character `defaultLabel`;
  `clockMode` `self_service` without `self_clock_in` and `self_clock_out`.
- [ ] U7. Business-date helpers in the configured zone, including a zone with daylight saving: today, month start, add days,
  and day bounds (the reference fixed offset is only valid for a zone without it, `src/lib/hr/attendance-paging.ts:42-43`).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] U8. Paging helpers: quick ranges, day bounds, row filter, day-page assembly, today's summary, name match, page count
  (keep the `tests/unit/attendance-paging.test.ts` cases, re-parameterised by zone).
- [ ] U9. Duration formatting (keep the `tests/unit/hr-format.test.ts` duration cases; drop the legacy hourly cases).
- [ ] U10. PDF helpers: file-name pattern and sanitising, money string with the configured currency code, and a label set that
  uses only glyphs the chosen font has (T16).
- [ ] U11. Correction prefill helper, minute precision (IMPLEMENTATION_PROMPT.md R7 and R8): the value is `time_in` rounded up
  to the next minute for an open session and the stored `time_out` truncated to its minute for a completed one; a chosen value
  in the same minute as the stored `time_out` is "unchanged"; a value that is not a whole minute is refused by the validator
  (T35). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] U12. Kiosk state resolver from the status reader's result: an open session wins; a clock-out today without an open
  session gives Continue Duty; otherwise Clock In; a session opened on an earlier day shows its date (T19, K16).
  RECOMMENDED TEMPLATE IMPROVEMENT.

### 4.2 Database (pgTAP), run after a clean reset

The code template ships `templates/attendance-payroll/migrations/0008_selftest.sql` (plain SQL, not pgTAP; one transaction
that ends in ROLLBACK). It asserts IMPLEMENTATION_PROMPT.md T3 with its variations, the catalog checks of Z1, Z2 and Z5 (and
of D9), part of Z3 (a direct `app_private.payroll_lines` call is filtered; internal functions have no end-user EXECUTE), and
parts of D1 to D3, D5 to D8, D12 to D16, D20 and D23. It does not exercise device modes `required` and `off`,
`attendance.allowMultipleSessionsPerDay = false`, `attendance.correction.maxWindowDays`, storage policies, or modules it
does not build (D19, D22, `review_attendance_page`, self-service clocking), and it uses the T3 fixture, not D0. Port its
assertions into the pgTAP suite.

- [ ] D0. Fixtures (synthetic, inserted by the privileged test role with explicit `work_date`, times in the business zone):
  accounts as in M1; one active device; period day 1 to day 7. The session times, rates and the 22:00 night start used with
  them in U3, D10 and D11 are arbitrary test data chosen so the same rows can also be run against CURRENT; they are never
  template defaults, and a template build sets the night keys from its own configuration. The canonical fixture for the
  template's pay computation is IMPLEMENTATION_PROMPT.md T3 (non-reference threshold and amount); D0 and D10 supplement it.
  `<staff-a>` rates: 100 effective d1, 120 effective d4, 150 effective d9.
  `<staff-a>` sessions: d1 09:00-17:00; d2 09:00-12:00 and 13:00-17:00; d3 14:00-22:30; d4 22:15 to 00:30 next day;
  d5 18:00-22:00; d6 22:00-22:30 and 22:45-23:45; d7 09:00 open.
  `<staff-b>`: rate 100 effective d1, no sessions. `<admin>`: d1 09:00-17:00, no rate.
  `<super-admin>`, `<demo-1>` and `<staff-c>`: one completed session on d1 and a rate each.
- [ ] D1. One open session: a second `kiosk_clock_in` for the same member raises the "already clocked in" message; a direct
  insert by the privileged role raises 23505 on `attendance_one_open_session_per_staff`.
- [ ] D2. `kiosk_clock_in` gates: inactive operator refused; operator without the kiosk key refused (template); unknown,
  inactive, demo and exempt targets refused with exact messages; `work_date` equals the configured zone's date of `now()`
  (the early-morning edge is covered through a date helper that accepts an instant, U7); `device_id` stored; with an active
  device, a null, unknown or revoked device (or token, if the template binds the token) is refused.
  RECOMMENDED TEMPLATE IMPROVEMENT: the kiosk key and the exempt-target refusal (T4, T5).
- [ ] D3. `kiosk_clock_out` (template DDL, T6): closes only the named member's open session, returns its id, refuses when none
  is open, refuses an inactive operator or one without the key, enforces the device rule. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D4. Night flag: the template stores no night flag and has no night trigger (DATABASE.md section 5.3;
  IMPLEMENTATION_PROMPT.md P8). Assert that `attendance_sessions` has no night column and no night trigger; the night result
  is covered by U3 and D10. RECOMMENDED TEMPLATE IMPROVEMENT (T3).
- [ ] D5. `correct_attendance_clock_out`: Staff refused; a JWT with no profile refused (NULL-role branch); a deactivated Admin
  refused. CURRENT: the live role helper returns the role key without an active check (`20260715130000:54-57`), so a
  deactivated Admin's still-valid JWT passes the SQL gate (`20260907130000:29-33`); the refusal through the `'inactive'`
  sentinel is PENDING (not live) (`20260916120000:46-57`). Blank reason, unknown id, null, before-clock-in and future values
  refused with exact messages; success writes `time_out`, `edited_by`, `edit_reason` and returns the old value; the flag columns
  unchanged; (template) overlap with the member's adjacent session refused; (template) the row is locked while it is read and
  updated (CURRENT has no lock, `20260907130000:39-40`); (template) a value that is not a whole minute is refused; (template) an
  unchanged save on a completed session whose `time_out` has seconds (its own minute sent as a whole minute) is refused and
  leaves `time_out`, `edited_by`, `edited_at` and `edit_reason` unchanged (CURRENT accepts it and rewrites `time_out` to the
  start of its minute, `src/components/hr/review-attendance-view.tsx:674-679`). RECOMMENDED TEMPLATE IMPROVEMENT: the
  deactivated-caller refusal, the overlap and lock rules, and the minute-precision refusals.
- [ ] D6. `delete_attendance_record` (template DDL): Staff refused; allowed per the delete key; the configured
  `attendance.deletion.mode` is asserted: `hard` removes the row after the function audits the deleted values; `soft` sets
  `deleted_at`, `deleted_by` and `delete_reason`, and every reader, the one-open-session index, `report_payroll` and the export
  exclude the row. In both modes `authenticated` still has no DELETE privilege on the table, the selfie handling decision is
  asserted, and the RPC writes its own audit row (Z10). CURRENT is a hard delete through a RECONSTRUCTED RPC
  (`src/lib/hr/attendance.ts:341-347`), audited by the app (`:383-388`); whether the RPC body audits is NEEDS VERIFICATION
  (N1). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D7. `list_clock_staff`: raises without hr_attendance; returns active members that are not exempt and not demo (CURRENT
  lists demo, T4); returns no email or other personal columns (CURRENT returns `id, full_name, role_key`, `20260907160000:10`).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D8. RLS per role for every table, asserted as `<super-admin>`, `<admin>`, `<staff-a>`, `<staff-b>`, a deactivated account
  and `anon`:
  `attendance_records`: SELECT own, all with the review key, all for the Super Admin; INSERT and UPDATE refused for
  `authenticated` (CURRENT allowed, `20260717120000:59-75`); no DELETE privilege.
  `attendance_devices`: SELECT only with the devices key; no write policy; RLS forced (CURRENT not forced, `20260722150000:30`).
  `attachments` and `storage.objects` for attendance photos: read by reviewers and the subject; insert only by the operator
  recorded for that kind, under that session path prefix (CURRENT any active staff, `20260716300000:127-142, 159-165`).
  `staff_profiles`: SELECT own or Super Admin (`20260821140000:21-22`); reviewer names come from the definer reader (T34).
  `staff_salary_rates` (RECONSTRUCTED): read own or with the view-all key; writes only through the rate RPC.
  `payroll_snapshots`: read own or with the view-all key; insert and update only through RPCs; no delete.
  `audit_events`: update and delete refused by trigger (`20260715120000:115-133`); insert self-attributed
  (`20260715130100:664-670`); Staff cannot read payroll money (CURRENT can, `:661-662`; PENDING (not live) narrows).
  `owner_approval_requests`, if the request path is kept: insert self-attributed by request-key holders
  (`20260715130100:566-571`); decide and execute Super Admin only.
  RECOMMENDED TEMPLATE IMPROVEMENT: every CURRENT difference named in this item.
- [ ] D9. Definer functions: for every `public` SECURITY DEFINER function of the module, `has_function_privilege` is false for
  `anon` and PUBLIC, true for `authenticated`, and `proconfig` sets `search_path` to the empty string. CURRENT: the repo revokes
  PUBLIC and `anon` explicitly only for the device RPCs (`20260722170000:8-18`), `list_clock_staff` (`20260806260000:17, 33-34`)
  and `correct_attendance_clock_out` (`20260907130000:65-68`); `kiosk_clock_in`, `kiosk_clock_out`, `delete_attendance_record`
  and the rate RPCs have no revoke in the repo before the PENDING (not live) bulk revoke (`20260916120000:76-110`), so per the
  repo this assertion is expected to fail for them; the live grants are NEEDS VERIFICATION (N4). See Z1.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D10. `report_payroll(d1, d7)` as `<super-admin>`, with B = the configured night bonus:
  `<staff-a>`: total_hours 31.25; overtime_hours 0.50 (only the 8.5 h session exceeds 8); days_worked 6 (the open d7 session
  is excluded); night days {d3, d5, d6} with the clock-out anchor (night_shifts 3; d4 ends 00:30; d6 counts once) or {d4, d6}
  with the clock-in anchor (night_shifts 2); daily_rate 120 (newest effective at or before d7; the d9 rate is ignored);
  computed_salary = round(6 x 120 + night_shifts x B, 2), which is 720 + 3B with the CURRENT clock-out anchor.
  `<staff-b>`: zeros and computed_salary 0.00. `<admin>`: days_worked 1 and computed_salary NULL.
  Absent: `<super-admin>`, `<demo-1>`, `<staff-c>`.
  As `<staff-a>` and `<admin>`: only the own row (CURRENT `20260907160000:100`; template: all rows only with the view-all key).
  As `anon`: no EXECUTE. RECOMMENDED TEMPLATE IMPROVEMENT: the view-all key (A17).
- [ ] D11. After-midnight clock-out: the configuration states whether d4 qualifies (CURRENT: it does not,
  `20260907160000:41`); D10 and U3 agree with that setting.
- [ ] D12. `generate_payslip_snapshot` for `<staff-a>`, d1 to d7, deductions 50: stores days, nights, rate, basis, regular pay,
  night pay, gross, deductions and net matching the D10 row and the formula adopted in PAYROLL.md (CURRENT `days_worked`,
  `night_shifts`, `daily_rate` and `rate_basis` are RECONSTRUCTED columns, N8); `generated_by` set;
  refused without a payroll row (CURRENT `20260722210000:102-104`); negative deductions clamped to 0 (CURRENT `:93`) or refused
  per the template; negative net per the CONFIGURABLE rule; a second generation for the same employee and period follows the
  template's uniqueness rule (CURRENT allows it and the newest wins, `src/lib/hr/payslip.ts:55-82`).
  RECOMMENDED TEMPLATE IMPROVEMENT: the deductions, negative-net and uniqueness rules.
- [ ] D13. Snapshot immutability: after generation, change the rate and correct a session; every money column of the snapshot
  is unchanged; (template) an UPDATE of a money column is refused while the payment columns stay writable through the
  mark-paid RPC (CURRENT the Super Admin can update any column, `20260722210000:62-68`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D14. Mark paid: the allowed key flips pending to paid exactly once; a second call changes 0 rows; a caller without the key
  is refused; `paid_by` references a profile; no money column changes. CURRENT `paid_at` and `paid_by` are RECONSTRUCTED
  columns whose type and foreign key the repo does not show (N8); the template ships their DDL. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D15. Rates: the rate RPC is refused without the rate key and for a NULL role; it appends a row; it refuses a negative
  amount, an unknown frequency and a missing effective date; the current-rate reader applies the CONFIGURABLE future-date rule.
  CURRENT `staff_salary_rates` and its CHECK constraints are RECONSTRUCTED (N8), so the template ships the DDL these assertions
  rely on. RECOMMENDED TEMPLATE IMPROVEMENT (T14, T15).
- [ ] D16. Device RPCs: register as Staff or Admin refused; register as the key holder deactivates the previous device and
  stores a 64-character hex hash, never the token; verify returns an id only for an active token; revoke sets `is_active`
  false and `revoked_at`; gating follows the configured mode. RECOMMENDED TEMPLATE IMPROVEMENT: the gating mode (K13).
- [ ] D17. Deleting a member aborts on the ON DELETE RESTRICT foreign keys (delete function `20260722120000:1-8`) when the member
  has attendance sessions (`20260717120000:24`), has payslips (`20260722210000:17`), or uploaded selfies as the kiosk operator
  (`attachments.uploaded_by`, `20260716300000:95`). CURRENT selfies whose subject is the member link through the polymorphic
  `related_entity_id`, which has no foreign key (`src/lib/hr/attendance.ts:345-346`), so they are not protected. In the template
  the photo row references its session (DATABASE.md section 5.7), so the session's key protects it.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D18. Replay: the whole suite runs on a database built only from the template's migrations (T28).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D19. Period lock, only when `payroll.lockPeriodAfterPayslip` is not `off` (IMPLEMENTATION_PROMPT.md R12; DATABASE.md 5.5).
  With a current payslip for `<staff-a>` covering d1 to d7: `correct_attendance_clock_out` and `delete_attendance_record` on a
  d3 session are refused with a message naming the period (under `generated` for a pending or paid payslip, under `paid` only
  for a paid one); a session outside the period, and a superseded or void payslip, do not lock. With `off`, both calls
  succeed. CURRENT has no lock (A15). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D20. Void, only when `void_payslip` is built (IMPLEMENTATION_PROMPT.md P14-P15; DATABASE.md 5.9, 5.13): refused without
  the generate key; a blank reason refused; pending to void and paid to void allowed, void to anything refused; a voided paid
  row keeps `paid_at` and `paid_by` and stamps `voided_at`, `voided_by` and `void_reason`; generating a new payslip for a period
  whose current row is paid is refused until that row is voided, then succeeds. When void is not built: no void function
  exists and a paid period cannot be regenerated. CURRENT has no void and no un-pay path (SA12).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D21. Generation without an effective rate: `generate_payslip_snapshot` for `<admin>` (a payroll row but no rate, D0) is
  refused and inserts no row (DATABASE.md 5.13 notes). CURRENT `report_payroll` returns a NULL salary without a rate
  (`20260907160000:86-93`); the repo generator body treats a missing rate as 0 (`20260722210000:113`), but the live body is
  RECONSTRUCTED, NEEDS VERIFICATION (N1). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D22. Day approval, only when `payroll.approvalRequired` is true (IMPLEMENTATION_PROMPT.md R11; DATABASE.md 5.5):
  `report_payroll` and generation count only sessions whose (employee, work_date) review row is approved; correcting or
  deleting a session on an approved day returns that day to pending and drops it from the count; `review_attendance_day` is
  refused without its key (default `attendance.correct`, PERMISSIONS.md section 4.2; IMPLEMENTATION_PROMPT.md Q14 asks only
  whether the client changes it) and for a NULL role; `attendance_day_reviews` has RLS forced, SELECT
  for self or the team key, and no direct writes. With the setting false, every completed session counts (CURRENT
  `20260907160000:43-44`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] D23. Direct call to the payroll engine (IMPLEMENTATION_PROMPT.md P16 and T2; DATABASE.md 5.13): with the D0 fixtures,
  `select * from app_private.payroll_lines(d1, d7)` as `<staff-a>` returns exactly one line, its own; as `<staff-b>` only its
  own zero line; as an Admin holding `payroll.view_all` every eligible line and no line for `<super-admin>`, `<demo-1>` or
  `<staff-c>`; as `anon` it is refused. For each caller the result equals `report_payroll(d1, d7)` for the same caller. No other
  private function that returns pay data is executable by `authenticated`. CURRENT has no engine function (the filter is in
  the INVOKER body, `20260907160000:100`). RECOMMENDED TEMPLATE IMPROVEMENT.

### 4.3 Integration (Vitest)

- [ ] I1. Page gates per role: for each page and each of Super Admin, Admin without grants, Staff without grants and Staff with
  the page key, assert `notFound()` or render; Admin has no implicit key.
- [ ] I2. Action guards run before any database access: page loaders, selfie loader, clock in and out (kiosk key and device),
  correct, delete, request deletion, generate, mark paid, rate save (CURRENT none, `src/lib/hr/rate.ts:201-231`), device
  register and revoke; including the server-side validation messages for deductions (`payslip-actions.ts:49-55`) and rates
  (`rate.ts:209-220`). RECOMMENDED TEMPLATE IMPROVEMENT: the kiosk key and rate-save guards (T22, T14).
- [ ] I3. Extended static sweep: `.rpc(` counts as a write alongside `.insert(`, `.update(` and `.delete(`; each exported writer
  in the HR modules (including files named `*-actions.ts`) is asserted to call a guard before its first database call; dead code
  cannot satisfy the sweep for another export; every exception entry must name live code (1.5). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] I4. The delete action refuses any confirmation text other than the exact configured word, server-side.
- [ ] I5. The request-deletion action fails closed without the request key and, with it, creates one pending request and deletes
  nothing.
- [ ] I6. No write retry: a failing clock-in issues exactly one RPC request (keep `tests/unit/retry-fetch.test.ts:40, 61`;
  wiring `src/lib/supabase/server.ts:26-30`).
- [ ] I7. The device cookie is set with httpOnly, secure, sameSite lax, path / and the configured max-age, and is read only by the
  device verifier (CURRENT `src/lib/hr/devices.ts:45-53, 83-89`).
- [ ] I8. Audit events: every write path writes its named event with the documented context keys, including denied and failed
  outcomes (CURRENT for correct and delete, `src/lib/hr/attendance.ts:354-388, 408-456`; CURRENT rate saves audit success only,
  `rate.ts:229-238`). RECOMMENDED TEMPLATE IMPROVEMENT: denied and failed outcomes on every path.
- [ ] I9. Read failures surface as errors: the paged reader returns an error shape on a count or row error and the page renders the
  read-error component, not the empty state (T18); the payslip status reader does the same (CURRENT returns an empty map,
  `src/lib/hr/payslip.ts:73`, so every row reads unpaid). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] I10. Export: the route checks the export key as well as RLS (CURRENT checks role only, `src/app/api/export/all/route.ts:18`);
  the Attendance and Payroll sheets carry the documented columns; sheets with rates require the view-all key.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] I11. The kiosk status reader returns the correct open and clocked-out-today state of every member to an operator without
  the review key (T19). RECOMMENDED TEMPLATE IMPROVEMENT.

### 4.4 UI (Vitest and Testing Library; component names from UI_UX.md section 9)

- [ ] V1. AttendanceClockCard and CurrentAttendanceStatus: no selection; empty roster; idle (Clock In); open session (Clock Out
  and the time, with the date when not today); clocked out today (Continue Duty); Continue Duty confirmation with Cancel and
  Confirm; camera step with Cancel and Capture; camera error with the without-photo button; submitting (buttons disabled);
  success notice and return to idle; error alert; buttons disabled while the device is blocked (template); selfie upload
  returned as an error (success notice with the selfie warning); selfie upload that throws (template: success notice with a
  selfie warning, no clock error, return to idle; CURRENT shows "Could not clock in/out" after a committed clock event, K9 case (b)).
  RECOMMENDED TEMPLATE IMPROVEMENT: the date on an older open session, the disabled buttons and a separate `try`/`catch` for
  the selfie upload (K9, K11, K16, T20).
- [ ] V2. ClockOutCorrectionModal: "Set clock-out" for open, "Correct clock-out" for completed; prefill per U11; the picker sends
  hour and minute only; Save disabled until a reason is typed and, for a completed session, the chosen minute differs from the
  stored `time_out`'s minute; the submitted instant equals the intended business-time instant; server errors
  render in the dialog; the dialog closes once per new success. RECOMMENDED TEMPLATE IMPROVEMENT (T25, T35).
- [ ] V3. AttendanceReviewFilters: tabs re-query at page 1; presets and custom bounds; employee dropdown and search intersect;
  300 ms debounce; count text and pagination footer; the phone sheet shows the active filter count.
- [ ] V4. AttendanceDeleteModal: critical (Escape and overlay do not close it); enabled only on the exact word; one delete policy
  on the Attendance and Review screens (CURRENT differs, A14 versus A16). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] V5. PayslipModal and PayslipDocument: no snapshot with the generate key (deductions form and Generate); no snapshot
  without it (read-only text and no Generate in the footer); pending snapshot (document, Download PDF, Print, Mark as Paid only
  with the mark-paid key, behind a confirmation); paid snapshot (no Mark as Paid); one status vocabulary on screen, PDF and summary.
  RECOMMENDED TEMPLATE IMPROVEMENT: CURRENT shows Generate without the right (S11, A19) and has no confirmation (SA12).
- [ ] V6. DeviceManager: not-registered status with Register; approved status with Manage; register dialog; revoke with a
  confirmation; the device list reachable for the key holder from any browser. RECOMMENDED TEMPLATE IMPROVEMENT (SA4).
- [ ] V7. AttendanceHistory, AttendanceReviewTable and AttendanceDayCard: one open or completed vocabulary; the multi-session
  marker; the OT badge on both screens (CURRENT Review only); the read-error state distinct from the empty state; count text
  that counts the days shown (CURRENT counts session rows). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] V8. PayrollTable and PayrollEmployeeRow: "Total hours" label (CURRENT "Regular Hours" shows total hours); three-state pay
  status (not generated, pending, paid); inline rate editor only with the rate key; "No rate set" for a NULL salary; summary
  button per its rule; the actions cell spans the phone card (W1). RECOMMENDED TEMPLATE IMPROVEMENT (SA7).
- [ ] V9. EmployeeRatesTable and RateEditor: one editor; the effective date defaults to the business date and is required; the
  success message is shown; each Edit button has an accessible name that includes the member's name.
  RECOMMENDED TEMPLATE IMPROVEMENT: CURRENT has two editors with different date defaults (SA8).
- [ ] V10. Nested dialogs: Escape inside ClockOutCorrectionModal closes only that dialog, not AttendanceDayDetailsModal (CURRENT
  every open modal adds a document-level Escape listener, `src/components/ui/modal.tsx:134-146`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] V11. PayrollPeriodSelector: From after To is refused with a message (CURRENT no validation,
  `src/components/hr/attendance-view.tsx:76-97`); configured presets fill both dates. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] V12. AttendanceSummaryCards: present today, clocked in now (open sessions of any date) and completed today
  (`src/lib/hr/attendance-paging.ts:141-150`).
- [ ] V13. PayrollSummaryDocument: the total with a negative net equals the signed sum (T33); status labels match V5.
  RECOMMENDED TEMPLATE IMPROVEMENT.

### 4.5 Responsive checks (browser, real or emulated)

Widths and pixel figures below are arithmetic from the cited CSS classes, not measurements; confirm each in a browser.
The width list is 360, 390, 430, 640, 768, 1024 and 1280 px, the same list as IMPLEMENTATION_PROMPT.md T7 and
INTEGRATION_GUIDE.md Step 13.1.

- [ ] W1. 360 px: the bottom bar shows full labels from 360 px (`src/components/shell/app-sidebar.tsx:579-582`); HR screens are
  reached through More; the three summary tiles fit three across (`src/components/hr/attendance-summary-cards.tsx:24`) and
  "Completed today" may wrap; history and Review render as card lists; Filters shows the active count; every dialog is a bottom
  sheet with safe-area padding (`modal.tsx:156, 190`); payslip columns stay two across (`payslip-button.tsx:105`), so long labels
  wrap; payroll rows stack as cards (`src/app/globals.css:315`) and the actions cell spans the card (CURRENT labelled "Actions").
  RECOMMENDED TEMPLATE IMPROVEMENT: the unlabelled, full-width actions cell.
- [ ] W2. 390 px: same layout; payslip amounts are not truncated; the kiosk select and the Capture button stay above the fixed
  bottom bar (content bottom padding, `app-sidebar.tsx:524`).
- [ ] W3. 430 px: same layout; nothing changes between 360 and 639 px except the bottom-bar labels; the Payroll Summary table
  (`payroll-summary-button.tsx:102`) scrolls horizontally inside the sheet.
- [ ] W4. Tablet 768 px portrait: tables and inline filters appear from 640 px while the phone header and bottom bar remain
  until 1024 px; the history table (`attendance-records.tsx:338`) and Review table fit; the payroll table
  (`attendance-view.tsx:118`) scrolls horizontally, so check the actions column is reachable; dialogs become centred cards.
- [ ] W5. Tablet 640 px: the history and Review tables scroll horizontally inside their containers; sticky headers do not pin
  during page scroll (CURRENT, `src/app/globals.css:222-226`); nothing overflows the viewport.
- [ ] W6. Desktop 1024 px with the sidebar expanded and collapsed: no page-level horizontal scroll; the payroll table still
  scrolls inside its card until the content width reaches its minimum.
- [ ] W7. Desktop 1280 px: no horizontal scroll anywhere; dialogs at their size tokens sm 460, md 640, lg 780 (`modal.tsx:29-31`).
- [ ] W8. Touch targets on a coarse pointer (a touch device, at any width): filter selects, date inputs, the typed-word input, rate
  buttons and selfie links reach 44 px. CURRENT: the 44 px hit area is a `pointer: coarse` rule on the `.tap-44` class
  (`src/app/globals.css:396-409`), applied only to controls that carry the class, such as the Review tabs and row buttons
  (`src/components/hr/review-attendance-view.tsx:194, 278, 392, 721`); the inline rate button has no such class
  (`src/components/hr/attendance-view.tsx:272-276`). RECOMMENDED TEMPLATE IMPROVEMENT: every listed control.
  Focus zoom. CURRENT: the shared Input uses 16 px text (`text-base`, `src/components/ui/input.tsx:13-14`), but the raw selects
  and textareas on the HR screens use 14 px (`text-sm`): the kiosk member select (`src/components/hr/attendance-clock.tsx:223`),
  the history and Review filter selects (`src/components/hr/attendance-records.tsx:48-49`; `review-attendance-view.tsx:60-61`),
  the rate frequency selects (`attendance-view.tsx:319`; `src/components/hr/employee-rates-view.tsx:114`) and the correction
  reason textarea (`review-attendance-view.tsx:787`). RECOMMENDED TEMPLATE IMPROVEMENT: every select, textarea and
  input uses at least 16 px text so iOS does not zoom on focus. Whether iOS actually zooms on the reference controls is NEEDS
  VERIFICATION on an iPhone.
- [ ] W9. Dark theme at each width: the payslip and summary sheets stay white with dark text, including the summary table header
  (CURRENT the shared table header background may render dark, NEEDS VERIFICATION).
- [ ] W10. Installed PWA on a phone: the camera permission prompt appears and the selfie step works; the device cookie survives an
  app relaunch (NEEDS VERIFICATION on a physical device).

### 4.6 Print and PDF checks

- [ ] P1. Payslip print preview: only the payslip is visible (`src/components/hr/payslip-button.tsx:24-36`); margins and paper
  size follow the template's `@page` rule (CURRENT has none); the document fits A4, A5 and Letter. RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] P2. Payroll Summary print preview with 40 rows: the sheet paginates (CURRENT container is `position: fixed`,
  `payroll-summary-button.tsx:18-29`; NEEDS VERIFICATION); the total row prints; the header is present on page 1.
- [ ] P3. Privacy mode: amounts masked on screen print as real values (`src/components/shell/privacy.tsx:113-119`).
- [ ] P4. Generated PDF: opens in two viewers; every label renders with no replacement glyph; amounts have two decimals and the
  configured currency code; the file name matches the pattern; page size per configuration.
- [ ] P5. Paid and pending payslips print the correct status line and date, in the same vocabulary as the screen (V5).
- [ ] P6. A negative net prints with its sign on the payslip, the PDF and the summary total (T33). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] P7. PDF library: the template pins a version without the critical advisory recorded for the reference's jsPDF 2.5.2
  (`docs/SYSTEM-AUDIT-2026-09-16.md:136`), or replaces the library. RECOMMENDED TEMPLATE IMPROVEMENT.

---

## 5. Security regression checklist

Run on every change to migrations, guards or actions. Z1 to Z15 are tests or catalog queries; Z16 is a static check. Template
builds read the reference table and column names below through the mapping at the start of section 4.

- [ ] Z1. Every `public` SECURITY DEFINER function has EXECUTE revoked from PUBLIC and `anon`, granted to `authenticated` (and
  `service_role` where a job needs it). CURRENT explicit revokes exist for the device RPCs (`20260722170000:8-18`),
  `list_clock_staff` (`20260806260000:17, 33-34`) and `correct_attendance_clock_out` (`20260907130000:65-68`); none in the
  migrations before the PENDING (not live) one for `kiosk_clock_in`, `kiosk_clock_out`, `delete_attendance_record` or the rate
  RPCs. PENDING (not live) revokes PUBLIC and `anon` in bulk (`20260916120000:76-110`) and explicitly for `kiosk_clock_in`
  (`:487-488`). Default privileges re-grant on every CREATE (`20260916120000:12-14`), so run the check after each migration.
  RECOMMENDED TEMPLATE IMPROVEMENT: an explicit revoke and grant beside every definer function the template creates.
- [ ] Z2. Every SECURITY DEFINER function sets `search_path` to the empty string, checked per function with a catalog query on
  `pg_proc.proconfig`. CURRENT content test is per file: a migration with one pinned and one unpinned definer passes
  (`tests/unit/security-guards.test.ts:130-135`). RECOMMENDED TEMPLATE IMPROVEMENT: the per-function check.
- [ ] Z3. The `app_private` schema grants no usage to `anon` (`20260715130000:246-247`), and every private function an INVOKER
  reader calls either filters by the caller (`app_private.payroll_lines`) or is not executable by end users; accessors that
  return no pay data (for example the settings readers) are executable by `authenticated` (N4). A direct call to
  `app_private.payroll_lines` as `<staff-a>` returns only the own line, and as a `payroll.view_all` holder every eligible line,
  equal to what `report_payroll` returns to the same caller (D23).
- [ ] Z4. No frontend-only gates. Each rule below has a test that bypasses the UI: kiosk key on clock in and out (CURRENT page and
  roster only); target exemption (CURRENT roster only); device rule on both clock events (CURRENT app only; PENDING (not live)
  clock-in only, bound to the device id); correct and delete (CURRENT SQL role gate for correct, RECONSTRUCTED for delete);
  generate, mark paid and rate edit (CURRENT UI wider than server, T31); request deletion (CURRENT key required but not
  in Manage Access, grantable only on the legacy console, T32); export (CURRENT role only); print summary (CURRENT UI only; the data is already RLS-scoped).
  RECOMMENDED TEMPLATE IMPROVEMENT: every rule whose CURRENT enforcement is named above as UI, roster or app only.
- [ ] Z5. Direct table writes are closed: `authenticated` cannot INSERT or UPDATE `attendance_records`, `payroll_snapshots` money
  columns, `attendance_devices` or `staff_salary_rates` except through the definer RPCs; no DELETE grant on any HR table;
  `attendance_devices` has RLS forced (CURRENT not forced, `20260722150000:30`). CURRENT `authenticated` may INSERT and UPDATE
  `attendance_records` under RLS per the repo (`20260717120000:59-75`; live policies N2). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Z6. Deactivated and profile-less callers: every role or key gate refuses a deactivated JWT (the `'inactive'` sentinel,
  PENDING (not live) `20260916120000:46-57`) and a JWT with no profile (an explicit NULL branch, as `20260907130000:30` has).
  `current_staff_id()` ignores `is_active` (`20260715130000:28-39`), so every self-scoped policy also needs an active check.
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Z7. Definer functions that write the FORCE-RLS `attendance_records` table are owned by a role that bypasses RLS, or explicit
  policies cover the function's owning role (`20260717120000:47-48`); check `pg_proc.proowner` and `pg_roles.rolbypassrls` (N4).
- [ ] Z8. Selfie access: metadata and objects readable only by reviewers and the subject; insert only by the operator recorded
  for that kind, under that session path prefix; signed URLs expire (CURRENT 300 s with a download disposition, `src/lib/hr/attendance.ts:544-549`); in and out are
  an explicit column, not a file-name substring (CURRENT `:553`); one photo per slot is deterministic (CURRENT the slot is filled
  after each asynchronous signing resolves, `:542-555`, so which of two uploads wins is not fixed).
  RECOMMENDED TEMPLATE IMPROVEMENT (T21).
- [ ] Z9. Selfie retention runs as a service-role job through the Storage API if the client requires deletion (objects cannot be
  deleted from SQL in the reference stack, `scripts/purge-attendance-selfies.mjs:7-9`); no template script embeds a project URL
  (the reference script does in its usage block, `:24-25`). RECOMMENDED TEMPLATE IMPROVEMENT (T36).
- [ ] Z10. Audit rows: every HR write path writes its event, including denied and failed outcomes; a successful direct RPC call
  is audited inside the RPC, and a refused direct RPC call leaves a row only on the typed-refusal path (a raise rolls back
  the row; SERVER_API.md section 9.1 rule 8) (CURRENT SQL RPCs write none, `20260907130000:13-63`); `audit_events` stays append-only
  (`20260715120000:115-133`); Staff cannot read payroll figures in audit context (CURRENT can, `20260715130100:661-662`).
  RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Z11. Device binding: the clock RPCs verify the token hash, not a client-supplied device id that Staff can read from their own
  rows (PENDING (not live) residual, `20260916120000:431-432`); gating fails closed when its read errors (CURRENT fails open,
  `src/lib/hr/devices.ts:38-42`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Z12. Headers: `Permissions-Policy` keeps `camera=(self)` and `X-Frame-Options` stays SAMEORIGIN for same-origin print
  previews; adding a Content-Security-Policy must not break the inline theme and print scripts, which need nonces first
  (`next.config.ts:31-50`).
- [ ] Z13. Identity and MFA: no hard-coded identity constant (CURRENT one in `src/lib/authz/guard.ts:281`); MFA for payroll and
  access management is CONFIGURABLE (CURRENT `requireAal2` is never called, `guard.ts:374-380`). RECOMMENDED TEMPLATE IMPROVEMENT.
- [ ] Z14. Fixtures, scripts and docs contain no real names, emails, phone numbers, production ids, project URLs, tokens or keys;
  grep the template for an at-sign, `https://` and 32-character hex strings before release.
- [ ] Z15. Realtime and caching: only the module's tables are in the publication and RLS decides what each subscriber receives
  (CURRENT `20260731130000:27-28, 33`); no page HTML is cached by the service worker (`tests/unit/pwa-cache-policy.test.ts:53-68`).
- [ ] Z16. Static check: no comment in the template states an authority model the code does not enforce. CURRENT examples to
  correct before porting: clocking described as self-service (`src/app/(app)/admin/attendance/page.tsx:34-35`); payslip actions
  described as Super-Admin-only for both acts (`src/lib/hr/payslip-actions.ts:13-15` versus `:106`); the rate module header
  (`src/lib/hr/rate.ts:9-20` versus `:201-231`); "Attendance is never deleted" (`src/lib/hr/attendance.ts:51-55`).
  RECOMMENDED TEMPLATE IMPROVEMENT.

---

## 6. NEEDS VERIFICATION: read-only checks before trusting CURRENT rows

These queries settle open questions about the reference implementation, so they only mean something when run against the
reference implementation's own database, read-only, by the person responsible for that database. Never run them through
connectors or accounts that belong to another client. They read the catalog and change nothing. The same queries also work as
post-install checks on a new client's project, where they confirm the template's own policies and grants instead.

- [ ] N1. `select p.proname, pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where
  n.nspname in ('public', 'app_private') and p.proname in ('kiosk_clock_out', 'delete_attendance_record', 'set_staff_salary_rate',
  'generate_payslip_snapshot', 'attendance_apply_overtime', 'night_ot_bonus');` settles T3, T6, T8, T12, T14, A18, D6, D21,
  SA11 and the bonus value.
- [ ] N2. `select polrelid::regclass, polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid) from
  pg_policy where polrelid in ('public.payroll_snapshots'::regclass, 'public.attendance_records'::regclass,
  'public.staff_profiles'::regclass, 'public.staff_salary_rates'::regclass);` settles A20, S14, T34 and the rate read scope.
- [ ] N3. `select count(*) from staff_permission_grants where permission_key = 'initiate_high_risk_action';` (count only) settles
  A16 and T32 on that install.
- [ ] N4. `select p.proname, p.prosecdef, p.proacl, r.rolname, r.rolbypassrls from pg_proc p join pg_namespace n on
  n.oid = p.pronamespace join pg_roles r on r.oid = p.proowner where n.nspname in ('public', 'app_private');` settles Z1, Z3 and
  Z7, including whether `anon` holds EXECUTE on `report_payroll` after its out-of-band re-creation.
- [ ] N5. `select version, name from supabase_migrations.schema_migrations order by version desc limit 15;` settles whether
  `20260916120000` is applied (K14, T27, Z1, Z6).
- [ ] N6. `npx supabase test db` on a scratch stack settles the stale pgTAP assertion (1.5) and the replay risk (T28).
- [ ] N7. Browser: correct a record and watch the table row and the open Details dialog (A11); print a 40-row summary (P2); open a
  generated PDF (P4, SA14); check iPhone zoom on focus and the installed-app camera prompt (W8, W10).
- [ ] N8. `select table_name, column_name, data_type, is_nullable, column_default from information_schema.columns where
  table_schema = 'public' and table_name in ('payroll_snapshots', 'staff_salary_rates') order by table_name, ordinal_position;`
  and `select conrelid::regclass, conname, contype, pg_get_constraintdef(oid) from pg_constraint where conrelid in
  ('public.payroll_snapshots'::regclass, 'public.staff_salary_rates'::regclass);` settle the RECONSTRUCTED columns
  (`daily_rate`, `days_worked`, `night_shifts`, `rate_basis`, `paid_at`, `paid_by`; none has DDL in
  `20260722210000:15-36`), the `staff_salary_rates` table, its CHECK constraints and foreign keys (T13, T14, D12, D14, D15,
  SA12).

---

## 7. PROJECT-SPECIFIC (removed from template)

The identifiers below belong to the source business. They appear in the reference tests or in the code those tests exercise,
and they are named only in this list. Template tests use configuration values and synthetic placeholders instead.

- [ ] Business timezone `Asia/Manila` and the fixed offset `+08:00`: `src/lib/hr/attendance-paging.ts:41-43`,
  `src/lib/hr/attendance.ts:133`, `20260722200000:34`, `20260907120000:45`, `20260907160000:41`, PENDING (not live) `20260916120000:368, 476`;
  the migration file name `20260907120000_kiosk_clock_in_manila_work_date.sql`; test titles in `tests/unit/attendance-paging.test.ts`
  and `tests/unit/security-hardening.test.ts:272`.
- [ ] The business-date helper `src/lib/format/manila-date.ts` and its test `tests/unit/manila-date.test.ts` (the eight cases in 1.3);
  the template renames them to a business-date helper.
- [ ] Retail wording in identifiers and copy: `SHOP_TZ`, `shopToday` and `shopDayBounds` (`src/lib/hr/attendance-paging.ts`); the
  "shop phone" device copy (`src/lib/hr/attendance.ts:41-46`; `src/components/hr/device-manager.tsx:73`) and the SQL default device
  label (`20260722150000:51`).
- [ ] Currency: the peso sign in screen money (`src/lib/payments/format.ts:51-56`, function `formatPeso`), the money input prefix, the
  privacy mask, the kiosk overtime notice (`src/lib/hr/attendance.ts:201`), a test title (`tests/unit/attendance-overtime.test.tsx:67`),
  the formatted amount asserted in `tests/unit/payslip-button.test.tsx:52`, and the `PHP` prefix in the PDF
  (`src/lib/hr/payslip-pdf.ts:12-31`).
- [ ] This client's pay policy values: the flat night amount 300, the 22:00 threshold, the daily rate on a weekly default frequency,
  and the exclusion of role key owner from timekeeping; all become CONFIGURABLE.
- [ ] Brand strings: "A.V. Jewelry" and the logo initials "AV" / "A.V" on the payslip, PDF and summary; the PDF file prefix
  `AV-Jewelry-Payslip-` (`src/lib/hr/payslip-pdf.ts:44-49`); the accent `#b28b3f`; the export file names `MineFlow-Data-Export-`
  (`src/app/api/export/all/route.ts:74`) and `AV-Jewelry-Data-Export-` (`src/components/export/export-all-button.tsx:91`).
- [ ] The device cookie name `av_att_device` (`src/lib/hr/devices.ts:27`).
- [ ] The realtime channel name `mineflow-live-sync` (`src/components/shell/dashboard-sync.tsx:154`).
- [ ] The approval-kind list that mixes this business's order, inventory and layaway kinds with `attendance_delete`
  (`tests/unit/phase7-fulfillment-approvals.test.ts:34, 48-49`), and the locked nav icons (`tests/unit/ui-lock.test.tsx:40-42`).
- [ ] Not reproduced anywhere in this folder: the real account-holder names in migration comments (`20260907160000:1-6`) and in a unit
  fixture (`tests/unit/payslip-button.test.tsx:16`); the demo-account email pattern (`20260722160000:10-15`); the Primary Super
  Admin email constant (`src/lib/authz/guard.ts:281`); the production project URL in `scripts/purge-attendance-selfies.mjs:25`.
