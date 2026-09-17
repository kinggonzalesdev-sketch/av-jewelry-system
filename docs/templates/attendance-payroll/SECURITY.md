# Attendance and Payroll Template: Security and Audit Trail (Phases 11 and 12)

This document covers the security side of the attendance kiosk, Review Attendance and Payroll screens. It records, for
every sensitive operation, what is enforced at each layer (UI, page gate, server action, RPC, row-level security,
storage policy), which checks must never live only in the browser, how Staff, Admin and Super Admin (role key owner) are scoped, how the
approved-device gate and the clock selfies work, who can read pay data, how the SECURITY DEFINER functions are hardened,
and what the audit trail does and does not record. Every CURRENT statement cites the repository. Every gap is carried
into the template as a RECOMMENDED TEMPLATE IMPROVEMENT. Nothing here changes the reference implementation, its
database or its deployment.

## How to read this

Labels used in this document:

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves today, with a file:line citation. |
| GENERIC | The reusable form the template should ship. |
| PROJECT-SPECIFIC | Tied to the source business. Named only in section 11 (one exception below the table). |
| CONFIGURABLE | Should become a client setting (key names from CONFIGURATION.md section 2). |
| NEEDS VERIFICATION | The repo cannot settle it; the text says what would (queries in section 12). |
| RECONSTRUCTED | A live database object whose DDL is missing from the repo; described from call sites and comments. |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation the template should fix. Never a change to production. |

Exception to the PROJECT-SPECIFIC rule: the shared key facts and some CURRENT descriptions also quote the session night
flag's 22 hour threshold and 300.00 amount and the payroll night rule's 22:00 threshold, because every document of this
set states them; they are PROJECT-SPECIFIC in those places too.

Role vocabulary: Super Admin (role key owner), Admin (role key selected_admin), Staff (role key staff). A database CHECK
allows exactly these three keys (`M/20260715120100:16`), mirrored in TypeScript (`src/lib/authz/permissions.ts:87-91`).
Page permission keys: `hr_attendance` (open the
Attendance page and read the kiosk roster), `hr_review_attendance` (open Review Attendance and read every attendance
row), `hr_payroll` (open Payroll). The Super Admin holds every key implicitly (`M/20260716240000:26-44`;
`src/lib/authz/guard.ts:177-180`).

Path shorthands used in citations (same as CONFIGURATION.md):

| Shorthand | Expands to |
|---|---|
| `L/` | `src/lib/hr/` |
| `C/` | `src/components/hr/` |
| `P/` | `src/app/(app)/admin/` |
| `M/<timestamp>` | the single file in `supabase/migrations/` whose name starts with that timestamp |

