# Attendance and Payroll Template: Architecture (Phase 2)

This document is Phase 2 of the attendance and payroll template. It maps how the reference implementation is built
from the browser down to the table for its three screens (Attendance, Review Attendance, Payroll): which server
component gates each page, which client component calls which server action, which domain function and SQL function
sit behind it, and which tables and row-level-security policies finally decide. It then traces the real journeys of
the four actors (Staff, kiosk operator, Admin, Super Admin (role key owner)), summarises the data model, shows where each
cross-cutting concern lives (authorization, timezone, money, audit, realtime refresh, read retries, response headers),
restates the same architecture with generic names for a new client, and lists what the reference implementation
deliberately does not do, so that adopters do not assume features that were never built.

## How to read this

Every statement carries one of these labels.

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves. Cited as `file:line` against the repository. |
| GENERIC | The reusable form of a rule, layer or object. |
| PROJECT-SPECIFIC | Tied to the source business. Named values are listed in section 10 (see its first paragraph). |
| CONFIGURABLE | Should become a client setting. See `CONFIGURATION.md`. |
| NEEDS VERIFICATION | The repository cannot settle it. The text says what would settle it. |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository; its shape is inferred from callers. |
| PENDING (not live) | Content of migrations `20260916120000`, `20260916130000` or `20260917120000`: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template should fix. Never a change to production. |

Conventions:

- Role vocabulary: database role keys are `owner`, `selected_admin` and `staff`. The user interface calls them
  Super Admin (role key owner), Admin (role key selected_admin) and Staff (role key staff). After this first use the
  document says Super Admin, Admin and Staff, and uses the raw key only inside SQL or code.
- Permission keys: `hr_attendance` opens the Attendance page and the kiosk roster; `hr_review_attendance` opens Review
  Attendance and lets the holder read every attendance row; `hr_payroll` opens Payroll. A Super Admin holds every key
  implicitly (`guard.ts:177-180`; `M/20260716240000:26-44`).
- "Kiosk operator" means any signed-in, active account that holds `hr_attendance` and operates the Attendance page.
  Clocking in the reference implementation is a shared kiosk: the operator picks a member and clocks that member.
- Diagrams are plain text. `A -> B` means A calls, submits to or renders B. `[RLS ...]` names the row policy that
  bounds a table read or write. Each step carries its citation.
- Placeholders: `<business-tz>` for the business timezone, `<business-utc-offset>` for its fixed UTC offset and
  `<cur>` for the currency symbol. The reference values are listed only in section 10.
- No line of this file contains a backslash character; regular expressions are described in words.

Related documents in this folder: `README.md` (index and scope), `DATABASE.md` (tables, functions, DDL, generic data
model), `BUSINESS_RULES.md` (clocking, correction and deletion rules), `PAYROLL.md` (pay rules and formulas),
`PERMISSIONS.md` (who may do what, by layer, and the template permission keys), `SECURITY.md` (checks that must not be
frontend-only, device approval, selfie and audit privacy), `SERVER_API.md` (the contract of every server action, reader
and RPC), `UI_UX.md` (screens and components), `CONFIGURATION.md` (settings), `INTEGRATION_GUIDE.md` (installing the
module in a host application), `TESTING_CHECKLIST.md` (tests) and `IMPLEMENTATION_PROMPT.md`. Where a subject belongs
to one of them, this file states only the architectural fact and points there.

### Citation key

| Short form | Full path |
|---|---|
| `app-layout.tsx` | `src/app/(app)/layout.tsx` |
| `attendance-page.tsx` | `src/app/(app)/admin/attendance/page.tsx` |
| `review-page.tsx` | `src/app/(app)/admin/attendance/review/page.tsx` |
| `payroll-page.tsx` | `src/app/(app)/admin/payroll/page.tsx` |
| `approvals-page.tsx` | `src/app/(app)/approvals/page.tsx` |
| `settings-page.tsx` | `src/app/(app)/settings/page.tsx` |
| `attendance-clock.tsx` | `src/components/hr/attendance-clock.tsx` |
| `attendance-records.tsx` | `src/components/hr/attendance-records.tsx` |
| `attendance-day-details.tsx` | `src/components/hr/attendance-day-details.tsx` |
| `device-manager.tsx` | `src/components/hr/device-manager.tsx` |
| `review-attendance-view.tsx` | `src/components/hr/review-attendance-view.tsx` |
| `payroll-tabs.tsx` | `src/components/hr/payroll-tabs.tsx` |
| `attendance-view.tsx` | `src/components/hr/attendance-view.tsx` (the payroll table, despite its name) |
| `employee-rates-view.tsx` | `src/components/hr/employee-rates-view.tsx` |
| `payslip-button.tsx` | `src/components/hr/payslip-button.tsx` |
| `payroll-summary-button.tsx` | `src/components/hr/payroll-summary-button.tsx` |
| `approvals-view.tsx` | `src/components/approvals/approvals-view.tsx` |
| `member-access-controls.tsx` | `src/components/settings/member-access-controls.tsx` |
| `app-shell.tsx` | `src/components/shell/app-shell.tsx` |
| `dashboard-sync.tsx` | `src/components/shell/dashboard-sync.tsx` |
| `navigation.ts` | `src/components/shell/navigation.ts` |
| `privacy.tsx` | `src/components/shell/privacy.tsx` |
| `money-input.tsx` | `src/components/ui/money-input.tsx` |
| `hr-actions.ts` | `src/lib/hr/actions.ts` |
| `payslip-actions.ts` | `src/lib/hr/payslip-actions.ts` |
| `attendance.ts` | `src/lib/hr/attendance.ts` |
| `attendance-paging.ts` | `src/lib/hr/attendance-paging.ts` |
| `sessions.ts` | `src/lib/hr/sessions.ts` |
| `hr-format.ts` | `src/lib/hr/format.ts` |
| `devices.ts` | `src/lib/hr/devices.ts` |
| `payroll.ts` | `src/lib/hr/payroll.ts` |
| `payslip.ts` | `src/lib/hr/payslip.ts` |
| `payslip-pdf.ts` | `src/lib/hr/payslip-pdf.ts` |
| `rate.ts` | `src/lib/hr/rate.ts` |
| `attachments-actions.ts` | `src/lib/attachments/actions.ts` |
| `upload.ts` | `src/lib/attachments/upload.ts` |
| `audit-log.ts` | `src/lib/audit/log.ts` |
| `guard.ts` | `src/lib/authz/guard.ts` |
| `request-deletion.ts` | `src/lib/authz/request-deletion.ts` |
| `team-accounts.ts` | `src/lib/authz/team-accounts.ts` |
| `team-actions.ts` | `src/lib/authz/team-actions.ts` |
| `fulfillment-service.ts` | `src/lib/fulfillment/service.ts` (hosts the generic approval queue) |
| `fulfillment-actions.ts` | `src/lib/fulfillment/actions.ts` |
| `auth-actions.ts` | `src/lib/auth/actions.ts` |
| `supabase-server.ts` | `src/lib/supabase/server.ts` |
| `retry-fetch.ts` | `src/lib/supabase/retry-fetch.ts` |
| `money-format.ts` | `src/lib/payments/format.ts` |
| `bizdate.ts` | the business-date helper module under `src/lib/format/` (its file name carries the timezone; see section 10) |
| `cache-policy.ts` | `src/lib/pwa/cache-policy.ts` |
| `export-route.ts` | `src/app/api/export/all/route.ts` |
| `data-export.ts` | `src/lib/export/data-export.ts` |
| `next.config.ts` | `next.config.ts` |
| `proxy.ts` | `src/proxy.ts` |
| `M/<timestamp>` | the migration in `supabase/migrations/` whose file name starts with that timestamp |

---

## 1. The request path in one picture

### 1.1 CURRENT layering (all three screens)

```
Browser
  -> proxy.ts:14-16            updateSession: refreshes the session cookie; explicitly NOT the security control (:9-12)
  -> app-layout.tsx:42         requireActiveStaff(): no session -> /sign-in; transient error -> /offline;
                               no profile, inactive, or demo without demo login -> /account-disabled (guard.ts:124-163)
  -> app-layout.tsx:43-53      getGrantedPermissions(): Super Admin = every key; others = explicit grants; read error = none
                               (guard.ts:174-198) -> sidebar allowedPages (app-layout.tsx:62; navigation.ts:264-275)
  -> page.tsx                  server component, dynamic = 'force-dynamic'
       gate                    canOpenPage(<key>) else notFound() (guard.ts:300-303)
       reads                   domain readers ('server-only') -> user-scoped Supabase client -> SELECT or RPC
  -> client component          'use client': filters, pagination, modal and camera state; renders server props
  -> server action             'use server' in hr-actions.ts or payslip-actions.ts: transport, some guards
  -> domain function           src/lib/hr/*.ts: TypeScript guard, validation, error mapping, audit write
  -> Supabase client           supabase-server.ts:18-48 (acts as the signed-in user; GET/HEAD retried, POST never)
  -> Postgres                  SECURITY DEFINER RPC (writes about other members) or INVOKER function or table query
  -> RLS policy -> table
```

### 1.2 CURRENT facts about the path

- The feature uses only the user-scoped client. `createClient()` "acts AS THE SIGNED-IN USER" and "cannot bypass RLS"
  (`supabase-server.ts:10-17`); the audit writer uses the same client (`audit-log.ts:40-47`). No service-role key is
  used by the three screens.
- Every page and the `(app)` layout are request-time rendered (`app-layout.tsx:36`; `attendance-page.tsx:31`;
  `review-page.tsx:12`; `payroll-page.tsx:14`), so authorization is evaluated per request, never at build time.
- The feature has no API route of its own. The only route handler that reads its tables is the workbook export
  (`export-route.ts:15-25`), which reads attendance rows and `report_payroll` under the caller's RLS
  (`data-export.ts:522-536`, `:563-568`).
- Hiding a sidebar link is convenience; every page re-checks its key (`navigation.ts:261-263`;
  `attendance-page.tsx:43`; `review-page.tsx:22`; `payroll-page.tsx:30`). A missing key returns 404, not 403.
- Writes that affect another member go through database functions, because the attendance table policies allow
  INSERT of the caller's own rows only, and UPDATE of the caller's own rows or, for a Super Admin, of any row
  (`M/20260717120000:58-75`). Kiosk clock-in, correction and the device functions are SECURITY DEFINER in the repository
  (`M/20260907120000:17`; `M/20260907130000:20`; `M/20260722150000:43`, `:73`). `kiosk_clock_out` and
  `delete_attendance_record` are RECONSTRUCTED: the application only calls them (`attendance.ts:217-220`, `:367-370`),
  their security mode is not in the repository, and DEFINER is inferred: under those policies an operator who is not a
  Super Admin could not close another member's session, and no end-user role holds DELETE on the table
  (`M/20260717120000:75`). NEEDS VERIFICATION, section 9 item 1. Payroll is read through an
  INVOKER function whose row filter decides visibility (`M/20260907160000:29-34`, `:97-100`). Both tables force RLS
  (`M/20260717120000:47-48`; `M/20260722210000:46-47`).
- NEEDS VERIFICATION: definer functions can write a table with FORCED row level security only if their owning role
  bypasses RLS. Settle with a catalog query on `pg_proc.proowner` joined to `pg_roles.rolbypassrls` (details in
  `DATABASE.md`).

---

## 2. Layering per screen (CURRENT)

### 2.1 Attendance: `/admin/attendance`

