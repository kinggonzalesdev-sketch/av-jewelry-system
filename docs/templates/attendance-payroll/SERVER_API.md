# Attendance and Payroll Template: Server API (Phase 10)

This document inventories every server-side entry point of Attendance, Review Attendance and Payroll in the
reference implementation (Next.js App Router pages, server actions, `server-only` domain functions, one API
route, Postgres RPCs and direct table reads under RLS), records for each one its input, authorization, action,
database effect and output, and then proposes a generic, typed interface contract that future systems can
implement. Evidence is the repository itself (the extraction method is in `README.md` section 7); every citation
that carries a verdict was re-read in the repository at commit `c31af2b`. No database was queried.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, with a `file:line` citation. |
| GENERIC | The reusable form proposed for the template. |
| PROJECT-SPECIFIC | Tied to the source business; collected in section 12 and removed from the template. |
| CONFIGURABLE | Should become a client setting (key names follow `CONFIGURATION.md`). |
| NEEDS VERIFICATION | The repository cannot settle it; the text says what would (section 13). |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository; described from call sites and comments. |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template should fix. Never a change to production. |

Role vocabulary: the database role keys are `owner`, `selected_admin` and `staff`; the UI calls them Super Admin
(role key owner), Admin (role key selected_admin) and Staff (role key staff). The rest of this document says
Super Admin, Admin and Staff. Code identifiers such as `requireOwner`, `requireOwnerOrAdmin` and `is_owner()`
keep their names; quoted database messages keep their wording.

Permission keys in the reference implementation: `hr_attendance` (open the Attendance page and the kiosk roster),
`hr_review_attendance` (open Review Attendance and read every attendance row), `hr_payroll` (open Payroll). The
generic keys in section 9 are the ones defined in `PERMISSIONS.md` section 4.2 and no others. Own-row access (own
sessions, own payroll line, own payslips, own rate) needs no key (`PERMISSIONS.md` section 4.1, principle 7).

Fields per inventory entry (sections 2 to 5): INPUT (parameters and validation), AUTHORIZATION (the exact check at
the action, domain and database layers; NONE when there is none), ACTION, DATABASE EFFECT (tables, rows, audit rows,
RLS in effect), OUTPUT (shape and error handling, including cases where a failure looks like an empty result).

Citation key. Paths are relative to the repository root. Short names used below:

| Short name | File |
|---|---|
| `hr/actions.ts` | `src/lib/hr/actions.ts` (`'use server'`) |
| `attendance.ts`, `attendance-paging.ts`, `devices.ts` | `src/lib/hr/` |
| `payroll.ts`, `payslip.ts`, `payslip-actions.ts`, `payslip-types.ts`, `payslip-pdf.ts`, `rate.ts`, `action-state.ts` | `src/lib/hr/` |
| `upload.ts`, `attachments/actions.ts` | `src/lib/attachments/` |
| `guard.ts`, `request-deletion.ts` | `src/lib/authz/` |
| `service.ts`, `fulfillment/actions.ts` | `src/lib/fulfillment/` |
| `log.ts` | `src/lib/audit/log.ts` |
| `server.ts`, `retry-fetch.ts` | `src/lib/supabase/` |
| `route.ts` | `src/app/api/export/all/route.ts` |
| `data-export.ts`, `sections.ts` | `src/lib/export/` |
| `attendance/page.tsx`, `review/page.tsx`, `payroll/page.tsx` | `src/app/(app)/admin/attendance/`, `.../attendance/review/`, `.../payroll/` |
| component files (`attendance-clock.tsx` and others) | `src/components/hr/` |
| migrations | `supabase/migrations/`, cited by timestamp prefix (for example `20260907130000:29-33`) |

Sibling documents own neighbouring subjects and are referred to instead of repeated: `DATABASE.md` (DDL, RLS,
function bodies, migration file names), `PERMISSIONS.md` (capability matrix, generic keys, default grants),
`PAYROLL.md` (formulas and the payroll engine types), `UI_UX.md` (screens and client state), `CONFIGURATION.md`
(settings), `TESTING_CHECKLIST.md` (tests), `IMPLEMENTATION_PROMPT.md` (build instructions).

---

## 1. Request path and shared mechanics (CURRENT)

### 1.1 Layers

1. Page: a server component with `export const dynamic = 'force-dynamic'` gates on a permission key with
   `canOpenPage(key)` and answers 404 through `notFound()` (`attendance/page.tsx:31, 43`; `review/page.tsx:12, 22`;
   `payroll/page.tsx:14, 30`). It then reads data in parallel and passes it as props.
2. Server action: a `'use server'` module that parses `FormData` or plain arguments and calls a domain function.
   The HR actions describe themselves as "Transport only" (`hr/actions.ts:28-32`; `attachments/actions.ts:6-13`).
3. Domain function: a `server-only` module that runs a guard, creates the user-scoped Supabase client, calls an
   RPC or a table, writes an audit event and returns a typed result (`attendance.ts:1-10`; `devices.ts:1-9`).
4. Database: SECURITY DEFINER functions with `set search_path = ''` and helpers in `app_private` that derive the
   caller from `auth.uid()`; tables with RLS. Details are in `DATABASE.md` sections 2 and 3.

The Supabase client used everywhere in scope is the user-scoped server client (`server.ts:18-49`): it carries the
caller's session and is subject to RLS. No service-role client is used by these modules.

Clocking is a shared KIOSK: a signed-in operator who can open the Attendance page picks a member from the roster
and clocks that member in or out (`hr/actions.ts:85`; `attendance.ts:148-153`). It is not self-service. The
operator's own identity only decides authorization and audit attribution.

### 1.2 Guards

| Guard | What it checks | On failure | Evidence |
|---|---|---|---|
| `requireAuthenticatedStaff()` | a verified session | redirect `/offline` (transient) or `/sign-in` | `guard.ts:56-71` |
| `requireActiveStaff()` | own `staff_profiles` row exists, `is_active`, not demo unless demo login is enabled | redirect `/offline` or `/account-disabled` | `guard.ts:124-163` |
| `getGrantedPermissions()` | Super Admin holds every key; others read own grants | read error returns an empty set (fail closed) | `guard.ts:174-198` |
| `canOpenPage(key)` | key in the granted set | returns false; the page calls `notFound()` | `guard.ts:300-303` |
| `requirePermission(key)` | key in the granted set | throws `AuthorizationError` | `guard.ts:211-223` |
| `requireOwner()` | role key `owner` | throws `AuthorizationError` | `guard.ts:263-273` |
| `requireOwnerOrAdmin()` | role key `owner` or `selected_admin` | throws `AuthorizationError` | `guard.ts:325-335` |
| `requireOwnerApprovalAuthority()` | role key `owner` | throws `AuthorizationError` | `guard.ts:346-356` |

`requireActiveStaff` is cached per request (`guard.ts:122-124`), so a page that calls `canOpenPage` first has
already run it. Write paths that use a throwing guard catch `AuthorizationError` and return it as
`{ ok: false, error }` (`attendance.ts:351-365`; `devices.ts:68-73`; `payslip-actions.ts:27-34`); the three load
actions let it throw (A10, A12, R2). `requireAal2` exists but nothing in scope calls it (`guard.ts:373-392`).

### 1.3 Result shapes

| Type | Shape | Used by | Evidence |
|---|---|---|---|
| `HrActionState` | `{ error: string or null, success: string or null, recordId?: string or null }` | HR form actions | `action-state.ts:6-14` |
| `PayslipActionState` | `{ error, success, snapshot: PayslipSnapshot or null }` | payslip actions | `payslip-types.ts:37-48` |
| `ClockResult` | `{ ok: true, message, recordId?, isOvertime?, overtimeAmount? }` or `{ ok: false, error }` | kiosk domain | `attendance.ts:71-80` |
| `SetRateResult` | `{ ok: true, message }` or `{ ok: false, error }` | rate domain | `rate.ts:22` |
| `RequestDeletionResult` | `{ ok: true }` or `{ ok: false, error }` | request deletion | `request-deletion.ts:13` |
| `PayrollResult` | `{ ok: true, rows }` or `{ ok: false }` (no reason) | payroll reader | `payroll.ts:31` |
| plain collections | `[]`, `{}` or an `AttendancePage` | every other reader | sections 2 to 4 |

State types live outside the `'use server'` file because such a file may export async functions only
(`action-state.ts:1-4`). Error text is usually the Postgres exception message with a leading `ERROR:` prefix and
the whitespace after it removed (`attendance.ts:174, 225, 380, 444`; `rate.ts:230`); `generatePayslipAction` passes
the message through without that step (`payslip-actions.ts:65-71`). No error carries a machine-readable code.

### 1.4 Retry and repeat behaviour

The user-scoped client installs a retrying `fetch` (`server.ts:26-30`). It retries only GET and HEAD, up to three
attempts in total, on a thrown network error or HTTP 429, 502, 503 or 504 (`retry-fetch.ts:40, 58-60, 75-109`).
Every RPC call and every INSERT or UPDATE uses another method and is never retried (`retry-fetch.ts:20-29`). The
kiosk UI does not retry either: a failed clock action shows the error and waits for a new click
(`attendance-clock.tsx:151-154, 181-182`). What a manual repeat does is recorded per entry below.

### 1.5 Audit writer

`recordAuditEvent` resolves the actor from the session, snapshots `actor_label` as name and role, inserts one
`audit_events` row, and never throws; it returns early without a session and does not check the insert result
(`log.ts:32-79`). An action can therefore succeed with no audit row. No attendance or payroll SQL function whose DDL
is in the repository writes audit rows; for the RECONSTRUCTED functions this is unknown. Audit rows are written from
TypeScript after the guard or the database call has returned, outside the refused transaction, so a denied or failed
event is not rolled back with it (`attendance.ts:354-362, 372-380`). Not every write path records its denials and
failures; the gaps are listed in section 10, convention 8. The live read policy lets every active staff
member read these rows, including money contexts (`20260715130100:661-662`); PENDING section 6 narrows it
(`20260916120000:290-298`).

---

## 2. Inventory: Attendance and clock (CURRENT)

| # | Entry point | Kind | Location |
|---|---|---|---|
| A1 | Attendance page loader | page (GET) | `attendance/page.tsx:42-134` |
| A2 | `listClockStaff` -> `list_clock_staff()` (roster) | reader + RPC | `attendance.ts:96-108`; `20260907160000:9-27` |
| A3 | `listOpenSessions` | reader | `attendance.ts:111-122` |
| A4 | `listLastClockOutToday` | reader | `attendance.ts:130-146` |
| A5 | `listTodaySessionStaff` | reader | `attendance.ts:666-681` |
| A6 | `clockInAction` -> `kioskClockIn` -> `kiosk_clock_in` | action + RPC | `hr/actions.ts:81-94`; `attendance.ts:154-207` |
| A7 | `clockOutAction` -> `kioskClockOut` -> `kiosk_clock_out` | action + RPC | `hr/actions.ts:96-105`; `attendance.ts:210-237` |
| A8 | `requireApprovedDevice` (internal device gate) | internal | `attendance.ts:28-48` |
| A9 | `listAttendancePage` | reader | `attendance.ts:596-659` |
| A10 | `loadAttendancePageAction` | action | `hr/actions.ts:57-64` |
| A11 | `uploadAttachmentAction` -> `uploadAttachment` (selfie attach) | action | `attachments/actions.ts:27-57`; `upload.ts:67-181` |
| A12 | `loadAttendanceSelfiesAction` -> `listAttendanceSelfiesFor` (signed-URL read) | action | `hr/actions.ts:45-50`; `attendance.ts:520-560` |
| A13 | `isAttendanceGatingActive` -> `attendance_gating_active()` | reader + RPC | `devices.ts:38-42` |
| A14 | `isThisDeviceApproved` / `verifyDeviceCookie` -> `verify_attendance_device()` | reader + RPC | `devices.ts:44-58` |
| A15 | `registerDeviceAction` -> `registerThisDevice` -> `register_attendance_device()` | action + RPC | `hr/actions.ts:108-119`; `devices.ts:65-97` |
| A16 | `revokeDeviceAction` -> `revokeDevice` -> `revoke_attendance_device()` | action + RPC | `hr/actions.ts:122-132`; `devices.ts:100-119` |
| A17 | `listDevices` | reader | `devices.ts:122-137` |
| A18 | Direct table writes to `attendance_records` through PostgREST (no application code) | table grant + RLS | `20260717120000:59-75` |

### A1. Attendance page loader

- INPUT: none (no search parameters).
- AUTHORIZATION: `canOpenPage('hr_attendance')` else 404 (`attendance/page.tsx:43`); `requireActiveStaff()` (`:44`).
  `canSeeTeam` is Super Admin or `canOpenPage('hr_review_attendance')` (`:49`); `canManage` is the role key `owner`
  or `selected_admin` (`:79`), not a permission.
- ACTION: one `Promise.all` of A9 (last 7 business days, all staff, page 1, 25 rows), A3, A4, A2, A5 (only when
  `canSeeTeam`), A13 and A14 (`:57-77`); then, for a Super Admin only, A17 as a separate serial read (`:80`).
- DATABASE EFFECT: reads only, all as the signed-in user under RLS.
- OUTPUT: rendered HTML. The blocked-device banner is informational; the clock buttons stay enabled
  (`:81, 91-105`).

### A2. Roster: `listClockStaff` -> `public.list_clock_staff()`

- INPUT: none.
- AUTHORIZATION: TypeScript NONE. RPC: SECURITY DEFINER, raises `insufficient_privilege` unless
  `app_private.has_permission('hr_attendance')` (`20260907160000:16-19`). EXECUTE revoked from PUBLIC and anon,
  granted to `authenticated` and `service_role` (`20260806260000:17, 33-34`).
- ACTION: read-only select of `id, full_name, role_key` where `is_active` and `role_key <> 'owner'`, ordered by
  name (`20260907160000:20-25`). It does not filter `is_demo`, while `kiosk_clock_in` refuses demo targets.
- DATABASE EFFECT: none.
- OUTPUT: `ClockStaff[]` `{ id, fullName, roleKey }` (`attendance.ts:88, 103-107`). Any error returns `[]`
  (`:102`), so a reviewer who holds `hr_review_attendance` but not `hr_attendance` gets an empty roster and an
  employee filter that matches nothing, with no message.

### A3. `listOpenSessions`