Names used for the GENERIC form: permission keys from PERMISSIONS.md section 4.2 (for example
`attendance.clock_operate`, `attendance.review`, `payroll.view_all`), configuration keys from CONFIGURATION.md section 2
(for example `attendance.device.failMode`, `retention.selfieRetentionDays`), database objects from DATABASE.md section 5
(for example `attendance_photos`, `payroll_adjustments`). A security rule that is not a setting (for example "the clock
RPCs verify the device") is stated as a fixed engine rule and has no configuration key. The full capability matrix and
the key mapping live in PERMISSIONS.md and are not repeated here; formulas live in PAYROLL.md; DDL lives in DATABASE.md;
test cases live in TESTING_CHECKLIST.md sections 4.2 and 5.

Evidence base: the repository, with every citation that matters re-read in the repo (the extraction method is in
README.md section 7).

## 0. Model summary (CURRENT)

- Clocking is a shared KIOSK, not self-service. A signed-in operator whose page gate passed on `hr_attendance` picks a
  member from `list_clock_staff` and clocks that member in or out (`C/attendance-clock.tsx:145-150`; `L/actions.ts:85`;
  `M/20260907160000:9-27`).
- One open session per member, enforced by a unique partial index (`M/20260717120000:41-45`).
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:40-46`). A day's total is the sum of its
  completed sessions (`L/sessions.ts:90-91`).
- Two different night rules exist. The session flag is set by an INSERT trigger when the clock-in hour is 22 or later
  (flat 300 on the row, `M/20260722200000:26-49`). Payroll counts distinct `work_date`s with a clock-out at or after
  22:00, times `app_private.night_ot_bonus()` (`M/20260907160000:41`, `:55`, `:85-93`).
- Pay = round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2) (`M/20260907160000:86-93`). Deductions are a
  single lump sum >= 0 entered at payslip generation (`M/20260722210000:27`, `:93`). A payslip is a frozen snapshot with
  `payment_status` pending then paid (`M/20260722210000:29-30`).
- No approval or finalization step exists for attendance, and no period lock.
- Only the clock-out can be corrected: Super Admin or Admin by role, reason required, in-place update, old value kept
  only in a best-effort app audit event (`M/20260907130000:29-61`; `L/attendance.ts:447-456`). Delete is a hard delete.
- Device approval: a random token whose sha256 hash is stored, the raw token in an httpOnly cookie, enforced in server
  TypeScript only. The live database has no check; PENDING adds a clock-in check. The gate fails open while no device is
  registered (section 5).
- Super Admins (role key owner) are excluded from the kiosk roster and from payroll (`M/20260907160000:24`, `:99`).
  Demo accounts are excluded from payroll (`:98`) and refused as clock-in targets (`M/20260907120000:35-37`), but the
  CURRENT roster still lists them (`M/20260907160000:20-25`).

## 1. Enforcement layers per sensitive operation (Phase 11)

### 1.1 The layers (CURRENT)

| Layer | What it is | Evidence |
|---|---|---|
| UI | Hides nav items and controls by key or role. Never a control. | `src/components/shell/navigation.ts:91-93`, `:264-275` |
| Proxy | Session refresh only; the file states it is not the security control. | `src/proxy.ts:9-12` |
| Layout | `requireActiveStaff()` on each request refuses no profile, inactive, and demo (unless enabled). | `src/app/(app)/layout.tsx:42`; `src/lib/authz/guard.ts:124-163` |
| Page gate | `canOpenPage(key)` then `notFound()`. The grant read fails closed. | `src/lib/authz/guard.ts:174-198`, `:300-303` |
| Server action / domain | `requirePermission`, `requireOwner`, `requireOwnerOrAdmin`, `requireActiveStaff`. | `src/lib/authz/guard.ts:211-223`, `:263-273`, `:325-335` |
| RPC | SECURITY DEFINER functions with an empty `search_path` and `app_private` helpers; `report_payroll` is INVOKER. | `M/20260715130000:28-161`; `M/20260907160000:29-34` |
| RLS | Enabled and forced on `attendance_records`, `payroll_snapshots`, `attachments`. | `M/20260717120000:47-49`; `M/20260722210000:46-48`; `M/20260716300000:120-122` |
| RLS | Forced on `audit_events`; enabled but NOT forced on `attendance_devices`. | `M/20260715120000:135-137`; `M/20260722150000:30` |
| Storage policy | Private bucket `attachments`; object read and insert for any active staff. | `M/20260716300000:35-43`, `:159-165` |
| Transport | User-scoped client; GET and HEAD retried, POST (every RPC and write) never retried. | `src/lib/supabase/server.ts:26-30`; `src/lib/supabase/retry-fetch.ts:58-61`, `:82` |

Attendance and payroll are not reachable from the mobile token API: no file under `src/app/api/**` or
`src/lib/mobile/**` references them by name. The web export route reaches their
sheets indirectly through the export builder (S23).

### 1.2 Summary matrix (CURRENT)

Cell vocabulary: `key:<k>` = that permission key is checked; `SA` = Super Admin role title; `SA+A` = Super Admin or
Admin role title; `active` = an active staff session is the only requirement; `none` = nothing is checked at that layer;
`-` = the layer is not involved; `RECON` = the function is RECONSTRUCTED. Details and citations are in section 1.3.

| # | Operation | UI | Page gate | Action / domain | RPC | RLS / storage | Weakest point |
|---|---|---|---|---|---|---|---|
| S1 | Open Attendance page | nav key | key:hr_attendance | - | - | - | none |
| S2 | Open Review Attendance page | nav key | key:hr_review_attendance | - | - | - | none |
| S3 | Open Payroll page | nav key | key:hr_payroll | - | - | - | none |
| S4 | Read kiosk roster | dropdown | S1 or S2 | none | key:hr_attendance (DEFINER) | bypassed by DEFINER | demo profiles listed |
| S5 | Clock in a member | after selection | S1 | active + device (TS) | active; target checks; no device check | self INSERT open | key not checked on the write |
| S6 | Clock out a member | open session visible | S1 | active + device (TS) | RECON | self UPDATE open | no database device check |
| S7 | Read own attendance rows | history list | S1 | key:hr_attendance | - | self branch | REST read needs no key |
| S8 | Read team attendance rows | reviewer only | S1 or S2 | key (loader) | - | key:hr_review_attendance | names blank for non-SA |
| S9 | Correct clock-out | SA+A (prop defaults true) | S2 | SA+A | SA+A, NULL refused | self UPDATE any column | review key unchecked |
| S10 | Delete a record | SA+A, differs by page | S1 or S2 | SA+A; typed DELETE | RECON | no DELETE grant | hard delete |
| S11 | Request deletion | Admin, Attendance page | S1 | key:initiate_high_risk_action | - | insert: key or SA | key only on legacy console |
| S12 | Register device | SA | S1 | SA | active SA | no write policy | deactivates all others |
| S13 | Gating state, verify cookie | banner | S1 | none | none (any authenticated) | DEFINER | RPC error = gate off |
| S14 | Revoke or list devices | SA | S1 | revoke: SA (`L/devices.ts:104`); list: none (`P/attendance/page.tsx:80`) | revoke: active SA | read: active SA, not forced | last revoke = gate off |
| S15 | Read selfies | day modal | S2 | key:hr_review_attendance | - | any active staff | storage open to all staff |
| S16 | Upload selfie | after clock action | S1 | active | - | any active staff | any record id |
| S17 | Read payroll rows | table | S3 | none | INVOKER filter: self or SA | rate table unknown | live grants unknown |
| S18 | Read payslips | dialog | S3 | none | - | self or SA | REST read needs no key |
| S19 | Generate payslip | button: every viewer, no snapshot; deductions: SA+A | S3 | SA | repo INVOKER; live RECON | insert: SA | UI offers it to Admin and Staff |
| S20 | Mark payslip paid | shown to SA and Admin | S3 | SA+A; pending filter | none (direct UPDATE) | update: SA, every column | TS wider than RLS |
| S21 | Edit salary rate | SA inline; SA+A tab | S3 | none | RECON | unknown | no TS guard |
| S22 | Print summary, payslip PDF | SA; snapshot readers | S3 | - (client-side) | - | as S17, S18 | UI only (low risk) |
| S23 | Export attendance, payroll | key or role button | - | route SA+A | as S17 | caller RLS | export key not checked |

### 1.3 Evidence per operation (CURRENT)

**S1 to S3 Open the three pages.** Server gates `canOpenPage('hr_attendance')` (`P/attendance/page.tsx:43`),
`canOpenPage('hr_review_attendance')` (`P/attendance/review/page.tsx:22`) and `canOpenPage('hr_payroll')`
(`P/payroll/page.tsx:30`), each followed by `notFound()`. The nav map mirrors the same keys
(`src/components/shell/navigation.ts:91-93`). GENERIC: keep page keys separate from write keys (PERMISSIONS.md 4.1).

**S4 Read the kiosk roster.**
- Reader: `listClockStaff()` calls the RPC and returns an empty list on any error (`L/attendance.ts:96-108`).
- RPC: DEFINER; raises unless `has_permission('hr_attendance')`; returns active profiles whose role key is not owner
  (`M/20260907160000:16-25`). It does not filter demo accounts. PUBLIC and anon EXECUTE revoked
  (`M/20260806260000:17`, `:33-34`); `CREATE OR REPLACE` keeps grants (`M/20260907160000:6-7`).
- The Review page also uses this roster, so a reviewer without `hr_attendance` gets an empty employee filter.

**S5 Clock in a member.**
- UI: clock buttons render only after a member is selected (`C/attendance-clock.tsx:244`); the blocked-device banner
  is informational and does not disable them (`P/attendance/page.tsx:91-105`).
- Action and domain: `clockInAction` has no guard (`L/actions.ts:81-94`). `kioskClockIn` calls `requireActiveStaff()`,
  then the TypeScript device gate, then the RPC (`L/attendance.ts:158`, `:161`, `:165-169`). No `hr_attendance` check.
- RPC `kiosk_clock_in` (DEFINER): refuses a caller who is not active staff, an unknown target, and an inactive or demo
  target; maps a second open session to "already clocked in"; stores whatever `p_device_id` it receives; does not
  refuse a Super Admin target (`M/20260907120000:25-50`). The live file has no EXECUTE revoke. PENDING adds a device-id
  check and revokes PUBLIC and anon (`M/20260916120000:451-459`, `:487-488`).
- RLS: `attendance_insert` lets any profile insert its own row directly (`M/20260717120000:59-61`, `:75`); section 3.3.
- GENERIC: `attendance.clock_operate`, an eligible target and a token-bound device check inside the RPC (PERMISSIONS.md
  4.4; SECURITY.md section 5.4).

**S6 Clock out a member.**
- UI: Clock Out is offered only when the operator can see the member's open session (`C/attendance-clock.tsx:300-318`).
  Those reads are RLS-scoped, so an operator without `hr_review_attendance` never sees another member's open session
  and cannot clock that member out (`L/attendance.ts:111-146`).
- Action and domain: `clockOutAction` has no guard (`L/actions.ts:96-105`); `kioskClockOut` calls
  `requireActiveStaff()` and the TypeScript device gate (`L/attendance.ts:211`, `:214`).
- RPC `kiosk_clock_out(p_staff_id)`: RECONSTRUCTED. It takes no device parameter (`L/attendance.ts:218-220`); a later
  migration comment says the kiosk clock "already allows any active staff on the approved device"
  (`M/20260805160000:2-4`).
- RLS: `attendance_update` lets a profile update its own rows directly (`M/20260717120000:65-72`); section 3.3.

**S7 Read own attendance rows.** The paged loader requires `hr_attendance` (`L/actions.ts:57-64`). The RLS self branch
is `staff_profile_id = app_private.current_staff_id()` (`M/20260804140000:11`), so a direct REST read of one's own rows
needs no permission key, and `current_staff_id()` has no active check (`M/20260715130000:28-39`).

**S8 Read team attendance rows.**
- UI: staff filter and summary cards only when `canSeeTeam` (`P/attendance/page.tsx:49`, `:121`;
  `C/attendance-records.tsx:228`).
- Action: `loadReviewAttendancePageAction` requires `hr_review_attendance` (`L/actions.ts:72-79`).
- RLS: third branch `app_private.has_permission('hr_review_attendance')` (`M/20260804140000:13`).
- Gap: names come from a `staff_profiles` embed (`L/attendance.ts:562-563`) whose read policy is Super Admin or self
  (`M/20260821140000:21-22`), so a reviewer who is not a Super Admin sees a dash for every other employee.
  NEEDS VERIFICATION only for a live-only extra profile read policy.

**S9 Correct a clock-out.**
- UI: controls shown when `canManage` is the owner or selected_admin role (`P/attendance/review/page.tsx:35-36`). The
  component's `canManage` prop defaults to `true` (`C/review-attendance-view.tsx:81`).
- Action and domain: presence checks (`L/actions.ts:169-174`); `requireOwnerOrAdmin()`, non-empty reason, valid date
  (`L/attendance.ts:405-427`).
- RPC `correct_attendance_clock_out` (DEFINER): `v_role is null or v_role not in ('owner', 'selected_admin')` is refused
  (`M/20260907130000:29-33`); reason required, record exists, `time_in <= p_time_out <= now()` (`:35-53`); updates
  `time_out`, `edited_by`, `edit_reason` (`:55-59`); reads without a row lock (`:39-40`); EXECUTE revoked from anon and
  PUBLIC (`:65-68`).
- Gaps: neither the action nor the RPC checks `hr_review_attendance`. LIVE `current_staff_role()` ignores `is_active`
  (`M/20260715130000:47-58`), so a deactivated Super Admin or Admin token passes until PENDING section 1
  (`M/20260916120000:46-57`). RLS still lets Staff rewrite their own rows and a Super Admin rewrite any row with no
  reason (`M/20260717120000:65-72`).

**S10 Delete a record.**
- UI: on the Attendance page a Super Admin deletes after typing DELETE and an Admin gets "Request deletion"
  (`C/attendance-day-details.tsx:138-150`); on the Review page both get a direct Delete (`C/review-attendance-view.tsx:624-629`).
- Action and domain: `confirm !== 'DELETE'` is refused on the server (`L/actions.ts:146-148`); `requireOwnerOrAdmin()`
  then `rpc('delete_attendance_record')` (`L/attendance.ts:352`, `:367-370`).
- RPC: RECONSTRUCTED. Comments say the role is re-checked in SQL (`L/attendance.ts:342-344`;
  `src/lib/authz/guard.ts:320-323`; `M/20260907130000:7`). Per the repo grants it must run with elevated rights, because
  `authenticated` has no DELETE privilege there (`M/20260717120000:75`). Its security mode and any live DELETE grant are
  NEEDS VERIFICATION: a production-only migration may have changed grants (section 3.3). Settle it with the section 12
  `proacl`/`prosecdef` and `role_table_grants` queries.
- Effect: hard delete; the selfie stays in storage (`L/attendance.ts:345-346`).

**S11 Request deletion.**
- Action: `requestAttendanceDeletionAction` has no role check (`L/actions.ts:190-204`); the approvals service requires
  `initiate_high_risk_action` (`src/lib/fulfillment/service.ts:500-515`).
- RLS: insert needs that key or Super Admin plus `requested_by = current_staff_id()` (`M/20260715130100:566-571`);
  decide and execute are Super Admin only (`:576-579`); execution calls the delete RPC (`src/lib/fulfillment/service.ts:735-739`).
- Gaps: the key is absent from the Manage Access catalogue and granted by no migration; it is grantable only on the
  legacy Super Admin console reachable by URL (`src/components/admin/staff-console.tsx:35`; `src/lib/authz/actions.ts:38-60`;
  `P/staff/page.tsx:34-41`), so the Admin request fails by default on a fresh install. The request text carries the member name and date (`C/attendance-day-details.tsx:141`) and
  requests are readable by every active staff member (`M/20260715130100:560-561`).

**S12 Register a device.** UI: device manager rendered for the Super Admin only (`P/attendance/page.tsx:107`).
Action: `requireOwner()` (`L/devices.ts:69`). RPC: active Super Admin check, deactivate every active device, store the
sha256 hash (`M/20260722150000:46-53`); PUBLIC and anon revoked (`M/20260722170000:14-15`). No write policy exists on
`attendance_devices`, so writes happen only through the DEFINER functions.

**S13 Gating state and cookie verification.** `isAttendanceGatingActive()` and `verifyDeviceCookie()` have no guard
(`L/devices.ts:38-53`); `attendance_gating_active()` and `verify_attendance_device(text)` are callable by any
authenticated user (`M/20260722150000:58-70`; `M/20260722170000:8-12`). An RPC error reads as "gating off"
(`L/devices.ts:41`).

**S14 Revoke and list devices.** Revoke: action `requireOwner()` (`L/devices.ts:104`) and an RPC active Super Admin
check (`M/20260722150000:75-78`). List: `listDevices()` has no TypeScript guard and reads the table directly
(`L/devices.ts:121-137`); the page calls it only when the viewer is the Super Admin (`P/attendance/page.tsx:80`), and the
real enforcement is the read policy, active Super Admin (`M/20260722180000:5-14`), on a table whose RLS is not forced
(`M/20260722150000:30`). Revoke is a one-tap submit with no confirmation (`C/device-manager.tsx:136-146`).

**S15 Read selfies.** The Review day modal lazy-loads them (`C/review-attendance-view.tsx:107-117`) through
`loadAttendanceSelfiesAction`, which requires `hr_review_attendance` (`L/actions.ts:45-50`) and mints 300-second signed
URLs with a download disposition (`L/attendance.ts:544-548`). Underneath, `attachments_read` is any active staff
(`M/20260716300000:127-129`) and the storage object read is any active staff in the bucket (`:159-161`). The reader
comment claiming record-level scoping is inaccurate (`L/attendance.ts:468-470`). The source audit lists this as open
(`docs/SYSTEM-AUDIT-2026-09-16.md:128`).

**S16 Upload a selfie.** The kiosk uploads after the clock action returns a record id (`C/attendance-clock.tsx:157-166`).
`uploadAttachment` requires active staff and validates the entity type, the uuid shape, purpose, source, content type
and size (`src/lib/attachments/upload.ts:72-100`). Nothing checks that the record exists or belongs to the clocked
member. RLS: metadata insert requires active staff and self-attribution (`M/20260716300000:137-142`); object insert is
any active staff (`:163-165`); no update or delete policy exists on either (`:144-148`, `:167-169`).

**S17 Read payroll rows.** Page gate `hr_payroll` (`P/payroll/page.tsx:30`); the reader has no guard of its own
(`L/payroll.ts:38-40`). `report_payroll` is INVOKER (`M/20260907160000:31-33`) with the row filter active, not demo,
not owner, and `sp.id = app_private.current_staff_id() or app_private.is_owner()` (`:97-100`). It reads
`staff_salary_rates` as the caller, whose policies are RECONSTRUCTED. Live EXECUTE grants are NEEDS VERIFICATION: the
repo grant (`M/20260721100000:73-74`) was lost when the function was re-created out of band.

**S18 Read payslips.** `listPayslipsForPeriod` reads `payroll_snapshots` directly (`L/payslip.ts:61-67`) under
`payroll_snapshots_read`: own or Super Admin (`M/20260722210000:51-55`).

**S19 Generate a payslip.**
- UI: `PayslipButton` renders on every payroll row with no role condition (`C/attendance-view.tsx:221-229`). When the row
  has no snapshot, the row button reads "Generate Payslip" (`C/payslip-button.tsx:253-261`) and the dialog footer shows
  Cancel plus "Generate payslip" (`:241-248`) for any viewer. Only the Deductions input is gated by `canManage`
  (`:276-293`), which is true for the Super Admin and Admin (`P/payroll/page.tsx:43`; `C/attendance-view.tsx:227`). A
  Staff member who holds `hr_payroll` sees "Ask the Owner to generate it" next to a still-active Generate button
  (`C/payslip-button.tsx:294-298`); the server then refuses both Staff and Admin.
- Action: `requireOwner()` (`L/payslip-actions.ts:28`); deductions must match a non-negative two-decimal pattern
  (`:49-55`).
- RPC: the repo `generate_payslip_snapshot` is SECURITY INVOKER (`M/20260722210000:72`, `:83`) granted to
  `authenticated` without a PUBLIC revoke (`:134-135`); the live body is RECONSTRUCTED.
- RLS: insert Super Admin only (`M/20260722210000:58-60`).

**S20 Mark a payslip paid.** UI: button when `canManage` and pending (`C/payslip-button.tsx:234-238`). Action:
`requireOwnerOrAdmin()` (`L/payslip-actions.ts:106`), then a direct `.update(...)` filtered on
`payment_status = 'pending'` (`:124-135`); no RPC. Repo RLS: update Super Admin only, on every column
(`M/20260722210000:62-65`). The `paid_at` and `paid_by` columns are RECONSTRUCTED, and whether the live policy admits
Admin is NEEDS VERIFICATION.

**S21 Edit a salary rate.** UI: inline editor for the Super Admin (`C/attendance-view.tsx:182-183`); Employee Rates tab
for Super Admin and Admin (`P/payroll/page.tsx:43-44`; `C/payroll-tabs.tsx:49`, `:76`). Action: `setHourlyRateAction`
has no guard (`L/actions.ts:206-228`); `setSalaryRate` validates only (`L/rate.ts:201-231`), while its comment says the
database enforces Super Admin only (`:197-199`). RPC `set_staff_salary_rate` and the rate table policies are
RECONSTRUCTED.

**S22 Print summary and payslip PDF.** The payroll summary renders only for the Super Admin (`C/attendance-view.tsx:98-105`)
and prints rows already loaded under the RPC filter. Payslip Print and Download PDF are available to anyone who can open
the snapshot (`C/payslip-button.tsx:223-233`). UI-only is acceptable here because the data is already scoped below.

**S23 Export.** The Dashboard shows the button on `export_data_reports` (`src/app/(app)/dashboard/page.tsx:92`). The route
calls `requireOwnerOrAdmin()` and returns 403 otherwise (`src/app/api/export/all/route.ts:15-25`); the export key is not
checked. Sensitive sheets (team roster with rates, audit log) are built only for the Super Admin
(`src/lib/export/data-export.ts:135-139`; `src/lib/export/sections.ts:24-28`). The attendance sheet reads
`attendance_records` as the caller (`data-export.ts:522-536`) and the payroll sheet calls `report_payroll` (`:563-568`),
so an Admin exports only their own payroll row. The export writes `data.export_all` (`route.ts:62-72`, `:85-90`).

## 2. Checks that MUST NOT be frontend-only

Each item names the layer the check belongs in, why, and the CURRENT state. Item numbers match the list in
IMPLEMENTATION_PROMPT.md Step 4 where the meaning is the same.

1. **Page access for the three pages.** Belongs in: the server page gate. Why: a URL can be typed. CURRENT: done
   (section 1.3, S1 to S3).
2. **Operator authority and the approved device for clock in and clock out.** Belongs in: the clock RPCs, mirrored in
   the actions. Why: any active session can call the server action or the RPC with any member id, and a direct RPC call
   skips a TypeScript device gate. CURRENT: the key gates only the page and the roster; the action and `kiosk_clock_in`
   check active staff only; the device rule is server TypeScript only, with a PENDING clock-in check by device id
   (S5, S6, section 5).
3. **Clock target eligibility (active, not demo, not timekeeping-exempt).** Belongs in: the clock RPCs. Why: a roster is
   a list, not a gate. CURRENT: active and non-demo are checked in `kiosk_clock_in`; the Super Admin exclusion exists
   only in the roster (`M/20260907160000:24` versus `M/20260907120000:30-37`).
4. **No direct table writes to attendance rows.** Belongs in: grants and RLS. Why: a direct write skips the kiosk, the
   device gate, the reason and the audit event, and it feeds payroll. CURRENT: open (section 3.3).
5. **Correction and deletion authority, mandatory reason and time bounds.** Belongs in: the RPCs. Why: both change pay.
   CURRENT: the correction RPC checks role, reason and bounds; the delete RPC is RECONSTRUCTED; the typed DELETE phrase
   is checked in the server action (S9, S10).
6. **Team visibility.** Belongs in: RLS on attendance rows. Why: any signed-in token can read the sessions table over
   REST without opening the page. CURRENT: done (`M/20260804140000:8-14`).
7. **Selfie visibility and attachment integrity.** Belongs in: RLS on the photo metadata, the storage policy, and an
   upload RPC. Why: facial images, readable through REST and storage without the page. CURRENT: any active staff member
   can read every selfie and attach one to any record id (S15, S16).
8. **Payroll row scope.** Belongs in: the report function filter plus RLS on snapshots and rates. Why: a token holding
   EXECUTE can call the report function directly, and snapshots are readable over REST, without the Payroll page.
   CURRENT: the filter and snapshot policy are done (S17, S18); the rate table policies are RECONSTRUCTED.
9. **Generate, mark-paid and rate-write authority, matching the UI.** Belongs in: RPCs and RLS. Why: money acts; a
   mismatch produces dead controls or a later accidental widening. CURRENT: generate is Super Admin in TypeScript and
   RLS but its button is offered to every Payroll viewer in the UI (Admin and Staff included); mark paid allows Admin
   in TypeScript but not in repo RLS; rate write has no TypeScript guard and a RECONSTRUCTED RPC (S19 to S21).
10. **Rate visibility.** Belongs in: RLS on the rate table. Why: rates are money data, readable over REST by any token
    the policy admits, whatever the UI hides. CURRENT: NEEDS VERIFICATION.
11. **Export authority.** Belongs in: the route (permission key) plus RLS on rows. CURRENT: the route checks role only;
    the key gates only the button (S23).
12. **Snapshot immutability and the pending-only paid transition.** Belongs in: the database (a mark-paid RPC that
    writes only status columns, plus a trigger that freezes money columns). CURRENT: the pending filter is a TypeScript
    `.eq` (`L/payslip-actions.ts:133`) and the update policy covers every column (`M/20260722210000:62-65`).
13. **Deactivated accounts refused by every SQL gate.** Belongs in: the `app_private` helpers. Why: the app redirect
    runs only on app pages; an access token issued before deactivation still reaches SQL through REST or RPC until it
    expires. CURRENT: LIVE `current_staff_role()` and `current_staff_id()` ignore `is_active`; PENDING fixes the role
    helper only (section 8.4).
14. **EXECUTE revoked from PUBLIC and anon, `search_path` pinned.** Belongs in: the migration that creates each function.
    Why: a PUBLIC or anon EXECUTE grant lets a DEFINER function be called outside the app, and a mutable `search_path`
    lets a caller's objects shadow the ones the function trusts. CURRENT: partial (section 8.2).
15. **Names and kiosk status for operators and reviewers.** Belongs in: permission-gated DEFINER readers. Why: the
    CURRENT RLS-scoped reads fail silently into a wrong screen (blank names, missing open sessions) rather than a refusal
    (S6, S8).
16. **Audit rows for every write.** Belongs in: the RPC transaction on success; for a refusal, a typed refusal that
    writes its row before returning, or the server layer after the error has returned (a raise rolls back rows the
    transaction inserted; section 9.4 item 2). Why: an app-side, best-effort event is skipped by any direct RPC or REST
    call. CURRENT: app-side only (section 9).

Acceptable as UI-only, because a lower layer already bounds the data or the action: nav visibility, the payroll summary
print button, Privacy Mode masking (section 7.3), disabling Save until a reason is typed (the server also requires it),
and the blocked-device banner (provided the RPC refuses).

## 3. Employee scoping: how Staff are limited to their own rows

### 3.1 Read scoping (CURRENT)

| Data | Rule for a Staff member | Evidence |
|---|---|---|
| Attendance rows | own rows, unless the member holds `hr_review_attendance` | `M/20260804140000:8-14` |
| Payroll rows | own row only (`report_payroll` INVOKER filter) | `M/20260907160000:100` |
| Payslip snapshots | own only | `M/20260722210000:51-55` |
| Staff profile (name, legacy rate column) | own only | `M/20260821140000:21-22` |
| Permission grants | own only | `M/20260821140000:15-16` |
| Attendance device roster | none (active Super Admin only) | `M/20260722180000:5-14` |
| Salary rates (`staff_salary_rates`) | RECONSTRUCTED: unknown | no DDL in the repo |
| Selfie metadata and storage objects | NOT scoped: every active staff member | `M/20260716300000:127-129`, `:159-161` |
| Audit events (with money and reasons) | NOT scoped in LIVE: every active staff member | `M/20260715130100:661-662` |
| Deletion requests (name and date in the text) | NOT scoped: every active staff member | `M/20260715130100:560-561` |

The own-row rules hold at the data layer without any page key: a member without `hr_payroll` can still call
`report_payroll` (repo grant to `authenticated`, `M/20260721100000:73-74`; live grants NEEDS VERIFICATION) and read their
own snapshots through REST. That is harmless (it is their own data) but it means the page
keys are navigation, not data permissions.

### 3.2 Self branches and deactivated accounts

`app_private.current_staff_id()` returns the profile for the caller's auth id whether or not it is active
(`M/20260715130000:28-39`). Every self branch above, and the attendance insert and update policies in 3.3, therefore
still match for a deactivated account whose access token is still accepted. The exception is the payroll report: its
row filter also requires the returned profile to be active (`M/20260907160000:97`), so a deactivated caller gets no
row of their own even though `current_staff_id()` still resolves (`:100`). The app layer redirects such an account
(`src/lib/authz/guard.ts:145-147`), but a direct REST or RPC call reaches the database.

PENDING section 1 changes only `current_staff_role()` (`M/20260916120000:46-57`). PENDING section 9 adds
`revoke_staff_sessions`, which deletes the member's `auth.sessions` rows so refresh tokens stop working
(`M/20260916120000:378-408`). Its comment says the remaining short-lived access token "is already refused by RLS
(is_active_staff)" (`:372-374`); that is true for policies that call `is_active_staff()` but not for the
`current_staff_id()` self branches. How long an issued access token stays valid is NEEDS VERIFICATION against the auth
provider settings.

### 3.3 MUST-FIX: open write policies on attendance rows

CURRENT repo definitions (`M/20260717120000:59-75`), unchanged by every later repo migration and by PENDING:

```sql
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (staff_profile_id = app_private.current_staff_id());

create policy attendance_update on public.attendance_records
  for update to authenticated
  using (staff_profile_id = app_private.current_staff_id() or app_private.is_owner())
  with check (staff_profile_id = app_private.current_staff_id() or app_private.is_owner());

grant select, insert, update on public.attendance_records to authenticated;
```

What any profile can do with only its own session token, per these definitions:

- Insert a session for itself with any `time_in`, `time_out` and `work_date`. The only row checks are
  `time_out >= time_in` (`M/20260717120000:32`) and the one-open-session index. No operator, device, selfie or audit
  event is involved. The INSERT trigger recomputes the night flag and amount from `time_in` (`M/20260722200000:26-49`).
- Update any column of its own rows: move `time_in` or `time_out`, change `work_date`, set `is_overtime` and
  `overtime_amount` (the trigger is INSERT-only), write `edited_by` and `edit_reason` (foreign key only), all without a
  reason check or an audit event.
- Change pay: `report_payroll` counts distinct `work_date`s of completed rows and judges night shifts on `time_out`
  (`M/20260907160000:39-55`), so fabricated or edited rows change `days_worked`, `night_shifts` and the salary on the
  next read.
- A Super Admin can update any member's row the same way; the insert policy is self-only for every role
  (`M/20260717120000:59-72`).
- The repo pgTAP suite asserts that a Staff member can insert an open session directly
  (`supabase/tests/26_hr_attendance.test.sql:82-86`), so this was the design at the time, not an accident.

NEEDS VERIFICATION (live): two production-only migrations whose names suggest grant or policy changes have no repo file
(`fix_payroll_grants_and_delete_all_where`, `payroll_paidby_and_kiosk_clock`). Settle it with the section 12 queries on
policies, table grants and column privileges, and with a controlled REST call in a scratch project, never in production.

RECOMMENDED TEMPLATE IMPROVEMENT (MUST-FIX):

- Revoke INSERT and UPDATE on the sessions table from `authenticated`; create no insert or update policy.
- Route every write through DEFINER RPCs (DATABASE.md sections 5.3 and 5.13) that check the key, the target, the
  device and the reason, and write the audit row.
- A client that wants self-service clocking gets a self-service clock RPC (the caller is the target), never a table grant.
- Use an active-checking helper in every self branch.
- Add pgTAP cases: a Staff token cannot insert or update a session; a Super Admin token cannot update a session outside
  the correction RPC.

### 3.4 GENERIC scoping rules

1. Reads: self, or a holder of the team key (`attendance.view_team`, `payroll.view_all`), or the Super Admin, in RLS
   or in the caller filter inside the definer payroll engine (`app_private.payroll_lines`; the INVOKER
   `report_payroll` wrapper adds no protection). The same rule in both places.
2. Writes: never through table grants for end-user roles.
3. Names, roster and kiosk status: returned by permission-gated DEFINER readers, not by embeds that RLS blanks.
4. Photos, audit events and deletion requests: scoped like the data they describe (subject plus the review key, or
   administrators only).
5. Every helper used in a policy refuses a deactivated profile.

## 4. Admin scope and Super Admin scope

### 4.1 Admin (role key selected_admin), CURRENT

| Capability | What the UI offers | What the server and database allow | Evidence |
|---|---|---|---|
| Default grants | none beyond the dashboard key at creation | explicit `hr_*` grants needed | `src/lib/authz/team-accounts.ts:350-354` |
| Open the three pages | only with the keys | same | S1 to S3 |
| Correct a clock-out | Review page controls by role | yes by role, any record id, key not checked | S9 |
| Delete a record | request (Attendance page), direct (Review page) | TypeScript yes by role; SQL RECONSTRUCTED | S10 |
| Devices | no | no | S12, S14 |
| Payroll rows | management controls | own row only | `P/payroll/page.tsx:43`; `M/20260907160000:100` |
| Generate payslip | form and button | refused (TypeScript and RLS) | S19 |
| Mark paid | button | TypeScript yes; repo RLS no (update matches zero rows) | S20 |
| Rates | Employee Rates tab | no TypeScript guard; RPC RECONSTRUCTED; tab lists only self | S21; `L/rate.ts:131-138` |
| Export | button by role or key | route yes; attendance own rows unless reviewer; payroll own row; no sensitive sheets | S23 |
| Audit events | none | LIVE yes (as active staff); PENDING yes by role title | `M/20260715130100:661-662`; `M/20260916120000:295` |
| Manage access | no | no | `src/lib/authz/team-accounts.ts:128`, `:180`, `:232` |
| Deactivated Admin token | redirected by the app | passes SQL role-title gates in LIVE | section 8.4 |

### 4.2 Super Admin (role key owner), CURRENT

- Holds every permission key implicitly, in SQL (`M/20260716240000:33-43`) and in TypeScript
  (`src/lib/authz/guard.ts:177-180`).
- Role-title only: devices (S12, S14), generating payslips (S19), all payroll rows and payslips (S17, S18), the payroll
  summary (S22), the team and audit export sheets (S23), deciding and executing approvals (`M/20260715130100:576-579`),
  and access management.
- Direct REST powers that bypass reason, audit and freeze: update any attendance row (`M/20260717120000:65-72`) and any
  payslip column (`M/20260722210000:62-65`). "Immutable" payslips hold by convention only (`M/20260722210000:1-5`).
- Not clocked: removed from the roster and payroll (`M/20260907160000:24`, `:99`) but accepted as a `kiosk_clock_in`
  target (`M/20260907120000:30-37`).
- The Primary Super Admin is identified by an email constant in TypeScript (`src/lib/authz/guard.ts:275-291`, value not
  reproduced; PROJECT-SPECIFIC).
- MFA step-up exists but no action calls it (`src/lib/authz/guard.ts:373-392`; `src/lib/auth/mfa.ts:48`).
- A floor that keeps at least one active Super Admin is PENDING section 5 (`M/20260916120000:20-22`, `:226-240`).

### 4.3 GENERIC and RECOMMENDED TEMPLATE IMPROVEMENTS

1. Replace every role-title gate (correct, delete, devices, generate, mark paid, rates, export) with the keys of
   PERMISSIONS.md section 4.2 and seed the default grant sets of PERMISSIONS.md section 5.
2. Super Admin writes go through the same RPCs as everyone else, so the reason, the bounds, the audit row and the
   snapshot freeze apply to them too. No table-level update grant is needed for any role.
3. A delegated payroll Admin needs `payroll.view_all` in the report filter and the snapshot and rate policies; without it
   the UI must not offer management controls.
4. Identify a primary Super Admin by a profile flag checked in SQL, not an email literal.
5. CONFIGURABLE MFA step-up (aal2) for payroll writes, rate edits, device registration and access changes.
6. Ship the last-Super-Admin floor trigger (carry PENDING section 5 forward).

## 5. Device approval

### 5.1 Mechanism (CURRENT)

| Aspect | Behaviour | Evidence |
|---|---|---|
| Token | `randomBytes(32).toString('hex')`, minted by a Super Admin-only server function | `L/devices.ts:69`, `:75` |
| Stored value | only `encode(extensions.digest(p_token, 'sha256'), 'hex')`; the raw token is passed to the RPC and hashed in SQL (pgcrypto) | `L/devices.ts:77-80`; `M/20260722150000:50-53` |
| Cookie | httpOnly, secure, sameSite lax, path `/`, max age 365 days; brand-prefixed name (section 11) | `L/devices.ts:27`, `:83-89` |
| Cookie scope | belongs to the browser, not to a user: anyone signed in on that browser passes | `L/devices.ts:45-53` |
| One active device | registering deactivates every active device first | `M/20260722150000:49`; `C/device-manager.tsx:161` |
| Gating flag | `attendance_gating_active()` = an active device exists | `M/20260722150000:66-69` |
| Verification | hash match against rows with `is_active` (not `revoked_at`; revoke sets both) | `M/20260722150000:58-63`, `:78` |
| Fail-open, no device | with no active device the gate is off and `device_id` is stored as NULL | `L/devices.ts:21-22`; `L/attendance.ts:32` |
| Fail-open, error | `response.data === true`, so an RPC error reads as "gate off" | `L/devices.ts:38-42` |
| Where enforced (LIVE) | server TypeScript only, before both RPCs | `L/attendance.ts:28-48`, `:161`, `:214` |
| Database (LIVE) | `kiosk_clock_in` stores any device id unchecked; `kiosk_clock_out` takes no device parameter | `M/20260907120000:40-46`; `L/attendance.ts:218-220` |
| Blocked attempt | refused and audited `attendance.blocked_device`, outcome denied, entity id = the member's profile id | `L/attendance.ts:36-42` |
| Register and revoke | Super Admin in TypeScript and in SQL (active owner role) | `L/devices.ts:69`, `:104`; `M/20260722150000:46-48`, `:75-77` |
| UI | banner when blocked (controls stay enabled); one-tap revoke | `P/attendance/page.tsx:91-105`; `C/device-manager.tsx:136-146` |
| Other bypass | a direct REST insert or update of one's own rows skips the gate entirely | section 3.3 |

### 5.2 PENDING (not live): section 10

`kiosk_clock_in` refuses a NULL, unknown or revoked `p_device_id` whenever an active device exists, and gains an
explicit PUBLIC and anon revoke (`M/20260916120000:451-459`, `:487-488`). The migration records its own residual: an
active device id is readable by staff from their own attendance rows, so binding to the token "needs an RPC signature
change" (`:431-432`; `docs/SYSTEM-AUDIT-2026-09-16.md:127`). `kiosk_clock_out` is not covered. A file-content test pins
the refusal message (`tests/unit/security-hardening.test.ts:272-285`); there is no behavioural test.

### 5.3 `trusted_devices` is registry-only

`trusted_devices` and `role_device_limits` are a separate per-user device registry. The migration states that
`enforcement_implemented` remains false (`M/20260715130200:15-21`) and the seed rows set it false
(`M/20260715120100:280-283`). Nothing in `src/` references `trusted_devices`. Web sign-in has no device, IP or location
gate. The template must not describe this registry as a control.

### 5.4 GENERIC and RECOMMENDED TEMPLATE IMPROVEMENTS

1. Enforce the device inside both clock RPCs with the token only. The server reads the raw token from the httpOnly
   cookie and passes it; the RPC hashes it and matches the hash against active, unrevoked device rows, then records the
   matched device id on the session (clock-in device and clock-out device, DATABASE.md sections 5.3, 5.6 and 5.13). No
   device id is taken from the request, so a device id read from one's own rows is useless.
2. Make the gate an explicit setting, not "a device exists": `attendance.device.mode` ('off', 'auto', 'required').
   Enforcement inside the clock RPCs (item 1) is a fixed engine rule whenever the gate is on, not a setting, so no
   configuration can move the device check back into server code only.
3. Offer a fail-closed option and default to it: `attendance.device.failMode = 'closed'`, so a gating-read error refuses
   the clock instead of opening it, and revoking the last device under mode 'required' blocks clocking.
4. CONFIGURABLE `attendance.device.maxActiveDevices` (CURRENT 1) and `attendance.device.cookieMaxAgeDays` (CURRENT 365);
   the cookie name prefix comes from branding configuration.
5. Force RLS on the device table and declare its grants explicitly (CURRENT: not forced, grants implicit).
6. Confirmation before revoke; disable the clock controls while the device is blocked; audit a blocked attempt with a
   device or staff entity type rather than `attendance_record`.
7. Never log the raw token; if request logging exists between the server and the database, hash the token in the
   server before the call and compare hashes in SQL.
8. pgTAP: unknown id, revoked id, wrong token, no device under each mode, clock-out coverage.

## 6. Selfies (clock photos)

### 6.1 CURRENT

- Optional. The kiosk opens the camera on clock in and out; "without photo" appears only when the camera API is missing
  or permission is denied, and an encode failure proceeds without a photo (`C/attendance-clock.tsx:106-128`,
  `:188-202`). The clock action runs first and the upload after it, so a failed upload never undoes the clock event
  (`:157-176`). The server never requires a photo.
- Storage: private bucket `attachments`, 10 MiB, jpeg/png/webp (`M/20260716300000:35-43`); path
  `attendance_record/<record id>/<uuid>.<ext>` (`src/lib/attachments/upload.ts:105-107`).
- Link: polymorphic `related_entity_type = 'attendance_record'` plus `related_entity_id`, with no foreign key
  (`L/attendance.ts:345-346`). In versus out is decided by the client-chosen file name containing `clock-out`
  (`L/attendance.ts:553`). When a slot has more than one upload, the photo shown is not deterministic: rows are read in
  `uploaded_at` order (`:531`), but each slot is assigned only after an awaited `createSignedUrl` call inside
  `Promise.all` (`:542-557`), so the upload whose signing call resolves last wins, which is not necessarily the latest. The dedicated
  `clock_in_photo` and `clock_out_photo` columns are unused (`M/20260722150000:8-9`).
- Read: metadata and objects readable by every active staff member (`M/20260716300000:127-129`, `:159-161`); the page
  action requires `hr_review_attendance` and mints 300-second signed URLs (S15). Open in the source audit
  (`docs/SYSTEM-AUDIT-2026-09-16.md:128`).
- Write: any active staff member can attach an image to any attendance record id (S16).
- Retention: indefinite. No update or delete policy exists (`M/20260716300000:144-148`, `:167-169`). Deleting a record
  leaves its selfie in storage (`L/attendance.ts:345-346`). No scheduled job touches attendance.
- Purge path: a one-off script deletes orphaned selfie blobs through the Storage API with the service-role key, because
  a live-only `storage.protect_delete` trigger blocks deleting storage objects from SQL
  (`scripts/purge-attendance-selfies.mjs:7-9`, `:17-22`). The trigger is NEEDS VERIFICATION (no DDL in the repo). The
  script is PROJECT-SPECIFIC and embeds a production project URL in its usage block (not reproduced; section 11).
- Browser prerequisite: every response carries `Permissions-Policy: camera=(self), microphone=(), geolocation=(),
  payment=(), usb=()` (`next.config.ts:45-48`), added so the camera stays available (`:38-39`). A header that denies the
  camera to the app's own origin (for example `camera=()`) makes `getUserMedia` fail and every clock event falls back to
  "without photo"; keep `camera=(self)` explicit. Whether omitting the header is harmless depends on the browser's
  default allowlist: NEEDS VERIFICATION in a browser. No Content-Security-Policy is shipped
  (`next.config.ts:31-35`).

### 6.2 Privacy position (GENERIC)

Facial images are treated as sensitive personal data in many jurisdictions, and employee monitoring often needs a stated
purpose, a retention period and an erasure path. The source business's own legal framework is PROJECT-SPECIFIC and is
not carried into the template (section 11). The template therefore must ship a retention setting and an erasure path,
and must let a client switch photos off.

### 6.3 RECOMMENDED TEMPLATE IMPROVEMENTS

1. A dedicated photo table with a real foreign key and an explicit `kind` (clock_in, clock_out), unique per session and
   kind (DATABASE.md section 5.7), instead of polymorphic attachments and file-name inference.
2. Read policy on metadata and objects: the subject, or a holder of the `attendance.review` permission (PERMISSIONS.md
   section 4.2 lists photo reads under that key; it is a permission, not a configuration key). Signed URL lifetime
   `retention.signedUrlTtlSeconds` (CURRENT 300).
3. Attach only through `attach_attendance_photo`, which requires `attendance.clock_operate`, a caller who is the
   operator recorded on that session for that kind (`clock_in_by` or `clock_out_by`), and a storage path under that
   session prefix for that kind (DATABASE.md section 5.13; IMPLEMENTATION_PROMPT.md PH4). The session must exist and
   the kind must not already be filled.
4. `attendance.selfie.mode` ('off', 'optional'). The value 'required' is not built in the template and fails
   configuration validation (CONFIGURATION.md section 2.9 rule 8); if a client ever needs it, it needs a server-side
   check and a different upload order, not a UI step.
5. `retention.selfieRetentionDays` and `retention.deleteSelfieWithRecord`, implemented by a scheduled server-side job
   that deletes through the Storage API with the service-role key (SQL deletes are blocked in the reference stack), with
   a dry-run mode and a prefix guard.
6. Deployment check: the camera Permissions-Policy header is present whenever photos are not 'off', and the site is
   served over HTTPS (camera access and the secure device cookie both need it).

## 7. Payroll privacy

### 7.1 Who can read pay data, by layer (CURRENT)

| Data | Staff | Admin | Super Admin | Enforced by |
|---|---|---|---|---|
| Own payroll row (hours, days, night shifts, rate, salary) | yes, even without `hr_payroll` | own only | all non-exempt | `M/20260907160000:97-100`; `P/payroll/page.tsx:30` |
| Other employees' payroll rows | no | no | yes | same filter |
| Payslip snapshots | own | own | all | `M/20260722210000:51-55` |
| Salary rates (`staff_salary_rates`) | NEEDS VERIFICATION | NEEDS VERIFICATION | presumably all | RECONSTRUCTED; Rates tab reads it directly `L/rate.ts:139-143` |
| Legacy rate on the profile | own | own | all | `M/20260821140000:21-22` |
| Payslip PDF and print | whoever can read the snapshot | same | same | client-side, `C/payslip-button.tsx:223-233` |
| Payroll summary print | hidden | hidden | yes | UI only, `C/attendance-view.tsx:98-105` |
| Export payroll sheet | 403 | own row | all | `src/app/api/export/all/route.ts:18-23`; `data-export.ts:563-568` |
| Export team sheet with current rates | 403 | not built | yes | `src/lib/export/sections.ts:24`; `data-export.ts:135-139`, `:776-788` |
| Audit events carrying money | LIVE yes; PENDING no | yes | yes | `M/20260715130100:661-662`; `M/20260916120000:290-298` |
| Realtime change events | as RLS allows | as RLS allows | as RLS allows | `M/20260731130000:27-33` |

### 7.2 Money in the audit trail

CURRENT audit contexts carry pay figures: `attendance.clock_in` adds `overtime_amount` when the session night flag is set
(`L/attendance.ts:188-196`); `payroll.set_salary_rate` carries `daily_rate`, `pay_frequency`, `effective_date`
(`L/rate.ts:233-238`); `payroll.payslip_generated` carries `net_salary` (`L/payslip-actions.ts:88-93`). In LIVE every
active staff member can read them (`M/20260715130100:661-662`). PENDING section 6 narrows reads to the Super Admin, the
Admin role title, `view_settings` holders, plus `official_order` rows for all staff (`M/20260916120000:290-298`), so an
Admin still reads every rate and net salary without any payroll key. Correction reasons in
`attendance.clock_out_corrected` are exposed the same way.

RECOMMENDED TEMPLATE IMPROVEMENT: `audit.payloadIncludesAmounts = false` by default (record the entity id and the
change, not the figure), and an audit read policy (DATABASE.md section 5.11; a policy on the audit table, not a
configuration key) under which payroll events are readable only by `payroll.view_all` holders.

### 7.3 Privacy mask (display only)

Privacy Mode masks money on screen per browser. Its own header says it changes only what is displayed and "is not a
security control" (`src/components/shell/privacy.tsx:21-23`). The real value stays in the DOM in a print-only span
(`:113-120`), the preference lives in local storage (`:33`, `:44-50`), and printing and export are unaffected. GENERIC:
keep it as a shoulder-surfing convenience and never cite it as a privacy control.

### 7.4 Other controls

- The service worker never caches page HTML, for any route (`src/lib/pwa/cache-policy.ts:63`); this is a generic rule,
  not a payroll-specific list.
- RECOMMENDED TEMPLATE IMPROVEMENTS: `payroll.view_all` in the report filter and the snapshot and rate read policies;
  explicit rate-table RLS (self or `payroll.view_all`); a mark-paid RPC plus a freeze trigger on money columns; the UI
  offers management controls only when the data layer will honour them.

## 8. Definer function hygiene

### 8.1 `search_path` pinned (CURRENT)

Every function in scope whose DDL is in the repo sets an empty `search_path` (the RECONSTRUCTED ones are unknown): the
helpers (`M/20260715130000:33`, `:52`, `:73`, `:152`;
`M/20260716240000:31`), the device RPCs (`M/20260722150000:43`, `:59`, `:67`, `:73`), `kiosk_clock_in`
(`M/20260907120000:18`), `correct_attendance_clock_out` (`M/20260907130000:21`), `list_clock_staff` and the INVOKER
`report_payroll` (`M/20260907160000:13`, `:33`). Tests: `tests/unit/security-guards.test.ts:120-135` checks per
migration FILE (a file with one pinned and one unpinned definer function passes); `tests/unit/phase2-authz.test.ts:368-380`
compares counts in the helper file only. RECOMMENDED TEMPLATE IMPROVEMENT: check per function against
`pg_proc.proconfig` (section 12).

### 8.2 PUBLIC and anon EXECUTE

| Function | Mode | Revoke in the repo | Status |
|---|---|---|---|
| `register_attendance_device`, `verify_attendance_device`, `attendance_gating_active`, `revoke_attendance_device` | DEFINER | `M/20260722170000:8-18` | CURRENT |
| `list_clock_staff` | DEFINER | `M/20260806260000:17`, `:33-34` | CURRENT |
| `correct_attendance_clock_out` | DEFINER | `M/20260907130000:65-68` | CURRENT |
| `kiosk_clock_in` | DEFINER | none in `M/20260907120000` | PENDING `M/20260916120000:487-488` and the section 2 loop |
| `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`, `set_staff_hourly_rate` | RECONSTRUCTED | none | PENDING section 2 loop covers them if DEFINER (`M/20260916120000:76-110`) |
| `report_payroll` | INVOKER | repo `M/20260721100000:73-74`, lost on the out-of-band re-create | NEEDS VERIFICATION |
| `generate_payslip_snapshot` | INVOKER (repo); live RECONSTRUCTED | grant only, `M/20260722210000:134-135` | NEEDS VERIFICATION |
| `app_private` helpers | DEFINER | EXECUTE to authenticated; schema usage revoked from anon | `M/20260715130000:233-247` |
| `app_private.night_ot_bonus()` | RECONSTRUCTED | unknown | NEEDS VERIFICATION: must be executable by `authenticated` because `report_payroll` is INVOKER |

The repo contradicts itself on the live state: one migration says that after it "0 public-schema DEFINER functions are
anon-executable" (`M/20260821120000:14`); the PENDING header says 20 were never revoked and that Supabase default
privileges re-grant anon on each create (`M/20260916120000:12-14`). The section 12 `proacl` query settles it. PENDING
section 2 revokes PUBLIC and anon on every public DEFINER function and grants nothing to `authenticated`; a named list
of system functions, plus every function whose name ends in `_system`, also loses `authenticated` and is narrowed to
`service_role` (`M/20260916120000:65-110`, name rule `:91-101`; pinned by
`tests/unit/security-hardening.test.ts:229-236`).

### 8.3 The NULL-role gate risk

A gate written `if current_staff_role() not in ('owner', 'selected_admin') then raise` evaluates to NULL when the helper
returns NULL, and a NULL condition skips the raise. LIVE `current_staff_role()` returns NULL when the auth user has no
profile (`M/20260715130000:47-58`); PENDING keeps NULL for that case on purpose (`M/20260916120000:40-43`).
`correct_attendance_clock_out` guards it with `v_role is null or ...` (`M/20260907130000:30`). Whether
`delete_attendance_record`, `kiosk_clock_out` and the rate RPCs do is unknown (RECONSTRUCTED). Helpers built on `exists`
(`is_active_staff()`, `is_owner()`, `has_permission()`) always return true or false (`M/20260715130000:68-81`,
`:147-161`; `M/20260716240000:26-44`).

GENERIC rule: gate on `has_permission(key)` or another boolean helper; if a role title is compared at all, the gate must
contain an explicit `is null` branch; pgTAP covers a token with no profile.

### 8.4 Deactivated accounts

- LIVE `current_staff_role()` ignores `is_active`, so a deactivated Super Admin or Admin token passes role-title gates
  such as `correct_attendance_clock_out` (`M/20260715130000:47-58`; `M/20260907130000:29-33`). PENDING section 1 returns
  the sentinel `'inactive'` (`M/20260916120000:46-57`), pinned by `tests/unit/security-hardening.test.ts:219-227`.
- `current_staff_id()` also ignores `is_active` and PENDING does not change it (section 3.2).
- The gates built on `is_active_staff()`, `is_owner()` and `has_permission()` already refuse a deactivated profile.
- GENERIC: every helper checks `is_active`; the session-revoke RPC of PENDING section 9 runs on every deactivation.

### 8.5 DEFINER functions writing a FORCE RLS table

`attendance_records` forces RLS (`M/20260717120000:48`) and the kiosk and correction functions write it as DEFINER. They
work only if the function owner bypasses RLS or a policy admits it. NEEDS VERIFICATION (`pg_proc.proowner`,
`pg_roles.rolbypassrls`, section 12). The template states the owner role explicitly in its migrations.

### 8.6 POST and RPC calls are never retried

The user-scoped client retries GET and HEAD up to three attempts on 429, 502, 503 and 504; every other method, and
therefore every RPC and write, is sent once (`src/lib/supabase/server.ts:26-30`; `src/lib/supabase/retry-fetch.ts:40`,
`:58-61`, `:82`, `:99`). A clock action is never silently repeated; a lost response surfaces as an error and a human
re-click. GENERIC: keep this rule; the one-open-session index makes a repeated clock-in fail with "already clocked in"
instead of creating a second session.

### 8.7 Static guards that give false assurance

- The authorization sweep detects writers by `.insert(`, `.update(` and `.delete(` only
  (`tests/integration/phase11-authorization-boundary.test.ts:30`), so an RPC-only writer is never swept, and the check is
  "the file contains a guard", not "each export is guarded" (`:94-99`). The live, unguarded `setSalaryRate` is covered
  only because dead code in the same file matches.
- Files ending in `actions.ts` are skipped by the writing-module sweep (`:86-88`), and the action sweep only matches
  `*/actions.ts` (`:61`), so the payslip actions file is checked by neither.
- Security comments contradict the code a reader trusts first: the Attendance page calls clocking "self-service"
  (`P/attendance/page.tsx:34-35`); the payslip actions header says generating and marking paid are Super Admin acts
  enforced by RLS while mark paid allows Admin (`L/payslip-actions.ts:13-15` versus `:106`); the rate module header
  describes a guard and a policy the live rate path does not use (`L/rate.ts:9-20` versus `:201-231`); the rate action
  says "Owner-only, the domain module re-checks" (`L/actions.ts:206-209`).
- RECOMMENDED TEMPLATE IMPROVEMENT: detect `.rpc(` too, assert per exported function, add catalog-level pgTAP for
  every gate, and write comments that describe the gate actually enforced.

## 9. Audit trail (Phase 12)

### 9.1 The audit store (CURRENT)

| Property | Behaviour | Evidence |
|---|---|---|
| Table | `audit_events`: actor uid, actor kind, actor label snapshot, action, entity type and id, outcome (succeeded, failed, denied), reason, jsonb context | `M/20260715120000:74-106` |
| Append-only | UPDATE and DELETE raise through triggers | `M/20260715120000:115-133` |
| RLS | forced; insert must be self-attributed staff (`actor_auth_uid = auth.uid()`) | `M/20260715120000:135-137`; `M/20260715130100:664-670` |
| Read | LIVE every active staff member; PENDING narrowed (section 7.2) | `M/20260715130100:661-662`; `M/20260916120000:290-298` |
| Writer | app code only, from the verified session; label snapshot "name (role key)" | `src/lib/audit/log.ts:40-74` |
| Best-effort | never throws; returns early without a user; the insert result is not checked | `src/lib/audit/log.ts:35-38`, `:49-51`, `:64-78` |
| SQL functions | write no audit rows (for example the correction RPC has no insert) | `M/20260907130000:13-63`; `M/20260907120000:14-54` |
| UI | no screen shows attendance or payroll history; the Super Admin-only export has an Audit Log sheet | `src/lib/export/data-export.ts:935-945` |

### 9.2 Events recorded today (CURRENT)

| Action | Outcomes written | Context | Evidence |
|---|---|---|---|
| `attendance.clock_in` | succeeded | `for_staff`, `overtime_amount` when flagged | `L/attendance.ts:188-196` |
| `attendance.clock_out` | succeeded | `for_staff` | `L/attendance.ts:230-235` |
| `attendance.blocked_device` | denied | reason text; entity id is the member's profile id | `L/attendance.ts:36-42` |
| `attendance.clock_out_corrected` | denied, failed, succeeded | `{old_time_out, new_time_out, reason}` on success | `L/attendance.ts:408-456` |
| `attendance.delete` | denied, failed, succeeded | `{permanent: true}` on success | `L/attendance.ts:354-388` |
| `attendance.device_register` | succeeded | `label` | `L/devices.ts:91-95` |
| `attendance.device_revoke` | succeeded | none | `L/devices.ts:113-117` |
| `attachment.upload` | failed, succeeded | purpose, source, size, path | `src/lib/attachments/upload.ts:119-126`, `:155-178` |
| `owner_approval.request`, `.decide`, `.execute` | denied, failed, succeeded | `action_kind` `attendance_delete`, target id | `src/lib/fulfillment/service.ts:504-512` |
| `payroll.payslip_generated` | succeeded only | `from`, `to`, `net_salary` | `L/payslip-actions.ts:88-93` |
| `payroll.payslip_marked_paid` | succeeded only | `payment_date`, `paid_by` | `L/payslip-actions.ts:145-150` |
| `payroll.set_salary_rate` | succeeded only | `daily_rate`, `pay_frequency`, `effective_date` | `L/rate.ts:233-238` |
| `data.export_all` | failed, succeeded | sections, range, bytes | `src/app/api/export/all/route.ts:62-72`, `:85-90` |

Refused or failed generate, mark-paid and rate actions return an error without an audit row
(`L/payslip-actions.ts:27-34`, `:65-71`, `:105-112`, `:137-143`; `L/rate.ts:229-231`).

### 9.3 What the rows themselves keep (CURRENT)

- Correction: `edited_by` and `edit_reason` are written in place and overwritten by the next correction
  (`M/20260907130000:55-59`). There is no `edited_at` or `updated_at` column. The previous `time_out`
  exists only in the audit context; it is lost if that best-effort insert fails. A direct REST update changes times
  without touching either column (section 3.3).
- Clock-in time: no app or RPC path edits it (`M/20260907130000:55-59` touches only `time_out`); a direct REST update
  can (section 3.3) and leaves no trace.
- Deletion: a hard delete keeps nothing of the row; the audit context is only `{permanent: true}`. The approval path
  keeps the request text with the member name and work date (`C/attendance-day-details.tsx:141`).
- Payslips: `generated_by` and `generated_at` on insert (`M/20260722210000:33-34`, `:116-120`); `paid_at` and `paid_by`
  on mark-paid (`L/payslip-actions.ts:126-131`, columns RECONSTRUCTED); `approved_by` exists and is never written
  (`M/20260722210000:32`).
- Payroll adjustments: none exist beyond the single `deductions` column. No app path edits it after
  generation; the Super Admin update policy still permits a direct REST rewrite of `deductions` and every other money
  column, with no trace (`M/20260722210000:62-68`; section 4.2). There is no void or unpay path.
- "Unchanged" correction saves: the correction dialog seeds its input from `time_out` (or `time_in` for an open
  session) truncated to the minute (`C/review-attendance-view.tsx:674-679`, `:707`). On a completed session, saving
  without touching the time is accepted and rewrites `time_out` to the start of its minute while stamping `edited_by`
  and `edit_reason` (`M/20260907130000:48-59`), so the in-row correction record and the audit event describe a change
  nobody intended. On an open session the same save is usually refused as "before clock-in". Save is
  disabled only until a value and a reason exist, not until the value changes (`C/review-attendance-view.tsx:740`).
- Edits after a payslip is issued: a correction or delete of a session inside an issued period silently diverges from
  the frozen snapshot. Nothing refuses it, flags the payslip, or records a post-issue adjustment (`M/20260722210000:1-12`).
- Duplicate payslips: the repo DDL makes nothing unique per employee and period (both indexes are non-unique,
  `M/20260722210000:41-44`; a live-only constraint is NEEDS VERIFICATION). The UI switches the row button to "View
  payslip" once a snapshot exists (`C/payslip-button.tsx:260`), but a direct call to the generate action by the Super
  Admin can insert another row, and the reader keeps only the newest by `generated_at` (`L/payslip.ts:55-80`), so a
  newer pending payslip masks an older paid one on screen.
- Device: `registered_by`, `created_at`, `revoked_at` (`M/20260722150000:14-22`); the session row keeps `device_id` for
  clock-in only.

### 9.4 RECOMMENDED TEMPLATE IMPROVEMENTS

1. Write success audit rows inside the RPC transaction (a small `app_private` audit helper called by each write
   function, DATABASE.md section 5.11), or with a database trigger on the sessions, snapshots, rates and devices
   tables, so a direct RPC call cannot skip the record and a failed audit insert rolls the write back.
2. Record denied and failed attempts for every money act (generate, mark paid, rate edit), not only successes. A raise
   rolls back every row its transaction inserted, so a refusal row is written by a typed refusal (the function inserts
   the row and returns a refusal instead of raising) or by the server layer after the error returns, outside the
   refused transaction; never insert an audit row and then raise (SERVER_API.md section 9.1 rule 8). A refused direct
   RPC call leaves a row only on the typed-refusal path.
3. Add `edited_at` to the session row and keep `edited_by` and `edit_reason` as the latest-change summary.
4. Keep before and after values in an append-only history, so repeated corrections do not overwrite each other. The
   history is the correction function's own success row in `audit_events` (session id, old and new `time_out`, reason,
   editor, time), written in the correction transaction; no separate edit-history table (DATABASE.md section 5.11).
5. Replace the hard delete with a soft delete (`deleted_at`, `deleted_by`, `delete_reason`, DATABASE.md section 5.3) or
   a deletion log that stores the full row, and exclude deleted rows from payroll.
6. Record payroll adjustments as rows with a label, amount, author and time (`payroll_adjustments`, DATABASE.md section
   5.10; the itemized mode fails configuration validation until it is built, CONFIGURATION.md section 2.9 rule 8), and
   add void or reversal events instead of editing a frozen snapshot.
7. Keep money out of audit payloads by default and restrict audit reads (section 7.2).
8. Show a change history in the Review day details for holders of the review key.
9. Log the device on clock-out as well as clock-in, and audit a blocked attempt against a device or staff entity type.
10. Make a correction record only a real change, at one precision (the minute) in the UI, the server action and SQL:
    seed a completed session's input with the stored `time_out` truncated to its minute and an open session's input
    with `time_in` rounded up to the next minute; disable Save until the chosen minute differs from the stored
    `time_out`'s minute; have the server action and the correction RPC refuse a new value that is not a whole minute,
    and refuse as unchanged a value equal to the stored `time_out` truncated to its minute, leaving the row untouched
    (IMPLEMENTATION_PROMPT.md R7 and R8). An exact-equality check would let an untouched save of a completed session
    whose `time_out` has seconds rewrite the clock-out (`C/review-attendance-view.tsx:674-679`).
11. Protect issued pay periods: with `payroll.lockPeriodAfterPayslip` set to `generated` or `paid`, the correction and
    delete RPCs refuse a session whose `work_date` falls inside the period of that employee's current payslip
    (DATABASE.md section 5.5; IMPLEMENTATION_PROMPT.md R12). The value is a client decision; with `off` (the default)
    a correction after issue changes the live payroll table but never the frozen payslip; a pending payslip can be
    regenerated (superseding it), and a paid one only after a void where `void_payslip` is built (DATABASE.md section
    5.13 notes). The template defines no post-issue adjustment rows.
12. Enforce one live payslip per employee and period in the database: a unique index on (employee, period) over rows
    not marked superseded, and a regeneration path that marks the old row superseded (refused outright when it is
    paid), so a paid snapshot can never be masked by a newer pending one.

## 10. Security checklist for adopters

Authorization
- [ ] Each page is gated on the server by its key (S1 to S3); nav visibility is not the only check.
- [ ] Each write RPC checks its PERMISSIONS.md key with `has_permission`; no role-title gate remains without an explicit
  `is null` branch (section 8.3).
- [ ] UI controls are shown only when the RPC or RLS will allow them (generate, mark paid, rates, delete paths agree).
- [ ] The request-deletion key, if kept, is grantable in the access-management screen (S11).
- [ ] Every helper used in a gate or policy refuses a deactivated profile, including the self-identity helper (section 8.4).

Writes and scoping
- [ ] `authenticated` has no INSERT, UPDATE or DELETE on sessions, snapshots, devices or rates; all writes are RPCs
  (section 3.3).
- [ ] Super Admin writes go through the same RPCs; no table-wide update policy exists for payslip money columns.
- [ ] Payroll report filter, snapshot policy and rate policy use the same rule (self or `payroll.view_all`).
- [ ] Names, roster and kiosk status come from permission-gated DEFINER readers.

Devices
- [ ] `attendance.device.mode` and `attendance.device.failMode` (default 'closed') are set deliberately; the database
  device check is an engine rule, not a setting (section 5.4).
- [ ] Both clock RPCs hash the token, match it against active device rows and record the matched device id (section 5.4).
- [ ] The device cookie is httpOnly, secure, sameSite lax, with a client-chosen lifetime and a client-branded name.
- [ ] The device table forces RLS and declares grants; revoke asks for confirmation.

Photos
- [ ] `attendance.selfie.mode` is chosen ('off' or 'optional'); 'required' is not built and fails configuration validation
  (CONFIGURATION.md section 2.9 rule 8).
- [ ] Photo metadata and objects are readable only by the subject and review-key holders; insert is RPC-checked.
- [ ] `retention.selfieRetentionDays` and `retention.deleteSelfieWithRecord` are decided with the client and a scheduled
  service-role job implements them.
- [ ] The camera Permissions-Policy header is present and the site is HTTPS.

Payroll privacy and audit
- [ ] Audit reads are restricted; payroll payloads carry no amounts unless the client opts in.
- [ ] Success audit rows are written inside the write transaction; denied and failed outcomes are recorded by a typed
  refusal or by the server layer after the error returns, never by inserting and then raising.
- [ ] Corrections keep before and after values and `edited_at`; deletions are soft or logged with the full row.
- [ ] A correction that changes nothing (same minute) cannot be saved; edits inside an issued pay period are refused when
  `payroll.lockPeriodAfterPayslip` is not `off` (section 9.4).
- [ ] The database allows one live payslip per employee and period; a paid payslip cannot be masked by a regeneration.
- [ ] Privacy Mode is documented as display-only.

Definer hygiene and tests
- [ ] Every DEFINER function sets an empty `search_path`, and every module function (definer, invoker, accessor, helper,
  trigger function) revokes PUBLIC and anon in the migration that creates it; EXECUTE for `authenticated` (and
  `service_role` if needed) is granted only where needed, never on trigger functions, the audit writer or an unfiltered
  private function (DATABASE.md section 5.1 principle 8).
- [ ] INVOKER report functions are executable by `authenticated`, and every private function they call either filters by
  the caller (the payroll row filter lives inside `app_private.payroll_lines`) or is not executable by end users.
- [ ] Function owners and BYPASSRLS are known for functions that write FORCE RLS tables.
- [ ] Writes and RPCs are never auto-retried by the data client.
- [ ] The static authorization sweep detects `.rpc(` and checks each export; pgTAP covers every gate and the direct-write
  refusal (TESTING_CHECKLIST.md sections 4.2 and 5).
- [ ] No production project URL, key or person name is embedded in scripts, migration comments or test fixtures.

## 11. PROJECT-SPECIFIC items removed from this document

- Device cookie name `av_att_device` (`L/devices.ts:27`) and the Privacy Mode storage key `av-privacy-mode`
  (`src/components/shell/privacy.tsx:33`): brand prefixes, replaced by a branding setting.
- Brand names in the export file name (`MineFlow-Data-Export-*`, `src/app/api/export/all/route.ts:74`), the workbook
  creator (`A.V. Jewelry`, `src/lib/export/data-export.ts:132`) and the service-worker cache rationale comment
  (`src/lib/pwa/cache-policy.ts:4`).
- Business timezone `Asia/Manila` in `kiosk_clock_in` (`M/20260907120000:45`), the PENDING `work_date` default
  (`M/20260916120000:368`) and the payroll night rule (`M/20260907160000:41`).
- Currency PHP and its symbol in the Privacy Mode mask (`src/components/shell/privacy.tsx:34`) and in server messages
  (`L/attendance.ts:201`; `L/rate.ts:242`).
- "Shop phone" device wording and default label (`M/20260722150000:51`; `L/attendance.ts:41`, `:46`).
- The Philippine Data Privacy Act context for facial selfies (`LEGAL_COMPLIANCE_AUDIT.md:44`).
- The one-off selfie purge script, its data-wipe context and its embedded production project URL
  (`scripts/purge-attendance-selfies.mjs:5-9`, `:24-28`; value not reproduced).
- The Primary Super Admin email constant (`src/lib/authz/guard.ts:281`, value not reproduced) and the two-Super-Admin cap.
- Real account-holder names in the roster and payroll migration header (`M/20260907160000:1-7`, not reproduced).
- Internal specification section references in comments and migration headers.
- Third-party integration function names in the PENDING section 2 system-only list (`M/20260916120000:92-100`).

## 12. NEEDS VERIFICATION: read-only catalog checks

These queries settle open questions about the reference implementation, so they only mean something when run against
the reference implementation's own database, read-only, by the person responsible for that database. Never run them
through connectors or accounts that belong to another client. They read the catalog and change nothing. The same
queries also work as post-install checks on a new client's project, where they confirm the template's own policies and
grants instead.

```sql
-- Section 3.3: policies, table grants, column privileges and triggers on attendance rows
select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
from pg_policy where polrelid = 'public.attendance_records'::regclass;
select grantee, privilege_type from information_schema.role_table_grants
where table_name = 'attendance_records' and grantee in ('anon', 'authenticated');
select grantee, privilege_type, column_name from information_schema.column_privileges
where table_name = 'attendance_records' and grantee in ('anon', 'authenticated');
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.attendance_records'::regclass and not tgisinternal;

-- Sections 6 and 7: photo, payslip, rate and profile policies
select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies
where tablename in ('attachments', 'objects', 'payroll_snapshots', 'staff_salary_rates',
  'staff_profiles', 'attendance_devices', 'audit_events');
select tgname from pg_trigger where tgrelid = 'storage.objects'::regclass and not tgisinternal;

-- Section 8.2: EXECUTE grants and definer mode
select n.nspname, p.proname, p.prosecdef, p.proacl, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.proname in ('kiosk_clock_in', 'kiosk_clock_out', 'correct_attendance_clock_out',
    'delete_attendance_record', 'list_clock_staff', 'register_attendance_device',
    'verify_attendance_device', 'attendance_gating_active', 'revoke_attendance_device',
    'report_payroll', 'generate_payslip_snapshot', 'set_staff_salary_rate',
    'set_staff_hourly_rate', 'night_ot_bonus', 'current_staff_role', 'current_staff_id');

-- Section 8.3: bodies of the RECONSTRUCTED functions (NULL-role branches, audit inserts)
select p.proname, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('kiosk_clock_out', 'delete_attendance_record', 'set_staff_salary_rate',
    'generate_payslip_snapshot');

-- Section 8.5: owners of definer functions that write FORCE RLS tables
select p.proname, r.rolname, r.rolbypassrls
from pg_proc p join pg_roles r on r.oid = p.proowner
where p.proname in ('kiosk_clock_in', 'kiosk_clock_out', 'correct_attendance_clock_out',
  'delete_attendance_record');

-- Sections 1.3 (S8, S11) and 8.4: reviewer name policy, request key, applied migrations
select polname, pg_get_expr(polqual, polrelid)
from pg_policy where polrelid = 'public.staff_profiles'::regclass and polcmd = 'r';
select count(*) from public.staff_permission_grants
where permission_key = 'initiate_high_risk_action';
select version, name from supabase_migrations.schema_migrations order by version desc limit 15;
```

## 13. Sources

- Extraction method: README.md section 7 (read-only notes on roles and security, clocking, review, configuration and
  tests, payroll and the database, corrected by a critic pass).
- Repository files re-read for this document: `L/attendance.ts`, `L/devices.ts`, `L/actions.ts`,
  `L/payslip-actions.ts`, `L/rate.ts`, `src/lib/audit/log.ts`, `src/lib/authz/guard.ts`,
  `src/lib/attachments/upload.ts`, `src/lib/supabase/server.ts`, `src/lib/supabase/retry-fetch.ts`,
  `src/components/shell/privacy.tsx`, `next.config.ts`, the three page files, the export route and sections, and
  migrations 20260715120000, 20260715130000, 20260715130100, 20260716240000, 20260716300000, 20260717120000,
  20260722150000, 20260722170000, 20260722180000, 20260722210000, 20260804140000, 20260806260000, 20260821140000,
  20260907120000, 20260907130000, 20260907160000 and 20260916120000.
- Sibling documents: PERMISSIONS.md (capability matrix, key mapping, default grants), DATABASE.md (DDL and generic
  objects), CONFIGURATION.md (setting schema), PAYROLL.md (formulas and payslip lifecycle), UI_UX.md (screens),
  TESTING_CHECKLIST.md (sections 4.2 and 5: pgTAP plan and security regression checklist), IMPLEMENTATION_PROMPT.md
  (Step 4 permission model).