```
GET /admin/attendance
  AttendancePage                                   attendance-page.tsx:42-134
    gate   canOpenPage('hr_attendance') else 404   attendance-page.tsx:43
    gate   requireActiveStaff()                    attendance-page.tsx:44
    flag   canSeeTeam = Super Admin or canOpenPage('hr_review_attendance')          attendance-page.tsx:49
    reads  Promise.all                             attendance-page.tsx:57-77
      listAttendancePage(last 7 days, all, 1, 25)  attendance.ts:596-659
          -> SELECT attendance_records: HEAD count, page, completion rows          [RLS attendance_read]
      listOpenSessions()                           attendance.ts:111-122 -> SELECT where time_out is null  [RLS attendance_read]
      listLastClockOutToday()                      attendance.ts:130-146 -> SELECT where work_date = today [RLS attendance_read]
      listClockStaff()                             attendance.ts:96-108
          -> rpc list_clock_staff()                M/20260907160000:9-27 (DEFINER; has_permission('hr_attendance')) -> staff_profiles
      listTodaySessionStaff() (reviewers only)     attendance.ts:666-681 -> SELECT time_in within today    [RLS attendance_read]
      isAttendanceGatingActive()                   devices.ts:38-42 -> rpc attendance_gating_active()  M/20260722150000:66-69
      isThisDeviceApproved()                       devices.ts:45-58 -> device cookie
          -> rpc verify_attendance_device(token)   M/20260722150000:58-63
    serial listDevices() (Super Admin only)        attendance-page.tsx:80; devices.ts:122-137 -> SELECT attendance_devices
                                                   [RLS Super Admin read, M/20260722180000:5-14]
    flags  canManage = Super Admin or Admin (role title)   attendance-page.tsx:79
           blockedHere = gating active and this device not approved             attendance-page.tsx:81
  renders
    blocked-device banner (the clock buttons are NOT disabled)                   attendance-page.tsx:91-105
    DeviceManager (Super Admin only)                                             attendance-page.tsx:107
      register form device-manager.tsx:178 -> registerDeviceAction hr-actions.ts:108-119
        -> registerThisDevice devices.ts:65-97 -> rpc register_attendance_device M/20260722150000:42-55 -> attendance_devices
        -> Set-Cookie (httpOnly, secure, lax, 1 year) devices.ts:83-89 -> audit attendance.device_register devices.ts:91-95
      revoke form device-manager.tsx:136-146 -> revokeDeviceAction hr-actions.ts:122-132
        -> revokeDevice devices.ts:100-119 -> rpc revoke_attendance_device M/20260722150000:72-79 -> audit attendance.device_revoke
    AttendanceClock                                                              attendance-clock.tsx:50-407
      finish() :137-186 -> clockInAction hr-actions.ts:81-94 -> kioskClockIn attendance.ts:154-207
        -> rpc kiosk_clock_in M/20260907120000:14-54 -> INSERT attendance_records (+ BEFORE INSERT trigger M/20260722200000:46-49)
      finish() -> clockOutAction hr-actions.ts:96-105 -> kioskClockOut attendance.ts:210-237
        -> rpc kiosk_clock_out (RECONSTRUCTED) -> UPDATE attendance_records.time_out
      finish() -> uploadAttachmentAction attachments-actions.ts:27-57 -> uploadAttachment upload.ts:67-181
        -> Storage bucket attachments + INSERT attachments                      [RLS active staff, self-attributed]
    AttendanceSummaryCards (reviewers only; props only)                          attendance-page.tsx:121
    AttendanceRecords                                                            attendance-records.tsx
      filter or page change :128-148 -> loadAttendancePageAction hr-actions.ts:57-64 (requirePermission) -> listAttendancePage
      View :385, :429 -> AttendanceDayDetails attendance-day-details.tsx:30-104
        Super Admin: type DELETE -> deleteAttendanceRecordAction hr-actions.ts:139-157
          -> deleteAttendanceRecord attendance.ts:348-390 -> rpc delete_attendance_record (RECONSTRUCTED)
        Admin: Request delete attendance-day-details.tsx:140-150 -> requestAttendanceDeletionAction hr-actions.ts:190-204
          -> requestOwnerDeletion request-deletion.ts:15-28 -> requestOwnerApproval fulfillment-service.ts:493-556
          -> INSERT owner_approval_requests (pending)
```

Notes (CURRENT):

- The page docstring still calls clocking "self-service for any active staff member" (`attendance-page.tsx:34-35`);
  the code is a kiosk that clocks the selected member (`hr-actions.ts:85`; `attendance-clock.tsx:145-150`).
- The two status maps that choose Clock In, Clock Out or Continue Duty are table reads under the operator's own RLS
  (`attendance.ts:111-146`; `M/20260804140000:8-14`). An operator without `hr_review_attendance` therefore never sees
  another member's open session or last clock-out. Clock Out is never offered for others; Continue Duty is never
  offered either, but the Clock In fallback runs the same RPC and creates the same new session; Clock In on a member
  who is already clocked in is refused by the database. RECOMMENDED TEMPLATE IMPROVEMENT: a permission-scoped definer
  status reader (section 8, AR3).
- Neither clock action checks `hr_attendance`; the domain functions check only `requireActiveStaff()` and the device
  cookie (`attendance.ts:158-162`, `:211-215`), and `kiosk_clock_in` checks only `is_active_staff()`
  (`M/20260907120000:25-28`). The permission gates the page and the roster, not the write (section 8, AR1).
- `listClockStaff()` returns an empty list on any error (`attendance.ts:102`); the dropdown then says there are no
  members, which hides a failure.
- The Super Admin device roster read runs after the parallel reads (`attendance-page.tsx:80`): one extra round trip.

### 2.2 Review Attendance: `/admin/attendance/review`

```
GET /admin/attendance/review
  ReviewAttendancePage                             review-page.tsx:21-51
    gate   canOpenPage('hr_review_attendance') else 404                          review-page.tsx:22
    gate   requireActiveStaff()                    review-page.tsx:23
    reads  Promise.all                             review-page.tsx:26-33
      listAttendancePage(last 7 days, all, 1, 25)  -> SELECT attendance_records  [RLS attendance_read, third branch M/20260804140000:13]
          embeds staff_profiles(full_name)         attendance.ts:562-563          [RLS staff_profiles_read: Super Admin or self,
                                                                                   M/20260821140000:21-22]
      listClockStaff()                             -> rpc list_clock_staff (gated on hr_attendance, not hr_review_attendance)
    flag   canManage = Super Admin or Admin (role title)                         review-page.tsx:35-36
  renders ReviewAttendanceView                                                   review-attendance-view.tsx:78-505
    filters useMemo :125-133 -> load effect :142-162 -> loadReviewAttendancePageAction hr-actions.ts:72-79 -> listAttendancePage
    Details -> openDay :110-117 -> loadAttendanceSelfiesAction hr-actions.ts:45-50 -> listAttendanceSelfiesFor attendance.ts:520-560
      -> SELECT attachments [RLS any active staff] -> Storage createSignedUrl(300 s, download) attendance.ts:544-550
    ReviewDayModal :547-646 (correct and delete controls only when canManage, :624-629)
      ReviewRowCorrect :687-799 -> correctAttendanceClockOutAction hr-actions.ts:165-183
        -> correctAttendanceClockOut attendance.ts:400-458 -> rpc correct_attendance_clock_out M/20260907130000:13-68
        -> UPDATE attendance_records set time_out, edited_by, edit_reason
      ReviewRowDelete :807-894 -> deleteAttendanceRecordAction hr-actions.ts:139-157
        -> deleteAttendanceRecord attendance.ts:348-390 -> rpc delete_attendance_record (RECONSTRUCTED)
```

Notes (CURRENT):

- Names are blank for a reviewer who is not a Super Admin. The embed reads `staff_profiles`, whose only SELECT policy
  in the repository is Super Admin or self, so every other member's name comes back null and the screen falls back
  to a placeholder (`review-attendance-view.tsx:564`). NEEDS VERIFICATION only for "does production carry another
  `staff_profiles` SELECT policy"; RECOMMENDED TEMPLATE IMPROVEMENT AR4.
- The roster that powers the employee filter and name search needs `hr_attendance`. A reviewer who holds only
  `hr_review_attendance` gets an empty roster, so every name search returns nothing (`attendance.ts:102`, `:604`).
- The page offers the Admin a direct Delete (`review-attendance-view.tsx:624-629`), while the Attendance page offers
  the same Admin only a request (`attendance-day-details.tsx:140-150`). The server accepts a direct delete from both
  roles (`attendance.ts:352`).
- `canManage` defaults to `true` when the prop is omitted (`review-attendance-view.tsx:81`); the server still guards
  every write, but a template component should default to the safe value.
- There is no flag, review or approval state and no export button on this page (`review-attendance-view.tsx:70-71`).

### 2.3 Payroll: `/admin/payroll`

```
GET /admin/payroll?from=YYYY-MM-DD&to=YYYY-MM-DD
  PayrollPage                                      payroll-page.tsx:23-61
    gate   canOpenPage('hr_payroll') else 404      payroll-page.tsx:30
    period from and to search params; default business month start to business today; not validated  payroll-page.tsx:33-34
    reads  Promise.all                             payroll-page.tsx:36-40
      requireActiveStaff()
      getPayroll(from, to)                         payroll.ts:38-68
          -> rpc report_payroll(p_from, p_to)      M/20260907160000:29-102 (INVOKER, STABLE)
          -> attendance_records [RLS] + staff_salary_rates (RECONSTRUCTED) + staff_profiles [RLS] + app_private.night_ot_bonus()
             (RECONSTRUCTED); row filter: self or Super Admin (:100)
      listPayslipsForPeriod(from, to)              payslip.ts:61-82
          -> SELECT payroll_snapshots, exact period, newest per employee wins     [RLS self or Super Admin, M/20260722210000:51-55]
    flag   canManagePayroll = Super Admin or Admin (role title)                   payroll-page.tsx:43
    serial listEmployeeRates() when canManagePayroll                              payroll-page.tsx:44; rate.ts:128-191
          -> SELECT staff_profiles [RLS] + SELECT staff_salary_rates (RECONSTRUCTED policies)
  renders PayrollTabs (tab bar only when canManageRates)                          payroll-tabs.tsx:17-79, :49
    AttendanceView = the payroll table                                            attendance-view.tsx
      period form method GET :76-97 -> full page navigation with new search params (no server action)
      Print Payroll Summary (Super Admin, rows exist) :98-105 -> PayrollSummaryButton payroll-summary-button.tsx:41-182
        (client only: integer minor-unit total, window.print)
      RateCell (Super Admin) :182-183, :253-348 -> setHourlyRateAction hr-actions.ts:210-228 -> setSalaryRate rate.ts:201-244
        -> rpc set_staff_salary_rate (RECONSTRUCTED) -> new row in staff_salary_rates (RECONSTRUCTED)
      PayslipButton per row :222-228                                              payslip-button.tsx:151-315
        generate() :171-193 -> generatePayslipAction payslip-actions.ts:23-97
          -> rpc generate_payslip_snapshot (repo body M/20260722210000:75-132 is stale; live body RECONSTRUCTED)
          -> INSERT payroll_snapshots [RLS insert: Super Admin] -> SELECT read-back payslip-actions.ts:76-82
        markPaid() :195-216 -> markPayslipPaidAction payslip-actions.ts:99-154
          -> direct UPDATE payroll_snapshots where payment_status = 'pending' (no RPC) [RLS update]
        Download PDF :223-230 -> downloadPayslipPdf payslip-pdf.ts:51-169 (client only)
        Print :231 -> window.print()
    EmployeeRatesView (second tab)                                                employee-rates-view.tsx:146-222
      EditRate :39-144 -> setHourlyRateAction -> setSalaryRate -> rpc set_staff_salary_rate (RECONSTRUCTED)
```

Notes (CURRENT):