- INPUT: none.
- AUTHORIZATION: NONE in TypeScript. RLS `attendance_read`: own rows, Super Admin, or `hr_review_attendance`
  (`20260804140000:8-14`).
- ACTION: select `staff_profile_id, time_in` where `time_out is null` (`attendance.ts:113-116`), any work date.
- DATABASE EFFECT: none.
- OUTPUT: `Record<staffProfileId, timeIn>`. The error is ignored and yields `{}` (`:117-121`). For an operator
  without `hr_review_attendance`, RLS hides other members' open sessions, so the kiosk never offers Clock Out for
  them.

### A4. `listLastClockOutToday`

- INPUT: none. Business today is computed in TypeScript with a timezone literal (`attendance.ts:133`).
- AUTHORIZATION: NONE in TypeScript; RLS as A3.
- ACTION: select `staff_profile_id, time_out` where `work_date` is business today and `time_out` is not null,
  ascending by `time_out`, keeping the last per member (`:134-145`).
- DATABASE EFFECT: none.
- OUTPUT: `Record<staffProfileId, timeOut>`; error ignored, `{}`. The same RLS blindness hides "Continue Duty" for
  other members, which is harmless because the fallback Clock In calls the same RPC.

### A5. `listTodaySessionStaff`

- INPUT: none; business-day bounds from the business-today and day-bounds helpers (`attendance.ts:670-671`).
- AUTHORIZATION: NONE in TypeScript; called only when `canSeeTeam` (`attendance/page.tsx:74`); RLS as A3.
- ACTION: select `staff_profile_id` with `time_in` inside today's bounds (`attendance.ts:672-676`).
- DATABASE EFFECT: none.
- OUTPUT: `{ staffProfileId }[]`, error returns `[]` (`:677`); feeds the summary counts
  (`attendance-paging.ts:141-150`).

### A6. Clock in: `clockInAction` -> `kioskClockIn` -> `public.kiosk_clock_in(p_staff_id, p_device_id, p_note)`

- INPUT: FormData `staffProfileId` (empty returns "Select a team member first.", `attendance.ts:159`; no uuid format
  check in TypeScript) and optional `note` (read by the action, `hr/actions.ts:88`, never sent by the kiosk UI,
  `attendance-clock.tsx:145-146`; trimmed, blank becomes NULL, at most 500 characters by table check
  `20260717120000:28`). The device is not an input field: it comes from the httpOnly cookie (A8).
- AUTHORIZATION:
  - Action: NONE (`hr/actions.ts:81-94`).
  - Domain: `requireActiveStaff()` only (`attendance.ts:158`). There is no `hr_attendance` check, so any active
    account that can call the action can clock any member.
  - Device: A8 before the RPC (`attendance.ts:161-162`).
  - RPC: SECURITY DEFINER; `app_private.is_active_staff()` else "Not authorized: only active staff may operate the
    time clock." (`20260907120000:25-28`). Target must exist, be active and not demo (`:30-37`). A Super Admin
    target is accepted. The live body does not validate `p_device_id` (PENDING section 10 adds a check).
  - Grants: the live migration declares none; PENDING revokes PUBLIC and anon (`20260916120000:487-488`). An
    anonymous call is refused by the gate anyway, because `is_active_staff()` is false without a session.
- ACTION: RPC, then a best-effort read of the overtime columns (`attendance.ts:180-186`), then audit, then
  `revalidatePath('/admin/attendance')` (`hr/actions.ts:91`).
- DATABASE EFFECT: INSERT one `attendance_records` row with `staff_profile_id`, `note`, `device_id` (verified device
  or NULL when the gate is off) and `work_date` = the business-timezone date of `now()`; `time_in` defaults to
  `now()` and cannot be sent (`20260907120000:40-47`). The BEFORE INSERT trigger sets `is_overtime` and
  `overtime_amount` from the clock-in hour: at or after 22 gives a flat 300.00, otherwise false and 0
  (`20260722200000:26-49`; both values PROJECT-SPECIFIC). The partial unique index on open sessions turns a second clock-in into "That team member
  is already clocked in. Clock out first." (`20260717120000:43-45`; `20260907120000:48-49`). Audit
  `attendance.clock_in`, entity `attendance_record`, context `{ for_staff, overtime_amount? }`
  (`attendance.ts:188-196`).
- OUTPUT: `HrActionState` `{ error: null, success, recordId }` or `{ error, success: null }`. Error text is the SQL
  message with the prefix removed, or "Could not clock in." (`attendance.ts:170-176`). The success message quotes the
  overtime amount with a currency sign when the flag was read as set (`:198-206`). The overtime read-back runs under
  RLS: an operator without `hr_review_attendance` cannot read another member's new row, so the flag reads false, the
  plain message is shown and the audit context omits the amount even when the trigger set overtime (`:180-186`;
  `20260804140000:8-14`).
- REPEAT: RPC over POST, never retried; a manual repeat is refused by the unique index.

### A7. Clock out: `clockOutAction` -> `kioskClockOut` -> `public.kiosk_clock_out(p_staff_id)` (RECONSTRUCTED)

- INPUT: FormData `staffProfileId` (empty returns "Select a team member first.", `attendance.ts:212`).
- AUTHORIZATION: action NONE (`hr/actions.ts:96-105`); domain `requireActiveStaff()` (`attendance.ts:211`) and A8
  (`:214-215`). RPC body, security mode, messages and grants are RECONSTRUCTED; the only repository statement is a
  comment that the kiosk clock "already allows any active staff on the approved device" (`20260805160000:2-4`). It
  must bypass RLS to close another member's row, because `attendance_update` allows only own rows or a Super Admin
  (`20260717120000:65-72`).
- ACTION: RPC, audit, `revalidatePath('/admin/attendance')` (`hr/actions.ts:102`).
- DATABASE EFFECT: RECONSTRUCTED: sets `time_out` on the member's single open session. No device parameter exists,
  so the database cannot record or check a clock-out device (`attendance.ts:218-220`). Audit `attendance.clock_out`
  with `{ for_staff }` (`:230-235`).
- OUTPUT: `{ error: null, success: 'Clocked out.', recordId }` where `recordId` is the value the RPC returned
  (`attendance.ts:229-236`); on error the SQL message with the prefix removed, or "Could not clock out."
- REPEAT: never retried; a repeat with no open session fails in the RPC (message NEEDS VERIFICATION).

### A8. Device gate: `requireApprovedDevice(staffProfileId, event)` (internal)

- INPUT: the member id (used only for the audit row) and `'clock_in'` or `'clock_out'`.
- AUTHORIZATION: n/a (it is itself a gate).
- ACTION: if A13 returns false (no active device registered, or the gating read failed) the gate is off and
  `deviceId` is NULL, by design so nobody is locked out before registration (`attendance.ts:22-26, 32`); otherwise
  A14 must return a device id (`:33-34`).
- DATABASE EFFECT: on refusal, audit `attendance.blocked_device` with outcome `denied`, entity type
  `attendance_record` and the member's profile id as `entity_id` (`:36-42`).
- OUTPUT: `{ ok: true, deviceId }` or `{ ok: false, error }` with a fixed refusal message (text in section 12).
  Fail open: an error from the gating RPC reads as "gate off" (`devices.ts:40-41`). Fail closed: a missing cookie or a
  verification error reads as "not approved" (`devices.ts:45-53`). The check is enforced only in TypeScript in the
  live system (`20260907120000:14-54`).

### A9. `listAttendancePage(filters, page, pageSize)`

- INPUT: `AttendanceFilters { from, to, staffIds, status }` (`attendance-paging.ts:22-28`), `page` default 1,
  `pageSize` default 25 from `[25, 50, 100]` (`:14-16`). Types only, no runtime validation. An explicit
  empty `staffIds` returns an empty page without a query (`attendance.ts:604`).
- AUTHORIZATION: NONE of its own. RLS `attendance_read` (`20260804140000:8-14`); the employee name comes from a
  `staff_profiles` embed whose read policy is Super Admin or self (`20260821140000:21-22`).
- ACTION: (1) exact HEAD count with the filters (`attendance.ts:623-627`); (2) the rows, `time_in desc`, with
  `.range(offset, offset + pageSize - 1)` (`:629-634`); (3) a completion query for every session of the
  (member, work_date) pairs on the page, with no status or date filter (`:641-656`). Dates filter `time_in` between
  business-day bounds built with a fixed UTC offset (`attendance-paging.ts:72-80`), not `work_date`.
- DATABASE EFFECT: none.
- OUTPUT: `AttendancePage { rows, completion, total, page, pageSize }` (`attendance-paging.ts:31-39`); rows carry
  id, member id and name, `work_date`, `time_in`, `time_out`, `note`, `is_overtime`, `overtime_amount`
  (`attendance.ts:57-69, 562-563`) and never `edited_by`, `edit_reason` or `device_id`. `total` counts sessions,
  not days. Failures that look empty: a count error returns an empty page (`:626`); a row error returns no rows with
  the count (`:635`); a completion error is ignored, so a day can show a partial total (`:645-655`). For a reviewer who
  is not a Super Admin, other members' names are NULL.

### A10. `loadAttendancePageAction(filters, page, pageSize)`

- INPUT: as A9.
- AUTHORIZATION: `requirePermission('hr_attendance')` (`hr/actions.ts:62`); rows by RLS as A9.
- ACTION: A9.
- DATABASE EFFECT: none.
- OUTPUT: `AttendancePage`. `AuthorizationError` is not caught; the client catch shows "Could not load attendance
  records. Please retry." (`attendance-records.tsx:141-143`). A9's swallowed read errors do not reach that catch.

### A11. Selfie attach: `uploadAttachmentAction` -> `uploadAttachment`

- INPUT: FormData `relatedEntityType` (one of nine types including `attendance_record`, `upload.ts:32-42, 78-80`),
  `relatedEntityId` (uuid format, `:81-83`), `purpose` (`photo` for selfies, `:84-86`), `source` (`camera`,
  `:87-89`), `file` (non-empty jpeg, png or webp, at most 10 MiB, `:91-100`), `width` and `height` (positive or
  NULL, `attachments/actions.ts:15-20`), `fileName` (client-chosen; the kiosk sends `clock-in-selfie-<ms>.jpg` or
  `clock-out-selfie-<ms>.jpg`, `attendance-clock.tsx:158-165`).
- AUTHORIZATION: action NONE (transport only); domain `requireActiveStaff()` (`upload.ts:72`). NONE of: record exists,
  record belongs to the operator's clock action, operator holds `hr_attendance`. RLS insert: active staff and
  `uploaded_by = current_staff_id()` (`20260716300000:137-142`); storage insert for any active staff in the bucket
  (`:163-165`).
- ACTION: storage upload to the private bucket at `attendance_record/<recordId>/<uuid>.<ext>` with `upsert: false`
  (`upload.ts:107-112`); INSERT metadata (`:130-148`); mint a 300-second signed URL (`:166-170`).
- DATABASE EFFECT: one storage object and one `attachments` row. Audit `attachment.upload`: failed on a storage error
  (`:119-126`), failed with `orphanPath` when the object uploaded but the row did not (`:155-162`), succeeded
  otherwise (`:172-178`). No scheduled cleanup of orphans exists.
- OUTPUT: `{ error: null, success: 'Photo attached.', attachment: { id, storagePath, signedUrl } }` or
  `{ error, success: null, attachment: null }`. The kiosk calls it only after a successful clock action and appends
  a failure softly to the clock message, so a failed upload never undoes the clock event
  (`attendance-clock.tsx:157-173`). The camera step depends on a `Permissions-Policy` header that allows the camera
  for the app origin (`next.config.ts:45-48`; `UI_UX.md` section 1.11).
- REPEAT: never retried; a repeat adds another row, and which upload the reader shows for that slot is not
  deterministic (A12).

### A12. Selfie read: `loadAttendanceSelfiesAction(recordIds)` -> `listAttendanceSelfiesFor`

- INPUT: `string[]` of record ids; blanks dropped and duplicates removed; empty returns `{}` (`attendance.ts:523-524`).
  No maximum count.
- AUTHORIZATION: `requirePermission('hr_review_attendance')` (`hr/actions.ts:48`). The data layer is wider:
  `attachments_read` and the storage read policy allow any active staff member (`20260716300000:127-129, 159-161`).
- ACTION: select `attachments` of type `attendance_record` for the ids, ascending by `uploaded_at`
  (`attendance.ts:526-531`); one `createSignedUrl(path, 300, { download: file_name })` per row (`:544-550`).
- DATABASE EFFECT: none.
- OUTPUT: `Record<recordId, { inUrl, outUrl }>` (`attendance.ts:463-466`). In versus out is decided by the substring
  `clock-out` in the stored file name (`:553`). When a slot has more than one upload, the photo returned is not
  deterministic: rows are read in `uploaded_at` order (`:531`), but each slot is assigned only after an awaited
  `createSignedUrl` call inside `Promise.all` (`:542-557`), so the upload whose signing call resolves last wins, which is
  not necessarily the latest upload.
  A query error returns `{}` (`:533`); a signing failure leaves that slot NULL (`:549-550`). The client has no catch
  (`review-attendance-view.tsx:114-116`), so a thrown authorization error shows a modal without photos and no message.

### A13. `isAttendanceGatingActive` -> `public.attendance_gating_active()`

- INPUT: none.
- AUTHORIZATION: NONE in TypeScript; the RPC has no internal gate; EXECUTE for `authenticated` only
  (`20260722170000:8-9`).
- ACTION: `exists (select 1 from attendance_devices where is_active)` (`20260722150000:66-70`).
- DATABASE EFFECT: none.
- OUTPUT: `response.data === true` (`devices.ts:40-41`); any error returns false, which switches the device gate off.

### A14. `isThisDeviceApproved` / `verifyDeviceCookie` -> `public.verify_attendance_device(p_token)`

- INPUT: the raw token from the httpOnly device cookie, read on the server (`devices.ts:46`); no cookie returns NULL
  without a query (`:47`).
- AUTHORIZATION: NONE in TypeScript; no internal RPC gate; EXECUTE for `authenticated` only (`20260722170000:11-12`).
- ACTION: returns the id of an active device whose `token_hash` equals the sha256 hex of the token
  (`20260722150000:58-64`). It checks `is_active` only.
- DATABASE EFFECT: none.
- OUTPUT: device id or NULL (`devices.ts:50-52`); `isThisDeviceApproved` returns a boolean (`:56-58`).

