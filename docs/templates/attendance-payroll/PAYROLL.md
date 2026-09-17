# Payroll (Phase 7): reference behaviour and reusable template

This document records how the reference implementation turns attendance sessions into pay: the pay period, the rate
source, hours, the night bonus, deductions, gross and net pay, payslip snapshots, the (absent) approval step and the
exclusions. It then separates the core engine from client configuration, gives a generic engine interface, and lists
the payroll defects that the template must fix. Every CURRENT statement cites the repository; anything the repository
cannot settle is marked NEEDS VERIFICATION, and nothing is described as existing unless the code shows it.

## How to read this

Labels used throughout:

- CURRENT = how the reference implementation behaves today, with a `file:line` citation.
- GENERIC = the reusable form of the same rule or object.
- PROJECT-SPECIFIC = tied to the source business; never copied silently into another client's system (section 13).
- CONFIGURABLE = should become a client setting; the proposed key is in section 10.
- NEEDS VERIFICATION = the repository cannot settle it; the text says what would (usually a query in section 14).
- RECONSTRUCTED = a live database object whose DDL is missing from the repository; its shape is inferred from the app
  code and later migrations.
- PENDING (not live) = content of migrations `20260916120000`, `20260916130000` or `20260917120000`, written but not
  applied to production. Of the three, only `20260916120000` touches payroll inputs or gates.
- RECOMMENDED TEMPLATE IMPROVEMENT = a gap or defect in the reference implementation that the template should fix.
  It is never a change to the production system.

Role vocabulary: the database role keys are `owner`, `selected_admin` and `staff`; the user interface calls them
Super Admin (role key owner), Admin (role key selected_admin) and Staff (role key staff). After this paragraph the
document says Super Admin, Admin and Staff. Permission keys: `hr_payroll` opens the Payroll page; `hr_attendance` (open
the Attendance clock page and roster) and `hr_review_attendance` (open Review and read all rows) are covered in
BUSINESS_RULES.md and PERMISSIONS.md.

Template names: generic database objects follow DATABASE.md section 5, configuration keys follow CONFIGURATION.md
section 2 (the schema of record for keys), and permission keys follow PERMISSIONS.md section 4.2. Where a proposed key
is a permission key rather than a setting, section 10 says so.

Quoting conventions: SQL is quoted verbatim except that comments are removed and the business-timezone literal is
replaced by `<business-tz>`; the removed literals are listed in section 13. Regular expressions are described in words
because this file contains no backslash characters. File names whose basename carries the business timezone or the
currency are cited by alias (see the key below).

### Citation key

| Short form | Full path |
|---|---|
| `M/20260715130000` | `supabase/migrations/20260715130000_phase2_authz_helpers.sql` |
| `M/20260717120000` | `supabase/migrations/20260717120000_hr_attendance.sql` |
| `M/20260721100000` | `supabase/migrations/20260721100000_payroll_hourly_rate_editor.sql` |
| `M/20260722160000` | `supabase/migrations/20260722160000_payroll_exclude_demo_accounts.sql` |
| `M/20260722200000` | `supabase/migrations/20260722200000_attendance_overtime_and_selfie.sql` |
| `M/20260722210000` | `supabase/migrations/20260722210000_payroll_payslip_snapshots.sql` |
| `M/20260729120000` | `supabase/migrations/20260729120000_portal_access_permissions.sql` |
| `M/20260731130000` | `supabase/migrations/20260731130000_enable_realtime_dashboard_tables.sql` |
| `M/20260804140000` | `supabase/migrations/20260804140000_attendance_review_by_permission.sql` |
| `M/20260821140000` | `supabase/migrations/20260821140000_merge_permissive_select_policies.sql` |
| `M/20260907120000` | the kiosk clock-in migration `supabase/migrations/20260907120000_*.sql` (full name in section 13) |
| `M/20260907130000` | `supabase/migrations/20260907130000_correct_attendance_clock_out.sql` |
| `M/20260907160000` | `supabase/migrations/20260907160000_exclude_owners_from_timekeeping.sql` |
| `M/20260916120000` | `supabase/migrations/20260916120000_security_hardening_definer_grants_owner_guards.sql` (PENDING) |
| `page.tsx` | `src/app/(app)/admin/payroll/page.tsx` |
| `attendance-view.tsx` | `src/components/hr/attendance-view.tsx` (the payroll table, despite its name) |
| `payroll-tabs.tsx` | `src/components/hr/payroll-tabs.tsx` |
| `employee-rates-view.tsx` | `src/components/hr/employee-rates-view.tsx` |
| `payslip-button.tsx` | `src/components/hr/payslip-button.tsx` |
| `payroll-summary-button.tsx` | `src/components/hr/payroll-summary-button.tsx` |
| `payroll.ts` | `src/lib/hr/payroll.ts` |
| `rate.ts` | `src/lib/hr/rate.ts` |
| `payslip.ts` | `src/lib/hr/payslip.ts` |
| `payslip-actions.ts` | `src/lib/hr/payslip-actions.ts` |
| `payslip-types.ts` | `src/lib/hr/payslip-types.ts` |
| `payslip-pdf.ts` | `src/lib/hr/payslip-pdf.ts` |
| `sessions.ts` | `src/lib/hr/sessions.ts` |
| `hr-format.ts` | `src/lib/hr/format.ts` |
| `actions.ts` | `src/lib/hr/actions.ts` |
| `attendance.ts` | `src/lib/hr/attendance.ts` |
| `guard.ts` | `src/lib/authz/guard.ts` |
| `audit-log.ts` | `src/lib/audit/log.ts` |
| `data-export.ts` | `src/lib/export/data-export.ts` |
| `export-route.ts` | `src/app/api/export/all/route.ts` |
| `money-format.ts` | the shared screen money formatter module under `src/lib/payments/` (path in section 13) |
| `money-input.tsx` | `src/components/ui/money-input.tsx` |
| `bizdate.ts` | the business-date helper module under `src/lib/format/` (path in section 13) |
| `pgtap-26` | `supabase/tests/26_hr_attendance.test.sql` |
| `audit-doc` | `docs/SYSTEM-AUDIT-2026-09-16.md` |

### At a glance (CURRENT)