- `setHourlyRateAction` is a legacy name; it writes an effective-dated daily rate (`rate.ts:193-199`). Neither the
  action nor `setSalaryRate` has a TypeScript guard (`hr-actions.ts:210-228`; `rate.ts:201-231`); the only gate is
  the RECONSTRUCTED database function.
- Role-derived UI flags and the data layer disagree for an Admin: the page treats an Admin as a payroll manager
  (`payroll-page.tsx:42-44`), but `report_payroll` returns only the caller's own row (`M/20260907160000:100`),
  `staff_profiles` lets the Employee Rates tab list only the Admin (`M/20260821140000:21-22`), generating a payslip
  requires the Super Admin role (`payslip-actions.ts:28`) and the repository update policy refuses mark-paid
  (`M/20260722210000:62-65`). See section 3.3 and `PERMISSIONS.md`.
- A payslip read error or a period that differs by a day from the generated one makes every row show "Unpaid",
  because the reader returns an empty map on error and matches the period exactly (`payslip.ts:66-73`).
- Pay rules (days worked, daily rate, night bonus, deductions) belong to `PAYROLL.md`; this file only records that
  every money figure is computed in SQL and crosses to TypeScript as a string (section 5.3).

---

## 3. Real flows by actor (CURRENT)

### 3.1 Staff (role key staff)

```
Sign in
  sign-in form src/app/(auth)/sign-in/sign-in-form.tsx:34 -> signIn auth-actions.ts:50
    -> supabase.auth.signInWithPassword auth-actions.ts:68 -> redirect('/dashboard') auth-actions.ts:126
  -> app-layout.tsx:42 requireActiveStaff()          inactive, missing profile or demo -> /account-disabled (guard.ts:141-154)
  -> app-layout.tsx:47 getGrantedPermissions()       Staff holds explicit grants only (guard.ts:182-197);
                                                     a newly created member is granted nav_dashboard only (team-accounts.ts:350-354)
  -> sidebar shows only pages whose key is held      navigation.ts:91-93, :264-275

Without hr_attendance, hr_review_attendance or hr_payroll:
  /admin/attendance, /admin/attendance/review and /admin/payroll all answer 404
  (attendance-page.tsx:43; review-page.tsx:22; payroll-page.tsx:30)

With hr_attendance granted:
  /admin/attendance -> the shared kiosk (section 3.2), not a personal clock
  history list -> own rows only                      [RLS attendance_read self branch, M/20260804140000:11]
  kiosk status maps -> own rows only, so other members look "not clocked in" (section 2.1 notes)

With hr_payroll granted:
  /admin/payroll -> one row: the caller's own        report_payroll row filter M/20260907160000:100
  own payslips only                                  [RLS payroll_snapshots_read, M/20260722210000:51-55]
  View payslip -> Download PDF, Print                payslip-button.tsx:218-233
  no payslip yet -> modal text asks for the Super Admin, but the footer still shows "Generate payslip"
                                                     payslip-button.tsx:240-249, :294-299
    -> generatePayslipAction -> requireOwner() refuses payslip-actions.ts:28
```

What the Staff journey does NOT contain (CURRENT):

- No self-service clock. The only clock UI is the kiosk. Super-Admin-only functions that clock the caller's own
  profile exist but have no caller (`attendance.ts:252-339`).
- No own-payroll screen. The single payroll route is `/admin/payroll` (`navigation.ts:93`); a Staff member sees their
  own row there only if granted `hr_payroll`.
- Data-layer reach is wider than the UI. Without any page grant, RLS still returns the member's own attendance rows
  and payslips, and the policies let a member insert and update their own attendance rows through PostgREST
  (`M/20260717120000:58-75`), bypassing the kiosk, the device gate and the selfie. The INSERT and UPDATE policies
  check only `staff_profile_id`, and `authenticated` holds table-wide INSERT and UPDATE (`:75`), so the member can
  also write any `time_in`, `time_out` or `work_date` value on their own rows, including closed sessions. The column
  defaults apply only when a value is omitted (`:25-26`); beyond NOT NULL, the note length, the one-open-session index
  and the check that `time_out` is not before `time_in` (`:32`), nothing bounds those values. Payroll reads those
  columns directly (`M/20260907160000:39-44`). The night flag trigger derives its result from the supplied `time_in`
  and fires only on INSERT (`M/20260722200000:34`, `:46-49`), so an UPDATE can also set `is_overtime` and
  `overtime_amount` freely within their check (`M/20260722200000:12-15`). NEEDS VERIFICATION against the live grants
  and policies; RECOMMENDED TEMPLATE IMPROVEMENT AR5.

### 3.2 Kiosk operator (any active account holding `hr_attendance`)

```
GET /admin/attendance (section 2.1 reads)
  roster        rpc list_clock_staff: active members, role key not owner; demo accounts NOT filtered  M/20260907160000:20-25
  status maps   open sessions and last clock-out today, both under the operator's RLS                attendance.ts:111-146
  device state  gating active? this browser's cookie approved?                                       devices.ts:38-58
  banner        shown when gating is active and this browser is not approved; buttons stay enabled attendance-page.tsx:81, :91-105

AttendanceClock
  select member                                     attendance-clock.tsx:214-235
  choose action (first match wins)                  attendance-clock.tsx:300-352
    open session         -> Clock Out
    clocked out today    -> Continue Duty -> confirmation modal attendance-clock.tsx:357-392 -> same path as Clock In
    otherwise            -> Clock In
  startCamera(in | out)                             attendance-clock.tsx:106-128  getUserMedia, front camera, no audio
    no camera API or permission denied -> only "Clock in/out without photo" is offered   attendance-clock.tsx:111-127, :275-286
  Capture -> compressToJpeg                         attendance-clock.tsx:27-40, :188-202 (encode failure -> no photo)
  finish(selfie)                                    attendance-clock.tsx:137-186
    -> clockInAction                                hr-actions.ts:81-94 (no permission check)
       -> kioskClockIn                              attendance.ts:154-207
          -> requireActiveStaff()                   attendance.ts:158
          -> requireApprovedDevice(member, clock_in) attendance.ts:28-48, :161
               gating inactive -> device id NULL
               cookie hash matches an active device -> that device id
               otherwise -> audit attendance.blocked_device (entity id = the member's id) + error
          -> rpc kiosk_clock_in(p_staff_id, p_device_id, p_note)                  attendance.ts:165-169
               is_active_staff() gate                                             M/20260907120000:25-28
               target exists, active, not demo                                    M/20260907120000:30-37
               INSERT attendance_records, work_date = business date at clock-in    M/20260907120000:40-47
               BEFORE INSERT trigger: clock-in hour >= 22 -> is_overtime, 300.00  M/20260722200000:26-49
               second open session -> unique partial index -> "already clocked in" M/20260717120000:43-45; M/20260907120000:48-49
               live: p_device_id is stored, not validated; PENDING (not live) adds the check M/20260916120000:451-459
          -> SELECT is_overtime, overtime_amount (best effort)                    attendance.ts:180-186
          -> recordAuditEvent attendance.clock_in {for_staff, overtime_amount?}   attendance.ts:188-196
       -> revalidatePath('/admin/attendance'); return recordId                    hr-actions.ts:91-93
    -> clockOutAction                               hr-actions.ts:96-105
       -> kioskClockOut                             attendance.ts:210-237
          -> requireActiveStaff(); requireApprovedDevice(member, clock_out)        attendance.ts:211-215
          -> rpc kiosk_clock_out(p_staff_id) (RECONSTRUCTED; no device parameter)  attendance.ts:217-220
          -> recordAuditEvent attendance.clock_out {for_staff}                     attendance.ts:230-235
    -> if a photo was taken and a record id came back                              attendance-clock.tsx:157-166
       uploadAttachmentAction                       attachments-actions.ts:27-57
         -> uploadAttachment                        upload.ts:67-181
              requireActiveStaff(); type, id, purpose, source, size checks         upload.ts:72-100
              Storage path attendance_record/<record id>/<uuid>.jpg, bucket attachments  upload.ts:105-112
              INSERT attachments (related_entity_type attendance_record, purpose photo, source camera,
                file name clock-in-selfie-<ms>.jpg or clock-out-selfie-<ms>.jpg, uploaded_by = operator) upload.ts:130-148
              audit attachment.upload                                              upload.ts:172-178
       upload failure -> soft notice; the clock event stands                        attendance-clock.tsx:167-173
    -> stop camera; router.refresh()                                               attendance-clock.tsx:178-180
```

Architectural consequences (CURRENT):

- The clock write happens before the photo upload, in two separate server actions. A photo can therefore be missing
  for a real clock event, and nothing on the server requires one.
- Clock-in versus clock-out photo is decided only by the file name the client chose (`attendance-clock.tsx:158-164`;
  `attendance.ts:552-554`).
- The upload accepts any `attendance_record` id from any active staff member (`upload.ts:78-83`; RLS
  `M/20260716300000:137-142`), and attachment metadata and storage objects are readable by every active staff member
  (`M/20260716300000:127-129`, `:159-161`). RECOMMENDED TEMPLATE IMPROVEMENT AR17.
- Super Admins are excluded from the roster, but `kiosk_clock_in` accepts a Super Admin target id; demo accounts are
  listed by the roster but refused by `kiosk_clock_in` (`M/20260907160000:24`; `M/20260907120000:30-37`).

### 3.3 Admin (role key selected_admin)

The Admin holds only what a Super Admin granted in Manage Access. The pages below open only with the named key, but
several writes behind them are gated by role, not by key: correction, delete, mark-paid and the rate edit (see the
notes after the diagram and section 5.1).

```
Review Attendance (needs hr_review_attendance)
  GET /admin/attendance/review (section 2.2)
    rows: every member                            [RLS attendance_read third branch M/20260804140000:13]
    names: blank for others                       [RLS staff_profiles_read M/20260821140000:21-22]
    roster: empty unless the Admin also holds hr_attendance       M/20260907160000:16-19
  filter (status tabs, date presets, employee, name search)       review-attendance-view.tsx:125-162
    -> loadReviewAttendancePageAction hr-actions.ts:72-79 -> listAttendancePage attendance.ts:596-659
       dates filter the clock-in timestamp within business-day bounds, not work_date   attendance.ts:606, :615-616
  inspect a day: Details -> openDay                review-attendance-view.tsx:110-117
    sessions, gaps "not counted", total = sum of completed sessions   sessions.ts:65-129
    selfies lazy-loaded for that day only -> loadAttendanceSelfiesAction hr-actions.ts:45-50 -> signed URLs (300 s)
  correct a clock-out (Set clock-out closes an open session; Correct clock-out changes a completed one)
    ReviewRowCorrect: prefill = current time_out or time_in, truncated to the minute, in the browser's zone
                                                  review-attendance-view.tsx:673-679, :706-713
    -> correctAttendanceClockOutAction           hr-actions.ts:165-183 (presence checks only)
    -> correctAttendanceClockOut                 attendance.ts:400-458: requireOwnerOrAdmin :406; reason :421-422; valid date :423-427
    -> rpc correct_attendance_clock_out          M/20260907130000:13-68
         role in (owner, selected_admin), NULL refused   :29-33
         reason required; record exists; new time not NULL, >= time_in, <= now()   :35-53
         reads the row without a lock (no select ... for update)   :39-40
         UPDATE time_out, edited_by, edit_reason in place   :55-59
         returns the OLD time_out                  :61
    -> audit attendance.clock_out_corrected {old_time_out, new_time_out, reason}   attendance.ts:447-456
    -> revalidatePath review, attendance, payroll hr-actions.ts:179-181; router.refresh() review-attendance-view.tsx:702
  delete
    on Review: type DELETE -> deleteAttendanceRecordAction hr-actions.ts:139-157 (confirm word checked :146-148)
      -> deleteAttendanceRecord attendance.ts:348-390 (requireOwnerOrAdmin :352)
      -> rpc delete_attendance_record (RECONSTRUCTED; hard delete; selfies left in storage, attendance.ts:345-346)
      -> audit attendance.delete {permanent: true} attendance.ts:383-388
    on Attendance (needs hr_attendance): Request delete attendance-day-details.tsx:140-150
      -> requestAttendanceDeletionAction hr-actions.ts:190-204 -> requestOwnerDeletion request-deletion.ts:15-28
      -> requestOwnerApproval fulfillment-service.ts:493-556: requirePermission('initiate_high_risk_action') :502
      -> INSERT owner_approval_requests status pending_owner_approval :522-535 (nothing deleted)

Payroll (needs hr_payroll)
  GET /admin/payroll (section 2.3)
    rows: the Admin's own row only                M/20260907160000:100
    Employee Rates tab shown (role flag)          payroll-page.tsx:43-44; payroll-tabs.tsx:49
      list: at most the Admin (staff_profiles RLS); excludes Super Admins and demo accounts   rate.ts:131-138
      Edit rate -> setHourlyRateAction -> setSalaryRate (no TypeScript guard) -> rpc set_staff_salary_rate
                   (RECONSTRUCTED gate; the code comment says Super Admin only, rate.ts:198-199)
    PayslipButton
      Generate form is shown (canManage)          payslip-button.tsx:276-293
        -> generatePayslipAction -> requireOwner() refuses            payslip-actions.ts:28
      Mark as Paid is shown on a pending payslip  payslip-button.tsx:234-238
        -> markPayslipPaidAction: requireOwnerOrAdmin() passes        payslip-actions.ts:106
        -> UPDATE payroll_snapshots where id and pending              payslip-actions.ts:124-135
        -> repository RLS update policy is Super Admin only -> no row -> "Could not mark the payslip as paid"
                                                  M/20260722210000:62-65; payslip-actions.ts:137-143
```