### A15. Register device: `registerDeviceAction` -> `registerThisDevice` -> `public.register_attendance_device(p_label, p_token)`

- INPUT: FormData `label` (optional; blank becomes the SQL default label, text in section 12).
- AUTHORIZATION: action NONE; domain `requireOwner()` with the message returned (`devices.ts:68-73`); RPC selects an
  active profile with role key `owner` for `auth.uid()` else "Not authorized" (`20260722150000:46-48`); EXECUTE
  revoked from PUBLIC and anon, granted to `authenticated` (`20260722170000:14-15`).
- ACTION: mint `randomBytes(32)` as hex (`devices.ts:75`); RPC; set the device cookie with `httpOnly`, `secure`,
  `sameSite: 'lax'`, `path: '/'` and a 365-day max age (`:83-89`; cookie name in section 12); audit; revalidate
  `/admin/attendance` (`hr/actions.ts:114`).
- DATABASE EFFECT: UPDATE every active device to `is_active = false, revoked_at = now()`, then INSERT label, sha256
  hex of the token and `registered_by` (`20260722150000:49-53`). Audit `attendance.device_register` with the label
  (`devices.ts:91-95`). Only the hash is stored; the raw token exists only in the cookie.
- OUTPUT: `{ error: null, success }` or `{ error, success: null }`. Any RPC error becomes "The device could not be
  registered." (`devices.ts:81`), which hides the database message.
- REPEAT: a second call revokes the device just registered and issues a new token to the same browser.

### A16. Revoke device: `revokeDeviceAction` -> `revokeDevice` -> `public.revoke_attendance_device(p_id)`

- INPUT: FormData `deviceId` (missing returns "Missing device.", `hr/actions.ts:126-127`); no uuid check.
- AUTHORIZATION: action NONE; domain `requireOwner()` (`devices.ts:103-108`); RPC Super Admin check
  (`20260722150000:75-77`); grants as A15 (`20260722170000:17-18`).
- ACTION: RPC, audit, revalidate (`hr/actions.ts:128-131`).
- DATABASE EFFECT: UPDATE `is_active = false, revoked_at = now()` where `id = p_id` (`20260722150000:78`). An unknown
  id updates nothing and raises nothing, and the app still reports success and writes a succeeded
  `attendance.device_revoke` event (`devices.ts:110-118`). Revoking the last active device switches the gate off.
- OUTPUT: success message or error; an RPC error becomes "The device could not be revoked." (`devices.ts:111`). The
  UI revokes on one tap without confirmation (`device-manager.tsx:136-146`).

### A17. `listDevices`

- INPUT: none.
- AUTHORIZATION: NONE in TypeScript; RLS read policy for an active Super Admin (`20260722180000:5-14`); the page
  calls it only for a Super Admin (`attendance/page.tsx:80`).
- ACTION: select `id, label, is_active, created_at, revoked_at`, newest first (`devices.ts:124-127`).
- DATABASE EFFECT: none.
- OUTPUT: `DeviceRow[]` (`devices.ts:29-35`); `token_hash` is never selected; an error returns `[]` (`:129`).

### A18. Direct table writes to `attendance_records` through PostgREST (no application code)

This entry point has no server action: it is the table itself, reachable by any signed-in client with the public API
key and a session token. The application never uses it (the only direct writers, `clockIn` and `clockOut`, are dead
code, section 6), but the grants and policies leave it open.

- INPUT: a PostgREST INSERT or PATCH on `attendance_records` with any column values the table accepts.
- AUTHORIZATION:
  - Grant: `select, insert, update` to `authenticated`, no DELETE (`20260717120000:75`).
  - RLS `attendance_insert`: `staff_profile_id = current_staff_id()` (`20260717120000:59-61`).
  - RLS `attendance_update`: own rows or a Super Admin, in both USING and WITH CHECK, not column-restricted
    (`20260717120000:65-72`).
  - No later repository migration changes these two policies or the grant, and PENDING does not either. The
    repository pgTAP suite asserts that INSERT and UPDATE stay granted (`supabase/tests/26_hr_attendance.test.sql:47-49`).
  - `current_staff_id()` ignores `is_active` (`20260715130000:28-39`), so the self branches also admit a deactivated
    profile whose token has not expired.
  - NONE of: `hr_attendance`, the device gate, the kiosk roster, the selfie, a correction reason.
- ACTION: none in the application.
- DATABASE EFFECT: a member can insert a session for themself with any `time_in`, `time_out`, `work_date`, `note` or
  `device_id`, and can update any column of their own rows, including `time_in`, `time_out`, `work_date`,
  `edited_by`, `edit_reason`, `is_overtime` and `overtime_amount`. Only the table checks, the foreign keys and the
  one-open-session index still apply (`20260717120000:28, 32, 43-45`). The BEFORE INSERT trigger recomputes the two
  night columns from the supplied `time_in` on insert only (`20260722200000:46-49`), so an update can set them to
  anything. A Super Admin can update any member's row the same way, skipping the reason and the not-in-the-future
  check of the correction function (`20260907130000:35-53`). No audit row is written. `report_payroll` counts every
  completed row by `work_date` (`20260907160000:42-44`), so such a write feeds pay directly.
- OUTPUT: the raw PostgREST response; no typed result.
- STATUS: CURRENT for the repository. Whether the live grants and policies still allow it NEEDS VERIFICATION
  (section 13, row 12). The fix is RECOMMENDED TEMPLATE IMPROVEMENT 24 (section 11) and contract rule 11 (section 9.1).

---

## 3. Inventory: Review Attendance (CURRENT)

| # | Entry point | Kind | Location |
|---|---|---|---|
| R1 | Review Attendance page loader | page (GET) | `review/page.tsx:21-51` |
| R2 | `loadReviewAttendancePageAction` | action | `hr/actions.ts:72-79` |
| R3 | `correctAttendanceClockOutAction` -> `correctAttendanceClockOut` -> `correct_attendance_clock_out` | action + RPC | `hr/actions.ts:165-183` |
| R4 | `deleteAttendanceRecordAction` -> `deleteAttendanceRecord` -> `delete_attendance_record` | action + RPC | `hr/actions.ts:139-157` |
| R5 | `requestAttendanceDeletionAction` -> approval request, executed later | action | `hr/actions.ts:190-204` |

The selfie read used by the Details modal is A12. There is no approval, sign-off, flag or period-lock endpoint for
attendance.

### R1. Review Attendance page loader

- INPUT: none.
- AUTHORIZATION: `canOpenPage('hr_review_attendance')` else 404 (`review/page.tsx:22`); `requireActiveStaff()`
  (`:23`). `canManage` is the role key `owner` or `selected_admin` (`:35-36`), not a permission.
- ACTION: `Promise.all` of A9 (last 7 business days, all, page 1, 25) and A2 (`:25-33`).
- DATABASE EFFECT: reads only under RLS.
- OUTPUT: rendered HTML. Because A2 needs `hr_attendance`, a reviewer without it has no employee filter options.

### R2. `loadReviewAttendancePageAction(filters, page, pageSize)`

- INPUT: as A9, unvalidated at runtime.
- AUTHORIZATION: `requirePermission('hr_review_attendance')` (`hr/actions.ts:77`); rows by RLS (the same key opens
  every row, `20260804140000:13`).
- ACTION: A9. DATABASE EFFECT: none.
- OUTPUT: `AttendancePage`; a thrown error reaches the client catch (`review-attendance-view.tsx:155-157`).

### R3. Correct clock-out: `correctAttendanceClockOutAction` -> `correctAttendanceClockOut` -> `public.correct_attendance_clock_out(p_record_id, p_time_out, p_reason)`

- INPUT: FormData `recordId`, `timeOut` and `reason`.
  - The browser builds `timeOut` from a minute-precision `datetime-local` value in the browser timezone
    (`review-attendance-view.tsx:674-679, 713`).
  - Action: each must be a non-empty string (`hr/actions.ts:172-174`).
  - Domain: trimmed reason non-empty; `timeOut` parses as a date and is re-serialised to ISO (`attendance.ts:421-427`).
  - SQL: reason non-blank; record exists; value not NULL; not before `time_in`; not after `now()`
    (`20260907130000:35-53`).
  - Not validated anywhere: overlap with the member's adjacent sessions, maximum session length, same work date, a
    changed value, an already-issued payslip.
- AUTHORIZATION:
  - Action: NONE (it delegates).
  - Domain: `requireOwnerOrAdmin()`, denial audited (`attendance.ts:405-419`).
  - RPC: SECURITY DEFINER; `v_role is null or v_role not in ('owner', 'selected_admin')` raises
    `insufficient_privilege` (`20260907130000:29-33`). Not tied to `hr_review_attendance`. The live
    `current_staff_role()` ignores `is_active` (`20260715130000:47-58`), so a deactivated Super Admin or Admin token
    passes the SQL gate; PENDING section 1 fixes that. EXECUTE revoked from anon and PUBLIC, granted to
    `authenticated` and `service_role` (`:65-68`).
- ACTION: RPC, audit, then `revalidatePath` for review, attendance and payroll (`hr/actions.ts:179-181`).
- DATABASE EFFECT: UPDATE in place `time_out = p_time_out`, `edited_by = current_staff_id()`, `edit_reason`
  (`20260907130000:55-59`); returns the old `time_out` (`:61`). No row lock, no `edited_at`, no SQL audit row. The
  session overtime columns are not recomputed (INSERT-only trigger), while payroll `days_worked` and `night_shifts`
  can change on the next read (`PAYROLL.md` sections 3 and 4). App audit `attendance.clock_out_corrected`: succeeded with
  `{ old_time_out, new_time_out, reason }`, or denied or failed with the reason (`attendance.ts:408-456`). The old
  value exists only in that best-effort event.
- OUTPUT: `{ error: null, success: 'Clock-out corrected.' }` or the SQL message. The UI seeds the input from the
  existing clock-out, else the clock-in, truncated to the minute: an unchanged save on an open session is normally
  refused with "Clock-out cannot be before clock-in." (the clock-in carries seconds), and on a completed session it
  silently rewrites `time_out` to the start of its minute. The open Details modal keeps the old times until reopened (NEEDS VERIFICATION
  in a browser).
- REPEAT: never retried; a manual repeat re-applies and audits again; concurrent corrections are last-write-wins and
  the audited old value can be stale.

### R4. Delete: `deleteAttendanceRecordAction` -> `deleteAttendanceRecord` -> `public.delete_attendance_record(p_record_id)` (RECONSTRUCTED)

- INPUT: FormData `recordId` (required) and `confirm`, which must equal `DELETE` on the server
  (`hr/actions.ts:143-148`). No reason field.
- AUTHORIZATION:
  - Action: the typed phrase only.
  - Domain: `requireOwnerOrAdmin()`, denial audited (`attendance.ts:351-365`).
  - RPC: RECONSTRUCTED. Comments state a SQL check for role key `owner` or `selected_admin` (`guard.ts:316-324`;
    `attendance.ts:341-344`). It must run with elevated rights, because `authenticated` has no DELETE grant on the
    table (`20260717120000:75`). NULL-role handling and grants NEEDS VERIFICATION.
- ACTION: RPC, audit, `revalidatePath` for attendance, review and payroll (`hr/actions.ts:153-155`).
- DATABASE EFFECT: hard DELETE of one `attendance_records` row (RECONSTRUCTED). Selfie rows and objects stay
  (`attendance.ts:345-346`). Audit `attendance.delete` with `{ permanent: true }` on success, or denied or failed
  (`:354-388`); the deleted values are kept nowhere. Neither the TypeScript path nor the UI checks whether the session
  is open or lies in a period with an issued payslip (`attendance.ts:348-390`; `hr/actions.ts:139-157`). Whether the
  live function refuses either case NEEDS VERIFICATION (section 13, row 2), because its body is not in the repository.
- OUTPUT: `{ error: null, success: 'Attendance record permanently deleted.' }` or the error text.
- UI: the Review page shows a direct Delete to Super Admin and Admin (`review-attendance-view.tsx:624-629, 807-894`);
  the Attendance page shows the Admin R5 instead (`attendance-day-details.tsx:138-150`).
- REPEAT: never retried; a repeat targets a row that no longer exists (RPC response NEEDS VERIFICATION).

### R5. Request deletion: `requestAttendanceDeletionAction(recordId, label, reason)`

- INPUT: plain arguments, not FormData. `label` is built in the browser from the member name and work date
  (`attendance-day-details.tsx:141`). Validation: record id present and reason non-blank
  (`request-deletion.ts:22-24`). Stored reason text: `Delete attendance record (<label>): <reason>`
  (`hr/actions.ts:199`; `request-deletion.ts:25`).
- AUTHORIZATION: action has no role check; `requirePermission('initiate_high_risk_action')`, denial audited
  (`service.ts:500-515`); RLS insert requires that key or a Super Admin, plus `requested_by = current_staff_id()`
  (`20260715130100:566-571`). The key is not in the Manage Access catalogue and no migration grants it. The only
  grant path in the repository is a legacy Super Admin staff console with no navigation entry, whose select offers every
  known key (`src/components/admin/staff-console.tsx:173-195`; `src/lib/authz/account-management.ts:35-49`). The path
  therefore fails on a fresh install until a Super Admin grants the key on that page (`PERMISSIONS.md` section 3.2,
  row 8). Whether a live grant exists NEEDS VERIFICATION (section 13, row 9).
- ACTION: `requestOwnerDeletion` -> `requestOwnerApproval` (`request-deletion.ts:15-28`; `service.ts:493-556`);
  `revalidatePath('/admin/attendance')` on success (`hr/actions.ts:202`).
- DATABASE EFFECT: INSERT `owner_approval_requests` with kind `attendance_delete`, status `pending_owner_approval`,
  entity `attendance_record` (`service.ts:523-535`); audit `owner_approval.request` (`:541-553`). Nothing is
  deleted. Request rows, whose reason carries a name and a date, are readable by every active staff member
  (`20260715130100:560-561`). Execution is separate and Super Admin only: `/approvals` is Super Admin only
  (`src/app/(app)/approvals/page.tsx:22-24`); `decideApprovalAction` records the decision
  (`fulfillment/actions.ts:211-241`); `executeApprovalAction` -> `executeOwnerApproval` re-reads the request,
  requires `approved` and not executed, calls `delete_attendance_record`, stamps `executed_at`, and audits
  `owner_approval.execute` rather than `attendance.delete` (`service.ts:648-697, 735-739, 810-833`). Execution revalidates
  `/orders` only (`fulfillment/actions.ts:253`).