- Clocking is a shared kiosk: a signed-in operator holding `hr_attendance` picks a member from `list_clock_staff` and
  clocks that member (BUSINESS_RULES.md, A1). One row of `attendance_records` is one session; a partial unique index allows
  one open session per member (`M/20260717120000:43-45`).
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:45`). Payroll buckets whole sessions by it.
- A day's worked time is the sum of its completed sessions; open sessions count for nothing (`M/20260907160000:39,43`).
- Pay = `round(days_worked * daily_rate + night_shifts * app_private.night_ot_bonus(), 2)`, computed in SQL
  (`M/20260907160000:86-93`). Hours and "overtime hours" are display only.
- Two different night rules exist: a session flag set by an insert trigger when the clock-in hour is 22 or later (flat
  300.00), and the pay rule counting distinct work dates with a clock-out at or after 22:00 (sections 4.1 to 4.3).
- Deductions are one lump sum of zero or more, entered when a payslip is generated (section 5).
- A payslip is a frozen snapshot row with `payment_status` moving `pending` to `paid` (section 7).
- There is no attendance approval, no payroll finalization and no period lock (section 8).
- Only the clock-out can be corrected (Super Admin or Admin by role, reason required, in-place update, old value only in
  a best-effort app audit event); deletion is a hard delete (BUSINESS_RULES.md, B5 and B6). Both change payroll on the
  next read.
- Super Admins, demo accounts and inactive profiles are excluded from payroll; the clock roster excludes Super Admins
  but still lists demo accounts, which the clock-in RPC refuses (section 9).
- No mobile or cron code reaches payroll (`src/lib/mobile/**` and the cron routes have no reference to it); the consumers
  are the Payroll page, the two payslip actions, the rate action and the workbook export route (section 7.8).

---

## 1. Pay period

### CURRENT

| Aspect | Behaviour | Evidence |
|---|---|---|
| Chooser | Two `type="date"` inputs, From and To, in a `method="GET"` form with an Apply button. No presets, no cutoffs. | `attendance-view.tsx:76-97` |
| Transport | URL search params `from` and `to`, read by the server page | `page.tsx:31-34` |
| Default | From = first day of the current business month; To = business today (month to date) | `page.tsx:32-34`; `bizdate.ts:18-26` |
| Shape validation | None in TypeScript: any string reaches the RPC; a malformed date fails it ("Payroll unavailable") | `page.tsx:33-34`; `payroll.ts:40-42`; `attendance-view.tsx:108-112` |
| Order validation | `from > to` is not refused. `between` matches no session, so every eligible employee shows zeros (salary 0 if a rate exists). | `M/20260907160000:44,86-93` |
| Bounds | Inclusive at both ends, on the `date` column `work_date`: `a.work_date between p_from and p_to` | `M/20260907160000:44` |
| Bucketing | By `work_date`, stamped by `kiosk_clock_in` as the business date at clock-in; never split at midnight or a period edge | `M/20260907120000:40-46`; `M/20260907160000:38,44` |
| Column default | `default current_date` (server date), used only by inserts that do not stamp it; PENDING (not live) makes it the business date | `M/20260717120000:25`; `M/20260916120000:367-368` |
| Pay frequency | weekly, bi_weekly or monthly: stored and displayed, but drives no computation and no period choice | `M/20260907160000:67-72,84,86-93`; `attendance-view.tsx:198-200` |
| Payslip binding | A payslip is shown only for the exact pair `payroll_start_date = from` and `payroll_end_date = to` | `payslip.ts:66-71` |
| Export | The workbook's payroll sheet calls `report_payroll('2000-01-01', '2100-01-01')` when no range is applied (all time) | `data-export.ts:564-568` |

The only insert path that relies on the column default is the Super-Admin-only web `clockIn()` in `attendance.ts:252-339`,
which has no call site. Clocking itself (kiosk model, `work_date`, device gate, selfies) is described in
BUSINESS_RULES.md, Part A (A6 for `work_date`).

### GENERIC

A pay period is an inclusive range of business dates `[from, to]` with `from <= to`. Every completed session whose
`work_date` is inside the range belongs to the period in full. The engine takes the range as input; presets, cutoff
calendars and the default range are a UI concern that produces a `[from, to]` pair.

### CONFIGURABLE

`payroll.periodDefault` (CURRENT `month_to_date`) and `payroll.periodPresets` (CURRENT none). Membership by `work_date`
(inclusive `from` to `to`) stays CORE ENGINE and has no setting key (CONFIGURATION.md section 2.6, the note under
"Periods, days and hours").

### RECOMMENDED TEMPLATE IMPROVEMENT

Validate both dates and refuse `from > to` on the server page. Offer presets so that the exact-match payslip binding does
not hide payslips generated for a slightly different range.

---

## 2. Rate source

### 2.1 CURRENT: table `staff_salary_rates` (RECONSTRUCTED)

The table exists in production but no repository migration creates it. What the repository proves:

| Column | Proven by | Inferred type |
|---|---|---|
| `staff_profile_id` | `rate.ts:141,158`; `M/20260907160000:63,69` | uuid referencing `staff_profiles(id)` (foreign key not proven) |
| `daily_rate` | `rate.ts:141,163-166`; `M/20260907160000:62,83,89` (cast to text, multiplied by an integer) | numeric, precision unknown |
| `pay_frequency` | `rate.ts:141,167`; `M/20260907160000:68,84` | text; TypeScript allows weekly, bi_weekly, monthly (`rate.ts:213-216`); DB check unknown |
| `effective_date` | `rate.ts:141-142`; `M/20260907160000:63-64` | date |
| `created_at` | `rate.ts:141,143`; `M/20260907160000:64` | timestamptz, used as the tie-breaker |

`id`, `created_by`, uniqueness, indexes, RLS and grants are NEEDS VERIFICATION (section 14, query 2). Each save appends
a row and nothing is edited in place (`rate.ts:193-199`; `employee-rates-view.tsx:19-23`). The only basis is a daily
amount: the editors label it "Salary amount (per day)" and "/day" (`employee-rates-view.tsx:96,198`;
`attendance-view.tsx:190-194,301`); the export column is "Salary Rate (per day)" (`data-export.ts:595`).

### 2.2 CURRENT: which rate a period uses

Quoted from `M/20260907160000:59-74`:

```sql
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
```

Rules that follow from the quote:

- One rate for the whole period: the newest row whose `effective_date` is on or before the period END (`p_to`).
- No proration: a rate that takes effect mid-period applies to every day of the period, including days before its
  effective date. A rate dated after `p_to` is ignored for that period.
- Same effective date twice: allowed; the later `created_at` wins.
- The frequency is looked up the same way and falls back to `'weekly'` (`M/20260907160000:84`).
- No rate: `daily_rate` is NULL, `computed_salary` is NULL and the UI says "No rate set" (`M/20260907160000:86-87`;
  `attendance-view.tsx:184-187,202-205`; `payroll.ts:50-53,61-64`). A salary is never invented.

### 2.3 CURRENT: the "current rate" readers ignore the effective date

- Employee Rates tab: `listEmployeeRates` reads every rate row ordered by `effective_date desc, created_at desc` with no
  `effective_date <= today` filter and keeps the first row per person (`rate.ts:139-143,157-170`). A future-dated rate
  is therefore shown as the current rate, while `report_payroll` correctly ignores it for earlier periods.
- Team export sheet: newest `effective_date` row, no `created_at` tie-break and no `<= today` filter
  (`data-export.ts:785-795`).
- The field that carries the daily amount in that reader is still named `hourlyRate` (`rate.ts:115-116,185`).

### 2.4 CURRENT: who edits rates

| Layer | Behaviour | Evidence |
|---|---|---|
| UI, Employee Rates tab | Shown with "Edit rate" buttons when `canManageRates` (Super Admin or Admin) | `page.tsx:41-44,57`; `payroll-tabs.tsx:49,76`; `employee-rates-view.tsx:211-215` |
| UI, inline RateCell in the payroll table | Super Admin only (`isOwner ? <RateCell row={r} /> : ...`) | `attendance-view.tsx:181-183,253-348` |
| Server action | `setHourlyRateAction` has no role or permission check; its comment says "Owner-only" | `actions.ts:206-228` |
| Domain function | `setSalaryRate` validates, then calls the RPC; no `requireOwner` or `requireOwnerOrAdmin`; its comment says "Super Admin only" | `rate.ts:193-231` |
| Database RPC | `set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective)`, RECONSTRUCTED; role gate NEEDS VERIFICATION | `rate.ts:223-228` |
| Validation (TypeScript) | Amount: one to ten digits, optionally a dot and one or two digits. Frequency in the allow-list. Effective date required, shaped YYYY-MM-DD. | `rate.ts:209-220` |
| Money discipline | The amount is sent as a string and cast by Postgres; never a JavaScript float | `rate.ts:17-19,225` |
| Audit | `payroll.set_salary_rate` with `{daily_rate, pay_frequency, effective_date}` on success only; refusals are not audited | `rate.ts:229-238` |
| Clearing a rate | Not possible on the live path: an empty amount fails the amount rule | `rate.ts:209-212` |
| Effective-date default | RateCell: the browser's local date. Employee Rates tab: the business date. | `attendance-view.tsx:44-50,335`; `employee-rates-view.tsx:43,66` |

Consequences:

- The Admin sees an Edit button whose outcome depends on an unknown database gate. Repository comments disagree:
  `rate.ts:198-199` says "Super Admin only", `rate.ts:24-30` (legacy hourly RPC) says "Owner or Selected Admin".
- Under the repository's `staff_profiles` read policy, `is_owner() or auth_user_id = auth.uid()`
  (`M/20260821140000:21-22`), an Admin's Employee Rates tab lists only the Admin (`rate.ts:131-138`). The
  `staff_salary_rates` read policy is NEEDS VERIFICATION.
- PENDING (not live): if `set_staff_salary_rate` is SECURITY DEFINER, `M/20260916120000:76-110` revokes EXECUTE from
  PUBLIC and anon; if its gate uses `app_private.current_staff_role()`, the `'inactive'` sentinel
  (`M/20260916120000:46-57`) refuses a deactivated account. Whether either applies is NEEDS VERIFICATION.

### 2.5 CURRENT: the legacy hourly path is dead

- `staff_profiles.hourly_rate numeric(10,2)` still exists (`M/20260717120000:12-14`) and is still selected by
  `listEmployeeRates` (`rate.ts:134`), but it is no longer the pay basis (`rate.ts:146-147`).
- `setHourlyRate` (`rate.ts:31-109`), the RPC `set_staff_hourly_rate` and the table `staff_hourly_rates` (both
  RECONSTRUCTED) have no caller in `src/`.
- Old payslips carry `rate_basis = 'hourly'` and `hourly_rate`; the reader treats a missing basis as hourly
  (`payslip.ts:31-38`; `payslip-types.ts:19-22`).

### GENERIC

An append-only, effective-dated rate history per employee: amount, basis, pay frequency, effective date, created at,
created by (DATABASE.md section 5.8, `employee_pay_rates`). The engine resolves a rate by a selection policy. The
reference policy is "newest row effective on or before the period end, for the whole period". The per-day policy prices
each `work_date` with the rate effective on that date, which is the only way to handle a mid-period change without
proration arithmetic.

### CONFIGURABLE

`payroll.rateBasis`, `payroll.rateSelection`, `payroll.currentRateLookup` (template default `effective_today`),
`payroll.payFrequencies`, `payroll.defaultFrequency`, and the permission key `payroll.rates.edit` (section 10).
`payroll.prorationPolicy` is listed in CONFIGURATION.md section 2.6 as fixed `none`; a client that needs a mid-period
change priced correctly uses `payroll.rateSelection = 'per_day'` instead.

### NEEDS VERIFICATION

Full DDL, RLS and grants of `staff_salary_rates`; body, security mode and role gate of `set_staff_salary_rate`
(section 14, queries 1 to 3).

---

## 3. Hours

### CURRENT

Quoted from `M/20260907160000:35-58`:

```sql
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
)
```

| Rule | Behaviour | Evidence |
|---|---|---|
| Unit | One `attendance_records` row is one session; several sessions per day are allowed ("Continue Duty") | `sessions.ts:5-16`; `M/20260717120000:20-22` |
| Worked hours | Sum of each completed session's `time_out - time_in`; off-duty gaps between sessions never count | `M/20260907160000:39,49`; `sessions.ts:12-16` |
| Open sessions | Excluded by `time_out is not null`: no hours, no day, no night shift | `M/20260907160000:43` |
| One open session | Partial unique index `attendance_one_open_session_per_staff` | `M/20260717120000:43-45` |
| Duration validity | `time_out >= time_in` check, so a zero-length completed session is possible | `M/20260717120000:32` |
| Days worked | `count(distinct work_date)` over completed sessions; no minimum hours, so a zero-length session counts a day | `M/20260907160000:52` |
| Hours rounding (SQL) | Per-session hours unrounded; `round(coalesce(total_hours, 0), 2)` and the same for overtime, on totals only | `M/20260907160000:79-80` |
| Hours rounding (TypeScript mirror) | Each session rounded to 2 dp, then the sum rounded again; a day total can differ slightly from SQL | `hr-format.ts:8-13`; `sessions.ts:90-91` |
| "Overtime hours" | `sum(greatest(hours - 8, 0))` per SESSION, not per day: two 5-hour sessions give 0. Display only. | `M/20260907160000:50-51` |
| Hours and pay | Hours do not affect pay in the current (daily) model; pay uses days and night shifts only | `M/20260907160000:86-93` |
| Column label | "Regular Hours" shows `total_hours`, hours above 8 included; the summary sheet says "Reg. hrs" | `attendance-view.tsx:140-142,175-177`; `payroll-summary-button.tsx:116,131-133` |
| Approval gate | None: every completed session counts ("payroll from APPROVED attendance only" was deferred and never built) | `M/20260907160000:42-44`; `docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212` |
| Corrections | `correct_attendance_clock_out` rewrites `time_out` in place, so it changes hours AND the pay rule's `night_out` | `M/20260907130000:55-59`; `M/20260907160000:39,41` |
| Deletions | `delete_attendance_record` (RECONSTRUCTED) hard-deletes a session; the action revalidates the Payroll page | `attendance.ts:341-390`; `actions.ts:139-157` |

### Worked example (illustrative fixture, business time)

| Session | work_date | In | Out | hours | over 8 | night_out |
|---|---|---|---|---|---|---|
| S1 | D1 | 09:00 | 12:00 | 3.00 | 0 | false |
| S2 | D1 | 13:00 | 18:30 | 5.50 | 0 | false |
| S3 | D2 | 14:00 | 22:30 | 8.50 | 0.50 | true |
| S4 | D3 | 22:15 | 00:30 next day | 2.25 | 0 | false (00:30 is before 22:00) |
| S5 | D4 | 08:00 | open | excluded | excluded | excluded |

Result: `total_hours = 19.25`, `overtime_hours = 0.50`, `days_worked = 3`, `night_shifts = 1` (D2 only). D1 has 8.5 hours
in total but no overtime hours, because the threshold is applied per session. The session flag of section 4.2 marks S4
(clock-in 22:15), not S3, so the Review badge and the pay line disagree for this fixture.

### GENERIC

Hours are an aggregate of completed sessions in the period, per employee: `total_hours`, `days_worked` (distinct work
dates with at least one completed session, optionally a minimum duration) and display-only `overtime_hours` above a
threshold with a stated basis (session or day). Whether hours feed pay depends on the rate basis.

### CONFIGURABLE

`payroll.minHoursForDay` (CURRENT 0), `payroll.overtimeDisplayThresholdHours` (CURRENT 8),
`payroll.overtimeBasis` (CURRENT `session`). The rounding keys `payroll.rounding.hoursScale` (2) and
`payroll.rounding.roundOnce` (true) are listed in CONFIGURATION.md section 2.6 as fixed engine values, not client
choices; CURRENT is not round-once in effect, because SQL rounds the totals while TypeScript rounds each session and
then the sum (`M/20260907160000:79-80`; `sessions.ts:90-91`).

---

## 4. Night bonus and overtime

### 4.1 CURRENT: the rule used for PAY (clock-out anchored, once per day)

- Qualifying session: a completed session whose clock-out time of day, in the business timezone, is at or after 22:00:
  `((a.time_out at time zone '<business-tz>')::time >= time '22:00') as night_out` (`M/20260907160000:41`).
- Cap: once per work date: `count(distinct work_date) filter (where night_out)::int as night_shifts`
  (`M/20260907160000:55`). A day with two late sessions earns one bonus.
- Amount: `app_private.night_ot_bonus()`, RECONSTRUCTED (no DDL in the repository). The user-facing labels embed 300
  in the business currency (`payslip-button.tsx:113,290`; `payslip-pdf.ts:106`), a code comment in the payroll table
  component says the same (`attendance-view.tsx:27-30`, a JSDoc block, not UI text), and the session trigger writes
  `300.00` (`M/20260722200000:37`). The clock-in message does not contain a literal: it interpolates the amount stored
  on the new row (`attendance.ts:200-202`). The function's return value is NEEDS VERIFICATION (section 14, query 1).
- Pay line: `(coalesce(t.night_shifts, 0) * app_private.night_ot_bonus())::text as overtime_pay`, not rounded
  (`M/20260907160000:85`). It is returned even when there is no rate.
- Multiplier overtime (for example 1.25 times an hourly rate) does not exist anywhere in the repository.

### 4.2 CURRENT: the session flag (clock-in anchored, BEFORE INSERT trigger)

Quoted from `M/20260722200000:26-49` (comments removed):

```sql
create or replace function public.attendance_apply_overtime()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare
  v_hour integer;
begin
  v_hour := extract(hour from (coalesce(new.time_in, now()) at time zone '<business-tz>'));
  if v_hour >= 22 then
    new.is_overtime := true;
    new.overtime_amount := 300.00;
  else
    new.is_overtime := false;
    new.overtime_amount := 0;
  end if;
  return new;
end;
$function$;

drop trigger if exists attendance_apply_overtime_biu on public.attendance_records;
create trigger attendance_apply_overtime_biu
  before insert on public.attendance_records
  for each row execute function public.attendance_apply_overtime();
```

The trigger fires on INSERT only, so no later update recomputes the flag. The flag feeds the clock-in message
(`attendance.ts:200-202`), the Review Attendance badge (the day's maximum `overtime_amount`, so one bonus per day,
`sessions.ts:54-63,116-118`) and the attendance export sheet (`data-export.ts:544-557`). `report_payroll` does not read
it. Whether a drift migration later redefined the live trigger is NEEDS VERIFICATION (section 14, query 1).

### 4.3 CURRENT: the two rules disagree

| Shift (business time) | Session flag (clock-in hour >= 22) | Pay rule (clock-out time >= 22:00) |
|---|---|---|
| 14:00 to 22:30 | no badge | paid |
| 08:00 to 23:30 | no badge | paid |
| 22:15 to 23:00 | badge | paid |
| 22:15 to 00:30 next day | badge | NOT paid |
| 21:00 to 21:59 | no badge | not paid |

Comments disagree as well: `payroll.ts:23` and `payslip-types.ts:25` say "clocked out at or after 22:00";
`M/20260907130000:9-10` says "the night bonus keys off clock-in". A third variant exists in the repository body of
`generate_payslip_snapshot`: the sum of `overtime_amount` over completed sessions, uncapped per day
(`M/20260722210000:106-111`), but that body is stale (section 6.2).

### 4.4 CURRENT: a clock-out after midnight earns no bonus

The pay rule compares the clock-out TIME OF DAY with 22:00, so a session that ends at 02:00 has `02:00 < 22:00` and earns
nothing, while a session that ends at 23:59 earns the bonus. No repository text says this is intended, and the governing
spec section that the migrations cite is not in the repository (section 13), so the rationale cannot be recovered.

### 4.5 CURRENT: corrections move the pay bonus but never the badge

`correct_attendance_clock_out` (Super Admin or Admin by role title, reason required) updates `time_out` in place and
returns the old value for the caller's audit event (`M/20260907130000:29-37,55-61`; `attendance.ts:400-430`). The pay
rule is evaluated on read, so a corrected clock-out can add or remove a paid night shift; the insert-only flag never
changes. The audit write is best-effort: a logging failure is not reported to the user (`audit-log.ts:36-41`). The full
correction flow is in BUSINESS_RULES.md (A9, B5 and B8).

### GENERIC

A night premium is a flat amount per qualifying business day (or session). The engine needs ONE predicate built from
settings: an anchor (clock-in or clock-out), a start time, an optional window end so that shifts ending after midnight
qualify, a cap, and an amount. The same predicate drives the attendance badge, the payroll aggregate and the snapshot.
In the template it is `app_private.is_night_session(p_time_in, p_time_out)`, with the amount read from
`app_private.night_bonus_amount(p_as_of)`, which replaces `night_ot_bonus()` (DATABASE.md section 5.12). As
CONFIGURATION.md section 2.6 states it: a completed session qualifies when the business-time time of day of its
anchored instant is at or after `thresholdTime` or, when `windowEnd` is set, before `windowEnd`; night shifts are the
distinct work dates with a qualifying session when `oncePerDay` is true, otherwise the qualifying sessions. This is a
RECOMMENDED TEMPLATE IMPROVEMENT; the reference implementation has two hard-coded predicates instead (sections 4.1 and
4.2).

### CONFIGURABLE

`payroll.nightRule.enabled`, `payroll.nightRule.anchor`, `payroll.nightRule.thresholdTime`,
`payroll.nightRule.windowEnd`, `payroll.nightRule.bonusAmount`, `payroll.nightRule.oncePerDay`, and
`payroll.overtimePayMultiplier` (CURRENT: never paid). Recommendation: the template picks ONE anchor and deletes the
second predicate (section 12, item 1).

---

## 5. Deductions and other adjustments

### CURRENT

| Kind | Exists | Detail | Evidence |
|---|---|---|---|
| Deductions | Yes | One lump sum per payslip, typed in the Generate dialog; default `'0'`; no line items, no label, no reason | `payslip-button.tsx:169,276-288`; `M/20260722210000:79` |
| Validation | Yes | TypeScript: digits, optional dot plus 1-2 digits. SQL: `greatest(coalesce(p_deductions, 0), 0)`; check `deductions >= 0` | `payslip-actions.ts:48-55`; `M/20260722210000:27,93` |
| Input control | Yes | The shared money input accepts digits and one dot with at most two decimals and rejects negatives | `money-input.tsx:15-29` |
| Ceiling | No | Deductions above gross give a negative `net_salary`; that column has no check | `M/20260722210000:28,125` |
| Editable later | No | No action changes deductions on an existing snapshot; only generate and mark-paid exist | `payslip-actions.ts:23,99` |
| Statutory items (tax, social insurance) | No | No table, column or code | repository search |
| Allowances, holiday pay, rest-day premium, manual additions | No | None | repository search |
| Late or undertime deductions | No | Listed as deferred, never built | `docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212` |
| Night bonus | Yes | Automatic, section 4.1 | `M/20260907160000:85` |
| Provisional markers | Yes | `app_private.provisional_fields` rows say deductions have "No standing deduction rules yet; awaiting Owner policy" | `M/20260722210000:137-142` |

### GENERIC

Deductions are applied only when a payslip is frozen. The minimal engine keeps the reference shape: one amount of zero
or more, stored in the snapshot column `deductions` (DATABASE.md section 5.9, `numeric(12,2)` with
`check (deductions >= 0)`, the same column name as CURRENT). An itemized mode stores adjustment rows (DATABASE.md
section 5.10, `payroll_adjustments`) in the same transaction, and their deduction sum equals `deductions`, so the net
formula never changes. The engine type in section 11 calls this value `deductionsTotal`; it maps to `deductions`.

### CONFIGURABLE

`payroll.deductionsModel` (`lump_sum` CURRENT; `itemized` as an option) and `payroll.allowNegativeNet` (CURRENT true by
omission; template default false, CONFIGURATION.md section 2.6).

---

## 6. Gross and net pay, rounding, currency

### 6.1 CURRENT: the derived payroll table (`report_payroll`)

Quoted from `M/20260907160000:83-93`:

```sql
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
```

- Gross (the table's "Salary") = `round(days_worked * daily_rate + night_shifts * night_ot_bonus(), 2)`, or NULL when
  there is no rate. The table shows no net figure; deductions exist only on payslips.
- Result columns: `staff_profile_id, full_name, role_key, total_hours, overtime_hours, days_worked, night_shifts,
  daily_rate, pay_frequency, overtime_pay, computed_salary`, ordered by `full_name` (`M/20260907160000:30,101`).
- The function is `language sql stable`, `set search_path to ''`, with no SECURITY DEFINER clause, so it runs as the
  caller (`M/20260907160000:31-33`). Row filter: `sp.is_active and not sp.is_demo and sp.role_key <> 'owner' and
  (sp.id = app_private.current_staff_id() or app_private.is_owner())` (`M/20260907160000:97-100`). Anyone other than a
  Super Admin, Admin included, receives only their own row.
- Because it runs as the caller, table RLS also applies: `staff_profiles` reads are Super-Admin-or-self
  (`M/20260821140000:21-22`), `attendance_records` reads are self, Super Admin or `hr_review_attendance`
  (`M/20260804140000:8-14`), and the `staff_salary_rates` policy is NEEDS VERIFICATION. Widening the row filter alone
  would therefore not show other employees to a delegated viewer.
- EXECUTE grants: the repository's v2 revoked PUBLIC and granted `authenticated` (`M/20260721100000:73-74`), but the
  11-column result shape at `M/20260907160000:30` cannot be produced by `create or replace` over the repository's
  previous shape (`M/20260722160000:20`), so the function was dropped and recreated out of band and its live grants are
  NEEDS VERIFICATION (section 14, query 3). The pending migration records that platform default privileges grant
  EXECUTE on every migration-created function (`M/20260916120000:70-73`). `app_private` usage is granted to
  `authenticated` only (`M/20260715130000:246-247`); whether `app_private.night_ot_bonus()` itself carries an EXECUTE
  grant for `authenticated` (required, since the caller's privileges apply) is NEEDS VERIFICATION.

### 6.2 CURRENT: the payslip snapshot formula

Repository body of `generate_payslip_snapshot` (`M/20260722210000:75-132`), hourly model, STALE (excerpt, comments
removed):

```sql
select total_hours, overtime_hours, nullif(hourly_rate, '')::numeric
  into v_reg_hours, v_ot_hours, v_rate
from public.report_payroll(p_from, p_to)
where staff_profile_id = p_employee;

if not found then
  raise exception 'No payroll row for this employee in the selected period.';
end if;

select coalesce(sum(overtime_amount), 0) into v_ot_pay
from public.attendance_records
where staff_profile_id = p_employee
  and time_out is not null
  and work_date between p_from and p_to;

v_regular_salary := round(coalesce(v_reg_hours, 0) * coalesce(v_rate, 0), 2);
v_gross := v_regular_salary + coalesce(v_ot_pay, 0);
```

with `v_deductions numeric := greatest(coalesce(p_deductions, 0), 0)` (`M/20260722210000:93`) and
`net_salary = v_gross - v_deductions` (`M/20260722210000:125`).

This body reads `hourly_rate` from `report_payroll` (`M/20260722210000:97`), a column the current function no longer
returns (`M/20260907160000:30`), so it cannot be the live body. The live daily-basis body is RECONSTRUCTED: the app
reads back `daily_rate`, `days_worked`, `night_shifts` and `rate_basis` after generation (`payslip-actions.ts:76-82`;
`payslip.ts:31-40`). The probable live formula, consistent with `report_payroll` but NOT proven by the repository:

- `regular_salary = days_worked * daily_rate`
- `overtime_pay = night_shifts * night_ot_bonus()`, or the older `sum(overtime_amount)`; the Generate dialog's hint
  still describes "the recorded ... flat late-night overtime" (`payslip-button.tsx:289-292`)
- `gross_salary = regular_salary + overtime_pay`
- `net_salary = gross_salary - greatest(coalesce(p_deductions, 0), 0)`

The unit-test fixture is not evidence for the formula: it has `rateBasis: 'daily'`, rate 100.00, 5 days and
`regularSalary: '4000.00'`, which is 40 hours times 100, not 5 days times 100 (`tests/unit/payslip-button.test.tsx:20-28`).
NEEDS VERIFICATION: section 14, query 1.

### 6.3 Worked example (illustrative values, not client data)

Using the section 3 fixture (`days_worked = 3`, `night_shifts = 1`), a daily rate of `500.00` and a night bonus `B`:
gross = `round(3 * 500.00 + 1 * B, 2)`. With `B = 150.00` the gross is `1650.00`. A payslip generated with deductions
`200.00` stores net `1450.00`; with deductions `2000.00` it stores net `-350.00`, which the reference accepts (section 5)
and which the summary total then mis-adds (section 6.6).

### 6.4 CURRENT: rounding and precision

| Item | Rule | Evidence |
|---|---|---|
| Computed salary | `numeric`, rounded once on the total with `round(..., 2)` | `M/20260907160000:88-92` |
| `overtime_pay` in the table | not rounded (integer count times the bonus) | `M/20260907160000:85` |
| Snapshot money columns | `numeric(12,2)`; legacy `hourly_rate numeric(10,2)` | `M/20260722210000:20-28` |
| Hours | totals to 2 dp in SQL; per session and again on the sum in TypeScript | `M/20260907160000:79-80`; `hr-format.ts:12`; `sessions.ts:90-91` |

### 6.5 CURRENT: money is a string on the wire

`report_payroll` returns every money figure as `::text` (`M/20260907160000:83,85,93`), and the TypeScript types keep
money as strings (`payroll.ts:50-64`; `payslip-types.ts:6-7`). Snapshot and rate columns are `numeric` read through the
table API; their mappers accept a string or a number and convert with `String` (`payslip.ts:21,41-45`;
`rate.ts:163-166`). Whether those values arrive as JSON numbers, which would be a float round-trip before the
conversion, is NEEDS VERIFICATION against the API client in use. Inputs are submitted as raw digit strings
(`money-input.tsx:8-18`) and Postgres casts them (`rate.ts:225`; `payslip-actions.ts:62`). The payroll summary adds
amounts in integer minor units with `BigInt` (`payroll-summary-button.tsx:31-39,54-60`).

### 6.6 CURRENT: the summary total cannot parse a negative amount

The summary's minor-unit parser (`payroll-summary-button.tsx:31-36`) splits the string on the dot and replaces the whole
part by `'0'` unless it consists only of digits, but keeps the fraction. A negative `net_salary` (possible, section 5)
therefore contributes only its fractional part: `-100.50` adds `+0.50` and `-350.00` adds `0` to "Total payroll"
(`payroll-summary-button.tsx:54-60,162-171`). The PDF formatter, by contrast, records a leading minus before stripping
non-digits (`payslip-pdf.ts:21-31`).

### 6.7 CURRENT: display formatting

| Surface | Rule | Evidence |
|---|---|---|
| Screen | Currency symbol plus comma grouping by string operations; two decimals only when the fraction is non-zero | `money-format.ts:51-56` |
| Privacy mode | Amounts can be masked on screen | `src/components/shell/privacy.tsx:88-90,107-109` |
| PDF | ISO-style currency code prefix instead of the symbol (the built-in PDF fonts lack the glyph); always two decimals | `payslip-pdf.ts:12-14,21-31` |
| PDF label | The night-shift label still embeds the currency symbol and the amount 300 | `payslip-pdf.ts:106` |
| Workbook | Money as numbers with a two-decimal number format; a missing rate or salary exports as a blank cell | `data-export.ts:39-43,77,580,583,595-598` |
| Table hours | "8h 30m" style | `hr-format.ts:16-21`; `attendance-view.tsx:176,179` |
| Summary hours | `toFixed(2)` | `payroll-summary-button.tsx:131-135` |

### GENERIC

`gross = regular + night_bonus + overtime` (overtime is zero unless a multiplier is configured); `net = gross -
deductions`, stored as `gross_salary`, `deductions` and `net_salary` on the snapshot (DATABASE.md section 5.9). All
money is exact decimal (numeric in SQL, decimal strings in TypeScript, integer minor units when summed), rounded to
the currency's minor units in one agreed place.

### CONFIGURABLE

`locale.currencyCode`, `locale.currencySymbol`, `locale.moneyDisplay.hideZeroMinorUnits`,
`locale.moneyDisplay.pdfUsesCode`, `payroll.rounding.moneyScale` (fixed 2).

---

## 7. Payslip

### 7.1 CURRENT: generation

| Step | Behaviour | Evidence |
|---|---|---|
| Entry | Each payroll row has "Generate Payslip" (no snapshot) or "View payslip" (snapshot exists), for every viewer of the row | `attendance-view.tsx:221-228`; `payslip-button.tsx:253-261` |
| Dialog footer | With no snapshot, the footer shows Cancel and "Generate payslip" to every viewer; it has no `canManage` check | `payslip-button.tsx:240-249` |
| Dialog body | `canManage` gates only the Deductions input and the hint; others see a "not generated" note | `payslip-button.tsx:276-299`; `attendance-view.tsx:68,227` |
| Server action | `generatePayslipAction` calls `requireOwner()` first (Super Admin only), validates, then calls the RPC | `payslip-actions.ts:23-63`; `guard.ts:263-273` |
| RPC | `generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions)`, deductions default `'0'` | `payslip-actions.ts:58-63` |
| Database gate (repository) | SECURITY INVOKER; the INSERT policy `with check (app_private.is_owner())` is the real gate | `M/20260722210000:58-60,83` |
| Precondition (repository body) | The employee must appear in `report_payroll` for the caller, else the function raises | `M/20260722210000:96-104` |
| Read-back | The inserted row is re-read with the employee name and role embedded | `payslip-actions.ts:73-86` |
| Audit | `payroll.payslip_generated` with `{from, to, net_salary}` (best-effort) | `payslip-actions.ts:88-93`; `audit-log.ts:36-41` |
| UI mismatch | Admin: Deductions input plus Generate. Staff, own row: note plus Generate. The server refuses both | `payslip-button.tsx:240-249`; `payslip-actions.ts:28` |
| Stale comment | The action file says generate AND mark-paid are Owner acts enforced by `requireOwner` and RLS; mark-paid calls `requireOwnerOrAdmin` | `payslip-actions.ts:12-16` vs `:106` |

Notes on the dialog rows: `canManage` is Super Admin or Admin (`attendance-view.tsx:68`; `page.tsx:43`). The Generate
button in the footer is rendered for every viewer of a row that has no snapshot; only the Deductions input and the hint
above it are conditional. A viewer without `canManage` who clicks Generate submits the default deductions `'0'`
(`payslip-button.tsx:169,180`), and `generatePayslipAction` refuses anyone who is not a Super Admin through
`requireOwner` (`payslip-actions.ts:28`). Because a viewer who is not a Super Admin sees only their own row (section
6.1), the Staff case is a member looking at their own row.

The live body, its security mode and its precondition are RECONSTRUCTED (section 6.2).

### 7.2 CURRENT: snapshot columns (`payroll_snapshots`)

Repository DDL `M/20260722210000:15-36`, plus columns that exist live without DDL (RECONSTRUCTED):

| Column | Type | Notes | Evidence |
|---|---|---|---|
| `id` | uuid primary key | | `M/20260722210000:16` |
| `employee_id` | uuid, `references staff_profiles(id) on delete restrict` | an employee with payslips cannot be deleted | `:17` |
| `payroll_start_date`, `payroll_end_date` | date | check `payroll_end_date >= payroll_start_date` | `:18-19,35` |
| `regular_hours`, `overtime_hours` | numeric(10,2) | display values | `:20-21` |
| `hourly_rate` | numeric(10,2), nullable | legacy basis | `:22-23` |
| `regular_salary`, `overtime_pay`, `gross_salary` | numeric(12,2) | | `:24-26` |
| `deductions` | numeric(12,2) | check `deductions >= 0` | `:27` |
| `net_salary` | numeric(12,2) | no check | `:28` |
| `payment_status` | text | `in ('pending', 'paid')`, default `'pending'` | `:29-30` |
| `payment_date` | date, nullable | | `:31` |
| `approved_by` | uuid, nullable | never written by app code | `:32` |
| `generated_by`, `generated_at` | uuid, timestamptz | `generated_by = app_private.current_staff_id()` in the repository body | `:33-34,126` |
| `daily_rate`, `days_worked`, `night_shifts`, `rate_basis` | RECONSTRUCTED | read back after generation; `rate_basis` is `'hourly'` or `'daily'` | `payslip-actions.ts:79`; `payslip.ts:31-40` |
| `paid_at`, `paid_by` | RECONSTRUCTED | written by mark-paid; not read by the snapshot reader | `payslip-actions.ts:126-131`; `payslip.ts:52-53` |

Indexes: `(employee_id, generated_at desc)` and `(payroll_start_date, payroll_end_date)` (`M/20260722210000:41-44`).
RLS enabled and forced; `revoke all` from anon and authenticated; policies: read `employee_id = current_staff_id() or
is_owner()`, insert `is_owner()`, update `is_owner()`, no delete policy; `grant select, insert, update` to authenticated
(`M/20260722210000:46-68`). The table is in the realtime publication (`M/20260731130000:28`).

### 7.3 CURRENT: immutability and duplicates

- Frozen by convention: no UI or action edits the figures and no DELETE policy or grant exists ("an issued payslip is a
  record", `M/20260722210000:67-68`). Nothing in the database freezes the money columns: the UPDATE policy lets a Super
  Admin rewrite any column and no trigger exists (`M/20260722210000:62-65`).
- No uniqueness on (employee, period). The reader orders by `generated_at desc` and keeps the first row per employee
  ("history is preserved in the table", `payslip.ts:55-60,71,76-80`). The UI hides Generate once a snapshot exists
  (`payslip-button.tsx:260`), but a direct action call can insert another row, and a newer `pending` row then hides an
  older `paid` one. There is no regenerate button.
- Attendance changes after generation move the derived table, never the snapshot (`M/20260907130000:9-11`).

### 7.4 CURRENT: statuses and labels

`payment_status` moves from `pending` to `paid` only; there is no unpay, void or reversal. Labels differ by surface:

| Surface | No payslip | pending | paid | Evidence |
|---|---|---|---|---|
| Payroll table | "Unpaid" | "Unpaid" | "Paid" | `attendance-view.tsx:210-219` |
| On-screen payslip | n/a | "Pending" | "Paid" plus the date | `payslip-button.tsx:92-100` |
| PDF | n/a | "Unpaid" | "Paid - " plus the date | `payslip-pdf.ts:86-90` |
| Summary sheet | "Not Generated" | "Pending" | "Paid" | `payroll-summary-button.tsx:155-157` |

The summary sheet's source strings are the lowercase `not generated` and the raw `payment_status` value; the cell's CSS
class `capitalize` renders them as shown in the table (`payroll-summary-button.tsx:155-157`).

### 7.5 CURRENT: mark paid

| Aspect | Behaviour | Evidence |
|---|---|---|
| Button | "Mark as Paid" when `canManage` and the status is `pending`; no confirmation, no undo | `payslip-button.tsx:234-238` |
| TypeScript gate | `requireOwnerOrAdmin()`: Super Admin or Admin | `payslip-actions.ts:103-112`; `guard.ts:325-335` |
| Write | Direct table UPDATE, no RPC: `payment_status = 'paid'`, `payment_date`, `paid_at = now`, `paid_by = actor`, `where id = ? and payment_status = 'pending'` | `payslip-actions.ts:124-135` |
| Idempotence | A repeat matches no row and returns "Could not mark the payslip as paid. It may already be paid." | `payslip-actions.ts:122-123,137-143` |
| Payment date | The action accepts a `paymentDate` field but the dialog never sends one, so it is always business today | `payslip-actions.ts:115-116`; `payslip-button.tsx:200-202,207-211` |
| Audit | `payroll.payslip_marked_paid` with `{payment_date, paid_by}` (best-effort) | `payslip-actions.ts:145-150` |
| Database gate (repository) | UPDATE policy `is_owner()` only: an Admin's update matches zero rows and gets the "already paid" message | `M/20260722210000:62-65` |

The TypeScript gate and the repository RLS conflict. Under the repository policies an Admin also sees only their own
payroll row and their own payslip (`M/20260907160000:100`; `M/20260722210000:51-55`), so the only payslip an Admin could
target is their own, and the UPDATE policy refuses it. Two production migrations without repository files
(`payroll_paidby_and_kiosk_clock`, `fix_payroll_grants_and_delete_all_where`) may have widened the live policy: NEEDS
VERIFICATION (section 14, query 2).

### 7.6 CURRENT: print and PDF

- On-screen document: white sheet with a logo mark, company name, "Payslip", employee, role, period and status; left
  column by basis (daily: Days worked, Regular hours, night shifts with the amount inside the label, Daily rate; legacy
  hourly: Regular hours, Overtime hours, Hourly rate); right column Regular salary, Overtime pay, Gross salary,
  Deductions, highlighted Net pay; signature lines "Employee signature" and "Approved by" (`payslip-button.tsx:64-149`).
- Print: `window.print()` with an injected `@media print` style that hides everything except `#payslip-doc`
  (`payslip-button.tsx:26-36,231,271`).
- PDF: client-side jsPDF, A5 portrait, same layout, file name `<brand prefix>-Payslip-<Employee>-<start>_<end>.pdf` with
  sanitised segments (`payslip-pdf.ts:44-53,168`). Anyone who can read the snapshot can print or download it
  (`payslip-button.tsx:218-233`). The component docstring still says both buttons use the browser print dialog "so no
  extra library is needed" (`payslip-button.tsx:16-22`), which is stale. `jspdf` is pinned at `^2.5.2`
  (`package.json:29`); the audit lists an open critical advisory and a static import into the Payroll and Attendance
  bundles (`audit-doc:136,303`).

### 7.7 CURRENT: payroll summary

A Super-Admin-only button (UI check only), shown when rows exist (`attendance-view.tsx:98-105`), opens a sheet with
Employee, Reg. hrs, OT hrs, Rate, Gross, Deductions, Net, Status and a "Total payroll" footer
(`payroll-summary-button.tsx:113-171`), printed through the same style-injection pattern (`:18-29,79,85`). Total = sum
over rows of the snapshot net when a payslip exists, else the computed gross, so net and gross are mixed, as its own
footnote states (`payroll-summary-button.tsx:54-60,174-177`). See section 6.6 for the negative-amount defect.

### 7.8 CURRENT: payroll in the workbook export

The export route admits Super Admin or Admin by role (`export-route.ts:15-24`). The `payroll` section is not marked
sensitive (`src/lib/export/sections.ts:22`); its rows come from `report_payroll`, so an Admin exports only their own row
(`data-export.ts:563-602`). The Super-Admin-only Team sheet (`src/lib/export/sections.ts:24`; `data-export.ts:138-139`)
lists every profile, including Super Admins and demo accounts, with the "current" rate chosen as in section 2.3
(`data-export.ts:776-811`).

### GENERIC

A payslip is an immutable snapshot: employee, period, the inputs used (days, hours, night shifts, rate, basis), the
components (regular, night bonus, overtime), gross, deductions total, net, payment status and payment metadata,
generated by and at. Rendering (screen, print, PDF, summary) reads only the snapshot and never recomputes. Status and
reversal columns follow DATABASE.md section 5.9 (`pending`, `paid`, `void`, `superseded_by`).

### CONFIGURABLE

Permission keys `payroll.payslip.generate` and `payroll.payslip.mark_paid`; settings `payroll.paidDateEditable`,
`payroll.statusLabels`, `payroll.payslip.pageSize`, `payroll.payslip.fileNamePattern`, `payroll.payslip.labels`,
`branding.companyName`, `branding.logoText`, `branding.logoUrl`, `branding.brandColor`, `branding.documentFilePrefix`.

---

## 8. Approval and finalization

CURRENT: there is no approval or finalization step beyond mark-paid, and no period lock.

- The lifecycle is: derived table, then optional generate (freeze), then mark paid. Only two payslip actions exist
  (`payslip-actions.ts:23,99`).
- `approved_by` is never written; "Approved by" is only a blank signature line (`M/20260722210000:32`;
  `payslip-button.tsx:145`; `payslip-pdf.ts:166`).
- The `hr_payroll` permission is described as "View and process payroll." (`M/20260729120000:34`), but no processing act
  checks it: generate and mark-paid are gated by role title (sections 7.1, 7.5) and the rate path has no TypeScript gate
  at all (section 2.4).
- Attendance in a period that already has payslips can still be corrected (in place) or hard-deleted; the derived table
  moves, the snapshot does not, and nothing warns the operator (`M/20260907130000:9-11`; `actions.ts:139-183`).
- Regenerating is not offered in the UI; a direct call creates an additional snapshot row that masks the earlier one
  (section 7.3).
- "Payroll from APPROVED attendance only" was deferred and is not implemented (`docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212`).

GENERIC: an optional review state per employee and work date (`attendance_day_reviews`, DATABASE.md section 5.5)
consulted by the aggregation and by the correction and delete RPCs, plus an optional lock that refuses corrections and
deletions of a session whose `work_date` lies inside the period of a current (not superseded, not void) payslip for
that employee. Both are switchable and off by default: `payroll.approvalRequired` (boolean, default false) and
`payroll.lockPeriodAfterPayslip` with three values, `off` (default), `generated` (locked as soon as that payslip
exists) and `paid` (locked once it is paid). The lock is a read of `payroll_snapshots` and needs no day-review column
(CONFIGURATION.md section 2.6; DATABASE.md section 5.5).

---

## 9. Exclusions

### CURRENT

| Profile kind | Clock roster `list_clock_staff` | `kiosk_clock_in` target | `report_payroll` | Employee Rates reader | Team export sheet |
|---|---|---|---|---|---|
| Inactive | excluded (`M/20260907160000:23`) | refused (`M/20260907120000:35-37`) | excluded (`M/20260907160000:97`) | excluded (`rate.ts:135`) | listed |
| Demo (`is_demo`) | listed: no demo filter (`M/20260907160000:20-25`) | refused (`M/20260907120000:35-37`) | excluded (`:98`) | excluded (`rate.ts:136`) | listed |
| Super Admin | excluded (`M/20260907160000:24`) | accepted: no role check (`M/20260907120000:25-37`) | excluded (`:99`) | excluded (`rate.ts:137`) | listed |
| No rate set | not applicable | not applicable | listed, "No rate set", NULL salary | listed, "No rate set" | blank rate |
| Zero attendance in range | not applicable | not applicable | listed with zeros (LEFT JOIN, `:94-96`) | listed | listed |

Team export evidence: `data-export.ts:779-811`. Notes:

- The `is_demo` column is `boolean not null default false` (`M/20260722160000:7-8`). It was back-filled once by matching
  an auth email pattern on a test domain (`M/20260722160000:10-15`); that seed convention is PROJECT-SPECIFIC and the
  pattern is not reproduced here.
- "Owners are not on payroll" is a dated owner decision recorded in a migration header that names real people
  (`M/20260907160000:1-7`): PROJECT-SPECIFIC.
- Summary, consistent with BUSINESS_RULES.md A14: Super Admins are excluded from the roster, payroll and rates but are
  still accepted as a `kiosk_clock_in` target; demo accounts are excluded from payroll and rates and refused as a
  clock-in target, but `list_clock_staff` still lists them.

### GENERIC

Exclusion is one per-profile predicate, `app_private.is_timekeeping_eligible(p_employee_id)` (DATABASE.md section 5.2),
applied identically in the roster, both clock functions, the payroll aggregate and the rate reader: `is_active and not
is_demo and not timekeeping_exempt`. `timekeeping_exempt` is a boolean profile column (default false); runtime checks
read only that flag.

### CONFIGURABLE

- `exclusions.excludedRoles`: CURRENT `['owner']` (hard-coded as `role_key <> 'owner'`); template default `[]`, decided
  at onboarding. It does not filter at runtime: it sets `timekeeping_exempt = true` on existing profiles at seed time
  and, through a role trigger, on profiles that enter a listed role. Leaving the role does not clear the flag.
- `exclusions.excludeDemoAccounts`: NOT a client choice. CONFIGURATION.md section 2.3 fixes it to true, and in the
  template it also applies to the roster (CURRENT: the roster still lists demo accounts).
- The per-profile exemption is the `timekeeping_exempt` column itself, edited per profile; it has no setting key.

---

## 10. CORE ENGINE vs CLIENT CONFIGURATION

Classification: CORE ENGINE = an invariant or mechanism that stays in code for every client; CLIENT CONFIG = a value or
policy another client will plausibly change; PROJECT-SPECIFIC = a reference value tied to the source business (the
literal values are in section 13). A row may combine them, for example "CLIENT CONFIG; value PROJECT-SPECIFIC". Keys
are from CONFIGURATION.md section 2 unless marked "permission", in which case they are from PERMISSIONS.md section 4.2.
A key that starts with a dot shares the prefix of the key before it in the same cell (`payroll.overtimeBasis` in row 7).

### 10.1 Period and hours

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 1 | Period aggregation | inclusive `[from, to]` on `work_date`; whole session on its clock-in date | `M/20260907160000:44`; `M/20260907120000:45` | CORE ENGINE | none (engine rule) |
| 2 | Period chooser, default | free From and To; month to date; no presets | `attendance-view.tsx:76-97`; `page.tsx:32-34` | CLIENT CONFIG | `payroll.periodDefault`, `payroll.periodPresets` |
| 3 | days_worked counting | `count(distinct work_date)` over completed sessions; no minimum duration | `M/20260907160000:52` | CORE ENGINE; minimum CLIENT CONFIG | `payroll.minHoursForDay` (0) |
| 4 | Hours aggregation | sum of completed session durations; gaps between sessions excluded | `M/20260907160000:39,49` | CORE ENGINE | none |
| 5 | Session-duration rule | `time_out - time_in`; open sessions excluded; `time_out >= time_in`; one open session | `M/20260907160000:39,43`; `M/20260717120000:32,43-45` | CORE ENGINE | none |
| 6 | Hours rounding | SQL: totals, 2 dp; TypeScript: per session and sum | `M/20260907160000:79-80`; `sessions.ts:90-91` | CORE ENGINE | `payroll.rounding.hoursScale`, `.roundOnce` (both fixed) |
| 7 | Overtime display threshold | above 8 h per SESSION; display only | `M/20260907160000:50-51` | CLIENT CONFIG; 8 PROJECT-SPECIFIC | `payroll.overtimeDisplayThresholdHours`, `.overtimeBasis` |
| 8 | Overtime pay | none; hours beyond the threshold are never paid | `M/20260907160000:86-93` | CLIENT CONFIG (option) | `payroll.overtimePayMultiplier` (0) |

### 10.2 Rates

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 9 | Rate basis set | daily only; hourly only on legacy snapshots; no monthly | `M/20260907160000:86-93`; `payslip.ts:31-38` | CLIENT CONFIG; hourly and monthly RECOMMENDED | `payroll.rateBasis` |
| 10 | Rate effective-dating | append-only rows; `effective_date`, tie-break `created_at` | `rate.ts:193-199`; `M/20260907160000:64` | CORE ENGINE | `payroll.rateEffectiveDating` (fixed) |
| 11 | Rate selection | newest row with `effective_date <= period end` | `M/20260907160000:59-74` | CLIENT CONFIG | `payroll.rateSelection` (`period_end`) |
| 12 | Proration policy | none: a mid-period change prices the whole period | `M/20260907160000:59-74` | CORE ENGINE; see row 11 `per_day` | `payroll.prorationPolicy` (fixed `none`) |
| 13 | "Current rate" lookup | newest row, no `<= today` filter (defect) | `rate.ts:139-143`; `data-export.ts:785-795` | CLIENT CONFIG | `payroll.currentRateLookup` (note below) |
| 14 | No-rate fallback | NULL salary and "No rate set"; never invented | `M/20260907160000:86-87`; `attendance-view.tsx:202-205` | CORE ENGINE | none |
| 15 | Pay frequency labels | 3 labels, default weekly; drive nothing | `rate.ts:213-216` | CLIENT CONFIG | `payroll.payFrequencies`, `.defaultFrequency`, `.frequencyDrivesPeriod` |
| 16 | Rate input limits | 1 to 10 integer digits, up to 2 decimals, not negative | `rate.ts:209-212` | CORE ENGINE | derived from `locale.moneyDisplay.minorUnits` |

Note on row 13: the values are `newest_row` (CURRENT, which shows a future-dated rate as the current one) and
`effective_today`, the template default and a RECOMMENDED TEMPLATE IMPROVEMENT (CONFIGURATION.md section 2.6).

### 10.3 Night bonus

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 17 | Night rule anchor | pay: clock-out; session flag: clock-in (two rules) | `M/20260907160000:41`; `M/20260722200000:34-35` | CLIENT CONFIG; pick ONE value | `payroll.nightRule.anchor` |
| 18 | Night threshold time | 22:00 business time | `M/20260907160000:41`; `M/20260722200000:35` | CLIENT CONFIG; value PROJECT-SPECIFIC | `payroll.nightRule.thresholdTime` |
| 19 | Night window end | none: a clock-out after midnight never qualifies | `M/20260907160000:41` | CLIENT CONFIG | `payroll.nightRule.windowEnd` |
| 20 | Night bonus amount | `night_ot_bonus()` (RECONSTRUCTED); labels say 300 | `M/20260907160000:85,90` | CLIENT CONFIG; value PROJECT-SPECIFIC | `payroll.nightRule.bonusAmount` |
| 21 | Night bonus cap | once per work date (pay and Review badge) | `M/20260907160000:55`; `sessions.ts:116-118` | CLIENT CONFIG | `payroll.nightRule.oncePerDay` (true) |
| 22 | Night rule on or off | always on; hard-wired in a trigger and in `report_payroll` | `M/20260722200000:46-49`; `M/20260907160000:85` | CLIENT CONFIG | `payroll.nightRule.enabled` |

### 10.4 Money

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 23 | Deductions model | one lump sum >= 0 at generation; default 0; no ceiling | `payslip-button.tsx:169`; `M/20260722210000:27,93` | CORE ENGINE; mode CLIENT CONFIG | `payroll.deductionsModel` |
| 24 | Negative net | allowed; no check on `net_salary` | `M/20260722210000:28,125` | CLIENT CONFIG | `payroll.allowNegativeNet` |
| 25 | Statutory items, allowances, holiday pay | none | repository search | CLIENT CONFIG (future module) | `payroll.deductionsModel = 'itemized'` (DATABASE.md 5.10) |
| 26 | Gross formula | `round(days * rate + nights * bonus, 2)`; NULL without a rate | `M/20260907160000:86-93` | CORE ENGINE (parameterised by 9-12, 17-22) | none |
| 27 | Net formula | `gross - deductions` | `M/20260722210000:125` | CORE ENGINE | none |
| 28 | Money rounding | `round(x, 2)` once on the salary total; `overtime_pay` unrounded | `M/20260907160000:85,88-92` | CORE ENGINE | `payroll.rounding.moneyScale` (fixed 2) |
| 29 | Money representation | numeric in SQL; strings in TypeScript; integer minor units when summed | `payroll.ts:50-64`; `payroll-summary-button.tsx:31-39` | CORE ENGINE | none |
| 30 | Currency | symbol on screen, ISO code in PDF | `money-format.ts:51-56`; `payslip-pdf.ts:12-31` | CLIENT CONFIG; value PROJECT-SPECIFIC | `locale.currencyCode`, `.currencySymbol` |
| 31 | Timezone | one hard-coded IANA zone in SQL and TypeScript | `M/20260907160000:41`; `M/20260907120000:45`; `bizdate.ts:16` | CLIENT CONFIG; value PROJECT-SPECIFIC | `locale.timezone` |

### 10.5 Payslip lifecycle

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 32 | Snapshot immutability | by convention; no delete; UPDATE not column-restricted; no trigger | `M/20260722210000:62-68` | CORE ENGINE (enforce it) | `payroll.snapshot.immutable` (fixed) |
| 33 | One current payslip per employee and period | not enforced; newest row wins in the reader | `payslip.ts:71,76-80` | CORE ENGINE (gap) | `payroll.snapshot.uniquePerPeriod` (fixed) |
| 34 | Statuses | `pending` then `paid`; no void or unpay | `M/20260722210000:29-30`; `payslip-actions.ts:124-135` | CORE ENGINE | `payroll.statuses` (fixed), `payroll.statusLabels` |
| 35 | Paid date | business today; not user-chosen | `payslip-actions.ts:115-116` | CLIENT CONFIG | `payroll.paidDateEditable` |
| 36 | Approval step | none; `approved_by` never written | `M/20260722210000:32`; `payslip-button.tsx:145` | CLIENT CONFIG (module) | `payroll.approvalRequired` |
| 37 | Period lock | none | `M/20260907130000:13-63` (no period check) | CLIENT CONFIG (module) | `payroll.lockPeriodAfterPayslip` (`off`, `generated` or `paid`; default `off`) |
| 38 | Payslip document | A5; hard-coded name, logo text, colour, file prefix | `payslip-pdf.ts:17,44-53,65,69` | CLIENT CONFIG; values PROJECT-SPECIFIC | `payroll.payslip.*`, `branding.*` |
| 39 | Night label text | label embeds the currency symbol and 300 | `payslip-button.tsx:113`; `payslip-pdf.ts:106` | CORE ENGINE (defect) | derived from `payroll.nightRule.bonusAmount` |
| 40 | Audit action names | `payroll.set_salary_rate`, `payroll.payslip_generated`, `payroll.payslip_marked_paid` | `rate.ts:234`; `payslip-actions.ts:89,146` | CORE ENGINE | none |

### 10.6 Access and exclusions

| # | Value or rule | CURRENT value or behaviour | Evidence | Classification | Proposed key |
|---|---|---|---|---|---|
| 41 | Open Payroll page | `hr_payroll`; Super Admin: all keys; others: own row | `page.tsx:30`; `guard.ts:174-179,294-303` | CORE ENGINE; screen CLIENT CONFIG | no key; `payroll.selfView` (note 1) |
| 42 | See all rows and payslips | `is_owner()` only | `M/20260907160000:100`; `M/20260722210000:51-55` | CLIENT CONFIG | permission `payroll.view_all` |
| 43 | Edit rates | UI: Super Admin, Admin (tab); TypeScript: none; DB: NEEDS VERIFICATION | `page.tsx:43-44`; `rate.ts:201-231` | CLIENT CONFIG | permission `payroll.rates.edit` |
| 44 | Generate payslip | Super Admin (TypeScript and RLS) | `payslip-actions.ts:28`; `M/20260722210000:58-60` | CLIENT CONFIG | permission `payroll.payslip.generate` |
| 45 | Mark paid | TypeScript: Super Admin, Admin; repo RLS: Super Admin | `payslip-actions.ts:106`; `M/20260722210000:62-65` | CLIENT CONFIG | permission `payroll.payslip.mark_paid` |
| 46 | Print summary | Super Admin, UI check only | `attendance-view.tsx:98-105` | CLIENT CONFIG | UI shown to `payroll.view_all` holders (no own key) |
| 47 | Export payroll sheet | Super Admin or Admin by role; rows as `report_payroll` | `export-route.ts:18`; `data-export.ts:563-602` | CLIENT CONFIG | permission `payroll.export` |
| 48 | Exclusion by role | `role_key <> 'owner'` in roster, payroll, rates | `M/20260907160000:24,99`; `rate.ts:137` | CLIENT CONFIG; value PROJECT-SPECIFIC | `exclusions.excludedRoles` (note 2) |
| 49 | Exclusion by flag | `is_active`, `is_demo` (note 2) | `M/20260907160000:20-25,97-98`; `rate.ts:135-136` | CORE ENGINE; seed PROJECT-SPECIFIC | `exclusions.excludeDemoAccounts` (fixed) |
| 50 | Money in audit context | rates and net pay in `audit_events.context` | `rate.ts:233-238`; `payslip-actions.ts:88-93` | CORE ENGINE (defect) | `audit.payloadIncludesAmounts` |

Notes on section 10.6:

1. Row 41. CURRENT: `canOpenPage` passes a Super Admin because `getGrantedPermissions` returns every key for role key
   owner (`guard.ts:174-179,294-303`); any other holder of `hr_payroll` receives only their own payroll row and their
   own payslips (`M/20260907160000:100`; `M/20260722210000:51-55`). Template: own row and own payslips need no
   permission key (PERMISSIONS.md 4.1, principle 7), and there is no separate own-view key. The Payroll page opens for
   holders of any `payroll.*` permission except `payroll.export` (PERMISSIONS.md 4.2), and for every eligible employee
   when the setting `payroll.selfView` is true. `payroll.selfView` is CLIENT CONFIG, template default false
   (CONFIGURATION.md section 2.3); it decides only whether the self-service screen exists, never what data is readable.
2. Rows 48 and 49. CURRENT is not uniform. `is_active` is applied in the roster (`M/20260907160000:23`), the clock-in
   target (`M/20260907120000:35-37`), `report_payroll` (`M/20260907160000:97`) and the rate reader (`rate.ts:135`), but
   not in the Team export sheet, which lists inactive and demo profiles with Status and Demo columns
   (`data-export.ts:779-811`). `is_demo` is applied in the clock-in target, `report_payroll` (`:98`) and the rate reader
   (`rate.ts:136`), not in the roster. `kiosk_clock_in` has no role check, so it accepts a Super Admin target
   (`M/20260907120000:25-37`). Template: `exclusions.excludedRoles` (default `[]`) only sets the `timekeeping_exempt`
   flag, and one predicate, `app_private.is_timekeeping_eligible`, tests `is_active`, `is_demo` and
   `timekeeping_exempt` in the roster, both clock functions, the payroll computation and the rate reader (section 9;
   DATABASE.md section 5.2).

---

## 11. Generic payroll engine interface

In words. The engine is a pure computation over five inputs:

1. Employee set: profiles that pass the eligibility predicate (section 9: active, not demo, not `timekeeping_exempt`),
   each with id, display name and role. The caller's row filter (own row, or every row for a holder of
   `payroll.view_all`) is applied inside the engine function (`app_private.payroll_lines`), not by the wrapper: the
   INVOKER `report_payroll` adds no protection, and a direct call to the engine returns what the wrapper returns to
   the same caller (DATABASE.md section 5.13).
2. Period: `from` and `to` as business dates, inclusive, with `from <= to`.
3. Sessions: every attendance session of those employees whose `work_date` is in the period, with `time_in` and
   `time_out` (open sessions are passed in so the engine can warn, and are excluded from every total).
4. Rate history: the effective-dated rate rows of those employees.
5. Settings: the section 10 keys (rate basis and selection, day minimum, night rule, overtime display, deductions mode,
   negative-net rule, rounding).

Steps, mirroring `report_payroll` (`M/20260907160000:35-101`) with the settings made explicit:

1. Keep completed sessions; compute each duration in hours.
2. Per employee: `totalHours` = sum of durations; `daysWorked` = distinct work dates whose completed time reaches
   `payroll.minHoursForDay` (CURRENT 0, so any completed session); `overtimeHoursDisplay` = hours above the threshold
   on the configured basis; `nightShifts` = work dates (or sessions) that satisfy the one night predicate.
3. Resolve the rate by `payroll.rateSelection` (CURRENT: newest row with `effective_date <= to`).
4. Gross components: `regular` = `daysWorked * rate` for the daily basis (hourly: `totalHours * rate`, the legacy
   snapshot rule; monthly: no reference formula exists; the computation returns a null gross with
   `unsupported_rate_basis` until the client defines one); `nightBonus` = `nightShifts *
   bonusAmount`; `overtime` = 0 unless a multiplier is configured. `gross` = the rounded sum, or null without a rate.
5. Freeze: generating a payslip takes one line plus the deductions supplied by the actor, applies the negative-net rule,
   computes `net = gross - deductionsTotal` (stored as `net_salary` and `deductions`, DATABASE.md section 5.9) and
   inserts one snapshot row; nothing downstream recomputes.

Warnings (no rate, open session in the period, rate changed mid-period, a rate basis without a formula) are a
RECOMMENDED TEMPLATE IMPROVEMENT; the reference implementation returns none.

```ts
// Sketch only. Setting names mirror CONFIGURATION.md section 2. Money is a decimal string, never a JS number.
type MoneyString = string;   // for example "1450.00"
type BusinessDate = string;  // YYYY-MM-DD in locale.timezone
type TimeOfDay = string;     // "HH:MM", 24-hour, business time
type RateBasis = 'daily' | 'hourly' | 'monthly';

type PayrollSettings = {
  locale: { timezone: string; currencyCode: string; moneyDisplay: { minorUnits: 2 } };
  payroll: {
    selfView: boolean;                             // CURRENT: no setting; template default false (screen only, not data)
    rateBasis: RateBasis;                          // CURRENT: 'daily'
    rateSelection: 'period_end' | 'per_day';       // CURRENT: 'period_end' (no proration)
    minHoursForDay: number;                        // CURRENT: 0
    nightRule: {
      enabled: boolean;                            // CURRENT: always on
      anchor: 'clock_in' | 'clock_out';            // CURRENT: two rules; the template keeps one
      thresholdTime: TimeOfDay;                    // CURRENT: "22:00"
      windowEnd: TimeOfDay | null;                 // CURRENT: null (time-of-day compare only)
      bonusAmount: MoneyString;                    // CURRENT: RECONSTRUCTED function; labels say 300
      oncePerDay: boolean;                         // CURRENT: true
    };
    overtimeDisplayThresholdHours: number;         // CURRENT: 8
    overtimeBasis: 'session' | 'day';              // CURRENT: 'session'
    overtimePayMultiplier: number;                 // CURRENT: 0 (never paid)
    deductionsModel: 'lump_sum' | 'itemized';      // CURRENT: 'lump_sum'
    allowNegativeNet: boolean;                     // CURRENT: true by omission
    rounding: { moneyScale: 2; hoursScale: 2; roundOnce: true };   // fixed engine values
    lockPeriodAfterPayslip: 'off' | 'generated' | 'paid';          // CURRENT: 'off' (no lock)
  };
  exclusions: {
    excludedRoles: string[];                       // CURRENT: ['owner']; sets timekeeping_exempt, never filters at runtime
    excludeDemoAccounts: true;                     // fixed; CURRENT roster still lists demo accounts
  };
};

type Employee = {
  id: string; fullName: string; roleKey: string;
  isActive: boolean; isDemo: boolean; timekeepingExempt: boolean;  // eligibility = active, not demo, not exempt
};
type Period = { from: BusinessDate; to: BusinessDate };  // inclusive
type Session = { employeeId: string; workDate: BusinessDate; timeIn: string; timeOut: string | null };  // ISO instants
type RateRow = {
  employeeId: string; basis: RateBasis; amount: MoneyString; payFrequency: string;
  effectiveDate: BusinessDate; createdAt: string;
};

type PayrollLine = {
  employeeId: string;
  fullName: string;
  roleKey: string;
  period: Period;
  daysWorked: number;
  totalHours: number;              // hours are not money; rounded once to hoursScale
  overtimeHoursDisplay: number;    // display only while overtimePayMultiplier is 0
  nightShifts: number;
  rate: { basis: RateBasis; amount: MoneyString; payFrequency: string; effectiveDate: BusinessDate } | null;
  gross: {
    regular: MoneyString | null;   // null without a rate
    nightBonus: MoneyString;       // computed even without a rate, as in the reference
    overtime: MoneyString;         // "0.00" unless a multiplier is configured
    total: MoneyString | null;     // null without a rate
  };
  warnings: Array<'no_rate' | 'open_session_in_period' | 'rate_changed_mid_period' | 'unsupported_rate_basis'>;  // RECOMMENDED
};

type PayslipSnapshot = PayrollLine & {
  id: string;
  deductionsTotal: MoneyString;    // >= 0; column deductions
  net: MoneyString;                // gross.total - deductionsTotal; >= 0 unless allowNegativeNet; column net_salary
  paymentStatus: 'pending' | 'paid' | 'void';
  paymentDate: BusinessDate | null;
  generatedBy: string;
  generatedAt: string;
  supersededBy: string | null;
};

declare function computePayroll(
  employees: Employee[], period: Period, sessions: Session[], rates: RateRow[], settings: PayrollSettings,
): PayrollLine[];

declare function freezePayslip(
  line: PayrollLine, deductions: MoneyString, actorId: string, settings: PayrollSettings,
): PayslipSnapshot;  // refuses when line.gross.total is null
```

Where the reference implementation puts this today: `computePayroll` is `report_payroll` in SQL
(`M/20260907160000:29-102`) with `getPayroll` as a mapping layer (`payroll.ts:38-68`); `freezePayslip` is
`generate_payslip_snapshot` (live body RECONSTRUCTED) behind `generatePayslipAction` (`payslip-actions.ts:23-97`). The
template keeps the money math in SQL, in one place, and treats these types as the contract for readers and renderers.
Whether the refusal on a missing rate matches the live function is NEEDS VERIFICATION: the stale repository body
coalesces a missing rate to 0 (`M/20260722210000:113`).

---

## 12. RECOMMENDED TEMPLATE IMPROVEMENTS (payroll)

Each item names the defect in the reference implementation and the template fix. None is a production change. Mapping
to the defect ids in README.md section 6: items 1-2 = D4; 3-5 = D12; 8-10 = D8; 11, 13 and 15 = D13; 16 = D2;
17-18 = D15; 19 = D14 (the audit-trail part).

1. One night rule. Pay keys off clock-out (`M/20260907160000:41`), the session flag off clock-in
   (`M/20260722200000:34-35`), and the repository snapshot body sums the flag uncapped (`M/20260722210000:106-111`).
   Fix: one SQL predicate, `app_private.is_night_session(p_time_in, p_time_out)` (DATABASE.md section 5.12), which
   reads `payroll.nightRule.*` through the settings accessors, with the amount from `app_private.night_bonus_amount`.
   The badge calls it directly; `report_payroll` and `generate_payslip_snapshot` use it through
   `app_private.payroll_lines` (DATABASE.md section 5.13). There is no stored night flag and no insert-only trigger.
2. Shifts that end after midnight. `time_out::time >= '22:00'` is false at 02:00 (`M/20260907160000:41`). Fix: evaluate
   the night rule against a window (`thresholdTime` to `windowEnd`) instead of a time-of-day comparison.
3. Negative amounts in the summary total. The parser keeps only the fraction of a negative amount
   (`payroll-summary-button.tsx:31-36`). Fix: parse signed decimals, add a unit test, and add
   `check (net_salary >= 0)` unless `payroll.allowNegativeNet` is true.
4. No deductions ceiling (`M/20260722210000:27-28`). Fix: the snapshot function refuses deductions above gross unless
   negative net is allowed, and says so in the dialog.
5. Immutability by convention only (`M/20260722210000:62-68`). Fix: a BEFORE UPDATE trigger that allows only the status
   and payment or void columns, and one current payslip per employee and period through `superseded_by` and a unique
   partial index (DATABASE.md section 5.9), so a regenerated `pending` row cannot hide a `paid` one (`payslip.ts:76-80`).
6. No reverse path and no chosen paid date (`payslip-actions.ts:115-116`; `payslip-button.tsx:200-202`). Fix: a `void`
   status with reason, actor and time that keeps `paid_at` (DATABASE.md section 5.9), and send the paid date from the
   dialog when `payroll.paidDateEditable` is true.
7. No review, finalization or lock (section 8). Fix: the optional `attendance_day_reviews` module and
   `payroll.lockPeriodAfterPayslip`, enforced inside `correct_attendance_clock_out` and the delete RPC, plus a warning
   when a period with payslips is edited.
8. Mark-paid gate conflict (`payslip-actions.ts:106` vs `M/20260722210000:62-65`). Fix: a SECURITY DEFINER
   `mark_payslip_paid` RPC gated on the permission `payroll.payslip.mark_paid` with a NULL-safe check, a TypeScript
   mirror, and no direct UPDATE grant on the table.
9. Rate edits without a TypeScript gate and with an unknown database gate (`actions.ts:206-228`; `rate.ts:193-231`).
   Fix: ship the DDL of the rate RPC with the DATABASE.md section 5.13 signature
   `public.set_staff_salary_rate(p_employee uuid, p_basis text, p_amount numeric, p_frequency text, p_effective date)`
   returning `uuid` (SECURITY DEFINER, writing `employee_pay_rates`, DATABASE.md section 5.8), gated on
   `payroll.rates.edit`; mirror the gate in TypeScript, audit refusals as well as successes, and remove the
   contradictory comments. The name is kept from CURRENT but the
   parameters differ from the RECONSTRUCTED `set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective)`
   (`rate.ts:223-228`), because the template stores a basis with every rate row.
10. Delegated payroll does not work. An Admin is given management controls (`page.tsx:41-44`) but `report_payroll`
    returns only their own row (`M/20260907160000:100`), the INVOKER function also reads `staff_profiles` under a
    Super-Admin-or-self policy (`M/20260821140000:21-22`), the snapshot read policy is Super-Admin-or-self
    (`M/20260722210000:51-55`), and generate refuses Admins (`payslip-actions.ts:28`), while the Generate button is
    shown to every viewer of a row without a snapshot, Staff included (`payslip-button.tsx:240-249`). Fix: the permission
    `payroll.view_all` honoured by every read path (row filter plus table policies, or a DEFINER reader with an explicit
    gate), and controls shown only to holders of the matching permission.
11. Future-dated rates shown as current (`rate.ts:139-143`; `data-export.ts:785-795`). Fix:
    `payroll.currentRateLookup = 'effective_today'` in both readers, with the upcoming rate shown separately.
12. Two rate editors with different date defaults (`attendance-view.tsx:44-50` vs `employee-rates-view.tsx:43`). Fix:
    one editor component whose default effective date is the business date.
13. Mid-period rate changes are silently applied to the whole period (`M/20260907160000:59-74`). Fix: offer
    `payroll.rateSelection = 'per_day'` and emit a `rate_changed_mid_period` warning under `period_end`.
14. Hard-coded and inconsistent labels. The night label embeds the symbol and 300 (`payslip-button.tsx:113`;
    `payslip-pdf.ts:106`), the PDF uses the glyph its own comment says the font lacks (`payslip-pdf.ts:12-14`), status
    words differ per surface (section 7.4), and "Regular Hours" shows total hours (`attendance-view.tsx:140-142`). Fix:
    labels derived from settings, one status label set (Not generated, Pending, Paid, Void), and the column named
    "Total hours".
15. Decorative pay frequency and an unvalidated free range (`M/20260907160000:84`; `page.tsx:33-34`). Fix: either drive
    period presets from the frequency (`payroll.frequencyDrivesPeriod`) or drop the field; validate the range.
16. Payroll inputs writable outside the kiosk. The repository grants `insert` and `update` on `attendance_records` to
    `authenticated` with self-scoped policies (`M/20260717120000:58-75`), so a member could insert or edit their own
    session times through the REST API and change their pay; the live grants may differ (drift migration
    `fix_payroll_grants_and_delete_all_where`, NEEDS VERIFICATION). Fix: no direct INSERT or UPDATE for `authenticated`;
    sessions change only through the clock, correction and delete RPCs (PERMISSIONS.md section 4.1, principle 4).
17. Missing and stale DDL. `staff_salary_rates`, `night_ot_bonus()`, six snapshot columns and the live snapshot body
    have no repository migration, and the repository snapshot body cannot run against the current `report_payroll`
    (`M/20260722210000:97` vs `M/20260907160000:30`). Fix: ship the full DDL; when a RETURNS TABLE shape changes, DROP
    and recreate with explicit grants (`M/20260721100000:10-12`); every private function that the INVOKER payroll
    reader calls either filters by the caller (as `app_private.payroll_lines` does) or is not executable by end users;
    grant EXECUTE only on those that filter or return no pay data; revoke PUBLIC and anon on every function.
18. Tests. No test covers the daily formula, rate selection, the SQL night rule, the snapshot formula, the mark-paid
    gate or the summary total, and `pgtap-26:142-148` still expects an `hourly_rate` column. The static authorization
    sweep only detects table writes (insert, update, delete calls), skips files ending in `actions.ts` (so
    `payslip-actions.ts` is never swept) and passes a file that contains any guard call anywhere; RPC-only writers such
    as `setSalaryRate` are invisible to it, and `rate.ts` is swept only because it also contains the dead legacy path
    (`tests/integration/phase11-authorization-boundary.test.ts:27-31,84-100`). Fix: pgTAP cases using the section 3 fixture
    (after-midnight end, split sessions, a mid-period rate change, negative net), and a sweep that matches `.rpc(` calls
    and asserts per exported function (TESTING_CHECKLIST.md).
19. Money in the audit trail. Rates and net pay are written to `audit_events.context` (`rate.ts:233-238`;
    `payslip-actions.ts:88-93`); the repository read policy admits every active staff member
    (`supabase/migrations/20260715130100_phase2_rls_policies.sql:661-662`), and PENDING (not live)
    `M/20260916120000:290-298` still admits Admins and `view_settings` holders. Fix: log identifiers and a change marker
    instead of amounts, or gate audit reads on `payroll.view_all` (`audit.payloadIncludesAmounts`).
20. Dead legacy hourly path (`rate.ts:31-109,134`; `staff_hourly_rates`; `staff_profiles.hourly_rate`). Fix: do not port
    it; keep only `rate_basis` on snapshots so historical hourly payslips still render with their own labels.
21. Summary total mixes net and gross (`payroll-summary-button.tsx:54-60,174-177`). Fix: print separate gross, deductions
    and net totals, and count employees without a payslip separately.
22. Stale comments that misstate authority: `payslip-actions.ts:12-16`, `rate.ts:9-20`, `actions.ts:206-209`,
    `page.tsx:16-22`, `payslip-button.tsx:16-22`. Fix: the template's comments state the enforced gate and its layer.
23. Export all-time default for payroll (`data-export.ts:564-568`) and a Team sheet that shows future-dated rates as
    current. Fix: require an explicit range for the payroll sheet and reuse the item 11 reader.

---

## 13. PROJECT-SPECIFIC values removed from the template

This is the only place in this document where the source system's brand, currency and timezone literals appear. None of
them may be copied into another client's system.

Each entry gives the reference value, where it lives, and the template replacement.

1. Business timezone literal: `Asia/Manila` (shown as `<business-tz>` in the SQL quotes above).
   Where: `M/20260907160000:41`; `M/20260722200000:34`; `M/20260907120000:45`; PENDING `M/20260916120000:368`;
   `bizdate.ts:16`. Replacement: `locale.timezone`.
2. Timezone-named files and functions: `supabase/migrations/20260907120000_kiosk_clock_in_manila_work_date.sql`;
   `src/lib/format/manila-date.ts` (alias `bizdate.ts`) with `manilaToday`, `manilaMonthStart`, `manilaAddDays`.
   Replacement: neutral names such as `businessToday` and `businessMonthStart`.
3. Timezone in comments: the SQL comment naming the city (`M/20260907160000:40`); "22:00 Manila" (`payroll.ts:23`);
   "the shop's (Manila) day" (`payslip-actions.ts:115`). Replacement: removed.
4. Currency: the peso sign (U+20B1) on screen; the `PHP` prefix in the PDF; the PDF formatter function `peso`
   (`payslip-pdf.ts:21-31`); the screen formatter `formatPeso` in `src/lib/payments/format.ts` (alias `money-format.ts`,
   lines 51-56); the summary parser names `toCentavos` and `fromCentavos` (`payroll-summary-button.tsx:31-39`).
   Replacement: `locale.currencyCode`, `locale.currencySymbol`, neutral function names.
5. Currency inside messages and labels: the rate-saved message (`rate.ts:242`), the night label "Night shifts (peso sign
   300 each)" (`payslip-button.tsx:113`; `payslip-pdf.ts:106`), the generate hint (`payslip-button.tsx:290`), and the
   SQL comment (`M/20260907160000:53-54`). Replacement: labels built from settings.
6. Night policy: a flat 300.00 at or after 22:00, once per day, registered as provisional pending owner confirmation
   (`M/20260722200000:34-37,70-73`; `M/20260907160000:41,53-55`). Replacement: `payroll.nightRule.*`, documented as
   client policy.
7. Overtime display threshold: 8 hours per session, marked provisional (`M/20260717120000:80-82,138-141`;
   `M/20260907160000:50-51`). Replacement: `payroll.overtimeDisplayThresholdHours`.
8. Pay-model decision: "a DAILY salary rate on a weekly cycle" (`rate.ts:194`; `attendance-view.tsx:27-30`).
   Replacement: `payroll.rateBasis`, `payroll.defaultFrequency`.
9. Company name: `A.V. Jewelry` on the payslip, the PDF, the summary and the workbook creator (`payslip-button.tsx:82`;
   `payslip-pdf.ts:69`; `payroll-summary-button.tsx:93`; `data-export.ts:132`). Replacement: `branding.companyName`.
10. Logo text: `AV` and `A.V` in a filled circle (`payslip-button.tsx:79`; `payslip-pdf.ts:65`;
    `payroll-summary-button.tsx:90`). Replacement: `branding.logoText` or `branding.logoUrl`.
11. Accent colour: `#b28b3f` ("Soft Gold", constant `SOFT_GOLD`, RGB 178,139,63) and `bg-amber-500` on the summary
    (`payslip-button.tsx:38-40`; `payslip-pdf.ts:17`; `payroll-summary-button.tsx:89`). Replacement: `branding.brandColor`.
12. Payslip PDF file-name prefix: `AV-Jewelry-Payslip-` (`payslip-pdf.ts:44-49`). Replacement:
    `branding.documentFilePrefix` with `payroll.payslip.fileNamePattern`.
13. Export file-name prefix: `MineFlow-Data-Export-` (`export-route.ts:74`). Replacement: `branding.documentFilePrefix`.
14. Owners excluded from payroll: an owner decision dated 2026-09-07; the migration header names real account holders,
    not copied (`M/20260907160000:1-7,24,99`; `rate.ts:137`). Replacement: `exclusions.excludedRoles`, which sets the
    per-profile `timekeeping_exempt` flag, decided per client.
15. Demo-account seed: a one-off back-fill from an auth-email pattern on a non-routable test domain, pattern not copied
    (`M/20260722160000:10-15`). Replacement: the `is_demo` flag stays; the seed convention does not.
16. Spec references: comments citing "Bible section F" (the cited section is not in the repository), "Owner request"
    and "Owner decision" (for example `payroll.ts:6`; `M/20260722210000:2`; the `provisional_fields` rows).
    Replacement: removed.
17. Primary Super Admin identity: a hard-coded email constant, value not copied and not used by payroll
    (`guard.ts:275-291`). Replacement: a profile flag or setting (PERMISSIONS.md).
18. Test fixture identity: a real-looking person name next to salary figures, not copied
    (`tests/unit/payslip-button.test.tsx:16`). Replacement: synthetic names.
19. UI role noun: "Ask the Owner to generate it." while the rest of the UI says Super Admin
    (`payslip-button.tsx:295-298`). Replacement: a label from the role vocabulary.

---

## 14. NEEDS VERIFICATION: read-only catalog queries

To be run only by someone with read access to the correct production project; never through connector accounts that
belong to another client.

1. Function bodies and security modes:
   `select n.nspname, p.proname, p.prosecdef, pg_get_functiondef(p.oid) from pg_proc p`
   `join pg_namespace n on n.oid = p.pronamespace`
   `where (n.nspname = 'public' and p.proname in ('report_payroll', 'generate_payslip_snapshot', 'set_staff_salary_rate',`
   `'set_staff_hourly_rate', 'attendance_apply_overtime')) or (n.nspname = 'app_private' and p.proname = 'night_ot_bonus');`
   then `select app_private.night_ot_bonus();`.
   Decides: the live snapshot formula and precondition (6.2, 7.1), the rate RPC gate (2.4), the bonus amount (4.1), the
   trigger body (4.2).
2. Table shapes and policies:
   `select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default`
   `from information_schema.columns where table_schema = 'public'`
   `and table_name in ('staff_salary_rates', 'payroll_snapshots', 'attendance_records') order by table_name, ordinal_position;`
   and `select tablename, policyname, cmd, qual, with_check from pg_policies`
   `where tablename in ('staff_salary_rates', 'payroll_snapshots', 'attendance_records', 'staff_profiles');`
   Decides: 2.1, 2.4 (who can read rates), 7.2, 7.5 (mark-paid policy) and item 16 of section 12.
3. Grants: `select routine_schema, routine_name, grantee, privilege_type from information_schema.routine_privileges`
   `where routine_name in ('report_payroll', 'generate_payslip_snapshot', 'set_staff_salary_rate', 'night_ot_bonus');`
   and `select table_name, grantee, privilege_type from information_schema.role_table_grants`
   `where table_name in ('payroll_snapshots', 'staff_salary_rates', 'attendance_records');`
   Decides: 6.1 (whether anon or authenticated hold EXECUTE) and whether direct attendance writes are still granted.
4. Constraints and indexes on payslips:
   `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.payroll_snapshots'::regclass;`
   and `select indexname, indexdef from pg_indexes where tablename in ('payroll_snapshots', 'staff_salary_rates');`
   Decides: whether any live uniqueness on (employee, period) or rate check exists (7.3, 2.1).
5. Migration order: `select version, name from supabase_migrations.schema_migrations`
   `where name ~ 'payroll|salary|payslip|night' order by version;`
   Decides which drift migration produced which object, and whether `20260916120000` has been applied.
6. Stale suite: run `pgtap-26` on a scratch stack; the assertion at `pgtap-26:142-148` is expected to fail.

---

## 15. Cross-references

- README.md: the document index, the scope matrix and the defect ids D1 to D15 used in section 12.
- BUSINESS_RULES.md, Part A: the kiosk model (an operator with `hr_attendance` clocks a member picked from
  `list_clock_staff`), one open session per member, `work_date` assignment (A6), the device gate (A11: the hash of a
  token kept in an httpOnly cookie, enforced in server TypeScript only, no database check live, PENDING adds a clock-in
  check, fail-open when no device is registered), the session night flag (A13) and the exclusions (A14).
- BUSINESS_RULES.md, Part B: the clock-out correction (Super Admin or Admin by role, reason required, in-place update,
  old value only in a best-effort app audit event) and the hard delete, both of which change payroll inputs (B5 to B8).
- PERMISSIONS.md: role keys, `hr_payroll`, `requireOwner` and `requireOwnerOrAdmin`, the generic permission keys used in
  section 10, and RLS on `payroll_snapshots` and `staff_profiles`.
- SECURITY.md: open write policies on attendance rows (section 3.3), payroll privacy and money in the audit trail
  (section 7), the PENDING role sentinel and definer-function grants.
- SERVER_API.md and ARCHITECTURE.md: the contracts of `generatePayslipAction`, `markPayslipPaidAction`,
  `setHourlyRateAction` and the payroll readers, and the request path of the Payroll screen.
- INTEGRATION_GUIDE.md: Step 4 (configure payroll rules) and the consolidated removal table.
- DATABASE.md: full DDL, the RECONSTRUCTED object list, and the generic tables and functions named in section 5 (5.5,
  5.8 to 5.10, 5.12: `employee_pay_rates`, `payroll_snapshots`, `payroll_adjustments`, `attendance_day_reviews`,
  settings accessors).
- CONFIGURATION.md: the schema of record for every setting key in section 10.
- UI_UX.md: the Payroll table, tabs, dialogs, print isolation and responsive behaviour.
- TESTING_CHECKLIST.md: the payroll test contract that section 12, item 18 feeds.
- IMPLEMENTATION_PROMPT.md: the build instructions that consume this document.