Notes:

- CURRENT: correction and delete authority is a role title checked in TypeScript and SQL, not the
  `hr_review_attendance` key (`attendance.ts:352`, `:406`; `M/20260907130000:29-33`); an Admin without that key can
  still call the correction or delete action for any record id. The same holds on Payroll without `hr_payroll`:
  mark-paid checks the role (`payslip-actions.ts:106`) and the rate action has no TypeScript guard at all
  (`hr-actions.ts:210-228`; `rate.ts:201-231`), so only the RLS update policy and the RECONSTRUCTED rate function stand
  behind them.
- CURRENT: the request path needs `initiate_high_risk_action`, which is absent from the Manage Access catalogue and
  granted by no migration; it is grantable only on the legacy Super Admin console reachable by URL
  (`src/components/admin/staff-console.tsx:35`; `src/lib/authz/actions.ts:38-60`; `src/app/(app)/admin/staff/page.tsx:34-41`),
  so the Admin request fails by default on a fresh install. NEEDS VERIFICATION whether production holds such a grant
  (count-only query, PERMISSIONS.md section 8); RECOMMENDED TEMPLATE IMPROVEMENT AR15.
- NEEDS VERIFICATION: whether the live `payroll_snapshots` update policy was widened for the Admin (migration drift;
  see `DATABASE.md`). With the repository policy, the Admin mark-paid path fails.
- CURRENT: an unchanged save in the correction modal is usually refused for an open session, because the
  minute-truncated prefill is earlier than `time_in` (`review-attendance-view.tsx:674-679`, `:707`, `:713`;
  `M/20260907130000:48-50`); it is accepted, as a zero-length session, only when `time_in` falls exactly on a whole
  minute. For a completed session an unchanged save silently rewrites the clock-out to the start of its minute. Screen
  detail and fix belong to `UI_UX.md`.
- CURRENT: the correction function reads the record without a row lock (`M/20260907130000:39-40`), so two concurrent
  corrections of the same record both succeed, the last write wins, and the `old_time_out` that the later one returns
  (and writes into its audit event) can be the value from before the earlier correction (section 5.4).

### 3.4 Super Admin (role key owner)

A Super Admin can do everything in sections 3.1 to 3.3 (implicit keys, `guard.ts:177-180`), with the differences
below and the extra flows that only this role reaches.

```
Differences on the shared screens
  Review and Attendance history: names visible     [RLS staff_profiles_read Super Admin branch M/20260821140000:22]
  Attendance day details: direct type-DELETE (no request path)          attendance-day-details.tsx:140-150
  Payroll: every active, non-demo, non-Super-Admin member               M/20260907160000:97-100
  Employee Rates tab: every such member                                  rate.ts:131-138

Device registration (Attendance page)
  DeviceManager                                    attendance-page.tsx:107; roster read devices.ts:122-137
  Register this device -> registerDeviceAction     hr-actions.ts:108-119
    -> registerThisDevice: requireOwner() devices.ts:69; token = 32 random bytes devices.ts:75
    -> rpc register_attendance_device(label, token) M/20260722150000:42-55
         Super Admin check :46-48; deactivates EVERY active device :49; stores only the sha256 hash :50-52
    -> httpOnly cookie on this browser             devices.ts:83-89
    -> audit attendance.device_register            devices.ts:91-95
  Revoke (one tap, no confirmation) -> revokeDeviceAction hr-actions.ts:122-132
    -> revokeDevice: requireOwner() devices.ts:104 -> rpc revoke_attendance_device M/20260722150000:72-79 -> audit :113-117

Rates
  inline RateCell on the payroll table             attendance-view.tsx:182-183, :253-348
  or Employee Rates tab EditRate                   employee-rates-view.tsx:39-144
    -> setHourlyRateAction hr-actions.ts:210-228 -> setSalaryRate rate.ts:201-244 (amount, frequency, effective date checks :207-220)
    -> rpc set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective) (RECONSTRUCTED) :222-228
    -> audit payroll.set_salary_rate (success only) rate.ts:233-238

Payslip generation and payment
  PayslipButton generate()                         payslip-button.tsx:171-193
    -> generatePayslipAction                       payslip-actions.ts:23-97
         requireOwner() :28; deductions must be a non-negative amount with at most two decimals :48-55
    -> rpc generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions) :57-63 (live body RECONSTRUCTED)
    -> INSERT payroll_snapshots                    [RLS insert Super Admin, M/20260722210000:58-60]
    -> read back with the member name              payslip-actions.ts:76-82
    -> audit payroll.payslip_generated {from, to, net_salary} payslip-actions.ts:88-93
    -> revalidatePath('/admin/payroll') :95; router.refresh() payslip-button.tsx:187
  Mark as Paid                                     payslip-button.tsx:195-216
    -> markPayslipPaidAction                       payslip-actions.ts:99-154
         payment_date = business today unless sent (the client never sends it) :115-116
         UPDATE payment_status 'paid', payment_date, paid_at, paid_by where still pending :124-135 (paid_at, paid_by RECONSTRUCTED)
    -> audit payroll.payslip_marked_paid           payslip-actions.ts:145-150
  Download PDF (client) payslip-pdf.ts:51-169; Print window.print() payslip-button.tsx:231
  Print Payroll Summary (client)                   attendance-view.tsx:98-105; payroll-summary-button.tsx:41-182

Permission grants (Manage Access)
  /settings (needs view_settings; member list loads for Super Admin only)   settings-page.tsx:115-120
  save toggles member-access-controls.tsx:156 -> setTeamMemberPermissionsAction team-actions.ts:47-54
    -> setTeamMemberPermissions team-accounts.ts:225-286: requireOwner() :232; catalogue keys only, other grants kept :244-255
    -> rpc set_team_member_permissions (RECONSTRUCTED) :258 -> staff_permission_grants

Approvals (deletion requested by an Admin)
  /approvals: role must be owner, else 404         approvals-page.tsx:22-24
  ApprovalDetail decide                            approvals-view.tsx:279-282
    -> decideApprovalAction fulfillment-actions.ts:211-241 -> decideOwnerApproval fulfillment-service.ts:562-638
         UPDATE owner_approval_requests status where still pending :584-595
         attendance_delete is NOT applied on approval (only order kinds auto-apply) :604-619
  ApprovalDetail execute                           approvals-view.tsx:283-286
    -> executeApprovalAction fulfillment-actions.ts:243-258 -> executeOwnerApproval fulfillment-service.ts:648-836
         rpc delete_attendance_record(p_record_id) :735-739 -> stamp executed_at, executed_by :810-817
         revalidates only /orders (fulfillment-actions.ts:253); audit owner_approval.* events, not attendance.delete

Export
  POST /api/export/all: Super Admin or Admin       export-route.ts:15-25
    -> attendance sheet (work_date range) data-export.ts:522-536; payroll sheet via report_payroll data-export.ts:563-568
```

---

## 4. Data model at a glance

Full DDL, policies, grants and the RECONSTRUCTED shapes are in `DATABASE.md`. This section fixes only the three ideas
every layer above depends on.

```
staff_profiles (identity: role_key, is_active, is_demo)
  |
  +--< attendance_records      one row per SESSION: time_in, time_out (NULL = open), work_date, device_id,
  |      |                     edited_by, edit_reason, is_overtime + overtime_amount (BEFORE INSERT trigger)
  |      |                     unique partial index: at most one open session per member
  |      +--< attachments      polymorphic: related_entity_type 'attendance_record'; no FK; in or out by file name
  |      >--  attendance_devices   device_id, ON DELETE SET NULL; one active device at a time
  |
  |   virtual DAY = group by (staff_profile_id, work_date)
  |      TypeScript: groupAttendanceDays sessions.ts:65-129   SQL: count(distinct work_date) M/20260907160000:52-55
  |      |
  |      v
  |   report_payroll(p_from, p_to)   derived at read time, never stored (INVOKER, row filter self or Super Admin)
  |
  +--< staff_salary_rates      (RECONSTRUCTED) effective-dated; each save adds a row (rate.ts:193-199)
  +--< payroll_snapshots       frozen payslip: figures copied at generation; payment_status pending -> paid
                               (repository: frozen by convention only; no trigger or column grant protects figures, 4.3)

audit_events                   append-only; written by the application; no repository SQL function for attendance
                               or payroll inserts a row
                               (RECONSTRUCTED function bodies: NEEDS VERIFICATION, section 5.4)
owner_approval_requests        kind attendance_delete: request -> decide -> execute
```

### 4.1 Session rows

CURRENT: each `attendance_records` row is one clock-in to clock-out session (`M/20260717120000:20-33`). Open or
completed is derived from `time_out is null`; the `status` column exists but nothing reads or writes it
(`attendance.ts:618-619`; `DATABASE.md`). `time_in` is the database clock (`M/20260717120000:26`); the kiosk never
sends it. `work_date` is the business-timezone date at clock-in (`M/20260907120000:45`). The partial unique index is
the core invariant: one open session per member, across all dates (`M/20260717120000:41-45`).

### 4.2 Virtual day grouping

CURRENT: there is no day table. Both layers group sessions by member and `work_date`:

- the day total is the sum of completed session durations, gaps excluded; an open session adds 0
  (`sessions.ts:4-17`, `:89-91`; `hr-format.ts:8-13`);
- "Continue Duty" is just another session on the same `work_date` (`attendance-clock.tsx:68-72`);
- the paged reader counts and pages SESSION rows, then fetches the other sessions of each (member, `work_date`) pair
  on the page so a day renders whole (`attendance.ts:639-656`); the page shows days (`attendance-paging.ts:106-125`).
  The "N records" count therefore counts sessions, not visible days.

A session that crosses midnight belongs entirely to its clock-in `work_date`. `DATABASE.md` section 5.4 explains why
a day table is not needed unless a client wants day-level approval or locking.