- OUTPUT: `{ ok: true }` or `{ ok: false, error }`; an insert error becomes "The approval request could not be
  created." (`service.ts:537-539`).
- REPEAT: the TypeScript path has no duplicate check, so a repeat creates a second pending request.

---

## 4. Inventory: Payroll (CURRENT)

| # | Entry point | Kind | Location |
|---|---|---|---|
| P1 | Payroll page loader | page (GET) | `payroll/page.tsx:23-61` |
| P2 | `getPayroll` -> `report_payroll(p_from, p_to)` | reader + RPC | `payroll.ts:38-68`; `20260907160000:29-102` |
| P3 | `listPayslipsForPeriod` | reader | `payslip.ts:61-82` |
| P4 | `listEmployeeRates` | reader | `rate.ts:128-191` |
| P5 | `setHourlyRateAction` -> `setSalaryRate` -> `set_staff_salary_rate` | action + RPC | `hr/actions.ts:210-228`; `rate.ts:201-244` |
| P6 | `generatePayslipAction` -> `generate_payslip_snapshot` | action + RPC | `payslip-actions.ts:23-97` |
| P7 | `markPayslipPaidAction` | action (direct UPDATE) | `payslip-actions.ts:99-154` |
| P8 | PDF, print and summary helpers | client only | `payslip-pdf.ts:51-169`; `payroll-summary-button.tsx:41-182` |

Formulas are owned by `PAYROLL.md`; this section records only what each entry point receives, checks, writes and
returns. There is no payroll approval, finalization or period-lock endpoint; `payroll_snapshots.approved_by` is never
written (`20260722210000:32`).

### P1. Payroll page loader

- INPUT: search parameters `from` and `to`, unvalidated strings, defaulting to the first day of the business month and
  business today (`payroll/page.tsx:33-34`).
- AUTHORIZATION: `canOpenPage('hr_payroll')` else 404 (`:30`); `requireActiveStaff()` (`:37`). `canManagePayroll`
  is the role key `owner` or `selected_admin` (`:43`) and also decides `canManageRates` (`:57`).
- ACTION: `Promise.all` of `requireActiveStaff`, P2 and P3 (`:36-40`); P4 only when `canManagePayroll` (`:44`).
- DATABASE EFFECT: reads only.
- OUTPUT: rendered HTML with payroll rows, payslips and rates.

### P2. `getPayroll(from, to)` -> `public.report_payroll(p_from date, p_to date)`

- INPUT: two strings, not validated in TypeScript. A malformed date makes the RPC fail; `from` after `to` returns
  every eligible employee with zero totals, not an error.
- AUTHORIZATION: TypeScript NONE (page gate only). The function is SECURITY INVOKER (no security clause,
  `20260907160000:31-33`) with the row filter `sp.id = app_private.current_staff_id() or app_private.is_owner()`
  (`:100`), so an Admin holding `hr_payroll` sees only their own row. Underlying RLS applies to `attendance_records`,
  `staff_profiles` and `staff_salary_rates` (RECONSTRUCTED). Live EXECUTE grants on `report_payroll` and on
  `app_private.night_ot_bonus()` NEEDS VERIFICATION.
- ACTION: one RPC call; `num()` maps hours and counts, money stays text (`payroll.ts:33-65`).
- DATABASE EFFECT: none. Rows exclude inactive, demo and Super Admin (role key owner) profiles (`20260907160000:97-99`).
  Pay is `round(days_worked x daily_rate + night_shifts x app_private.night_ot_bonus(), 2)`, NULL without a rate,
  where `night_shifts` counts distinct work dates with a clock-out at or after 22:00 business time (`:41, 53-55,
  86-93`; see `PAYROLL.md` sections 3, 4 and 6).
- OUTPUT: `{ ok: true, rows: PayrollRow[] }` (`payroll.ts:11-29`) or `{ ok: false }` with no reason (`:42`). The page
  renders a read error ("Payroll unavailable", `attendance-view.tsx:108-112`) for `ok: false`. This is the only
  reader in scope that keeps a failure distinct from an empty result.

### P3. `listPayslipsForPeriod(from, to)`

- INPUT: `from` and `to`, matched exactly against `payroll_start_date` and `payroll_end_date` (`payslip.ts:69-70`).
- AUTHORIZATION: NONE in TypeScript; RLS `payroll_snapshots_read`: own snapshots or a Super Admin
  (`20260722210000:51-55`).
- ACTION: select snapshot columns with the staff name embedded, newest `generated_at` first (`payslip.ts:52-53, 66-71`).
- DATABASE EFFECT: none.
- OUTPUT: `Record<employeeId, PayslipSnapshot>` keeping the first (newest) row per employee (`:75-81`;
  `payslip-types.ts:10-35`). An error returns `{}` (`:73`), which the table shows as "no payslip" for everyone. A
  payslip for a different range never appears; a newer pending regeneration hides an older paid one.

### P4. `listEmployeeRates()`

- INPUT: none.
- AUTHORIZATION: NONE in TypeScript (the page calls it for Super Admin and Admin, `payroll/page.tsx:44`). RLS on
  `staff_profiles` is Super Admin or self (`20260821140000:21-22`), so an Admin's list contains only themself; the
  `staff_salary_rates` policy is RECONSTRUCTED.
- ACTION: two parallel selects: active, non-demo profiles whose role key is not `owner` (`rate.ts:132-138`) and every rate row ordered by
  `effective_date desc, created_at desc` (`:139-143`); the first row per person is taken as current (`:157-170`).
- DATABASE EFFECT: none.
- OUTPUT: `EmployeeRateRow[]` (`rate.ts:111-121`; the field `hourlyRate` holds the daily rate). Both query errors are
  ignored: a profile error gives `[]`, a rate error shows everyone without a rate. There is no
  `effective_date <= today` filter, so a future-dated rate is shown as current.

### P5. Set rate: `setHourlyRateAction` -> `setSalaryRate` -> `public.set_staff_salary_rate(p_staff, p_daily_rate, p_frequency, p_effective)` (RECONSTRUCTED)

- INPUT: FormData `staffProfileId` (required, `hr/actions.ts:214-217`); `rate`: one to ten digits, optionally a dot
  and one or two digits (`rate.ts:209-212`); `frequency`: `weekly`, `bi_weekly` or `monthly`, default `weekly`
  (`:213-216`); `effectiveDate`: required, shape `YYYY-MM-DD` only (`:217-220`). The rate is sent as text (`:225`).
- AUTHORIZATION: NONE in the action and NONE in `setSalaryRate` (`hr/actions.ts:210-228`; `rate.ts:201-231`). The
  comments disagree with the code and with each other: "Super Admin only, enforced again in the database function"
  (`rate.ts:193-199`) and "Owner-only, the domain module re-checks" (`hr/actions.ts:206-209`). The RPC gate is
  RECONSTRUCTED (NEEDS VERIFICATION). The UI offers the editor to a Super Admin inline and to Super Admin and Admin
  on the Employee Rates tab.
- ACTION: RPC, audit on success only, `revalidatePath` for attendance and payroll (`hr/actions.ts:225-226`).
- DATABASE EFFECT: RECONSTRUCTED: writes one `staff_salary_rates` row; the only repository source for "append, never
  rewrite" is the docstring (`rate.ts:193-199`). Audit `payroll.set_salary_rate` with
  `{ daily_rate, pay_frequency, effective_date }` (`rate.ts:233-238`); failures are not audited (`:229-231`).
- OUTPUT: `{ error: null, success }` with a message that quotes the amount and a currency sign (`rate.ts:240-243`), or
  the SQL message with the prefix removed (`:229-231`).
- REPEAT: never retried. If the docstring is accurate, a manual repeat appends an identical row and both readers
  tie-break on `created_at` (`rate.ts:139-143`; `20260907160000:62-65`); whether the live function instead upserts on member and effective date
  NEEDS VERIFICATION (section 13, row 3). The static authorization sweep cannot see this RPC-only writer.

### P6. Generate payslip: `generatePayslipAction` -> `public.generate_payslip_snapshot(p_employee, p_from, p_to, p_deductions)`

- INPUT: FormData `employeeId`, `from`, `to` (presence only, `payslip-actions.ts:41-47`) and optional `deductions`:
  digits, optionally a dot and one or two digits, default `'0'`, sent as text (`:48-55, 62`). No date-format or
  order check in TypeScript; the table check requires `payroll_end_date >= payroll_start_date` (`20260722210000:35`).
- AUTHORIZATION: `requireOwner()`, message returned (`payslip-actions.ts:27-34`); RLS insert Super Admin only
  (`20260722210000:58-60`). The repository function is SECURITY INVOKER with EXECUTE for `authenticated`
  (`:83, 134-135`); the live body is RECONSTRUCTED because the repository body reads `hourly_rate` from
  `report_payroll`, which the current function no longer returns (`:97` versus `20260907160000:30`).
- ACTION: RPC; read the inserted row back with the staff name (`payslip-actions.ts:75-86`); audit; revalidate
  `/admin/payroll` (`:95`).
- DATABASE EFFECT: INSERT one `payroll_snapshots` row, `payment_status` default `pending`, `generated_by =
  current_staff_id()` (repository body `20260722210000:116-128`). The row is a frozen copy: later rate or attendance
  changes do not alter it (`20260722210000:38-39`). The repository body raises "No payroll row for this
  employee in the selected period." when the employee is not in the caller's `report_payroll` (`:102-104`) and clamps
  deductions to zero or more (`:93`). No uniqueness per employee and period (`:41-44`); no `net_salary >= 0` check
  (`:28`). Audit `payroll.payslip_generated` with `{ from, to, net_salary }` (`payslip-actions.ts:88-93`).
- OUTPUT: `{ error: null, success: 'Payslip generated.', snapshot }` or `{ error }` with the raw RPC message or "The
  payslip could not be generated." (`:65-71`). If the read-back fails, the RPC row is mapped without a name
  (`:84-86`). The Generate form is also shown to an Admin, whom the server refuses.
- REPEAT: never retried; a manual repeat inserts another snapshot and P3 shows the newest.

### P7. Mark paid: `markPayslipPaidAction` (direct UPDATE, no RPC)

- INPUT: FormData `snapshotId` (required, `payslip-actions.ts:117-119`) and optional `paymentDate`, unvalidated,
  defaulting to business today (`:116`); the client never sends it (`payslip-button.tsx:200-202`).
- AUTHORIZATION: `requireOwnerOrAdmin()` (`payslip-actions.ts:104-112`). RLS update in the repository is Super Admin
  only (`20260722210000:62-65`), so for an Admin the update matches no row: a TypeScript versus RLS conflict. The live
  policy NEEDS VERIFICATION. The Super Admin policy is not column-restricted.
- ACTION: one UPDATE, audit on success, revalidate `/admin/payroll` (`:152`).
- DATABASE EFFECT: `payment_status = 'paid'`, `payment_date`, `paid_at` (server clock), `paid_by` (actor profile id)
  where `id` matches and `payment_status = 'pending'` (`:124-135`); `paid_at` and `paid_by` are RECONSTRUCTED
  columns. Audit `payroll.payslip_marked_paid` with `{ payment_date, paid_by }` (`:145-150`). No unmark or void path.
- OUTPUT: `{ error: null, success: 'Payslip marked as paid.', snapshot: null }`. Every failure (already paid, row not
  visible, refused by RLS, malformed date, unknown id) becomes "Could not mark the payslip as paid. It may already be
  paid." (`:137-143`). On success the client optimistically sets the dialog's status to paid and its date to a business
  date computed in the browser, then calls `router.refresh()`, which re-reads the page data while the open dialog keeps
  its local copy (`payslip-button.tsx:207-212`).
- REPEAT: the pending guard makes a repeat change nothing and return the same message. The UI has no confirmation.

### P8. PDF, print and summary helpers (client only, not server endpoints)

- `downloadPayslipPdf(snap)` builds the PDF in the browser from an already-read `PayslipSnapshot`; it has no
  authorization of its own (`payslip-pdf.ts:51-169`; file name pattern in section 12).
- Print uses `window.print()` with print-isolation CSS (`payslip-button.tsx:24-36, 231-233`).
- `PayrollSummaryButton` is rendered only for a Super Admin (`attendance-view.tsx:98-105`). Its total adds each
  row's snapshot net or computed salary in integer cents; the minor-unit parser treats a non-digit whole part as zero
  but keeps the fraction, so a negative net adds a small positive amount (`payroll-summary-button.tsx:31-36, 54-60`).
- None of these calls the server. `UI_UX.md` section 4 covers them; they are listed so adopters do not look for
  server routes.

---

## 5. Inventory: Export (CURRENT)

### X1. `POST /api/export/all` (attendance and payroll sheets)

- INPUT: JSON `{ from?, to?, applyRange?, sections? }`. An unparseable body becomes `{}` (`route.ts:33-37`); unknown
  section keys are dropped and an empty result means all sections (`:39-45`); dates must have the shape `YYYY-MM-DD`;
  the range applies only when `applyRange === true` and both dates are valid (`:47-51`).
- AUTHORIZATION: `requireOwnerOrAdmin()`, else 403 JSON `{ error }` (`route.ts:16-25`). The `export_data_reports` key
  is not checked. `attendance` and `payroll` are not sensitive sections (`sections.ts:21-22`); sensitive sheets, such
  as `team` with salary rates, are built only for a Super Admin (`sections.ts:24`; `data-export.ts:138-139`). Rows are
  RLS-scoped.
- ACTION, attendance sheet (`data-export.ts:522-561`): select `work_date, time_in, time_out, is_overtime,
  overtime_amount` with the member name, ordered `time_in desc, id desc`; the range filters `work_date` with
  `gte from` and `lte '<to> 23:59:59'` (`:116-127`); read 1,000 rows per request up to 200,000 (`:94-114`). A read
  error throws, so the whole export fails. Columns: Employee, Date, Time In, Time Out, Overtime, Overtime Amount. An
  Admin without `hr_review_attendance` exports only their own rows; other names show a dash for anyone who is not a
  Super Admin.
- ACTION, payroll sheet (`data-export.ts:563-602`): `report_payroll` with the range, or 2000-01-01 to 2100-01-01
  when no range applies (`:565-568`). The RPC error is not checked: a failed read yields an empty sheet inside a
  successful export. An Admin gets only their own row.
- DATABASE EFFECT: read-only. Audit `data.export_all` with `{ sections, applied_range, from, to, bytes }`, or failed
  with the reason (`route.ts:62-72, 85-90`).
- OUTPUT: 200 with an xlsx body, `Content-Disposition: attachment` and `Cache-Control: no-store` (`route.ts:74-83`;
  file name in section 12), or 500 JSON "The export could not be generated. Please try again." (`:91-94`).
- Notes: the screen filters `time_in` inside business-day bounds while the export filters `work_date`.
  Timestamps are written as JavaScript `Date` values (`data-export.ts:45-49`); the timezone a spreadsheet shows for
  them NEEDS VERIFICATION.

---

## 6. Dead and unused exports (do not port)

A repository-wide search finds no caller in `src/` or `tests/` for these exports.

| Export | Location | What it does | Why not to port |
|---|---|---|---|
| `clockIn(note)` | `attendance.ts:252-304` | Super Admin clocks themself in by direct INSERT | Superseded by the kiosk; bypasses the definer RPC; relies on the column default for `work_date` |
| `clockOut()` | `attendance.ts:306-339` | Super Admin clocks themself out by direct UPDATE | Same; Super Admins are excluded from timekeeping |
| `getOpenSession()` | `attendance.ts:240-250` | caller's own open session | No screen uses it |
| `listAttendance(limit)` | `attendance.ts:687-700` | newest 100 sessions | Replaced by server paging (A9) |
| `listAttendanceSelfies()` | `attendance.ts:477-512` | signs a URL for every selfie ever stored | Replaced by the bounded A12; unbounded storage calls |
| `setHourlyRate(...)` | `rate.ts:31-109` | legacy hourly rate via `set_staff_hourly_rate` (RECONSTRUCTED) or a clear | Legacy pay basis; the only reason the sweep scans `rate.ts` |

---

## 7. Failures that look like empty results (CURRENT)

| Entry point | Failure | What the caller sees | Evidence |
|---|---|---|---|
| A2 roster | RPC error or missing `hr_attendance` | empty roster, filter matches nothing | `attendance.ts:102` |
| A3, A4 kiosk status | read error; RLS hides other members | no Clock Out or Continue Duty for them | `attendance.ts:113-145` |
| A5 today summary | read error | zero counts | `attendance.ts:677` |
| A9 page reader | count error; row error; completion error | empty state; no rows; partial day totals | `attendance.ts:626, 635, 645-655` |
| A9 names | profile RLS for non-Super-Admin reviewers | NULL names shown as a dash | `attendance.ts:562-563`; `20260821140000:21-22` |
| A12 selfies | query error; signing error; thrown guard | no photos, no message | `attendance.ts:533, 549-550`; `review-attendance-view.tsx:114-116` |
| A13 gating | RPC error | device gate off (fail open) | `devices.ts:40-41` |
| A16 revoke | unknown id | success message and succeeded audit | `devices.ts:110-118` |
| A17 devices | read error | empty device list | `devices.ts:129` |
| P3 payslips | read error | every row shows no payslip | `payslip.ts:73` |
| P4 rates | either read error | empty list or everyone without a rate | `rate.ts:131-144` |
| P7 mark paid | any error | one generic "may already be paid" message | `payslip-actions.ts:137-143` |
| X1 payroll sheet | RPC error | empty sheet in a successful file | `data-export.ts:565-573` |
| audit writer | insert error | action succeeds without an audit row | `log.ts:64-78` |

---

## 8. PENDING (not live) changes that touch this surface

| Migration section | Change | Effect on the entry points |
|---|---|---|
| `20260916120000` section 1 (`:46-57`) | `current_staff_role()` returns `'inactive'` for a deactivated profile | R3 refuses deactivated Super Admin and Admin tokens; R4 probably too |
| section 2 (`:76-110`) | revoke PUBLIC and anon EXECUTE on every public SECURITY DEFINER function | A2, A6, A13 to A16, R3; A7, R4, P5 only if definer; not P2, P6 |
| section 6 (`:290-298`) | `audit_events` read limited to Super Admin, Admin and `view_settings` holders (plus order rows) | payroll money in audit context no longer readable by Staff |
| section 8 (`:367-368`) | `attendance_records.work_date` default becomes the business-timezone date | only direct inserts (dead `clockIn`, A18); the kiosk already stamps it |
| section 10 (`:435-488`) | `kiosk_clock_in` refuses a NULL, unknown or revoked device id while a device is active | A6 checked in SQL by id (readable from own rows); A7 unchanged |
| `20260916130000` (`:12-13`) | `audit_events_occurred_at_idx` | performance only |
| `20260917120000` | no attendance or payroll object | none |

A file-content test pins sections 1, 2, 6, 8, 9 and 10, including the section 10 refusal message
(`tests/unit/security-hardening.test.ts:218-286`); no behavioural or pgTAP test covers them.

---

## 9. GENERIC interface template

Everything in this section is GENERIC unless a row says otherwise. Capability names are dotted and stable across
transports: a host may expose them as server actions, route handlers or RPC wrappers. Permission keys are exactly
those of `PERMISSIONS.md` section 4.2; own-row access (own sessions, own payroll line, own payslips, own rate) needs no
key, and whether a self-service screen exists is CONFIGURABLE (`PERMISSIONS.md` section 4.1, principle 7). The
authorization rule per capability follows the enforcement contract of `PERMISSIONS.md` section 4.4. Backing function
names and signatures follow `DATABASE.md` section 5.13; settings follow `CONFIGURATION.md` section 2.

The optional key `attendance.delete.request` is outside the eleven keys of `PERMISSIONS.md` section 4.2 and exists only
when a client adds the deletion-request path.

Fields of the contract tables (sections 9.4 to 9.9): Input, Output, Authorization, DB effect, Repeat and Errors. The
ACTION field of the inventory (sections 2 to 5) has no separate row: in the generic contract every capability performs
the same action, which is to validate the input, check the key in the server layer as a mirror, call the backing object
named in the section 9.3 index, and map the result. What that call does is stated in the DB effect row.

### 9.1 Contract rules

1. Every capability returns `Result<T>` (section 9.2) and never throws to the UI. Page loaders may still redirect an
   unauthenticated or deactivated caller. CURRENT mixes typed results with thrown guards (A10, A12, R2) and readers that
   swallow errors (section 7).
2. A read failure is `{ ok: false, error: { code: 'unavailable' } }`, never an empty success. An empty list is a
   real answer.
3. Authorization lives in the database function or RLS policy; the TypeScript guard mirrors it only to produce the
   message, and runs before any database client is created (`PERMISSIONS.md` section 4.4).
4. Inputs are validated at runtime on the server with a schema, then again in SQL. TypeScript types are not
   validation.
5. Writes are never retried automatically, by the transport or by the UI. Only idempotent GET and HEAD reads may be
   retried (section 10, convention 7). Each write below states what a manual repeat does.
6. The business date of a clock event, every "business today" default and the timestamp bounds of a date filter are
   computed on the server from the configured timezone, never taken from the client clock and never built from a fixed
   UTC offset. `time_in` and `time_out` for clock events come from the database clock. A client may send filter dates
   (`BusinessDate` strings); the server validates them.
7. Money crosses the wire as `MoneyString`; the server never parses it to a float.
8. Audit. A successful write inserts its audit row in the same transaction as the change, through the SQL-side writer
   (`DATABASE.md` section 5.11), so a direct RPC call leaves the same trace as a call from the UI. A refusal or failure
   cannot be kept that way when the function raises: in Postgres the exception rolls back every row the transaction
   inserted, including an audit row written before the raise. Denial and failure rows are therefore written outside
   the refused transaction, either by the server layer after the error has returned, as CURRENT does
   (`attendance.ts:354-362, 372-380`), or by a function that returns a typed refusal instead of raising. `DATABASE.md`
   section 5.13 builds every refusal row one of these two ways. The server-side writer reports its own
   insert failure to the server log instead of dropping it (CURRENT drops it, section 1.5).
9. The device token is never a request field and never readable by page JavaScript: the server reads it from an
   httpOnly cookie and the database compares its hash.
10. After a write, the server revalidates every screen that shows derived data (attendance, review, payroll).
11. Tables are read-only to clients. Sessions, photo metadata, rates and payslips grant `authenticated` SELECT only,
    with no INSERT, UPDATE or DELETE grant or policy, so every write passes through the definer function that checks
    the key, the device, eligibility and the reason, and writes the audit row (A18; `PERMISSIONS.md` section 4.4,
    "sessions: no INSERT or UPDATE grant"; `DATABASE.md` section 5.1, principle 2). The template's database test
    asserts that these grants are absent, the inverse of the CURRENT pgTAP assertion
    (`supabase/tests/26_hr_attendance.test.sql:47-49`).
12. Eligibility is one rule checked everywhere. The roster reader, both clock functions, the payroll computation and
    the rates reader call the same predicate (active, not demo, not timekeeping-exempt;
    `app_private.is_timekeeping_eligible`, `DATABASE.md` section 5.2). CURRENT checks exclusions in different places:
    the roster drops Super Admins but lists demo accounts, and the clock-in function refuses demo targets but accepts
    Super Admins (A2, A6).
13. Identity helpers refuse deactivated profiles. `current_staff_id()` returns NULL and `current_staff_role()` returns
    a non-NULL sentinel for an inactive profile, and every gate treats NULL as refusal (`DATABASE.md` section 5.1,
    principle 4). CURRENT `current_staff_id()` ignores `is_active` (`20260715130000:28-39`), so self branches of RLS
    still admit a deactivated token (A18).
14. Definer functions state their owning role. A definer function that writes a table with forced RLS works only when
    its owner bypasses RLS or a policy admits that owner role (`20260717120000:48`; `20260907120000:17`). The
    template migration sets the owner explicitly and a test asserts it. For the reference implementation the owner and
    its RLS bypass NEEDS VERIFICATION (section 13, row 13).

### 9.2 Shared types

```ts
type Uuid = string;
type BusinessDate = string;   // 'YYYY-MM-DD' in the configured business timezone
type Timestamp = string;      // ISO 8601 with offset, produced or normalised by the server
type MoneyString = string;    // decimal text at the configured money scale; never a JS float

type ErrorCode =
  | 'unauthenticated'       // no valid session
  | 'forbidden'             // key missing, account inactive, or the database refused (hint forbidden; SQLSTATE 42501)
  | 'validation'            // input failed a server check; nothing was written
  | 'not_found'             // target does not exist or is not visible to the caller
  | 'conflict'              // state guard: already clocked in, not pending, duplicate, changed since read
  | 'device_not_approved'   // device gate on and the token is missing, unknown or revoked (hint; SQLSTATE 42501)
  | 'unavailable';          // the read or write could not be completed

type ApiError = { code: ErrorCode; message: string; field?: string };
type Result<T> = { ok: true; data: T } | { ok: false; error: ApiError };
```

### 9.3 Capability index

Capability names carry the prefix `cap.` so that they never share a name with a permission key: for example the
capability `cap.payroll.payslip.generate` is authorized by the key `payroll.payslip.generate`, and
`cap.attendance.clock.in` by `attendance.clock_operate`.

| Capability | Kind | Authorization (`PERMISSIONS.md` 4.2 keys) | CURRENT gate | Backing object (`DATABASE.md` 5.13) | Manual repeat |
|---|---|---|---|---|---|
| `cap.attendance.roster.list` | read | `attendance.clock_operate` or `attendance.view_team` | RPC `hr_attendance` | `list_clock_staff()` | safe |
| `cap.attendance.team.list` | read | `attendance.view_team` or `attendance.clock_operate` | none of its own; Review reuses the kiosk roster (R1, A2) | names reader (note below) | safe |
| `cap.attendance.status.list` | read | `attendance.clock_operate` or `attendance.view_team` | none (RLS-blind reads A3, A4) | `attendance_status(p_employee_ids)` | safe |
| `cap.attendance.clock.in` | write | `attendance.clock_operate` | active staff only; device in TypeScript | `kiosk_clock_in(p_employee_id, p_device_token, p_note)` | `conflict` |
| `cap.attendance.clock.out` | write | `attendance.clock_operate` | active staff only (RECONSTRUCTED) | `kiosk_clock_out(p_employee_id, p_device_token)` | `conflict` |
| `cap.attendance.photos.attach` | write | `attendance.clock_operate` AND caller = recorded operator for that kind | active staff only | `attach_attendance_photo(...)` | `conflict` per kind |
| `cap.attendance.photos.read` | read | `attendance.review`; own sessions without a key | `hr_review_attendance` in TypeScript | signed URLs under photo RLS | safe |
| `cap.attendance.sessions.page` | read | own rows: no key; others' rows and names: `attendance.view_team` | `hr_attendance` or `hr_review_attendance`, RLS | `review_attendance_page(...)` | safe |
| `cap.attendance.session.correctClockOut` | write | `attendance.correct` | role Super Admin or Admin | `correct_attendance_clock_out(...)` | `conflict` |
| `cap.attendance.session.delete` | write | `attendance.delete` | role Super Admin or Admin | `delete_attendance_record(p_record_id, p_reason)` | `not_found` |
| `cap.attendance.session.requestDelete` | write (optional) | optional key `attendance.delete.request` | `initiate_high_risk_action` | request insert | `conflict` |
| `cap.attendance.devices.list` | read | `attendance.devices.manage` | Super Admin RLS | table read under RLS | safe |
| `cap.attendance.devices.register` | write | `attendance.devices.manage` | role Super Admin | `register_attendance_device(p_label, p_token)` | new device each time |
| `cap.attendance.devices.revoke` | write | `attendance.devices.manage` | role Super Admin | `revoke_attendance_device(p_id)` | idempotent |
| `cap.attendance.devices.gateState` | read | SQL: active caller; page gate: `attendance.clock_operate` | none | `attendance_gating_active()`, `verify_attendance_device(p_token)` | safe |
| `cap.payroll.report` | read | own line: no key; every line: `payroll.view_all` | page `hr_payroll`; row filter self or Super Admin | `report_payroll(p_from, p_to)` | safe |
| `cap.payroll.rates.list` | read | own rate: no key; every employee: `payroll.view_all` | page role; RLS | table read under RLS | safe |
| `cap.payroll.rates.set` | write | `payroll.rates.edit` | NONE in TypeScript; RPC RECONSTRUCTED | `set_staff_salary_rate(p_employee, p_basis, p_amount, p_frequency, p_effective)` | appends a row |
| `cap.payroll.payslip.generate` | write | `payroll.payslip.generate` and `payroll.view_all` | role Super Admin and RLS | `generate_payslip_snapshot(...)` | `conflict` |
| `cap.payroll.payslip.markPaid` | write | `payroll.payslip.mark_paid` | TypeScript Super Admin or Admin; RLS Super Admin | `mark_payslip_paid(p_snapshot_id, p_payment_date)` | `conflict` |
| `cap.payroll.payslip.void` | write (optional) | `payroll.payslip.generate` | none (no reverse path) | `void_payslip(p_snapshot_id, p_reason)` | `conflict` |
| `cap.payroll.payslip.list` | read | own payslips: no key; every employee: `payroll.view_all` | RLS self or Super Admin | table read under RLS | safe |
| `cap.export.attendance` | read (file) | `payroll.export` plus row visibility | route role Super Admin or Admin | route handler | safe |
| `cap.export.payroll` | read (file) | `payroll.export`; every line needs `payroll.view_all` | route role Super Admin or Admin | route handler | safe |