### 4.3 Derived payroll and snapshot payslips

CURRENT: payroll is computed on every read by `report_payroll` (`M/20260907160000:29-102`):
pay = round(days_worked x daily_rate + night_shifts x `app_private.night_ot_bonus()`, 2), where `days_worked` counts
distinct `work_date` values with a completed session and `night_shifts` counts distinct `work_date` values with a
clock-out at or after 22:00 in `<business-tz>` (`:39-55`, `:86-93`). A payslip is a separate frozen row in
`payroll_snapshots` created on demand with a single deductions amount of zero or more
(`M/20260722210000:15-36`; `payslip-actions.ts:48-63`). Later corrections or deletions change the derived table but
never the snapshot, and nothing prevents them after a payslip exists. Formulas, the two different night rules and
the payslip body are in `PAYROLL.md`.

CURRENT: the freeze is by convention. In the repository the `payroll_snapshots` update policy checks only that the
caller is a Super Admin, with no column restriction (`M/20260722210000:62-65`), `authenticated` holds table-wide
UPDATE (`:68`), and no trigger protects the money columns (no other repository migration touches the table except the
realtime publication, `M/20260731130000:28`). A Super Admin can therefore change any figure of any payslip directly
through PostgREST; the application only ever changes the payment status columns (`payslip-actions.ts:124-135`).
The live policy is NEEDS VERIFICATION (section 9 item 4). There is also no unique constraint on employee and
period (only non-unique indexes, `M/20260722210000:41-44`), so a second generation for the same period adds a second
snapshot (section 5.6). RECOMMENDED TEMPLATE IMPROVEMENT AR21.

---

## 5. Cross-cutting concerns

### 5.1 Authorization: where each gate lives

CURRENT enforcement per operation. "none" means the layer does not check; RECONSTRUCTED gates are described from
comments only. The full capability matrix per role is in `PERMISSIONS.md`.

| Operation | Page or UI | Action or domain guard | SQL function gate | RLS |
|---|---|---|---|---|
| Open Attendance | `hr_attendance` (`attendance-page.tsx:43`) | n/a | n/a | n/a |
| Kiosk roster | page | none | `has_permission('hr_attendance')` (`M/20260907160000:16-19`) | bypassed (definer) |
| Kiosk status maps | page | none | none (table read) | `attendance_read` (`M/20260804140000:8-14`) |
| Clock in | page only | active staff + device cookie (`attendance.ts:158-162`) | active staff; eligible target (`M/20260907120000:25-37`) | bypassed (definer) |
| Clock out | page only | active staff + device cookie (`attendance.ts:211-215`) | RECONSTRUCTED (inferred DEFINER, section 1.2) | bypassed if definer |
| History page load | page | `requirePermission('hr_attendance')` (`hr-actions.ts:62`) | n/a | `attendance_read` |
| Open Review | `hr_review_attendance` (`review-page.tsx:22`) | `requirePermission` (`hr-actions.ts:77`) | n/a | `attendance_read` |
| Selfie URLs | Review page | `requirePermission('hr_review_attendance')` (`hr-actions.ts:48`) | n/a | any active staff |
| Correct clock-out | role flag (`review-page.tsx:35-36`) | role (`attendance.ts:406`) | role (`M/20260907130000:29-33`) | bypassed (definer) |
| Delete record | role flag; Super Admin vs request split | typed word; role (`attendance.ts:352`) | RECONSTRUCTED role gate (inferred DEFINER) | no DELETE grant |
| Request delete | Admin UI only | `initiate_high_risk_action` (`fulfillment-service.ts:502`) | n/a | approvals insert policy |
| Devices | Super Admin UI | `requireOwner()` (`devices.ts:69`, `:104`) | Super Admin (`M/20260722150000:46-48`, `:75-77`) | Super Admin read |
| Open Payroll | `hr_payroll` (`payroll-page.tsx:30`) | n/a | `report_payroll` row filter (`:100`) | caller's RLS (INVOKER) |
| Edit rate | role flags | none (`hr-actions.ts:210-228`; `rate.ts:201-231`) | RECONSTRUCTED | RECONSTRUCTED |
| Generate payslip | role flag | `requireOwner()` (`payslip-actions.ts:28`) | repo body INVOKER, no own gate (`M/20260722210000:75-89`); live body RECONSTRUCTED | insert: Super Admin |
| Mark paid | role flag | `requireOwnerOrAdmin()` (`payslip-actions.ts:106`) | none (direct UPDATE) | update: Super Admin (repo) |
| Print summary | Super Admin UI (`attendance-view.tsx:98`) | n/a (client) | n/a | rows already read |
| Export attendance and payroll sheets | other modules' pages | `requireOwnerOrAdmin()` (`export-route.ts:18`); no `hr_*` key | `report_payroll` row filter | caller's RLS |
| Manage Access | Super Admin list | `requireOwner()` (`team-accounts.ts:232`) | RECONSTRUCTED | Super Admin writes |
| Approve and execute | role `owner` (`approvals-page.tsx:24`) | owner authority (`fulfillment-service.ts:569`, `:653`) | delete RPC gate | Super Admin update |

CURRENT, export: the attendance and payroll sheets are not marked sensitive (`src/lib/export/sections.ts:21-22`), so
the workbook builder includes them for an Admin as well as a Super Admin (`data-export.ts:138-139`). An Admin who
holds none of `hr_attendance`, `hr_review_attendance` or `hr_payroll` can therefore still export whatever RLS lets
that Admin read: attendance rows under `attendance_read` and the Admin's own payroll row (`data-export.ts:522-536`,
`:563-568`). The export button's visibility is decided by other modules' pages, not by an `hr_*` key
(`src/app/(app)/reports/page.tsx:67-71`; `src/components/dashboard/dashboard-view.tsx:263-270`).

CURRENT helper facts that shape every SQL gate: `is_active_staff()`, `is_owner()` and `has_permission()` check
`is_active`, but `current_staff_id()` and the live `current_staff_role()` do not (`M/20260715130000:28-81`,
`:147-161`). PENDING (not live): `current_staff_role()` returns the sentinel `'inactive'` for a deactivated profile
(`M/20260916120000:46-57`) and every public definer function loses PUBLIC and anon EXECUTE (`:76-110`).

GENERIC rule: a UI flag is derived from the same key the server checks; every write is re-checked in the SQL function
with active-profile helpers; every read is bounded by RLS or by a permission-scoped definer reader; pages hide what
the caller cannot open; every definer function revokes EXECUTE from PUBLIC and `anon` in its own migration.
RECOMMENDED TEMPLATE IMPROVEMENTS: AR1, AR3 to AR5, AR14 to AR16 and AR20 (section 8).

The static authorization sweep in the reference tests detects writes by the insert, update and delete call patterns
only (`tests/integration/phase11-authorization-boundary.test.ts:27-31`), so a module that writes only through
`supabase.rpc(...)` is never swept, and action files are excluded from the writing-module sweep (`:85-88`).

### 5.2 Timezone handling

CURRENT, TypeScript:

- The zone constant (`'<business-tz>'`) and the fixed-offset constant (`'<business-utc-offset>'`), valid only because the zone has
  no daylight saving (`attendance-paging.ts:41-43`). "Today" and the quick ranges come from `Intl` with that zone
  (`:46-48`, `:57-65`); list date filters are built as literal day bounds on the CLOCK-IN timestamp (`:72-80`,
  used at `attendance.ts:606`, `:615-616`).
- A second literal copy of the zone name sits in `listLastClockOutToday` (`attendance.ts:133`).
- The business-date helper module supplies the Payroll default period (`payroll-page.tsx:33-34`), the mark-paid date
  (`payslip-actions.ts:115-116`), the Employee Rates default effective date (`employee-rates-view.tsx:43`) and the
  optimistic paid date (`payslip-button.tsx:207-211`); see `bizdate.ts:16-26`.
- Four places use the VIEWER'S browser zone instead: table times (`attendance-paging.ts:176-179`), kiosk status times
  with seconds (`attendance-clock.tsx:305`, `:322`, `:387`), the correction input conversion
  (`review-attendance-view.tsx:673-679`, `:713`) and the inline rate editor's default effective date
  (`attendance-view.tsx:44-50`, `:335`).

CURRENT, SQL:

- `kiosk_clock_in` stamps `work_date = (now() at time zone '<business-tz>')::date` (`M/20260907120000:45`).
- The column default is still `current_date`, the server's UTC date (`M/20260717120000:25`); PENDING (not live)
  changes it to the business date (`M/20260916120000:367-368`).
- The session night flag uses the clock-in hour in the zone (`M/20260722200000:34`); payroll's night rule uses the
  clock-out time of day in the zone (`M/20260907160000:41`).

CURRENT, two different date bases across three consumers: lists filter clock-in timestamps (`attendance.ts:606`,
`:615-616`); payroll filters `work_date` (`M/20260907160000:44`), and so does the export (`data-export.ts:533`).
Rows written through the kiosk before it stamped the business date may carry the UTC date (comment at
`attendance.ts:588-590`).

GENERIC: one timezone setting read by both layers (the SQL accessors proposed in `DATABASE.md` section 5.12 and the
matching TypeScript setting in `CONFIGURATION.md`); day bounds computed with a zone-aware library or in SQL, never
with a fixed offset; every displayed time and every `datetime-local` conversion in the business zone.
RECOMMENDED TEMPLATE IMPROVEMENT AR7.

### 5.3 Money

CURRENT:

- SQL keeps money `numeric`, rounds the computed salary once to 2 decimals and returns it as text
  (`M/20260907160000:83-93`); payslip money columns are `numeric(12,2)` (`M/20260722210000:24-28`), while the hours
  and the stored hourly rate are `numeric(10,2)` (`:20-23`).
- The TypeScript reader keeps money as strings and only hours and counts as numbers (`payroll.ts:44-65`).
- Inputs cross the wire as strings: the money input submits the raw digits through a hidden field
  (`money-input.tsx:21-30`, `:152`); the rate and deductions are validated as decimal strings with at most two
  decimals and passed to the RPC unparsed (`rate.ts:209-228`; `payslip-actions.ts:48-63`).
- Display uses one shared formatter built from string operations, with the currency symbol `<cur>` and decimals shown
  only when non-zero (`money-format.ts:51-56`); `Money` masks the value on screen in privacy mode but prints the real
  value (`privacy.tsx:107-121`).
- Where TypeScript must combine money it uses integer minor units in `BigInt`: the day's night amount is the maximum,
  never a sum (`sessions.ts:54-63`), and the Payroll Summary total adds net (payslip exists) or gross (no payslip)
  (`payroll-summary-button.tsx:31-39`, `:54-60`).
- Defect: the summary parser replaces a non-digit whole part with 0 but keeps the fraction, so a negative net such as
  -100.50 adds +0.50 (`payroll-summary-button.tsx:32-35`); `net_salary` has no non-negative check
  (`M/20260722210000:28`, `:125`).
- Hours (not money) are rounded per session and again per day in TypeScript (`hr-format.ts:8-13`; `sessions.ts:90-91`)
  but summed raw and rounded once in SQL (`M/20260907160000:39`, `:49`, `:79`). Each per-session rounding can move a
  value by up to 0.005 h, so a total built from screen values can differ from the payroll total by a few hundredths of
  an hour, and the possible gap grows with the number of sessions in the period.

GENERIC: numeric in SQL with a fixed scale, strings on the wire, integer minor units for any client-side total,
signed parsing everywhere, rounding in exactly one layer. RECOMMENDED TEMPLATE IMPROVEMENT AR9.

### 5.4 Audit

CURRENT:

- One writer, `recordAuditEvent`, called by domain functions after the SQL call returns (`audit-log.ts:40-79`). It
  reads the identity from the session, snapshots the actor label, inserts into `audit_events` with the user-scoped
  client and returns early when there is no user (`:45-51`). It never throws, and the action still reports success,
  but only a thrown exception is logged to the server console (`:75-78`). The insert's result is awaited and never
  inspected (`:64-74`), so an insert that the database refuses with an error result (a policy or a constraint) is
  lost without any log line. It is best effort.
- No repository SQL function for attendance or payroll inserts an audit row (for example
  `M/20260907130000:13-63` has no insert). The bodies of `kiosk_clock_out`, `delete_attendance_record`,
  `set_staff_salary_rate`, `set_team_member_permissions` and the live `generate_payslip_snapshot` are RECONSTRUCTED,
  so whether they write audit rows is NEEDS VERIFICATION (section 9 item 1). For the functions whose bodies are in the
  repository, a direct RPC call made outside the application leaves only `edited_by` and `edit_reason`, or nothing.
- The old clock-out value of a correction exists only in the audit context (`attendance.ts:447-456`); the row keeps
  only the last editor and reason (`M/20260907130000:55-59`). The function reads that old value without a row lock
  (`M/20260907130000:39-40`, no `select ... for update`), so under concurrent corrections of one record the audited
  `old_time_out` can be stale.
- Coverage is uneven: the rate write and both payslip actions audit success only (`rate.ts:233-238`;
  `payslip-actions.ts:88-93`, `:145-150`); a delete executed through Approvals writes `owner_approval.*` events, not
  `attendance.delete` (`fulfillment-service.ts:648-836`); the blocked-device event stores the member id as the entity
  id of type `attendance_record` (`attendance.ts:36-42`).
- The table is append-only by trigger (`M/20260715120000:115-133`). Live read policy: any active staff member
  (`M/20260715130100:661-662`), which exposes correction reasons and money contexts. PENDING (not live) narrows reads
  (`M/20260916120000:290-298`).

The event catalogue is in `DATABASE.md` section 2.8. GENERIC: SQL functions insert their own success audit row
through a private helper, in the same transaction as the change (`DATABASE.md` section 5.11). A refusal row is written
either by a typed refusal (the function inserts the row and returns a refusal instead of raising) or by the server
layer after the raised error returns, outside the refused transaction, because a raise rolls back every row the
transaction inserted; a function never inserts an audit row and then raises (`SERVER_API.md` section 9.1 rule 8). A
function that audits an old value locks the row first (`select ... for update`); the application writer checks the
insert result and logs a failure; the application event stays as a second, descriptive record. RECOMMENDED TEMPLATE
IMPROVEMENT AR10.

### 5.5 Realtime refresh and revalidation

CURRENT:

- `attendance_records`, `payroll_snapshots` and `staff_profiles` are in the `supabase_realtime` publication with
  replica identity full (`M/20260731130000:24-34`, `:37-48`).
- `DashboardSyncProvider` is mounted once for the whole app (`app-shell.tsx:47`). It subscribes to every change in
  schema `public` (`dashboard-sync.tsx:153-160`), lets RLS decide which changes reach the user, and answers with a
  trailing-debounced `router.refresh()` after 2000 ms (`:73`, `:117-126`). It skips while the tab is hidden (`:120`),
  reconciles on subscribe, `online` and visibility (`:161-173`), and ignores a deny-list of high-churn tables owned by
  other modules (`:86-97`); the attendance and payroll tables are not on that list. Realtime is a nudge; the server
  read stays the source of truth (`:19-45`).
- Every write action also calls `revalidatePath` for the affected pages (`hr-actions.ts:91`, `:102`, `:153-155`,
  `:179-181`, `:225-226`; `payslip-actions.ts:95`, `:152`), and the client calls `router.refresh()` after success
  (`attendance-clock.tsx:180`; `attendance-day-details.tsx:132`; `review-attendance-view.tsx:702`, `:821`;
  `payslip-button.tsx:187`, `:212`; `employee-rates-view.tsx:54`). Executing an approval revalidates only `/orders`
  (`fulfillment-actions.ts:253`), so an attendance page that is already open reflects that delete only through the
  realtime nudge or the next navigation.
- What updates after a refresh, by code reading: the list components hold `useState(initialPage)`, but their load
  effect depends on a `filters` object memoised on the `roster` prop, and a refresh delivers a new roster array, so
  the list reloads (`review-attendance-view.tsx:125-133`, `:142-162`; `attendance-records.tsx:104-117`, `:128-148`).
  The open Details modal keeps the pre-change day object (`review-attendance-view.tsx:107`, `:495-503`;
  `attendance-records.tsx:94`), and the kiosk keeps the selected member. NEEDS VERIFICATION in a browser: correct a
  record and watch the table row update while the open modal keeps the old times.

GENERIC: server-rendered truth plus a single, RLS-filtered realtime nudge; open detail views re-derive their content
from the refreshed list by key. RECOMMENDED TEMPLATE IMPROVEMENT AR12.

### 5.6 Read-retry engine and error surfacing

CURRENT:

- The user-scoped client installs `createRetryingFetch()` (`supabase-server.ts:26-30`).
- Only GET and HEAD are idempotent and retried (`retry-fetch.ts:58-61`, `:82`): on status 429, 502, 503 or 504
  (`:40`, `:99-101`) or on a thrown network error (`:103-108`), up to 3 attempts in total with a linear backoff of
  150 ms times the attempt number (`:75-76`, `:93`).
- Every POST, PATCH or DELETE is sent exactly once (`:22-29`). Supabase RPCs are POST, so `kiosk_clock_in`,
  `kiosk_clock_out`, `correct_attendance_clock_out`, `delete_attendance_record`, `generate_payslip_snapshot` and
  `set_staff_salary_rate` are never repeated by the client, and neither is the mark-paid UPDATE. Server actions add
  no retry of their own. A failed clock action is shown to the operator, who must press again
  (`attendance-clock.tsx:151-154`, `:181-183`).
- Two database guards make an accidental second press harmless: the one-open-session index refuses a second clock-in
  (`M/20260717120000:43-45`) and mark-paid only matches a still-pending row (`payslip-actions.ts:122-135`).
- Payslip generation has no such guard. The repository has no unique constraint on employee and period
  (`M/20260722210000:41-44`), and the repository function body inserts without looking for an existing snapshot
  (`:75-132`). When the response is lost, the caught error leaves "Generate payslip" available
  (`payslip-button.tsx:188-190`), and a repeat inserts a second snapshot for the same period; the reader is written
  for this and shows the newest (`payslip.ts:58-59`, `:78-79`). Whether the live function body (RECONSTRUCTED)
  refuses a duplicate is NEEDS VERIFICATION (section 9 item 14). RECOMMENDED TEMPLATE IMPROVEMENT AR21.
- Error surfacing is inconsistent. `getPayroll` returns `{ ok: false }` and the page shows a read-error box
  (`payroll.ts:42`; `attendance-view.tsx:108-112`). Other readers turn an error into empty data: the paged attendance
  reader returns an empty page on a count error and no rows on a data error (`attendance.ts:626`, `:635`), the roster
  returns an empty list (`attendance.ts:102`), payslips return an empty map (`payslip.ts:73`), and the gating check
  treats an RPC error as "no device registered", which opens the gate (`devices.ts:40-41`).

GENERIC: keep the rule (retry idempotent reads only; never a write or RPC); readers return a typed error that the UI
shows as a read failure, never as an empty result; security checks fail closed. RECOMMENDED TEMPLATE IMPROVEMENTS
AR2 and AR11.

### 5.7 Response headers the camera needs

CURRENT: `next.config.ts` sends security headers on every path (`next.config.ts:41-50`, `:55-57`), including
`Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()` (`:45-48`), added so that
"camera stays available to the app (attendance selfies ...)" (`:38-39`). It also sends `X-Frame-Options: SAMEORIGIN`
(`:42`, needed for same-origin print previews, `:36`), `X-Content-Type-Options`, `Referrer-Policy` and HSTS, and
deliberately ships no Content-Security-Policy yet because inline scripts would need nonces (`:31-35`).

Failure mode: a header that denies the camera to the app's own origin (for example `camera=()`) makes `getUserMedia`
fail; the kiosk shows the camera error and offers only "Clock in/out without photo" (`attendance-clock.tsx:116-127`,
`:249-286`), so every clock event falls back to without photo. Clocking keeps working and photos silently stop. Keep
`camera=(self)` explicit. Whether omitting the header is harmless depends on the browser's default allowlist: NEEDS
VERIFICATION in a browser.

GENERIC: keep camera allowed for the app's own origin in every environment, including when a CSP is added. The device
cookie is set with `secure: true` (`devices.ts:86`), so production must be served over HTTPS; browsers also expose
the camera API only in secure contexts. RECOMMENDED TEMPLATE IMPROVEMENT AR13: a test that asserts the header value.
NEEDS VERIFICATION: the production response actually carries the header (inspect the response headers of any page).

### 5.8 Caching

CURRENT: all three pages are rendered per request (section 1.2). The PWA service worker bypasses every non-GET request
and every cross-origin request, including Supabase (`cache-policy.ts:54-62`), treats every HTML navigation as
network-only with an offline fallback that is never stored (`:33-39`, `:63-64`), serves only a static allow-list from
cache (`:65`) and bypasses everything else, including API routes and RSC payloads (`:66-67`). The rule is generic
for all navigations, not a per-route list. Attendance and payroll data therefore never enter a cache. GENERIC: keep
this rule for any page that renders personal or payroll data.

---

## 6. GENERIC architecture

This section restates sections 1 and 2 with the generic names used across the template set.

- Tables follow `DATABASE.md` section 5: `employees`, `attendance_sessions`, `attendance_devices`, `attendance_photos`,
  `employee_pay_rates`, `payroll_snapshots`, `audit_events`, plus the settings store `hr_settings` and its SQL readers
  (`DATABASE.md` section 5.12; `CONFIGURATION.md` section 1.2).
- SQL function names and signatures follow `DATABASE.md` section 5.13, which `SERVER_API.md` section 9.3 and
  `IMPLEMENTATION_PROMPT.md` Step 7 use as well. The template keeps the reference function names (`kiosk_clock_in`,
  `kiosk_clock_out`, `correct_attendance_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`) with
  generic parameters, and adds `attach_attendance_photo`, `attendance_status`, `review_attendance_page` and
  `mark_payslip_paid`, even though the tables take generic names.
- Permission keys follow `PERMISSIONS.md` section 4.2 and its dependency table in section 4.3; `DATABASE.md` section
  5.1 states that section 4.2 wins where names differ. Two rules from there shape the diagrams below. First, own-row
  access (own sessions, own payroll row, own payslips) needs no key, and there is no separate Payroll page key.
  Second, the deletion request path is off by default; its optional key `attendance.delete.request` is outside the
  eleven keys of section 4.2 and exists only when a client keeps that path.
- Server action and RPC contracts (input, authorization, effect, output, errors) live in `SERVER_API.md` section 9;
  the diagrams below show only the call chain. Component names follow `UI_UX.md` section 9.

### 6.1 Generic request path

```
Browser
  -> session refresh at the edge (never an authorization control)
  -> app layout: require an active employee profile; load granted keys (sidebar convenience only)
  -> page (server component, rendered per request)
       gate: page key held, else 404
       reads: server-only readers -> user-scoped client (GET/HEAD retried, writes never)
              -> SELECT under RLS, or a permission-scoped SECURITY DEFINER reader when names or other members' state are needed
  -> client component: filters, pagination, dialogs, camera; UI flags derived from the SAME keys the server checks
  -> server action: transport; re-checks the key for a clear message; never the only check
  -> domain function: input validation, error mapping; no money arithmetic
  -> SECURITY DEFINER function (set search_path = ''): has_permission(key) with active-profile helpers, NULL treated as
     refusal, target eligibility, device token, business rules, audit insert in the same transaction
  -> table: RLS enabled and forced, SELECT policies only, no INSERT/UPDATE/DELETE grants to end users
```