Notes on the index:

- Kiosk roster, team names and kiosk status. One design: `list_clock_staff()` and `attendance_status()` are each gated on
  either `attendance.clock_operate` or `attendance.view_team` (`DATABASE.md` section 5.13; `PERMISSIONS.md` section 4.4).
  They expose eligible ids and display names, and open or last-out times that an `attendance.view_team` holder can
  already read from sessions. A reviewer without the kiosk key therefore still gets an employee filter, which CURRENT
  does not provide (R1). The roster and team capabilities are two names over the same reader.
- Photo attach. `attach_attendance_photo` requires `attendance.clock_operate`, a caller who is the operator recorded on
  that session for that kind (`clock_in_by` or `clock_out_by`), and a storage path under that session prefix for that
  kind (`DATABASE.md` section 5.13; `IMPLEMENTATION_PROMPT.md` PH4).
- `PERMISSIONS.md` section 4.2 defines one export key, `payroll.export`, for both sheets; a client that wants a
  separate attendance export key adds it there first.
- The request path is dropped by default (`PERMISSIONS.md` section 4.2, "Not in the list, on purpose"). A client that
  keeps it adds the optional key `attendance.delete.request`, lists it in the access catalogue and checks it in the
  request insert policy.
- A reverse path for payslips (`void_payslip`, `DATABASE.md` section 5.9) and a day-approval capability
  (`review_attendance_day`, `DATABASE.md` section 5.5) are optional modules with no counterpart in the reference
  implementation.

### 9.4 Attendance: roster, status, clock

```ts
type RosterEntry = { employeeId: Uuid; fullName: string };

type ClockStatus = {
  employeeId: Uuid;
  openSession: { sessionId: Uuid; timeIn: Timestamp; workDate: BusinessDate } | null;
  lastClockOutToday: Timestamp | null;          // business today
};

type ClockInInput = { employeeId: Uuid; note?: string };   // note trimmed; at most 500 characters
type ClockOutInput = { employeeId: Uuid };
type ClockEvent = {
  sessionId: Uuid;
  employeeId: Uuid;
  workDate: BusinessDate;                       // business date of the clock-in
  timeIn: Timestamp;
  timeOut: Timestamp | null;                    // null after clock.in
};

interface AttendanceClockApi {
  roster: { list(): Promise<Result<RosterEntry[]>> };            // kiosk roster
  team: { list(): Promise<Result<RosterEntry[]>> };              // employee filter on review screens
  status: { list(input: { employeeIds?: Uuid[] }): Promise<Result<ClockStatus[]>> };
  clock: {
    in(input: ClockInInput): Promise<Result<ClockEvent>>;
    out(input: ClockOutInput): Promise<Result<ClockEvent>>;
  };
}
```

| `cap.attendance.roster.list` | |
|---|---|
| Input | none |
| Output | `RosterEntry[]`: employees that pass the eligibility predicate (rule 12), ordered by name. CURRENT also returns `role_key`, which the kiosk hides, and lists demo accounts (A2). |
| Authorization | `attendance.clock_operate` or `attendance.view_team`, checked inside the definer reader (`PERMISSIONS.md` section 4.4) |
| DB effect | none |
| Repeat | safe to repeat; transport may retry |
| Errors | `forbidden`, `unavailable` (never an empty list on failure) |

| `cap.attendance.team.list` | |
|---|---|
| Input | none |
| Output | `RosterEntry[]` for the employee filter of the history and review screens |
| Authorization | `attendance.view_team` or `attendance.clock_operate`, checked inside the same definer reader as the roster (section 9.3 notes) |
| DB effect | none |
| Repeat | safe |
| Errors | `forbidden`, `unavailable`. CURRENT: a reviewer without `hr_attendance` gets an empty filter and no message (A2, R1). |

| `cap.attendance.status.list` (RECOMMENDED TEMPLATE IMPROVEMENT) | |
|---|---|
| Input | optional `employeeIds`; default every roster member |
| Output | `ClockStatus[]` per member, including open sessions from earlier dates with their `workDate` |
| Authorization | `attendance.clock_operate` or `attendance.view_team`, in a definer reader so the operator sees every member's state (fixes A3 and A4) |
| DB effect | none |
| Repeat | safe |
| Errors | `forbidden`, `validation` (unknown or excluded ids), `unavailable` |

| `cap.attendance.clock.in` | |
|---|---|
| Input | `ClockInInput`; device token from the httpOnly cookie on the server |
| Output | `ClockEvent` with `timeOut: null`. No pay figure is returned; pay is computed by `cap.payroll.report`. |
| Authorization | `attendance.clock_operate`; target passes the eligibility predicate (rule 12); device gate per `attendance.device.mode` and `.failMode`, checked by token hash in the function |
| DB effect | one session row with `clock_in_by` and device; `time_in` from the database clock; `work_date` in the business timezone |
| Audit | `attendance.clock_in` in the same transaction; a refusal is audited outside it (rule 8) |
| Repeat | never retried; a repeat hits the one-open-session unique index and returns `conflict` |
| Errors | `forbidden`, `device_not_approved`, `validation`, `not_found` (employee), `conflict` (open session, ineligible target) |

| `cap.attendance.clock.out` | |
|---|---|
| Input | `ClockOutInput`; device token from the cookie |
| Output | `ClockEvent` with `timeOut` set |
| Authorization | `attendance.clock_operate`; device gate in the function, same as clock-in (CURRENT has no database check for clock-out) |
| DB effect | sets `time_out` and `clock_out_by` on the single open session; records the clock-out device; audit `attendance.clock_out` in the same transaction |
| Repeat | never retried; a repeat finds no open session and returns `conflict` |
| Errors | `forbidden`, `device_not_approved`, `not_found`, `conflict` (no open session, ineligible target) |

### 9.5 Attendance: photos

```ts
type PhotoKind = 'clock_in' | 'clock_out';
type AttachPhotoInput = {
  sessionId: Uuid;
  kind: PhotoKind;                               // explicit; never inferred from a file name
  file: File;                                    // jpeg, png or webp; at most the configured maximum bytes
  width?: number;
  height?: number;
};
type SessionPhotos = { clockIn: string | null; clockOut: string | null; expiresAt: Timestamp };

interface AttendancePhotosApi {
  attach(input: AttachPhotoInput): Promise<Result<{ photoId: Uuid }>>;
  read(input: { sessionIds: Uuid[] }): Promise<Result<Record<Uuid, SessionPhotos>>>;
}
```

| `cap.attendance.photos.attach` | |
|---|---|
| Input | `AttachPhotoInput` |
| Output | `{ photoId }` |
| Authorization | `attendance.clock_operate` AND the session exists AND the caller is the operator recorded on it for that kind AND the storage path lies under that session prefix for that kind (`DATABASE.md` section 5.13) |
| DB effect | one object in the photo bucket and one `attendance_photos` row (`DATABASE.md` section 5.7); audit |
| Repeat | never retried; a second photo of the same kind for the session returns `conflict` (unique per session and kind) |
| Errors | `forbidden` (key, or not the recorded operator), `validation` (type, size, kind, path), `not_found` (session missing or soft-deleted), `conflict`, `unavailable` (storage) |
| Notes | the clock event does not wait for the photo; a failed attach is reported next to the clock result |
| Required photo | not built: `attendance.selfie.mode = required` fails configuration validation (`CONFIGURATION.md` section 2.9 rule 8); if ever built it needs a check in the clock function |

| `cap.attendance.photos.read` | |
|---|---|
| Input | `sessionIds`, bounded (for example the sessions of one opened day) |
| Output | map of session id to signed URLs and their expiry; TTL `retention.signedUrlTtlSeconds` |
| Authorization | `attendance.review`, or the subject reading their own sessions; storage and metadata policies enforce the same rule |
| DB effect | none |
| Repeat | safe; each call mints fresh URLs |
| Errors | `forbidden`, `validation` (too many ids), `unavailable` |

### 9.6 Attendance: sessions, correction, deletion

```ts
type SessionsPageInput = {
  from: BusinessDate | null;                     // inclusive; basis = review.dateFilterBasis
  to: BusinessDate | null;
  employeeIds: Uuid[] | null;                    // null = every visible employee; [] = no match
  status: 'all' | 'open' | 'completed';
  page: number;                                  // integer, at least 1
  pageSize: number;                              // member of review.pageSizes
};
type SessionRow = {
  sessionId: Uuid;
  employeeId: Uuid;
  employeeName: string;                          // from a permission-scoped reader, never a profile embed
  workDate: BusinessDate;
  timeIn: Timestamp;
  timeOut: Timestamp | null;
  note: string | null;
  edit: { by: string; at: Timestamp; reason: string } | null;
};
type SessionsPage = {
  rows: SessionRow[];                            // one page of sessions, newest first
  completion: SessionRow[];                      // other sessions of the same (employee, work date) pairs
  total: number;                                 // number of matching sessions
  page: number;
  pageSize: number;
};

type CorrectClockOutInput = {
  sessionId: Uuid;
  timeOut: Timestamp;                            // a whole minute; time_in <= timeOut <= server now
                                                 // same minute as the stored time_out = unchanged, refused
  reason: string;                                // non-blank after trim
  expectedTimeOut: Timestamp | null;             // the value the editor loaded
};
type DeleteSessionInput = { sessionId: Uuid; reason: string; confirmPhrase?: string };

interface AttendanceSessionsApi {
  sessions: { page(input: SessionsPageInput): Promise<Result<SessionsPage>> };
  session: {
    correctClockOut(input: CorrectClockOutInput):
      Promise<Result<{ sessionId: Uuid; previousTimeOut: Timestamp | null; timeOut: Timestamp }>>;
    delete(input: DeleteSessionInput): Promise<Result<{ sessionId: Uuid; mode: 'hard' | 'soft' }>>;
    requestDelete(input: { sessionId: Uuid; reason: string }): Promise<Result<{ requestId: Uuid }>>;
  };
}
```

| `cap.attendance.sessions.page` | |
|---|---|
| Input | `SessionsPageInput`, schema-validated (page sizes, date shape, `from <= to`) |
| Output | `SessionsPage`; the UI groups sessions into days (a day total is the sum of completed sessions) |
| Authorization | own rows always; other members' rows and names need `attendance.view_team` |
| DB effect | none; exact count plus range paging plus the completion query, as CURRENT |
| Repeat | safe |
| Errors | `forbidden`, `validation`, `unavailable` for any of the three queries (CURRENT returns empty, section 7) |
| Notes | the date basis is one setting used by this capability and by `cap.export.attendance` (CURRENT differs, section 5) |

| `cap.attendance.session.correctClockOut` | |
|---|---|
| Input | `CorrectClockOutInput` |
| Output | `{ sessionId, previousTimeOut, timeOut }` |
| Authorization | `attendance.correct`, active account (sentinel helper), NULL treated as refusal |
| DB effect | in-place update of `time_out`, `edited_by`, `edited_at`, `edit_reason`; audit with old and new values in the same transaction |
| Repeat | never retried; `expectedTimeOut` makes a stale or repeated save return `conflict` (RECOMMENDED TEMPLATE IMPROVEMENT) |
| Errors | `forbidden`, `validation` (reason, time order, future, overlap with adjacent sessions), `not_found`, `conflict` |
| Notes | only the clock-out is correctable, as CURRENT; a day lock or payslip lock refuses with `conflict` when enabled |

| `cap.attendance.session.delete` | |
|---|---|
| Input | `DeleteSessionInput`; `confirmPhrase` required when `attendance.deletion.requireTypedConfirmation` |
| Output | `{ sessionId, mode }`, mode from `attendance.deletion.mode` (CURRENT is hard delete) |
| Authorization | `attendance.delete` |
| DB effect | hard or soft delete of one session; photos handled per `DATABASE.md` section 5.7; audit keeps the deleted values |
| Repeat | never retried; a repeat returns `not_found` (hard) or `conflict` (already soft-deleted) |
| Errors | `forbidden`, `validation` (reason, phrase), `not_found`, `conflict` (locked day when enabled) |

| `cap.attendance.session.requestDelete` (optional, off by default) | |
|---|---|
| Input | `{ sessionId, reason }`; the server builds the label from stored data, not from client text |
| Output | `{ requestId }` |
| Authorization | `attendance.delete.request`: added by the client to its access catalogue and checked in the request insert policy |
| Key status | an optional key outside the eleven of `PERMISSIONS.md` section 4.2, because the template drops this path by default |
| DB effect | one pending approval request; nothing deleted; execution later runs `cap.attendance.session.delete` as the approver |
| Repeat | a second pending request for the same session returns `conflict` |
| Errors | `forbidden`, `validation`, `not_found`, `conflict` |

### 9.7 Attendance: devices

```ts
type DeviceRow = {
  deviceId: Uuid;
  label: string;
  isActive: boolean;
  createdAt: Timestamp;
  revokedAt: Timestamp | null;                   // token hash is never returned
};
type GateState = { gateActive: boolean; thisDeviceApproved: boolean };

interface AttendanceDevicesApi {
  list(): Promise<Result<DeviceRow[]>>;
  register(input: { label?: string }): Promise<Result<{ deviceId: Uuid }>>;   // also sets the httpOnly cookie
  revoke(input: { deviceId: Uuid }): Promise<Result<{ deviceId: Uuid; revokedAt: Timestamp }>>;
  gateState(): Promise<Result<GateState>>;
}
```

| Capability | Input | Output | Authorization | DB effect | Repeat | Errors |
|---|---|---|---|---|---|---|
| `cap.attendance.devices.list` | none | `DeviceRow[]` | `attendance.devices.manage` | none | safe | `forbidden`, `unavailable` |
| `cap.attendance.devices.register` | label | `{ deviceId }` | `attendance.devices.manage` | hash stored; active count per setting; audit | new device | `forbidden`, `validation` (token or label), `conflict` (maximum reached or token already registered), `unavailable` |
| `cap.attendance.devices.revoke` | `deviceId` | `{ deviceId, revokedAt }` | `attendance.devices.manage` | deactivated, `revoked_at` set; audit | idempotent | `forbidden`, `not_found` |
| `cap.attendance.devices.gateState` | none | `GateState` | SQL helpers: active caller; page gate: page key `attendance.clock_operate` | none | safe | `unavailable` |

Device notes: registration keeps at most `attendance.device.maxActiveDevices` active devices; with 1 it reproduces the
CURRENT deactivate-all-then-insert behaviour (`DATABASE.md` section 5.6). Revoking an already revoked device returns
`ok`. The cookie lifetime is `attendance.device.cookieMaxAgeDays`; a `gateState` or verification error is
treated as "not approved" when `attendance.device.failMode` is `closed` (CURRENT fails open, A13). Revoke returns
`not_found` for an unknown id (CURRENT reports success, A16).

### 9.8 Payroll

`PAYROLL.md` section 11 owns the payroll shapes: `RateBasis`, `RateRow`, `PayrollLine`, `PayslipSnapshot` and
`PayrollSettings` are used exactly as defined there and are not redefined here. `PayslipSnapshot` already carries the
employee, period, figures, `deductionsTotal`, `net`, `paymentStatus` (`'pending' | 'paid' | 'void'`), `paymentDate`,
`generatedBy`, `generatedAt` and `supersededBy`. A row reaches `'void'` only when the optional `void_payslip`
capability is installed (`DATABASE.md` section 5.9); the reference implementation has `pending` and `paid` only. The
API adds only the payment audit fields that the snapshot table stores and the PAYROLL.md type leaves out. The CURRENT
TypeScript type with the same name (`payslip-types.ts:10-35`, used in sections 1.3, P3 and P8) has other field names
and is not ported.

```ts
// From PAYROLL.md section 11, unchanged: RateBasis, RateRow, PayrollLine, PayslipSnapshot, PayrollSettings.

type PayrollReportInput = { from: BusinessDate; to: BusinessDate };   // inclusive; from <= to

type RateEntry = RateRow & { rateId: Uuid };     // RateRow: employeeId, basis, amount, payFrequency, effectiveDate, createdAt
type EmployeeRate = { employeeId: Uuid; fullName: string; current: RateEntry | null };
type SetRateInput = {
  employeeId: Uuid;
  basis: RateBasis;                              // CURRENT: daily only
  amount: MoneyString;                           // at least 0, configured scale
  payFrequency: string;                          // member of payroll.payFrequencies
  effectiveDate: BusinessDate;
};

// Transport view of one payslip: the PAYROLL.md snapshot plus stored payment audit fields.
type PayslipView = PayslipSnapshot & {
  paidAt: Timestamp | null;
  paidBy: Uuid | null;
};

type GeneratePayslipInput = {
  employeeId: Uuid;
  from: BusinessDate;
  to: BusinessDate;
  deductions: MoneyString;                       // at least 0
  regenerate?: boolean;                          // default false; true supersedes a current pending payslip
};

interface PayrollApi {
  report(input: PayrollReportInput): Promise<Result<PayrollLine[]>>;
  rates: {
    list(input: { asOf?: BusinessDate }): Promise<Result<EmployeeRate[]>>;   // default business today
    set(input: SetRateInput): Promise<Result<{ rateId: Uuid }>>;
  };
  payslip: {
    generate(input: GeneratePayslipInput): Promise<Result<PayslipView>>;
    markPaid(input: { snapshotId: Uuid; paymentDate?: BusinessDate }):
      Promise<Result<{ snapshotId: Uuid; paymentDate: BusinessDate; paidAt: Timestamp; paidBy: Uuid }>>;
    list(input: PayrollReportInput): Promise<Result<Record<Uuid, PayslipView>>>;   // key: employeeId
  };
}
```

If the itemised adjustments module of `DATABASE.md` section 5.10 is enabled, `GeneratePayslipInput.deductions`
becomes a list of labelled amounts; the reference implementation has only the lump sum.

| `cap.payroll.report` | |
|---|---|
| Input | `PayrollReportInput`, validated (date shape, `from <= to`) |
| Output | `PayrollLine[]`: one line per eligible employee visible to the caller |
| Authorization | own line: no key (shown only when the self view is enabled, CONFIGURABLE); every line: `payroll.view_all`; enforced by the caller filter inside `app_private.payroll_lines` |
| DB effect | none; days worked, night shifts and pay per `PAYROLL.md` (one night rule, `payroll.nightRule`) |
| Repeat | safe |
| Errors | `forbidden`, `validation`, `unavailable` |

| `cap.payroll.rates.list` | |
|---|---|
| Input | optional `asOf`, default business today |
| Output | `EmployeeRate[]`; `current` is the newest row with `effectiveDate <= asOf` (CURRENT shows future rows as current) |
| Authorization | every employee: `payroll.view_all`; own rate: no key; RLS on the rate table enforces the same |
| DB effect | none |
| Repeat | safe |
| Errors | `forbidden`, `unavailable` (CURRENT ignores both read errors, P4) |

| `cap.payroll.rates.set` | |
|---|---|
| Input | `SetRateInput` |
| Output | `{ rateId }` |
| Authorization | `payroll.rates.edit`, checked in the function and mirrored in TypeScript (CURRENT has no TypeScript guard) |
| DB effect | appends one effective-dated row; history is never edited; audit row in the same transaction on success; a denial or failure is audited outside the refused transaction (rule 8) |
| Repeat | never retried; a manual repeat appends an identical row, which does not change pay |
| Errors | `forbidden`, `validation` (amount, basis, frequency, date, ineligible employee), `not_found` (employee), `unavailable` (`payroll.payFrequencies` not configured) |

| `cap.payroll.payslip.generate` | |
|---|---|
| Input | `GeneratePayslipInput` |
| Output | `PayslipView` with `paymentStatus: 'pending'` |
| Authorization | `payroll.payslip.generate` AND `payroll.view_all`, both checked inside `generate_payslip_snapshot` (`DATABASE.md` section 5.13; `PERMISSIONS.md` section 4.3) |
| DB effect | one frozen snapshot row computed in SQL; audit |
| Repeat | never retried; a repeat without `regenerate` returns `conflict`; with `regenerate` it supersedes a pending payslip; a paid payslip returns `conflict` until voided (CURRENT inserts again) |
| Errors | `forbidden`, `validation` (negative net when `payroll.allowNegativeNet` is false), `not_found` (no line), `conflict` |

| `cap.payroll.payslip.markPaid` | |
|---|---|
| Input | `snapshotId`; `paymentDate` honoured only when `payroll.paidDateEditable`, else business today |
| Output | `{ snapshotId, paymentDate, paidAt, paidBy }` |
| Authorization | `payroll.payslip.mark_paid` inside a definer function that may change only the status columns |
| DB effect | `pending` to `paid`, `paid_at` and `paid_by` set once; audit |
| Repeat | never retried; a repeat returns `conflict` (already paid), distinct from `forbidden` and `not_found` (CURRENT merges them, P7) |
| Errors | `forbidden`, `validation` (date), `not_found`, `conflict` |

| `cap.payroll.payslip.list` | |
|---|---|
| Input | `PayrollReportInput` (exact period) |
| Output | current `PayslipView` per employee (`supersededBy` is null); superseded rows available on request |
| Authorization | own payslips: no key (self view CONFIGURABLE); every employee: `payroll.view_all` |
| DB effect | none |
| Repeat | safe |
| Errors | `forbidden`, `validation`, `unavailable` (CURRENT returns `{}`, P3) |

Rendering (PDF, print, summary) stays client-side and uses only snapshots returned above; totals are added in integer
minor units with signed parsing.

### 9.9 Export

```ts
type ExportInput = { from: BusinessDate | null; to: BusinessDate | null; applyRange: boolean };
// Success: HTTP 200 with the workbook, Content-Disposition attachment, Cache-Control no-store.
// Failure: HTTP 401, 403, 422 or 500 with JSON { ok: false, error: ApiError }.
```

| `cap.export.attendance` and `cap.export.payroll` | |
|---|---|
| Input | `ExportInput`; the range applies only when both dates are valid; the attendance date basis matches `cap.attendance.sessions.page` |
| Output | a workbook sheet per capability; file name from `branding.documentFilePrefix` |
| Authorization | `payroll.export` checked in the route; rows by RLS (`attendance.view_team`, `payroll.view_all`) |
| DB effect | none; audit `data.export_all` with sections, range and size, or failed |
| Repeat | safe to repeat; the browser does not retry the POST automatically |
| Errors | any sheet read error fails the whole export with `unavailable` (CURRENT payroll sheet can be silently empty, X1) |

### 9.10 Error contract and mapping

| Code | HTTP (route handlers) | Raised by | CURRENT equivalent |
|---|---|---|---|
| `unauthenticated` | 401 | session check | redirect to `/sign-in` or `/offline` (`guard.ts:56-71`) |
| `forbidden` | 403 | key check in SQL (SQLSTATE 42501, hint `forbidden`) or TypeScript mirror | `AuthorizationError` text; 403 JSON in `route.ts:21-23` |
| `validation` | 422 | schema or SQL check | free-text messages such as "Enter a clock-out time." |
| `not_found` | 404 | target lookup | "That attendance record could not be found." (`20260907130000:41-43`) |
| `conflict` | 409 | unique index, pending guard, expected-value guard | "already clocked in" (`20260907120000:48-49`); generic mark-paid text |
| `device_not_approved` | 403 | device check in the function (SQLSTATE 42501, hint `device_not_approved`) | fixed refusal text from A8 |
| `unavailable` | 500 or 503 | read or write failure | mostly empty results (section 7); "Payroll unavailable" for P2 |

Mapping rule: every refusal carries its `ErrorCode` in the exception hint, including `forbidden` and
`device_not_approved`; authority and device refusals raise SQLSTATE 42501 (`insufficient_privilege`, as CURRENT already
does for authority in `20260907120000:26-27` and `20260907130000:31-32`). The server maps the hint first, and maps
SQLSTATE 42501 without a hint to `forbidden`. It never parses message text. The human message is safe to show and never
contains SQL.

Audit of refusals: a raised exception rolls back the whole transaction, including any audit row the function inserted
before raising. So a function that refuses by raising writes no audit row of its own for that refusal; the server
layer writes the `denied` or `failed` row after it has mapped the error, outside the refused transaction (rule 8). A
function that must record its own refusals returns a typed refusal instead of raising, and the server maps that result
to the same `ErrorCode`.

---

## 10. Conventions worth keeping

1. Typed results instead of exceptions for writes. `ClockResult`, `SetRateResult`, `HrActionState` and
   `PayslipActionState` (section 1.3) let the UI render an error without an error boundary; domain functions convert
   `AuthorizationError` into a result (`attendance.ts:351-365`; `payslip-actions.ts:27-34`). The template extends this
   to every read and adds error codes (section 9.1).
2. A guard before any database client. The guard runs first, then the client is created: `kioskClockIn`
   (`attendance.ts:158` before `:164`), `deleteAttendanceRecord` (`:352` before `:367`), `registerThisDevice`
   (`devices.ts:69` before `:76`), `generatePayslipAction` (`payslip-actions.ts:28` before `:57`), `uploadAttachment`
   (`upload.ts:72` before `:103`), the export route (`route.ts:18` before `:54`). Permission reads fail closed
   (`guard.ts:189-192`). Exceptions to fix: `setSalaryRate` and the readers without a TypeScript guard.
3. RPC-first writes. Clocking, correction, deletion, device changes, rates and payslip generation all go through
   database functions (A6, A7, R3, R4, A15, A16, P5, P6); the definer functions use `set search_path = ''` and derive
   the caller from `auth.uid()` (`20260907120000:17-18, 25`). Exceptions to fix: these application writes are direct
   table writes under RLS: mark-paid (P7, `payslip-actions.ts:124-135`), the selfie metadata insert (A11,
   `upload.ts:130-148`), the deletion approval request insert (R5, `service.ts:523-535`) and the audit writer itself
   (`log.ts:64-78`). Separately, the table grants still allow direct session writes that the application never makes
   (A18).
4. HEAD count plus range paging. An exact HEAD count, a `.range()` page and a bounded completion query keep list reads
   independent of history size (`attendance.ts:623-656`); the export reads 1,000 rows per request and throws on a read
   error rather than returning a partial sheet (`data-export.ts:87-114`), except for the payroll sheet, whose single
   RPC call does not go through that reader and ignores its error (`data-export.ts:565-573`; X1).
5. Business-day values computed on the server. `work_date` is stamped in SQL from the database clock
   (`20260907120000:45`), `time_in` defaults to `now()` and is never a request field (`20260717120000:26`), day
   bounds for list filters are built on the server (`attendance-paging.ts:72-80`), and the paid date and payroll
   default period default on the server (`payslip-actions.ts:116`; `payroll/page.tsx:33-34`). The template reads the
   timezone from a setting and drops the fixed offset.
6. Money as text. Payroll money stays a string from SQL to the screen (`payroll.ts:5-9, 50-64`; `rate.ts:17-19, 225`;
   `payslip-types.ts:6-7`).
7. No automatic retry of writes. The fetch wrapper retries only GET and HEAD (`retry-fetch.ts:20-33, 58-60`;
   `server.ts:26-30`), and the kiosk shows an error and waits for a new click (`attendance-clock.tsx:151-154`).