### 6.2 Generic Attendance (clock) screen

```
page key attendance.clock_operate
  reads
    list_clock_staff()                       -> employees (active, not demo, not timekeeping_exempt)
    attendance_status(p_employee_ids)        -> attendance_sessions (open session and last clock-out today per member)
    attendance_gating_active(), verify_attendance_device(token)   -> attendance_devices
    own history                              -> SELECT attendance_sessions under RLS (self branch)
  AttendanceClockCard + CurrentAttendanceStatus
    Clock In / Continue Duty -> clock-in action -> kiosk_clock_in(p_employee_id, p_device_token, p_note)
        -> INSERT attendance_sessions (work_date = app_private.business_today()) -> audit_events
    Clock Out -> clock-out action -> kiosk_clock_out(p_employee_id, p_device_token)
        -> UPDATE attendance_sessions (the single open session) -> audit_events
    photo -> attach-photo action -> Storage (own bucket)
        -> attach_attendance_photo(p_session_id, p_kind, p_storage_path, p_content_type, p_byte_size)
        -> INSERT attendance_photos (only from the operator recorded on that session for that kind)
  DeviceManager (attendance.devices.manage) -> register_attendance_device / revoke_attendance_device -> attendance_devices
  AttendanceSummaryCards (attendance.view_team)
  AttendanceHistory -> AttendanceDayCard -> AttendanceDayDetailsModal -> AttendanceDeleteModal
```

### 6.3 Generic Review Attendance screen

```
page key attendance.review (team rows need attendance.view_team)
  review_attendance_page(filters, page)      -> attendance_sessions + employees (names), permission-scoped DEFINER reader
  AttendanceReviewFilters -> AttendanceReviewTable -> AttendanceDayCard -> AttendanceDayDetailsModal
    photos -> signed URLs for attendance_photos   (read policy: the subject, or attendance.review)
    ClockOutCorrectionModal (attendance.correct)
        -> correct_attendance_clock_out(p_record_id, p_time_out, p_reason)
           -> lock the row, validate -> UPDATE attendance_sessions -> audit_events
    AttendanceDeleteModal (attendance.delete)
        -> delete_attendance_record(p_record_id, p_reason) -> audit_events
  optional, off by default (PERMISSIONS.md section 4.2): a deletion request path, only in a host with an approval
    queue and only when CONFIGURABLE attendance.deletion.requestApprovalPath is on (CONFIGURATION.md section 2.4);
    the client then adds a grantable request key to the access catalogue (CONFIGURATION.md section 2.3 names it
    attendance.delete.request) -> request row -> a holder of attendance.delete executes it through the same function
  optional attendance_day_reviews (approval or lock per member and work_date; DATABASE.md section 5.5)
```

### 6.4 Generic Payroll screen

```
page gate: no separate page key (PERMISSIONS.md sections 4.2 and 4.3)
  opens for a holder of any payroll.* key except payroll.export,
  and for every eligible employee when the CONFIGURABLE self view is on (default off, PERMISSIONS.md section 5)
  report_payroll(p_from, p_to)               STABLE INVOKER wrapper; selects from app_private.payroll_lines
    app_private.payroll_lines(p_from, p_to)  DEFINER; holds the only pay math; its OWN WHERE clause returns eligible
                                             employees AND (own row, no key, or every row with payroll.view_all)
      -> attendance_sessions + employee_pay_rates (effective-dated) + employees + hr_settings readers
      the signed-in role needs EXECUTE on payroll_lines because the wrapper runs as the caller; that grant is safe
      only because the filter lives inside payroll_lines (IMPLEMENTATION_PROMPT.md P16)
  SELECT payroll_snapshots                   RLS: own rows (no key), or payroll.view_all
  PayrollPeriodSelector -> PayrollTable -> PayrollEmployeeRow
    RateEditor (payroll.rates.edit)
      -> set_staff_salary_rate(p_employee, p_basis, p_amount, p_frequency, p_effective) -> INSERT employee_pay_rates
      -> audit_events
    PayslipModal
      generate (payroll.payslip.generate) -> generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions, p_regenerate)
        -> INSERT payroll_snapshots (one current row per employee and period) -> audit_events
      mark paid (payroll.payslip.mark_paid) -> mark_payslip_paid(p_snapshot_id, p_payment_date) -> audit_events
      PayslipDocument -> print or PDF (client only)
    PayrollSummaryDocument -> print (client only)
  EmployeeRatesTable -> RateEditor
  export route (payroll.export) -> rows under RLS
```

Two optional payroll modules have no counterpart in the reference implementation: itemised adjustments
(`payroll_adjustments`, `DATABASE.md` section 5.10; the default stays one lump-sum deduction, `PAYROLL.md` section 5)
and a void path for a payslip (`void_payslip`, `DATABASE.md` sections 5.9 and 5.13; `PAYROLL.md` section 12).

### 6.5 Mapping: CURRENT layer to GENERIC layer

| CURRENT | GENERIC |
|---|---|
| `staff_profiles` role title exclusion (`owner`) | `employees.timekeeping_exempt` checked by roster, clock functions and payroll |
| `attendance_records` + BEFORE INSERT night trigger | `attendance_sessions`; night rule computed in one place from `hr_settings` |
| `attachments` rows of type `attendance_record` | `attendance_photos` with a real FK and an explicit `kind` |
| `staff_salary_rates` (RECONSTRUCTED) | `employee_pay_rates` with full DDL |
| status maps read under the operator's RLS | `attendance_status(...)` permission-scoped reader |
| name embed nulled by `staff_profiles` RLS | `review_attendance_page(...)` returning names |
| device check in TypeScript only | device token checked inside both clock functions |
| role-title gates in TypeScript and SQL | permission keys checked in SQL, mirrored in TypeScript |
| mark-paid as a direct table UPDATE | `mark_payslip_paid(...)` definer function |
| payslip frozen by convention; duplicates per period possible | freeze trigger; unique current payslip per employee and period |
| application-only audit | SQL audit insert plus the application event |
| hard-coded zone and fixed offset | one `hr_settings` timezone read by SQL and TypeScript |

### 6.6 Engine rules the generic layering must keep

1. One row per session; the day is a grouping; one open session per employee enforced by a partial unique index.
2. `work_date` is the business date at clock-in and is stamped by the database, never sent by the client.
3. `time_in` comes from the database clock, never from the client (CURRENT `M/20260717120000:26`); the generic
   clock-out function must do the same for `time_out` (the reference `kiosk_clock_out` body is RECONSTRUCTED).
4. Payroll is derived at read time; payslips are frozen rows whose figures never change after generation, enforced
   in the database by a freeze trigger and one current payslip per employee and period (CURRENT relies on convention
   and allows duplicates, sections 4.3 and 5.6; AR21).
5. Money is numeric in SQL and a string everywhere else.
6. Reads may be retried; writes and RPCs are never retried automatically.
7. The clock write succeeds or fails on its own; a photo upload failure never undoes it.
8. Realtime only triggers a server re-render; it never carries totals.

---

## 7. What is deliberately simple

The reference implementation does NOT do any of the following. Some omissions are stated as deliberate in the code,
others were deferred and never built. An adopter must not assume them; each is a client decision.

| Not in the reference implementation | Evidence (CURRENT) | Discussed in |
|---|---|---|
| Attendance review, flag, approval or finalization state | `review-attendance-view.tsx:70-71`; `attendance-paging.ts:136-139` | `DATABASE.md` 5.5 |
| Payroll limited to approved attendance | deferred: `docs/FINAL-UI-SOURCE-OF-TRUTH.md:208-212`; reads all: `M/20260907160000:42-44` | `PAYROLL.md` 8 |
| Period lock after payslips | corrections and deletes have no period check: `hr-actions.ts:139-183` | `PAYROLL.md` 8 |
| Scheduling: shifts, lateness, undertime, grace periods | deferred: `docs/FINAL-UI-SOURCE-OF-TRUTH.md:211`; no schedule in `M/20260907120000:14-54` | `CONFIGURATION.md` |
| Self-service clocking from a personal device | kiosk only; self clock has no caller: `attendance.ts:252-339` | section 3.1 |
| A personal payroll or payslip screen | one payroll route: `navigation.ts:93` | section 3.1 |
| Automatic close of a forgotten open session | manual correction only: `M/20260907130000:3-6` | `UI_UX.md` |
| Clock-in correction or adding a missed session | only `time_out` is updated: `M/20260907130000:55-59` | `PERMISSIONS.md` |
| Edit history beyond the last editor and reason | overwrite in place: `M/20260907130000:55-59`; old value in audit only | section 5.4 |
| Soft delete or restore | hard delete, RECONSTRUCTED: `attendance.ts:341-347` | `DATABASE.md` 5.3 |
| More than one active clock device | registration deactivates all others: `M/20260722150000:49` | `CONFIGURATION.md` |
| A device gate before a device exists | gate is on only while a device is active: `devices.ts:21-22` | section 5.6 |
| Hours-based pay or an overtime multiplier | pay uses days and a flat night bonus: `M/20260907160000:50-51`, `:86-93` | `PAYROLL.md` 4 |
| Itemised or statutory deductions | one lump sum at generation: `payslip-actions.ts:48-63`; `M/20260722210000:27` | `PAYROLL.md` 5 |
| Pay periods driven by pay frequency | frequency is a label; free date range: `attendance-view.tsx:76-97` | `PAYROLL.md` 1 |
| Unpay or void a payslip; deliberate regeneration (duplicates are possible, not a feature) | two actions: `payslip-actions.ts:23`, `:99`; `approved_by` never written; 5.6 | `PAYROLL.md` 7 |
| Scheduled jobs or notifications for attendance | no route under `src/app/api/cron/` references attendance (repository search) | `TESTING_CHECKLIST.md` |

---

## 8. RECOMMENDED TEMPLATE IMPROVEMENTS (architecture)

None of these is a change to production. Each names the gap and where the detailed fix lives.

- AR1. Clock authority in the database. The clock actions and `kiosk_clock_in` check active staff only
  (`hr-actions.ts:81-105`; `attendance.ts:158`, `:211`; `M/20260907120000:25-28`). Check the clock key inside both
  clock functions. `PERMISSIONS.md` section 4.
- AR2. Device rule in the database, bound to the token, failing closed. Live: TypeScript only; PENDING checks only a
  device id on clock-in (`M/20260916120000:425-459`); the gating check fails open on error (`devices.ts:40-41`).
- AR3. Kiosk status from a permission-scoped definer reader instead of RLS-bound table reads (`attendance.ts:111-146`).
- AR4. Reviewer names from a permission-scoped definer reader instead of a `staff_profiles` embed
  (`attendance.ts:562-563`; `M/20260821140000:21-22`).
- AR5. No direct INSERT or UPDATE on attendance rows for end users (`M/20260717120000:58-75`); every write through the
  definer functions. `DATABASE.md` section 5.3.
- AR6. Ship complete DDL. `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`, `staff_salary_rates`,
  `night_ot_bonus()`, the live payslip function body and six payslip columns are RECONSTRUCTED; a schema built only
  from the repository migrations cannot run the current screens. `DATABASE.md` section 1.3.
- AR7. One timezone setting for both layers; zone-aware day bounds; business-zone display and input (section 5.2).
- AR8. One night rule, computed in one place; the session flag and payroll disagree today (`M/20260722200000:34-37`
  versus `M/20260907160000:41`). `PAYROLL.md` section 4.