8. Denials and failures audited next to successes, on the paths that do it: delete and correction audit denied and
   failed outcomes (`attendance.ts:354-380, 408-444`), the approval request audits a denial (`service.ts:505-511`),
   the selfie upload audits storage and metadata failures (`upload.ts:119-126, 155-162`), the export audits a failed
   build (`route.ts:85-90`), and the device gate audits a blocked clock attempt (`attendance.ts:36-42`). The audit
   writer never masks the action's outcome (`log.ts:32-39`). The template writes success rows in SQL and denial or
   failure rows outside the refused transaction (section 9.1, rule 8). Exceptions to fix, where CURRENT writes no
   audit row:
   - `kioskClockIn` and `kioskClockOut`: an RPC refusal or failure (`attendance.ts:170-176, 221-227`).
   - `generatePayslipAction`: a denial (`payslip-actions.ts:27-34`) and an RPC failure (`:65-71`).
   - `markPayslipPaidAction`: a denial (`payslip-actions.ts:104-112`) and a failed update (`:137-143`).
   - `setSalaryRate`: a failure (`rate.ts:229-231`); it has no guard, so no denial branch exists.
   - `registerThisDevice` and `revokeDevice`: a denial and an RPC failure (`devices.ts:68-73, 81, 103-108, 111`).
   - `requestOwnerApproval`: a failed insert (`service.ts:537-539`).
   - The export route: a denial (`route.ts:20-23`).
9. The device secret never reaches page JavaScript: a server-minted token in an httpOnly cookie, only its hash in the
   database (`devices.ts:11-25, 75-89`; `20260722150000:52`).
10. Transport-only actions with state types outside the `'use server'` file (`hr/actions.ts:28-37`;
    `action-state.ts:1-4`), and revalidation of every page that shows derived data after a write
    (`hr/actions.ts:153-155, 179-181, 225-226`).
11. Migration-content regression tests where a database cannot run in CI (`tests/unit/security-hardening.test.ts:218-286`).
12. No caching of HR data: all HTML navigations are network-or-offline in the service worker
    (`src/lib/pwa/cache-policy.ts:34-37, 45-60`) and the export sets `Cache-Control: no-store` (`route.ts:81`).

---

## 11. RECOMMENDED TEMPLATE IMPROVEMENTS (server surface)

Each item names the gap in the reference implementation and what the template contract in section 9 does instead.
Items that are also permission findings point to `PERMISSIONS.md` section 6 rather than repeating the analysis.

1. Kiosk writes do not check the kiosk key (A6, A7). The clock capabilities check `attendance.clock_operate`
   inside the functions (`PERMISSIONS.md` section 6 item 3).
2. The device rule is enforced only in TypeScript and fails open (A8, A13). Both clock functions verify the
   token hash; `attendance.device.failMode` defaults to closed; clock-out records its device.
3. Kiosk status is RLS-blind for operators without the review key (A3, A4). `cap.attendance.status.list` is a
   permission-scoped definer reader.
4. Reviewer screens and exports lose employee names for anyone who is not a Super Admin (A9, X1). Names
   come from permission-scoped readers.
5. Readers turn failures into empty results (section 7). Every read returns `unavailable` on failure.
6. Load actions throw, and the selfie read has no client catch (A10, A12). Every capability returns `Result<T>`.
7. No runtime validation of page, page size, filters or payroll dates (A9, P1, P2). Server-side schemas.
8. The rate write has no TypeScript guard and an unknown database gate (P5). `payroll.rates.edit` in
   the function plus a mirror; the static authorization sweep must detect `.rpc(` writers per export.
9. Mark-paid is a direct UPDATE whose TypeScript gate (Super Admin or Admin) contradicts the RLS policy (Super Admin
   only), and every failure shares one message (P7). A definer `mark_payslip_paid` gated on
   `payroll.payslip.mark_paid` that changes only status columns and returns distinct codes.
10. No uniqueness for payslips per employee and period (P6). `conflict` when a current snapshot exists,
    or an explicit supersede (`DATABASE.md` section 5.9).
11. Negative net is accepted and corrupts the printed summary total (P6, P8). `payroll.allowNegativeNet`
    checked at generation, and signed parsing in the summary.
12. Corrections have no concurrency guard, no overlap check and no `edited_at`, and the UI default truncates to the
    minute (R3). `expectedTimeOut`, an overlap check, `edited_at` and minute precision
    on the server (a value that is not a whole minute is refused; the stored `time_out`'s own minute is refused as
    unchanged); in the UI, seed an open session from `time_in` rounded up to the next minute and a completed one from
    `time_out` truncated to its minute, and disable Save until the minute changes (IMPLEMENTATION_PROMPT.md R7 and R8).
13. Delete keeps no record of the deleted values and asks for no reason (R4). A required reason and an audit row with
    the old values; soft delete per `attendance.deletion.mode`.
14. The delete request path fails by default on a fresh install (its key is grantable only on a legacy console) and
    stores a client-built label (R5; `PERMISSIONS.md` section 6, item 2). The template drops the path by
    default; a client that keeps it adds its request key to the catalogue, builds the label on the server and refuses
    duplicate pending requests.
15. Selfie attach accepts any record id from any active staff member, links in and out by file name, and reads are
    open to every active staff member at the data layer (A11, A12). An explicit `kind`, a session
    check, one photo per kind, and read policies scoped to the subject and `attendance.review`.
16. Orphaned selfie objects and deleted-record selfies have no cleanup, and storage rows cannot be deleted from SQL
    (A11, R4). A service-role retention job through the storage API if the client needs retention.
17. Revoke reports success for an unknown device id (A16). `not_found`.
18. Screen and export filter different date columns (A9, X1). One `review.dateFilterBasis` for both.
19. The export payroll sheet ignores the RPC error, and the export key is not checked by the route (X1).
    Fail the whole export; check `payroll.export`.
20. Write functions do not write audit rows themselves, the application writer ignores insert errors (section 1.5),
    and several paths record no denial or failure at all (section 10, convention 8). SQL-side audit in the same
    transaction for successes (`DATABASE.md` section 5.11), and a denied or failed row for every write capability,
    written outside the refused transaction (section 9.1, rule 8; section 9.10).
21. Error messages are free text passed through from SQL, inconsistently prefix-stripped (section 1.3). Stable error
    codes (section 9.10).
22. Missing DDL for `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate` and the live
    `generate_payslip_snapshot` (A7, R4, P5, P6). The template ships every backing function
    (`DATABASE.md` section 5.13).
23. Stale docstrings describe a different authority model: "self-service" (`attendance/page.tsx:34-35`),
    "Owner acts" for mark-paid (`payslip-actions.ts:13-15`), the unused RLS model in `rate.ts:9-20`, and "Owner-only"
    for the rate action (`hr/actions.ts:206-209`). Comments in the template describe the key model of
    `PERMISSIONS.md` section 4.
24. Direct session writes bypass every server rule (A18; `PERMISSIONS.md` section 6,
    item 7). CURRENT grants `authenticated` INSERT and UPDATE on `attendance_records` with self and Super Admin policies
    that are not column-restricted, and the night trigger fires on INSERT only (`20260717120000:59-75`;
    `20260722200000:46-49`). Template: revoke INSERT, UPDATE and DELETE on sessions (and on photo metadata, rates and
    payslips) from `authenticated`, drop the write policies, write only through the definer functions of section 9,
    and invert the pgTAP grant assertion (section 9.1, rule 11).
25. Eligibility is checked differently by the roster and the clock function (A2, A6; `PERMISSIONS.md` section
    6, item 14). CURRENT: the roster
    RPC has no `is_demo` filter, so demo accounts are listed and then refused by `kiosk_clock_in`
    (`20260907160000:20-25`; `20260907120000:30-37`), while `kiosk_clock_in` has no role check, so a Super Admin
    target excluded from the roster is still accepted by a direct call. Template: the eligibility predicate inside the
    roster reader, both clock functions, the payroll computation and the rates reader (section 9.1, rule 12).
26. Deactivated profiles keep self access (A18; `PERMISSIONS.md` section 6, item 9). CURRENT `current_staff_id()`
    ignores `is_active` (`20260715130000:28-39`), so the self branches of the session read, insert and update policies
    and of the payroll readers still admit a deactivated profile whose token has not expired; PENDING section 1 fixes
    only `current_staff_role()` (`20260916120000:46-57`). Template: both helpers refuse inactive profiles (section 9.1,
    rule 13).
27. Definer functions write a table with forced RLS without stating who owns them. CURRENT:
    `20260717120000:48` forces RLS and `20260907120000:17` declares SECURITY DEFINER; the write works only if the
    function owner bypasses RLS or a policy admits that role, and the repository records neither. Template: set the owner in the migration and
    assert it in a test (section 9.1, rule 14; section 13, row 13).

---

## 12. PROJECT-SPECIFIC (removed from template)

These values and names belong to the source business. They are listed so an adopter can find and replace them; none
of them is part of the generic contract.

- Business timezone `Asia/Manila` and fixed offset `+08:00`: `attendance-paging.ts:41-43`, `attendance.ts:133`,
  `20260907120000:45`, `20260722200000:34`, `20260907160000:41`, PENDING `20260916120000:368`. The business-date
  helpers `manilaToday` and `manilaMonthStart` in `src/lib/format/manila-date.ts:19-26` are used by
  `payslip-actions.ts:116` and `payroll/page.tsx:33-34`. The migration with prefix 20260907120000 carries the zone
  name in its file name.
- Currency: the peso sign in the clock-in overtime message (`attendance.ts:201`) and in the rate success message
  (`rate.ts:242`).
- Brand strings: export file name prefix `MineFlow-Data-Export-` (`route.ts:74`), workbook creator `A.V. Jewelry`
  (`data-export.ts:132`), payslip PDF file name prefix `AV-Jewelry-Payslip-` (`payslip-pdf.ts:44-49`).
- Device vocabulary: cookie name `av_att_device` (`devices.ts:27`); "shop phone" in the refusal and success messages
  (`attendance.ts:41, 46`; `hr/actions.ts:117`) and the default label `Shop phone` (`20260722150000:51`;
  `devices.ts:94`).
- Night rule values: the session flag threshold 22 and flat amount 300.00 (`20260722200000:35-37`), the payroll
  threshold 22:00 (`20260907160000:41`), the live value of `app_private.night_ot_bonus()`, and the "clock-in at/after
  10 PM" wording (`attendance.ts:201`).
- Role wording and exclusions: `role_key <> 'owner'` in the roster, payroll and rates reader
  (`20260907160000:24, 99`; `rate.ts:137`); guard messages that name the Owner and Selected Admin (`guard.ts:268,
  330`); migration comments that name real account holders (`20260907160000:1-7`, not reproduced).
- Approvals coupling: kind `attendance_delete` and its executor in the fulfillment module alongside the business's
  other approval kinds (`service.ts:735-739`), and the key `initiate_high_risk_action`.
- Demo accounts: the `is_demo` flag seeded from a test-domain email pattern (pattern not reproduced).
- Internal spec references ("Bible" section numbers) in docstrings (`hr/actions.ts:29`; `payroll.ts:6`;
  `payslip-actions.ts:13`).
- Route paths revalidated by the actions (`/admin/attendance`, `/admin/attendance/review`, `/admin/payroll`,
  `/orders`, `/approvals`) are the host application's routes.

---

## 13. NEEDS VERIFICATION

Read-only checks for someone with access to the correct production project. They settle cells marked above.

| # | Question | Settles | How |
|---|---|---|---|
| 1 | Body, security mode, gate, messages and grants of `kiosk_clock_out(uuid)` | A7 | `select pg_get_functiondef('public.kiosk_clock_out(uuid)'::regprocedure);` |
| 2 | Body, NULL-role handling, grants of `delete_attendance_record(uuid)`; does it touch attachments | R4 | `pg_get_functiondef` on the same pattern |
| 3 | Gate of `set_staff_salary_rate` (Super Admin only, or Admin too) and its security mode | P5 | `pg_get_functiondef`; `prosecdef`, `proacl` from `pg_proc` |
| 4 | Live body of `generate_payslip_snapshot` (daily model, overtime source, guards) | P6 | `pg_get_functiondef` |
| 5 | Live UPDATE policy on `payroll_snapshots` (does an Admin mark paid succeed) | P7 | `pg_policy` rows for `public.payroll_snapshots` with `pg_get_expr` |
| 6 | RLS on `staff_salary_rates` | P2, P4 | `pg_policy` for that table |
| 7 | EXECUTE grants on `report_payroll`, `app_private.night_ot_bonus()` and `kiosk_clock_in` | P2, A6 | `has_function_privilege('anon', ..., 'execute')` and `proacl` |
| 8 | A second `staff_profiles` SELECT policy for reviewers | A9, X1 names | `pg_policy` for `public.staff_profiles`, command `r` |
| 9 | Any live grant of `initiate_high_risk_action` (count only) | R5 | `select count(*) from staff_permission_grants where permission_key = 'initiate_high_risk_action';` |
| 10 | Whether the review list reloads after a correction while the open modal stays stale | R3 | correct one record in a browser and watch both |
| 11 | Timezone the spreadsheet shows for Time In and Time Out | X1 | export one known session and compare |
| 12 | Does `authenticated` still hold direct INSERT and UPDATE on `attendance_records`; which write policies exist | A18 | `role_table_grants`, `column_privileges`; `pg_policies` for the table |
| 13 | Owner of the definer functions that write `attendance_records`, and whether it bypasses RLS | A6, A7, R3, R4 | `pg_proc.proowner` joined to `pg_roles.rolbypassrls` for those functions |

---

## 14. Cross-references

- `DATABASE.md`: CURRENT tables (section 2) and functions (section 3), migration file names for every prefix cited here
  (section 1.2), generic principles (5.1), eligibility predicate (5.2), day reviews (5.5), devices (5.6), photos (5.7),
  rates (5.8), snapshots (5.9), adjustments (5.10), audit (5.11), function set (5.13), object mapping (5.14).
- `PERMISSIONS.md`: capability matrix (section 3), own-row principle (4.1), generic keys (4.2), key dependencies
  (4.3), enforcement contract (4.4), default grants (5), permission improvements (6).
- `PAYROLL.md`: formulas, the two night rules, rate selection, payslip lifecycle, and the engine types `RateRow`,
  `PayrollLine`, `PayslipSnapshot` and `PayrollSettings` (section 11).
- `UI_UX.md`: screens that call these entry points, how screens refresh after a write (1.10), the camera response
  header (1.11), print and PDF.
- `CONFIGURATION.md`: every setting key named in section 9.
- `TESTING_CHECKLIST.md`: tests for the contracts and the improvements above.