- AR9. Signed money parsing and a single rounding layer (section 5.3).
- AR10. Audit rows written by the SQL functions themselves, in the same transaction; lock the row before reading an
  old value that is audited (`M/20260907130000:39-40` has no lock); the application writer checks its insert result
  instead of ignoring it (`audit-log.ts:64-74`). Section 5.4.
- AR11. Readers return typed errors; empty results and read failures are different UI states (section 5.6).
- AR12. Open detail dialogs refresh from the reloaded list after a write or a realtime nudge (section 5.5).
- AR13. Keep and test the camera permission header (section 5.7).
- AR14. The authorization sweep must also detect RPC writes and assert a guard per exported function, not per file
  (`tests/integration/phase11-authorization-boundary.test.ts:27-31`, `:85-88`).
- AR15. One delete policy across both screens (`attendance-day-details.tsx:140-150`; `review-attendance-view.tsx:624-629`).
  The template drops the request path by default (`PERMISSIONS.md` section 4.2); a client that keeps it must make the
  request key grantable in the access screen, which the reference key is not (`fulfillment-service.ts:502`).
- AR16. UI capability flags computed from the same keys and policies as the data layer, so an Admin is never shown a
  control the server or RLS refuses (`payroll-page.tsx:42-44`; `payslip-actions.ts:28`, `:106`;
  `M/20260722210000:62-65`; `M/20260907160000:100`).
- AR17. Photos with an explicit kind, a real FK, a narrow read policy, their own bucket and a retention job that deletes
  objects through the Storage API (`attendance.ts:552-554`; `M/20260716300000:127-142`, `:159-165`). `DATABASE.md`
  section 5.7. Why the Storage API: the reference selfie purge script documents a live-only trigger on the storage
  objects table that blocks deleting objects with SQL, so its purge runs server-side with the service-role key through
  the Storage API (`scripts/purge-attendance-selfies.mjs:7-9`). The trigger's DDL is not in the repository (NEEDS
  VERIFICATION on the target project), so a template must not assume that an SQL `delete` or a cascade removes a photo
  file.
- AR18. Validate the payroll period on the server (format and `from <= to`) before calling the report
  (`payroll-page.tsx:33-34`).
- AR19. Keep comments true. These describe behaviour the code no longer has: the Attendance page docstring
  (`attendance-page.tsx:34-35`, "self-service"; the page is a kiosk); the payslip actions header
  (`payslip-actions.ts:13-15`, both acts Super Admin only, while mark-paid checks `requireOwnerOrAdmin()` at `:106`);
  the attendance module header (`attendance.ts:50-55`, members clock themselves and attendance is never deleted); the
  rate module header (`rate.ts:9-20`), which names a `requireOwner` gate and the `staff_profiles` update policy as the
  boundary, although the live `setSalaryRate` (`rate.ts:201-231`) uses neither; the docstring at `rate.ts:24-30`,
  which presents the legacy hourly-rate function (`set_staff_hourly_rate`, called at `rate.ts:83`) as the way a rate
  is set, although only the uncalled `setHourlyRate` uses it; and the `setHourlyRateAction` docstring
  (`hr-actions.ts:206-208`), which says the domain module re-checks Super Admin authority and RLS is the boundary,
  while `setSalaryRate` has no TypeScript check and the gate is the RECONSTRUCTED rate function.
- AR20. Revoke PUBLIC and `anon` EXECUTE on every SECURITY DEFINER function in the same template migration that
  creates it, and grant EXECUTE explicitly. CURRENT: the repository revokes for the device functions
  (`M/20260722170000:8-18`), `list_clock_staff` (`M/20260806260000:17`, `:33-34`) and `correct_attendance_clock_out`
  (`M/20260907130000:65-68`), but not for `kiosk_clock_in` (`M/20260907120000` has no revoke), and the RECONSTRUCTED
  `kiosk_clock_out`, `delete_attendance_record` and `set_staff_salary_rate` have no DDL at all; PENDING (not live)
  revokes PUBLIC and `anon` from every public definer function in one pass (`M/20260916120000:64-110`), because
  default privileges grant again on each CREATE (`:12-14`). `SECURITY.md` section 8.2.
- AR21. Payslips frozen by the database, one current payslip per period. CURRENT: the freeze is a convention; the
  repository update policy is Super Admin only with no column restriction and the UPDATE grant covers the whole table
  (`M/20260722210000:62-65`, `:68`), and only non-unique indexes exist (`:41-44`), so a repeated generation adds a
  second snapshot that the reader masks by showing the newest (`payslip.ts:58-59`, `:78-79`). Template: a BEFORE
  UPDATE trigger that refuses every change except the payment columns (written by `mark_payslip_paid`), the optional
  void columns and the supersede link; a BEFORE DELETE trigger; no direct UPDATE grant to end users; and a partial
  unique index on employee and period for the current row, with regeneration as an explicit, audited supersede.
  `DATABASE.md` section 5.9; `IMPLEMENTATION_PROMPT.md` P13 and P14.

---

## 9. NEEDS VERIFICATION (architecture items)

Each item is settled with read-only catalog queries or a browser check; the queries are listed in `DATABASE.md` section
8 and `PERMISSIONS.md` section 8. They settle open questions about the reference implementation, so they only mean
something when run against the reference implementation's own database, read-only, by the person responsible for that
database, never through connectors or accounts that belong to another client. The same queries also work as
post-install checks on a new client's project, where they confirm the template's own policies and grants instead.

1. Bodies, security mode and grants of `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`,
   `set_team_member_permissions`, `app_private.night_ot_bonus()` and the live `generate_payslip_snapshot`.
2. Whether the owners of the definer functions bypass RLS on the tables with forced row level security.
3. Live policies and grants on `attendance_records` (can a member still insert or update their own rows directly?).
4. Live `payroll_snapshots` update policy (does the Admin mark-paid path work?) and the `staff_salary_rates` policies.
5. Whether production has a second `staff_profiles` SELECT policy that would show reviewer names.
6. Whether any account holds `initiate_high_risk_action` (count only).
7. EXECUTE on `app_private.night_ot_bonus()` for `authenticated`, required because `report_payroll` runs as invoker.
8. Browser: after a correction, the Review table row updates and the open Details modal keeps the old times.
9. Production response headers include `Permissions-Policy` with `camera=(self)`.
10. Whether migrations `20260916120000`, `20260916130000` and `20260917120000` have been applied.
11. Whether `PUBLIC` or `anon` holds EXECUTE on `kiosk_clock_in`, `kiosk_clock_out`, `delete_attendance_record` and
    `set_staff_salary_rate` (AR20).
12. Whether the target project blocks SQL deletes of storage objects with a trigger, as the purge script's comment
    says (AR17).
13. Live EXECUTE grants (`pg_proc.proacl`) on `report_payroll`, including whether `anon` holds them. A change to its
    RETURNS TABLE shape needs DROP and CREATE, after which grants must be re-applied (`M/20260721100000:10-12`, grants
    at `:73-74`). `M/20260907160000:29-30` uses CREATE OR REPLACE with a different shape, so the live function must
    already have had that shape through an out-of-band DROP and CREATE, and what replaced the repository grants is
    unknown. Supabase default privileges re-grant on each CREATE (`M/20260916120000:12-13`), and the PENDING (not
    live) revoke pass covers SECURITY DEFINER functions only (`:82-88`), so it would not touch this INVOKER function.
    The invoker row filter returns no row for `anon` (`M/20260907160000:100`).
14. Whether the live `generate_payslip_snapshot` refuses a second snapshot for the same employee and period
    (section 5.6; AR21).

---

## 10. PROJECT-SPECIFIC values removed from the template

This section lists the reference implementation's business-specific values. Brand names, brand-prefixed file and
cookie names, the timezone and the currency are named only here. Two values are also quoted earlier, because the
shared key facts of this template set name them: the session night flag's 22 hour threshold and 300.00 amount
(section 3.2) and the payroll night rule's 22:00 clock-out threshold (section 4.3). They are PROJECT-SPECIFIC in those
places too. None of these values may appear in template code, migrations or `IMPLEMENTATION_PROMPT.md`.

- Business timezone `Asia/Manila` and fixed offset `+08:00`, written above as `<business-tz>` and
  `<business-utc-offset>`. Where: `attendance-paging.ts:41-43`; `attendance.ts:133`; `M/20260722200000:34`;
  `M/20260907120000:45`; `M/20260907160000:41`; `M/20260916120000:368`.
- The business-date helper module `src/lib/format/manila-date.ts` (cited above as `bizdate.ts`) and its exports
  `manilaToday`, `manilaMonthStart`, `manilaAddDays`; the kiosk clock-in migration file name
  `20260907120000_kiosk_clock_in_manila_work_date.sql` (cited above as `M/20260907120000`).
- Currency PHP: the peso sign `<cur>` in the shared formatter (named `formatPeso`, `money-format.ts:51`), the privacy
  mask, the money input prefix and server messages; the ISO code in the PDF.
- Session night flag: clock-in hour at or after `22` in the business zone stores `is_overtime` and the literal amount
  `300.00` on each qualifying session, set per session by the BEFORE INSERT trigger (`M/20260722200000:34-37`).
- Payroll night bonus: one bonus per distinct `work_date` with a clock-out at or after `22:00` in the business zone
  (`M/20260907160000:41`, `:55`), priced by `app_private.night_ot_bonus()` (`:85`, `:90`). That function's body, and
  therefore its value, is RECONSTRUCTED; the comment at `M/20260907160000:53-55` says 300. The threshold, the amount
  and the anchor all become settings (`CONFIGURATION.md` section 2.6).
- Device cookie name `av_att_device` (`devices.ts:27`); the default device label `Shop phone` and the "approved shop
  phone" wording (`M/20260722150000:51`; `attendance-page.tsx:101`; `device-manager.tsx:73`, `:186`).
- Realtime channel name `mineflow-live-sync` (`dashboard-sync.tsx:154`) and the ignore-list table names that belong to
  other modules: `label_jobs`, `printers`, `customer_messages`, `capture_device_heartbeats`, `layaway_code_pool`
  (`dashboard-sync.tsx:86-92`).
- Brand names on documents and files: `A.V. Jewelry` and the initials `AV` and `A.V` on the payslip, PDF and payroll
  summary (`payslip-button.tsx:79-82`; `payslip-pdf.ts:65`, `:69`; `payroll-summary-button.tsx:90`, `:93`); the PDF file
  prefix `AV-Jewelry-Payslip-` (`payslip-pdf.ts:44-48`); the workbook creator `A.V. Jewelry` (`data-export.ts:132`) and
  the export file prefix `MineFlow-Data-Export-` (`export-route.ts:74`).
- The decision to exclude the Super Admin role from clocking, rates and payroll, recorded in migration comments that
  name real account holders (`M/20260907160000:1-7`; names not copied).
- The Primary Super Admin identified by a hard-coded email constant (`guard.ts:281`; value not reproduced).
- The approval queue housed in the fulfillment module, with business-specific approval kinds next to
  `attendance_delete` (`fulfillment-service.ts:33-48`).
- Internal specification references ("Bible" section labels) in comments across the files cited above.
- The one-off selfie purge script `scripts/purge-attendance-selfies.mjs`: its usage block embeds the production project
  URL (`:24-27`; value not reproduced) and its header records a one-time data reset of the source business (`:5-9`).
  Keep only the design lesson (AR17: delete photo files through the Storage API from a server-side job that reads the
  project URL and key from the environment); do not copy the script.
- Service worker cache policy: brand-prefixed image file names in the static allow-list (`cache-policy.ts:20`) and the
  source system's name in the header comment (`cache-policy.ts:4`).
- The camera header rationale also names a photo-capture feature of another module of the source system
  (`next.config.ts:38-39`); the template keeps only the attendance selfie reason.
