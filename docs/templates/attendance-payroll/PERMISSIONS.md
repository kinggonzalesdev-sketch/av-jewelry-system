# Attendance and Payroll Template: Permissions and Roles (Phase 3)

This document (Phase 3 of the attendance-payroll template) records who may do what in the reference implementation of
Attendance, Review Attendance and Payroll, and at which enforcement layer each rule actually lives: UI, page gate,
action guard, RPC gate or RLS. It then defines the generic permission model the template uses for new clients, a
proposed default grant set per role, and the authorization gaps the template must close. Every verdict is backed by a
`file:line` citation that was re-read in the repository at commit `c31af2b`. No database was queried, so anything the
repository cannot settle is marked NEEDS VERIFICATION and section 8 gives the read-only catalog query that settles it.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves, with a `file:line` citation. |
| GENERIC | The reusable form proposed for the template. |
| PROJECT-SPECIFIC | Tied to the source business; collected in section 7 and removed from the template. |
| CONFIGURABLE | Should become a client setting or a client grant decision rather than code. |
| NEEDS VERIFICATION | The repository cannot settle it; the text says what would (section 8). |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository; described from call sites and comments. |
| PENDING (not live) | Content of migrations `20260916120000`, `20260916130000` or `20260917120000`: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template should fix. Never a change to production. |

- Roles. The database role keys are `owner`, `selected_admin` and `staff`. The UI calls them Super Admin (role key
  owner), Admin (role key selected_admin) and Staff (role key staff). After this paragraph the document says
  Super Admin, Admin and Staff.
- Matrix verdicts. YES (allowed), NO (refused), ONLY WITH GRANT `key` (an explicit grant is needed), ROLE-GATED
  (allowed because of the role title, not a grant: a `role_key` comparison in TypeScript or `is_owner()` in SQL).
  A Super Admin cell says YES where the path is ungated or every deciding gate is a permission check that the
  implicit-all rule satisfies (`has_permission`, `canOpenPage`); it says ROLE-GATED where a deciding gate is a
  role-title check. Where two layers disagree, both are written and the cell is marked CONFLICT.
- Layers. UI = a component shows or hides a control. Page gate = a server component calls `notFound()`. Action guard
  = a server action, route handler or TypeScript domain function refuses. RPC gate = a check inside a SQL function.
  RLS = a row policy or table grant.
- PENDING scope. Only `20260916120000` changes authorization for this area. `20260916130000` adds an `audit_events`
  index and `20260917120000` touches another module; neither changes a verdict here.
- Citations. Short file names and migration prefixes are expanded in section 9. A migration is cited by its
  14-digit prefix, for example `20260907160000:16-19`.
- Sibling documents. `DATABASE.md` owns the DDL, the RECONSTRUCTED object list and the generic function names;
  `PAYROLL.md` owns the pay formula and the payslip lifecycle; `UI_UX.md` owns the screens and controls;
  `CONFIGURATION.md` owns client settings; `TESTING_CHECKLIST.md` owns the permission tests. The key names of section
  4.2 and the default-grant proposal of section 5 are authoritative for permissions; `IMPLEMENTATION_PROMPT.md`
  restates them without reference-implementation detail.

## Key facts (shared with the sibling documents)

- Clocking is a shared kiosk, not self-service. A signed-in operator who holds `hr_attendance` opens the Attendance
  page, picks a member from `list_clock_staff`, and clocks that member (`attendance/page.tsx:43`, `:113-117`;
  `actions.ts:85`; `attendance.ts:148-169`). The clocked member does not sign in. The page docstring that says
  "self-service" is stale (`attendance/page.tsx:34-35`).
- One open session per member, enforced by a unique partial index (`20260717120000:43-45`).
- `work_date` is the business-timezone date at clock-in, stamped by `kiosk_clock_in` (`20260907120000:40-46`).
  A day's total is the sum of its completed sessions (`PAYROLL.md`).
- Two different night rules exist. The session flag: a BEFORE INSERT trigger sets a flat 300.00 when the clock-in
  hour is 22 or later (`20260722200000:26-49`). Payroll: distinct `work_date`s with a clock-out at or after 22:00,
  multiplied by `app_private.night_ot_bonus()` (`20260907160000:41`, `:55`, `:85`).
- Pay = round(days_worked x daily_rate + night_shifts x night_ot_bonus, 2) (`20260907160000:86-93`). Deductions are
  one lump sum >= 0 entered at payslip generation (`20260722210000:27`; `payslip-actions.ts:48-55`).
- A payslip is a frozen snapshot whose `payment_status` goes pending -> paid (`20260722210000:29-30`;
  `payslip-actions.ts:124-135`). There is no approval or finalization step for attendance and no period lock.
- Only the clock-out can be corrected: by Super Admin or Admin by role title, reason required, as an in-place
  update; the old value survives only in a best-effort application audit event (`20260907130000:29-61`;
  `attendance.ts:447-456`; `src/lib/audit/log.ts:35`). Delete is a hard delete (section 3, row 7).
- Device approval is a hashed token in an httpOnly cookie, enforced in server TypeScript only (`attendance.ts:28-48`;
  `devices.ts:75-89`). The live database has no device check; PENDING adds a clock-in check
  (`20260916120000:451-459`). The gate is fail-open when no device is registered (`attendance.ts:32`).
- Exclusions. Super Admins are excluded from the kiosk roster, payroll and the rates list
  (`20260907160000:24`, `:99`; `rate.ts:137`) but accepted as a `kiosk_clock_in` target (`20260907120000:30-37`).
  Demo accounts are excluded from payroll and rates (`20260907160000:98`; `rate.ts:136`) and refused as a clock-in
  target (`20260907120000:35-37`), but CURRENT `list_clock_staff` still lists them (`20260907160000:20-25`).

## 1. Role model

### 1.1 Role keys and labels (CURRENT)

| Role key | DB label (`20260715120100:28-31`) | UI label (`access-catalogue.ts:177-182`) | Authority |
|---|---|---|---|
| `owner` | Owner | Super Admin | Holds every permission implicitly (`20260716240000:33-34`; `permissions.ts:131`). |
| `selected_admin` | Selected Admin | Admin | Holds only explicit grants (`permissions.ts:78-86`); also passes role-title gates. |
| `staff` | Staff | Staff | Holds only explicit grants; never passes a role-title gate. |

The CHECK constraint allows exactly these three keys (`20260715120100:16`); TypeScript mirrors them in `ROLES`
(`permissions.ts:87-91`). There is deliberately no role-to-permission map (`permissions.ts:81-86`): a role title
confers nothing except where code compares `role_key` directly, which the matrix calls ROLE-GATED. The three keys are
GENERIC; the label pair Super Admin / Admin is CONFIGURABLE wording.

### 1.2 How role and grants resolve (CURRENT)

Tables (`20260715120100`):

| Table | Lines | Role in authorization |
|---|---|---|
| `staff_profiles` | `:106-131` | One row per auth user: `role_key`, `is_active`, `deactivated_at`. `is_demo` added later (`20260722160000:7-8`). |
| `permissions` | `:36-43` | Key catalogue with `is_request_only`. |
| `staff_permission_grants` | `:188-206` | One row per (profile, key), unique on the pair, FK to `permissions`, RLS forced. |

SQL helpers, all in schema `app_private`, SECURITY DEFINER, `set search_path = ''`, identity from `auth.uid()` only:

| Helper | Definition | Checks `is_active`? | Notes |
|---|---|---|---|
| `current_staff_id()` | `20260715130000:28-39` | NO | Returns the profile id for an inactive profile too. |
| `current_staff_role()` | `20260715130000:47-58` | NO (live) | PENDING returns `'inactive'` for a deactivated profile and keeps NULL for no profile (`20260916120000:40-57`). |
| `is_active_staff()` | `20260715130000:68-81` | YES | The operator gate of `kiosk_clock_in`; also the attachments policies. |
| `is_owner()` | `20260715130000:147-161` | YES | Active and `role_key = 'owner'`. |
| `has_permission(key)` | `20260716240000:26-44` | YES | `is_owner()` OR an explicit grant held by an active profile. |
| `is_primary_super_admin()` | no DDL | ? | RECONSTRUCTED; referenced by `20260731120000:21`. PROJECT-SPECIFIC (section 1.4). |

EXECUTE on the helpers is granted to `authenticated`; `anon` loses usage of the schema (`20260715130000:233-247`).

TypeScript mirror (`guard.ts`), cached once per request:

| Function | Lines | Behaviour |
|---|---|---|
| `requireAuthenticatedStaff()` | `:56-71` | Verifies the session; redirects to `/sign-in`, or to `/offline` on a transient failure. |
| `requireActiveStaff()` | `:124-163` | Reads the caller's own profile; no profile, `is_active = false`, or `is_demo` without demo login -> `/account-disabled`. |
| `getGrantedPermissions()` | `:174-198` | Super Admin gets every key (`permissionsForRole`, `permissions.ts:127-133`); others read their grants. |
| (fail closed) | `:189-192` | A grant read error returns an empty set, never all keys. |
| `canOpenPage(key)` | `:300-303` | Set membership; pages call `notFound()` when false. |
| `requirePermission(key)` | `:211-223` | Throws `AuthorizationError`. |
| `requireOwner()` | `:263-273` | Role-title gate: `owner` only. |
| `requireOwnerOrAdmin()` | `:325-335` | Role-title gate: `owner` or `selected_admin`. |
| `requireOwnerApprovalAuthority()` | `:346-356` | Role-title gate for deciding and executing approvals: `owner` only. |
| `requirePrimarySuperAdmin()` | `:306-314` | Compares the signed-in email with a constant. PROJECT-SPECIFIC. |
| `requireAal2()` | `:373-392` | Exists; documented as not called, so MFA is not enforced for any HR action. |

The application layout calls `requireActiveStaff()` on every request (`src/app/(app)/layout.tsx:42`) and passes the
granted keys to the sidebar (`:62`); the sidebar hides an item whose key is missing (`navigation.ts:83-97`,
`:264-275`). Hiding is convenience, never the control. The `ownerOnly` docstring that calls Review Attendance
"Owner-only" is stale (`navigation.ts:64-71`).

Order of layers on an HR request: sidebar (UI) -> `canOpenPage` (page gate) -> `requirePermission` or a role-title
function (action guard) -> the check inside the SQL function (RPC gate) -> policies and grants on the touched tables
(RLS). Section 3 names which of these layers carries each rule.

### 1.3 Account flags (CURRENT)

| Flag | Where | Behaviour |
|---|---|---|
| `is_active = false` | TypeScript | `requireActiveStaff` redirects to `/account-disabled` (`guard.ts:145-147`). |
| `is_active = false` | SQL helpers | `is_active_staff`, `is_owner`, `has_permission` refuse; check constraint `20260715120100:127-130`. |
| `is_active = false` | Gap | `current_staff_id()` and live `current_staff_role()` ignore it: self branches and role-title RPC gates still pass. |
| `is_demo = true` | TypeScript | Sign-in refused unless demo login is enabled (`guard.ts:152-154`). |
| `is_demo = true` | SQL | Excluded from `report_payroll` (`20260907160000:98`); refused as clock-in target (`20260907120000:35-37`). |
| `is_demo = true` | Rates list | Excluded (`rate.ts:136`). |
| `is_demo = true` | Gap | `list_clock_staff` does not filter it (`20260907160000:20-25`): selectable, then refused. |
| `role_key = 'owner'` | Exclusion | Roster (`20260907160000:24`), `report_payroll` (`:99`), rates list (`rate.ts:137`). |
| `role_key = 'owner'` | Gap | `kiosk_clock_in` accepts a Super Admin target (`20260907120000:30-37`); PENDING unchanged (`20260916120000:461-468`). |

PENDING also adds `revoke_staff_sessions(uuid)`, a Super Admin-only (`is_owner()`) revocation of every session of a member, so
deactivating a kiosk operator takes effect on every device at once (`20260916120000:378-422`).

### 1.4 Role-count and identity constants (PROJECT-SPECIFIC)

- `MAX_SUPER_ADMINS = 2` (`access-catalogue.ts:188-190`). The cap is re-checked by the RECONSTRUCTED RPC
  `set_team_member_role` according to its caller's comment (`team-accounts.ts:167-171`).
- `PRIMARY_SUPER_ADMIN_EMAIL` (`guard.ts:281`; the value is deliberately not reproduced anywhere in this template)
  identifies the Primary Super Admin in TypeScript (`guard.ts:287-291`; `team-accounts.ts:116`, `:160`). Its SQL twin
  has no DDL in the repository. The template replaces both with a profile flag checked in SQL (section 6, item 20).
- A trigger lets only the Super Admin promote or demote an Admin (`20260715130200:98-139`); that shape is GENERIC. A legacy
  "maximum two Admins" trigger (`20260715120100:148-182`, redefined in `20260715130300:104-136`) is described as
  retired (`admin/staff/page.tsx:75-77`; `src/lib/authz/account-management.ts:254-257`), but no repository migration
  drops it: NEEDS VERIFICATION (section 8).

## 2. Permission keys for this area (CURRENT)

| Key | DB label and description (`20260729120000:32-34`) | Manage Access (`access-catalogue.ts:116-128`) | TS constant (`permissions.ts:69-71`) | Route (`navigation.ts:91-93`) |
|---|---|---|---|---|
| `hr_attendance` | Attendance: "Use the Attendance kiosk / records." | Attendance, module Team Management | `HR_ATTENDANCE` | `/admin/attendance` |
| `hr_review_attendance` | Review Attendance: "Review and correct attendance records." | Review Attendance, module Team Management | `HR_REVIEW_ATTENDANCE` | `/admin/attendance/review` |
| `hr_payroll` | Payroll: "View and process payroll." | Payroll, module Team Management | `HR_PAYROLL` | `/admin/payroll` |

- Catalogue module. Team Management has `parent: null`, so the three keys are independent toggles with no cascade
  (`access-catalogue.ts:28-32`, `:116-128`).
- Default holders. Only the Super Admin, implicitly (`20260716240000:33-34`). No repository migration grants an `hr_*`
  key to anyone; the only grant backfill in the repository belongs to another module (`20260805140000:16-26`). A new member
  receives only `nav_dashboard` (`team-accounts.ts:340-354`). Which live accounts hold the keys is NEEDS
  VERIFICATION (count-only query in section 8).

Where each key is checked:

| Key | TypeScript | SQL |
|---|---|---|
| `hr_attendance` | page gate (`attendance/page.tsx:43`); page loader (`actions.ts:57-64`) | roster raises without it (`20260907160000:16-19`); no clock RPC checks it |
| `hr_review_attendance` | page gate (`review/page.tsx:22`); `canSeeTeam` (`attendance/page.tsx:49`); loaders (`actions.ts:48`, `:77`) | third branch of `attendance_read` (`20260804140000:13`) |
| `hr_payroll` | page gate (`payroll/page.tsx:30`) | none |

Related keys:

| Key | Role in this area | Evidence |
|---|---|---|
| `export_data_reports` | Shows the Dashboard export button and the Reports report export; the export route does not check it. | `dashboard/page.tsx:92`; `reports/page.tsx:42`; `route.ts:15-25` |
| `initiate_high_risk_action` | Request a deletion; request-only; no Manage Access entry or migration grant; legacy console only (row 8) | `service.ts:502`; `20260715130100:566-571` |
| `view_settings` | PENDING only: one of the audiences allowed to read the whole audit trail. | `20260916120000:290-298` |

Two descriptions overstate their key. `hr_review_attendance` says "review and correct", but correcting is gated by
role title (row 6). `hr_payroll` says "view and process", but generating and marking paid are gated by role title
(rows 11, 12); rate editing is role-gated only in the UI, with no action guard and an unknown RPC gate (row 15). The
template splits these into separate keys (section 4).

## 3. Capability matrix (CURRENT)

### 3.1 Overview

Verdicts only; section 3.2 gives every layer with `file:line` for each cell.

| # | Capability | Staff | Admin | Super Admin |
|---|---|---|---|---|
| 1 | View own attendance | ONLY WITH GRANT `hr_attendance` (page gate, action guard); YES (RLS). CONFLICT | as Staff. CONFLICT | YES |
| 2 | Clock In/Out for self | ONLY WITH GRANT `hr_attendance` (UI, page gate); YES if active (action guard, RPC gate, RLS). CONFLICT | as Staff. CONFLICT | NO (UI); YES (RPC gate, RLS). CONFLICT |
| 3 | Clock In/Out for others (kiosk operator) | ONLY WITH GRANT `hr_attendance` (UI, page gate); YES if active (action guard, RPC gate). CONFLICT | as Staff. CONFLICT | YES |
| 4 | View team attendance | ONLY WITH GRANT `hr_review_attendance` (UI, RLS): rows yes, names no. CONFLICT | as Staff. CONFLICT | YES; names ROLE-GATED (RLS) |
| 5 | Review attendance | ONLY WITH GRANT `hr_review_attendance` (page gate, action guard); selfies YES (RLS). CONFLICT | as Staff. CONFLICT | YES |
| 6 | Correct attendance (clock-out) | NO (UI, action guard, RPC gate); own rows YES by REST (RLS). CONFLICT | ROLE-GATED (action guard, RPC gate). CONFLICT | ROLE-GATED |
| 7 | Delete attendance record (direct) | NO (UI, action guard, RLS) | ROLE-GATED (action guard); UI differs by page. CONFLICT | ROLE-GATED |
| 8 | Request attendance deletion | ONLY WITH GRANT `initiate_high_risk_action` (action guard, RLS); no UI. CONFLICT | same; UI shown; key only on a legacy page. CONFLICT | YES (not offered) |
| 9 | Manage attendance devices | NO (UI, action guard, RPC gate, RLS) | NO | ROLE-GATED |
| 10a | View payroll: own row | ONLY WITH GRANT `hr_payroll` (page gate); YES (RPC gate, RLS). CONFLICT | as Staff. CONFLICT | no own row (excluded) |
| 10b | View payroll: all rows | NO (RPC gate, RLS) | NO (RPC gate, RLS); UI treats Admin as manager. CONFLICT | ROLE-GATED (RPC gate, RLS) |
| 11 | Generate payslip | NO (action guard, RLS); UI still offers Generate. CONFLICT | NO (action guard, RLS); UI shows the form. CONFLICT | ROLE-GATED |
| 12 | Mark payslip paid | NO (UI, action guard, RLS) | ROLE-GATED (UI, action guard); NO (RLS). CONFLICT | ROLE-GATED |
| 13 | Print payroll summary | NO (UI only) | NO (UI only) | ROLE-GATED (UI only) |
| 14 | View employee rates | own rate ONLY WITH GRANT `hr_payroll` (page gate); others NO (UI) | ROLE-GATED (UI); self only (RLS). CONFLICT | ROLE-GATED (UI, RLS) |
| 15 | Edit employee rate | NO (UI); no action guard; RPC gate unknown | ROLE-GATED (UI); no action guard; RPC gate probably NO. CONFLICT | ROLE-GATED (UI); no action guard |
| 16 | Export attendance/payroll data | NO (action guard) although the button shows WITH GRANT `export_data_reports`. CONFLICT | ROLE-GATED (action guard); rows by RLS | ROLE-GATED (action guard) |
| 17 | Manage access/permissions | NO | NO | ROLE-GATED (action guard, RLS) |

The RLS verdicts on attendance writes in rows 2 and 6 describe the repository. The live table and column grants on
`attendance_records` are NEEDS VERIFICATION, because a live-only grants migration has no file in the repository
(section 3.2 rows 2 and 6; section 8).

### 3.2 Enforcement detail

#### Row 1: View own attendance

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | Sidebar entry needs `hr_attendance` (`navigation.ts:91`, `:264-275`); the history list is on the kiosk page | same as Staff | shown |
| Page gate | `canOpenPage('hr_attendance')` else 404 (`attendance/page.tsx:43`) | same as Staff | passes (`guard.ts:178-180`) |
| Action guard | `loadAttendancePageAction` requires `hr_attendance` (`actions.ts:62`) | same as Staff | passes |
| RPC gate | none: the reader queries the table under RLS (`attendance.ts:562-563`) | none | none |
| RLS | self branch, no key needed and no active check (`20260804140000:11`; `20260715130000:28-39`) | same as Staff | `is_owner()` branch (`20260804140000:12`) |
| Verdict | ONLY WITH GRANT `hr_attendance` (page gate, action guard); YES through REST without it (RLS). CONFLICT | same. CONFLICT | YES |

The conflict is harmless (the rows are the member's own) but leaves members without a self view unless they hold the
kiosk key.

#### Row 2: Clock In/Out for self (the operator selects their own name)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | Page and roster need `hr_attendance` (`attendance/page.tsx:43`; `20260907160000:16-19`) | same as Staff | not offered: Super Admins filtered from the roster (`20260907160000:24`) |
| UI (selection) | a member must be selected first (`attendance-clock.tsx:63-65`) | same | same |
| Action guard | no guard in `clockInAction` / `clockOutAction` (`actions.ts:81-105`); domain calls only `requireActiveStaff()` (`attendance.ts:158`, `:211`) | same as Staff | same code path |
| Device gate | TypeScript only, when a device is registered (`attendance.ts:161`, `:214`; gate `:28-48`) | same | same |
| RPC gate | `kiosk_clock_in`: active operator; active, non-demo target, Super Admins included; no key or device check (`20260907120000:25-37`) | same | accepts a Super Admin target (`:30-37`) |
| RPC gate (out) | `kiosk_clock_out`: RECONSTRUCTED; "any active staff" per comment (`20260805160000:2-4`) | same | same |
| RLS | repository: direct REST INSERT of an own row and UPDATE of own rows (`20260717120000:59-72`, grant `:75`) | same as Staff | same, plus UPDATE of any row (`:65-72`) |
| RLS (live) | table and column grants NEEDS VERIFICATION: a live-only grants migration exists (section 8) | same | same |
| PENDING | device-id check on clock-in only (`20260916120000:451-459`) | same | same |
| Verdict | ONLY WITH GRANT `hr_attendance` (UI, page gate); YES if active (action guard, RPC gate, repository RLS). CONFLICT | same. CONFLICT | NO (UI); YES (RPC gate, repository RLS). CONFLICT |

The REST path bypasses the kiosk, the device gate, the selfie and the audit event. The Super Admin-only self functions
`clockIn` / `clockOut` (`attendance.ts:252-339`) have no caller and are dead code.

#### Row 3: Clock In/Out for others (kiosk operator)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI (access) | as row 2 | as row 2 | roster lists every active member except Super Admins (`20260907160000:20-25`) |
| UI (status) | open-session and last-clock-out maps are read under RLS (`attendance.ts:111-146`; `attendance-clock.tsx:66-71`) | same as Staff | complete (`20260804140000:12`) |
| UI (effect) | without `hr_review_attendance` every other member looks not clocked in: Clock Out is never offered for them | same as Staff | n/a |
| Action guard | active staff only; the target is the posted id (`attendance.ts:154-169`, `:210-220`) | same | same |
| Device gate | fail-open: a gating-read error counts as "no gating" (`devices.ts:38-42`) | same | same |
| RPC gate | `kiosk_clock_in` clocks any active non-demo id for any active operator (`20260907120000:25-37`) | same | same |
| RLS | not involved: the definer function writes (the clock-out function is RECONSTRUCTED) | same | same |
| Verdict | ONLY WITH GRANT `hr_attendance` (UI, page gate, roster); YES if active (action guard, RPC gate). CONFLICT | same. CONFLICT | YES |

#### Row 4: View team attendance

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | summary cards and staff filter need `canSeeTeam` (`attendance/page.tsx:49`, `:121`; `attendance-records.tsx:228`) | same as Staff | shown |
| Page gate | Attendance page on `hr_attendance` (`attendance/page.tsx:43`) or Review page on `hr_review_attendance` (`review/page.tsx:22`) | same | passes |
| RLS (rows) | third branch `has_permission('hr_review_attendance')` (`20260804140000:13`) | same | `is_owner()` |
| RLS (names) | rows embed `full_name` (`attendance.ts:562-570`); `staff_profiles_read` is Super Admin-or-self (`20260821140000:21-22`) | same | names via `is_owner()` |
| UI (effect) | other members' names are null and render as a dash (`review-attendance-view.tsx:373`) | same as Staff | n/a |
| Verdict | ONLY WITH GRANT `hr_review_attendance` (UI, RLS): rows YES, names NO. CONFLICT | same. CONFLICT | YES; names ROLE-GATED (RLS) |

The export sheet has the same blind spot (`data-export.ts:529`, `:537-540`). The only escape would be a live-only
second `staff_profiles` SELECT policy: NEEDS VERIFICATION (section 8).

#### Row 5: Review attendance (Review page, day details, selfies)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| Page gate | `canOpenPage('hr_review_attendance')` (`review/page.tsx:22`) | same | passes |
| Action guard | page loader and selfie loader require `hr_review_attendance` (`actions.ts:77`, `:48`) | same | passes |
| RPC gate | the employee filter reads `list_clock_staff`, gated on `hr_attendance` (`20260907160000:16-19`); without it the roster is empty (`attendance.ts:96-108`) | same | passes |
| RLS (rows) | as row 4 | as row 4 | as row 4 |
| RLS (selfies) | `attachments_read` and the bucket read policy allow any active staff (`20260716300000:127-129`, `:159-161`) | same | same |
| Verdict | ONLY WITH GRANT `hr_review_attendance` (page gate, action guard); selfie data YES without it (RLS). CONFLICT | same. CONFLICT | YES |

The comment "RLS-scoped exactly like the records" (`attendance.ts:468-470`) does not match those policies. The storage
exposure is an open item of the repository's own audit (`docs/SYSTEM-AUDIT-2026-09-16.md:128`).

#### Row 6: Correct attendance (clock-out)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | hidden: `canManage` is role-derived (`review/page.tsx:35-36`; `review-attendance-view.tsx:624-629`) | shown on the Review page, reachable only WITH GRANT `hr_review_attendance` | shown |
| Action guard | the action has no guard (`actions.ts:165-183`); the domain calls `requireOwnerOrAdmin()` (`attendance.ts:405-406`) | passes by role (`guard.ts:325-335`) | passes |
| RPC gate | `correct_attendance_clock_out` refuses a NULL or other role (`20260907130000:29-33`) | passes by role; no key; DEFINER, so any record id (`:13-22`, `:55-59`) | passes |
| Deactivated JWT | n/a | passes the live RPC gate (`20260715130000:47-58`) until PENDING (`20260916120000:46-57`) | same as Admin |
| RLS | repository: REST UPDATE of any column of own rows (`20260717120000:65-72`, `:75`); night trigger INSERT-only (`20260722200000:46-49`) | same as Staff | repository: any row (`:65-72`) |
| RLS (live) | table and column grants NEEDS VERIFICATION: a live-only grants migration exists (section 8) | same | same |
| Verdict | NO (UI, action guard, RPC gate); own rows YES by REST (repository RLS). CONFLICT | ROLE-GATED (action guard, RPC gate); UI needs a grant. CONFLICT | ROLE-GATED |

#### Row 7: Delete attendance record (direct)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | hidden (`attendance/page.tsx:79`; `review/page.tsx:36`) | Review page: direct Delete (`review-attendance-view.tsx:624-629`, `:807-812`) | direct Delete on both pages |
| UI (Attendance page) | hidden | "Request delete" instead of Delete (`attendance-day-details.tsx:138-150`) | direct (`attendance-day-details.tsx:140`) |
| Action guard | typed `DELETE` checked server-side (`actions.ts:143-148`); `requireOwnerOrAdmin()` refuses (`attendance.ts:351-352`) | passes by role | passes |
| RPC gate | `delete_attendance_record`: RECONSTRUCTED; role gate per comments only (`attendance.ts:341-347`; `guard.ts:316-324`; `20260907130000:7`) | same; NEEDS VERIFICATION | same |
| RLS | no DELETE grant to `authenticated` (`20260717120000:49`, `:75`) | same | same |
| Approvals | n/a | n/a | executes approved requests through the same RPC (`service.ts:653`, `:735-738`) |
| Verdict | NO | ROLE-GATED (action guard); request on one page, delete on the other. CONFLICT | ROLE-GATED |

#### Row 8: Request attendance deletion

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | not shown: it needs `canManage` without `isOwner`, which only an Admin has (`attendance-day-details.tsx:83-87`, `:138-150`) | shown on the Attendance page | not offered (direct delete) |
| Action guard | no role check (`actions.ts:190-204`) -> `request-deletion.ts:15-28` -> `requirePermission('initiate_high_risk_action')` (`service.ts:502`) | same | passes (implicit key) |
| RLS | `approvals_insert`: key or `is_owner()`, self-attributed (`20260715130100:566-571`) | same | passes |
| Grantability | request-only seed (`20260715120100:78-80`); not in Manage Access (`access-catalogue.ts:37-129`); no migration grant; legacy console only (below) | same | n/a |
| Verdict | ONLY WITH GRANT `initiate_high_risk_action` (action guard, RLS); no UI. CONFLICT | same grant; UI shown, but the key is granted only on a legacy page. CONFLICT | YES (not offered) |

How the key can be granted. The key is absent from the Manage Access catalogue and never granted by a migration, but it
is not ungrantable. The legacy `/admin/staff` page renders for the Super Admin only (`admin/staff/page.tsx:34-41`, `:99`)
and has no sidebar entry; it is reachable by URL. Its console offers a "Grant a permission" select built from every
value of `PERMISSIONS` (`src/components/admin/staff-console.tsx:35`, `:109`, `:173-195`), which includes this key
(`permissions.ts:41`). The action accepts any `PERMISSIONS` value (`src/lib/authz/actions.ts:40-41`, `:48-60`), the domain
function calls `requireOwner()` and upserts the grant (`src/lib/authz/account-management.ts:35-49`), and the table grant
and insert policy allow the Super Admin (`20260715130100:27`, `:90-91`). A later Manage Access save keeps the grant, because keys outside
the catalogue are preserved (`team-accounts.ts:247-255`). So the Admin request path fails by default on a fresh install
and works only after a Super Admin grants the key on that legacy page.

Whether any live grant of the key exists is NEEDS VERIFICATION (count query in section 8). Requests, including the
label with a member name and date, are readable by every active staff member through REST
(`20260715130100:560-561`; `docs/SYSTEM-AUDIT-2026-09-16.md:156`).

#### Row 9: Manage attendance devices (register, list, revoke)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | device manager only when `isOwner` (`attendance/page.tsx:80`, `:107`) | same | shown |
| Action guard | `requireOwner()` in register and revoke (`devices.ts:69`, `:104`); `listDevices` has no guard (`devices.ts:121-137`) | same | passes |
| RPC gate | register and revoke: inline active `role_key = 'owner'` check, equal to `is_owner()`, not a call to it (`20260722150000:46-48`, `:75-77`) | same | passes |
| RPC grants | anon EXECUTE revoked on the device functions (`20260722170000:8-18`) | same | same |
| RLS | Super Admin-only read (`20260722180000:5-14`); no write policy; RLS enabled, not forced (`20260722150000:30`) | same | reads all |
| Verdict | NO | NO | ROLE-GATED |

`attendance_gating_active()` and `verify_attendance_device(token)` are callable by any authenticated user
(`20260722150000:58-70`; `20260722170000:8-12`).

#### Row 10: View payroll (own row / all rows)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| Page gate | `canOpenPage('hr_payroll')` (`payroll/page.tsx:30`); sidebar `navigation.ts:93` | same | passes |
| UI | own row only | `canManagePayroll` by role (`payroll/page.tsx:42-44`) passed to the table (`attendance-view.tsx:68`, `:227`) | all rows |
| RPC gate | `report_payroll` is INVOKER (`20260907160000:29-34`); row filter self or `is_owner()` (`:100`) | same | `is_owner()` branch: active, non-demo, not Super Admin (`:97-100`) |
| RPC grant | repository: EXECUTE to `authenticated` (`20260721100000:73-74`); live function re-created out of band: NEEDS VERIFICATION | same | same |
| RLS | payslips: own, or all for `is_owner()` (`20260722210000:51-55`) | same | all |
| Verdict (own row) | ONLY WITH GRANT `hr_payroll` (page gate); YES without it through the RPC and REST (RPC gate, RLS). CONFLICT | same. CONFLICT | no own row: excluded (`20260907160000:99`) |
| Verdict (all rows) | NO (RPC gate, RLS) | NO (RPC gate, RLS) while the UI treats the role as a manager. CONFLICT | ROLE-GATED (RPC gate, RLS) |

#### Row 11: Generate payslip

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI (trigger) | "Generate Payslip" row button always rendered when no snapshot exists (`payslip-button.tsx:253-261`; `attendance-view.tsx:222-228`) | same | shown |
| UI (modal) | footer Generate needs only "no snapshot" (`payslip-button.tsx:240-249`); input replaced by "ask" copy (`:294-298`) | same; input on `canManage` (`:276-293`) | shown |
| Action guard | `requireOwner()` (`payslip-actions.ts:27-34`) | refused | passes |
| RPC gate | repository function is INVOKER (`20260722210000:83`) and granted to `authenticated` (`:134-135`); live body RECONSTRUCTED | same | same |
| RLS | insert `with check (is_owner())` (`20260722210000:58-60`) | refused | passes |
| Verdict | NO (action guard, RLS) while the UI still offers Generate on the own row. CONFLICT | NO (action guard, RLS) while the UI offers the form. CONFLICT | ROLE-GATED |

A Staff member who holds `hr_payroll` therefore sees Generate on their own row and in the modal footer, and the click
ends in the action guard's refusal message.

#### Row 12: Mark payslip paid

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | hidden (`payslip-button.tsx:234-238`) | "Mark as Paid" on a pending snapshot it can read (own only, RLS) | shown |
| Action guard | `requireOwnerOrAdmin()` refuses (`payslip-actions.ts:106`) | passes by role; direct UPDATE of pending rows (`:124-135`) | passes |
| RPC gate | none: there is no mark-paid function | none | none |
| RLS | update `using / with check (is_owner())` (`20260722210000:62-65`) | repository: zero rows, the action reports failure (`payslip-actions.ts:137-143`) | passes; not column-restricted |
| Verdict | NO | ROLE-GATED (UI, action guard); NO (RLS, repository). CONFLICT | ROLE-GATED |

The `paid_at` / `paid_by` columns come from a migration missing from the repository, so the live update policy may
have been widened: NEEDS VERIFICATION (section 8). The file docstring still calls mark-paid one of the "Owner acts"
(`payslip-actions.ts:12-15`).

#### Row 13: Print payroll summary

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | button only when `isOwner` and rows exist (`attendance-view.tsx:98-105`) | same | shown |
| Server | none: a client-side print of rows `report_payroll` already returned | none | none |
| Payslip print and PDF | anyone who can read the snapshot (`payslip-button.tsx:223-233`) | same | same |
| Verdict | NO (UI only) | NO (UI only) | ROLE-GATED (UI only) |

No server gate is needed because the printed data is already RLS-scoped.

#### Row 14: View employee rates

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | no Rates tab (`payroll/page.tsx:43-44`, `:57`; `payroll-tabs.tsx:49`) | Rates tab by role (`payroll-tabs.tsx:76`) | Rates tab and inline editor |
| UI (own rate) | own daily rate on the own payroll row (`attendance-view.tsx:184-196`) | same | all rows |
| Reader | `listEmployeeRates` has no guard (`rate.ts:128-144`); the page calls it for the role only (`payroll/page.tsx:44`) | same | same |
| RLS (profiles) | n/a | Super Admin-or-self (`20260821140000:21-22`): the tab lists only the Admin | all via `is_owner()`; reader keeps active, non-demo, not Super Admin (`rate.ts:134-137`) |
| RLS | `staff_salary_rates`: RECONSTRUCTED; policies NEEDS VERIFICATION | same | same |
| Export | team sheet with rates is Super Admin only by role (`sections.ts:24`; `data-export.ts:138-139`, `:776-789`) | refused | allowed |
| Verdict | own rate ONLY WITH GRANT `hr_payroll` (page gate), subject to rate-table RLS; others NO (UI) | ROLE-GATED (UI); self only (RLS). CONFLICT | ROLE-GATED (UI, RLS) |

#### Row 15: Edit employee rate

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | no editor | Rates tab Edit (`employee-rates-view.tsx:211-215`); inline editor hidden (`attendance-view.tsx:182-183`) | both editors |
| Action guard | none: `setHourlyRateAction` (`actions.ts:206-228`, comment claims "Owner-only") -> `setSalaryRate` validates input only (`rate.ts:201-231`) | none | none |
| RPC gate | `set_staff_salary_rate`: RECONSTRUCTED; comment "Super Admin only" (`rate.ts:198-199`); a dead-path comment says "Owner or Selected Admin" (`rate.ts:24-29`) | same | same |
| RLS | rate table RECONSTRUCTED; legacy `staff_profiles.hourly_rate` is Super Admin-only (`20260715130100:75-78`), no longer the pay basis (`rate.ts:146-147`) | same | same |
| Verdict | NO (UI); unguarded action; RPC gate unknown. NEEDS VERIFICATION | ROLE-GATED (UI); probably NO (RPC gate, per comment). CONFLICT, NEEDS VERIFICATION | ROLE-GATED (UI); unguarded action |

#### Row 16: Export attendance / payroll data

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | Dashboard export button on `export_data_reports` (`dashboard/page.tsx:92`; `dashboard-view.tsx:263-270`) | same, plus Reports Export All by role (`reports/page.tsx:44`, `:67-71`) | shown |
| Page gate | Reports page needs `view_reports` (`reports/page.tsx:33`) | Export All is reachable only WITH GRANT `view_reports` | passes |
| Action guard (route) | `requireOwnerOrAdmin()` else 403 (`route.ts:15-25`); `export_data_reports` not checked | passes by role | passes |
| RLS (rows) | n/a | attendance: own rows unless `hr_review_attendance` (`data-export.ts:523-536`); payroll: own row (`:564-568`) | all rows |
| Sensitive sheets | n/a | team sheet refused (`sections.ts:24`; `data-export.ts:138-139`) | allowed |
| Verdict | NO (action guard) while the button shows WITH GRANT `export_data_reports`. CONFLICT | ROLE-GATED (action guard); rows by RLS | ROLE-GATED (action guard) |

The repository audit lists the export gating as open (`docs/SYSTEM-AUDIT-2026-09-16.md:153`).

#### Row 17: Manage access / permissions (including the `hr_*` keys)

| Layer | Staff | Admin | Super Admin |
|---|---|---|---|
| UI | none | none | Settings team panel (`settings/page.tsx:115-120`, `:169-177`); legacy staff page by role, URL only, grant select for every key (`admin/staff/page.tsx:31-41`) |
| Action guard | `requireOwner()` (`team-accounts.ts:128`, `:180`, `:232`) | same | passes; module cascade re-applied, non-catalogue grants kept (`:240-255`) |
| Action guard (legacy) | `requireOwner()` in the legacy grant path (`src/lib/authz/account-management.ts:35-49`) | same | passes; any `PERMISSIONS` key (`src/lib/authz/actions.ts:48-60`) |
| RPC gate | role and grant functions RECONSTRUCTED (`team-accounts.ts:167-171`, `:220-224`) | same | per comments: no self-edit, no Super Admin target, Primary only for Super Admin changes |
| RLS | grants and profiles writable by the Super Admin only (`20260715130100:72-78`, `:90-95`) | same | passes |
| Triggers | n/a | n/a | Super Admin-only Admin promotion (`20260715130200:98-139`); PENDING floor: the last active non-demo Super Admin stays (`20260916120000:230-279`) |
| Primary | n/a | n/a | the Primary Super Admin can never be demoted, per the caller's comment; RPC RECONSTRUCTED (`team-accounts.ts:167-171`) |
| Member delete | refused (`20260722120000:24-31`) | same | `delete_team_member`: active Super Admin, no self-delete (`:24-43`); PENDING: refuses a Super Admin target (`20260916120000:206-208`) |
| Verdict | NO | NO | ROLE-GATED |

### 3.3 Other authorization facts in this area

| Capability | CURRENT | Evidence |
|---|---|---|
| Attach a selfie | Any active staff member, to any `attendance_record` id; nothing checks that the record exists or relates to the operator. | `upload.ts:36-42`, `:67-72`; `20260716300000:137-142` |
| Read the audit trail (live) | Any active staff, including rate and net-salary contexts. | `20260715130100:661-662`; `rate.ts:233-238`; `payslip-actions.ts:88-93` |
| Read the audit trail (PENDING) | Super Admin, Admin by role title, `view_settings` holders. | `20260916120000:290-298` |
| Decide and execute approvals | Super Admin only (page, action guard, RLS). | `src/app/(app)/approvals/page.tsx:22-24`; `guard.ts:346-356`; `20260715130100:576-579` |
| MFA step-up | Not enforced for any HR action. | `guard.ts:373-380` |
| Mobile API access | None: no file under `src/app/api` or `src/lib/mobile` names these objects. | grep for attendance, payroll, salary, `hr_` |
| Web export route | Reads them only through `data-export.ts` (row 16). | `route.ts:15-25` |

### 3.4 Conflict index

| Rows | Disagreeing layers | Root cause |
|---|---|---|
| 1, 2, 3 | UI needs `hr_attendance`; action guard, RPC gate and RLS need only an active session | The kiosk key gates the page and roster, not the write. |
| 2 | Roster excludes Super Admins; RPC gate and RLS accept a Super Admin target | Exclusion lives in the roster only. |
| 3 | Operator may clock others; status reads are RLS-limited | Status comes from table reads, not from a permission-scoped reader. |
| 4 | RLS returns team rows; profile RLS withholds names | No reviewer branch for names. |
| 5 | Action guard needs `hr_review_attendance`; attachments and storage RLS need only an active session | Selfie policies were never scoped. |
| 6 | App refuses Staff; repository RLS lets Staff rewrite own rows (live grants NEEDS VERIFICATION) | Table-wide INSERT/UPDATE grant plus self policies. |
| 7 | Attendance page requests, Review page deletes, for the same Admin | Two components, two rules. |
| 8 | UI offers a request; the key is granted by no migration and missing from Manage Access | Only grant path is the legacy Super Admin console, so the request fails by default. |
| 10b, 11, 14, 15 | UI treats Admin as payroll manager; RPC gate, action guard or RLS refuse | UI flags are role-derived while the data layer is Super Admin-or-self. |
| 11 (Staff) | UI offers Generate on the own row and in the modal footer; action guard and RLS refuse | Generate controls are not gated on `canManage`; only the deductions input is. |
| 12 | Action guard allows Admin; repository RLS refuses | Update policy never widened in the repository. |
| 15 | No action guard; RPC gate unknown | Authority delegated to a function whose DDL is missing. |
| 16 | Button on `export_data_reports`; route on role | Inconsistent export gating. |

## 4. GENERIC permission model for the template

### 4.1 Principles

1. Authority comes from permission keys. A role title only selects a default grant set (section 5). The Super Admin
   implicit-all rule, `has_permission(key) = is_owner() or an explicit grant of an active profile`, stays as written.
2. The role-title gates of the reference implementation for correct, delete, rate edits, payslip generation,
   mark-paid, device management and export become permission gates.
3. Every gate is enforced in the RPC or RLS layer. TypeScript guards mirror the same key for messages; UI flags come
   from the granted-key set, never from `role_key === ...` and never from a prop that defaults to true (the Review
   component's `canManage` defaults to `true`, `review-attendance-view.tsx:81`).
4. Attendance sessions, rates and payslips are written only through SECURITY DEFINER functions. `authenticated`
   keeps SELECT only on those tables, so the kiosk, the device rule, the correction reason and the audit event cannot
   be bypassed by REST.
5. Every identity helper refuses an inactive profile, including the profile-id helper; a role or permission gate
   treats NULL as refusal. Carry the PENDING `'inactive'` sentinel forward (`20260916120000:40-57`).
6. Names and per-member status for operators and reviewers come from permission-scoped definer readers (the
   `list_clock_staff` pattern, `20260907160000:9-27`), never from a `staff_profiles` embed under Super Admin-or-self RLS.
7. Own-row access (own sessions, own payroll row, own payslips, own rate) needs no key. For sessions, the payroll row
   and payslips this is how the CURRENT self branches already behave (`20260804140000:11`; `20260907160000:100`;
   `20260722210000:54`). For the own rate it is NEEDS VERIFICATION in CURRENT, because the `staff_salary_rates`
   policies are RECONSTRUCTED; even the payroll row's rate depends on them, because the INVOKER report reads the rate
   table under the caller's RLS (`20260907160000:59-74`). Whether a self-service screen exists is CONFIGURABLE.
8. Every key checked anywhere is listed in the access catalogue, and every dependency between keys is checked by
   the grant function on the server, not only by the modal.
9. Every function created by a template migration revokes EXECUTE from PUBLIC and `anon` in the same migration.

### 4.2 Recommended keys

| Key | Allows | Replaces (CURRENT) |
|---|---|---|
| `attendance.clock_operate` | Open the kiosk page; read roster and kiosk status; clock a selected eligible member | `hr_attendance` (`attendance/page.tsx:43`; `20260907160000:16-19`) |
| `attendance.view_team` | Read every member's sessions and names; team cards; employee filter | `attendance_read` third branch (`20260804140000:13`); `attendance/page.tsx:49` |
| `attendance.review` | Open Review Attendance; day details; clock-in and clock-out photos | `hr_review_attendance` on the page and loaders (`review/page.tsx:22`; `actions.ts:48`, `:77`) |
| `attendance.correct` | Correct a clock-out, with a mandatory reason | role title (`attendance.ts:406`; `20260907130000:29-33`) |
| `attendance.delete` | Delete an attendance session | role title (`attendance.ts:352`; RPC RECONSTRUCTED) |
| `attendance.devices.manage` | Register, list and revoke kiosk devices | role title (`devices.ts:69`, `:104`; `20260722150000:46-48`, `:75-77`; `20260722180000:5-14`) |
| `payroll.view_all` | Read every payroll row, rate and payslip; print the period summary | `is_owner()` (`20260907160000:100`; `20260722210000:54`); `attendance-view.tsx:98` |
| `payroll.rates.edit` | Append an effective-dated rate row | UI role (`payroll-tabs.tsx:49`; `attendance-view.tsx:182`); no action guard (`rate.ts:201-231`) |
| `payroll.payslip.generate` | Generate a frozen payslip for a period | role title (`payslip-actions.ts:28`; `20260722210000:58-60`) |
| `payroll.payslip.mark_paid` | Move a pending payslip to paid | action guard role (`payslip-actions.ts:106`) versus Super Admin-only RLS (`20260722210000:62-65`) |
| `payroll.export` | Export the attendance and payroll sheets | route role (`route.ts:18`); button key `export_data_reports` (`dashboard/page.tsx:92`) |

Not in the list, on purpose:

- `hr_payroll` (page key). No separate key. The Payroll page opens for holders of any `payroll.*` key except
  `payroll.export`, and for every eligible employee when the self view is enabled (CONFIGURABLE). A client that
  wants a page-only toggle may keep one; it gates the page, never data.
- The `initiate_high_risk_action` request path. Dropped by default: deletion is governed by `attendance.delete`
  alone. A client that enables a deletion-approval queue adds the optional key `attendance.delete.request`, lists it
  in the access catalogue and checks it in the queue's insert policy; a holder of `attendance.delete` then executes
  the approved request through the same delete function (section 6, item 2). The CURRENT key is not ungrantable: a
  Super Admin can grant it on the legacy console (row 8). Any shorter "cannot be granted" description of it means
  "absent from Manage Access and from every migration; grantable only on the legacy console".
- Print payroll summary. Folded into `payroll.view_all`, consistent with `PAYROLL.md`; the printed data is already
  RLS-scoped.
- Day approval (optional module, `payroll.approvalRequired`; NOT IN THE REFERENCE). No separate key by default: day
  approval reuses `attendance.correct` (`review_attendance_day`, `DATABASE.md` sections 5.5 and 5.13) unless the client
  adds a key, which is then listed in the access catalogue and requires `attendance.review`.
- Manage access. Stays with the host application's access module: Super Admin only, with a primary flag instead of an
  email constant (section 6, item 20).
- Timekeeping exemption. Not a permission: an eligibility rule checked in the roster, the clock functions and the
  payroll report. Its shape is in `DATABASE.md` and `CONFIGURATION.md`.
- The write-side gap. CURRENT clock writes check only an active session (`attendance.ts:158`, `:211`;
  `20260907120000:25-28`); `attendance.clock_operate` closes it in the RPC (section 6, item 3).

### 4.3 Key dependencies and page access (GENERIC)

| Key | Requires | Page it opens |
|---|---|---|
| `attendance.clock_operate` | none | Attendance (kiosk) |
| `attendance.devices.manage` | `attendance.clock_operate` (the device manager lives on the kiosk page) | none of its own |
| `attendance.view_team` | none | team history and summary cards on the Attendance page when the page is open |
| `attendance.review` | `attendance.view_team` | Review Attendance |
| `attendance.correct`, `attendance.delete` | `attendance.review` (the controls live in day details) | none of their own |
| `payroll.view_all` | none | Payroll |
| `payroll.rates.edit`, `payroll.payslip.generate`, `payroll.payslip.mark_paid` | `payroll.view_all` (the operator must see the employee's row) | Payroll |
| `payroll.export` | none; rows stay scoped by `attendance.view_team` and `payroll.view_all` | export control on the host's reports screen |
| no key (self-service mode only) | `attendance.clockMode = 'self_service'` and an eligible caller | self-service clock page, where the caller clocks only themselves |

The dependency check belongs in the grant-saving function, as CURRENT already re-applies its module cascade on the
server (`team-accounts.ts:240-246`). Each RPC gate checks only its own key, with one exception:
`generate_payslip_snapshot` also requires `payroll.view_all`, because it reads the caller-filtered payroll lines
(`DATABASE.md` section 5.13).

Self-service clock page (NOT IN THE REFERENCE; RECOMMENDED TEMPLATE IMPROVEMENT; `CONFIGURATION.md` section 2.4). When a
client sets `attendance.clockMode` to `self_service`, the clock page opens for every eligible employee without a key,
following principle 7 (own-row access needs no key) and the same pattern as the payroll self view (`payroll.selfView`).
The page calls only `self_clock_in` and `self_clock_out` (`DATABASE.md` section 5.13), which take no employee id. In
`kiosk` mode that page does not exist and the kiosk page keeps `attendance.clock_operate`. A client that wants a key
on the self-service page instead confirms it in `IMPLEMENTATION_PROMPT.md` question Q4 and lists that key in its access
catalogue (principle 8).

### 4.4 Enforcement contract

| Gate | Authoritative layer | TypeScript mirror | RLS and grants |
|---|---|---|---|
| Open a page | page gate from the granted-key set | same | n/a |
| Clock in / out | RPC: operator holds `attendance.clock_operate`; eligible target; token hash valid when gated | action guard (message) | sessions: no INSERT or UPDATE grant |
| Kiosk status and roster names | definer readers `list_clock_staff`, `attendance_status`: `attendance.clock_operate` or `attendance.view_team` | none | id, display name, status only |
| Read sessions | RLS: self, or `attendance.view_team` | none | forced RLS |
| Read names for review | definer reader gated on `attendance.view_team` | none | no reviewer widening of the profile table |
| Read photos | RLS on photo metadata and storage: subject, or `attendance.review` | action guard | forced RLS |
| Attach a photo | RPC `attach_attendance_photo`: record exists; caller holds `attendance.clock_operate` AND is the operator recorded on that session for that kind (`clock_in_by` or `clock_out_by`) AND the storage path lies under that session prefix for that kind | action guard | no direct insert |
| Correct | RPC gate on `attendance.correct`; active check via the sentinel; reason required | action guard | no direct update |
| Delete | RPC gate on `attendance.delete` | action guard; typed confirmation | no DELETE grant |
| Devices | RPC gate on `attendance.devices.manage` | action guard | read policy on the same key; forced RLS; explicit grants |
| Payroll rows | filter inside the definer `app_private.payroll_lines`: self, or `payroll.view_all`; wrapper adds none | none | rate and snapshot reads: self, or `payroll.view_all` |
| Rates | RPC gate on `payroll.rates.edit` | action guard | no direct insert or update |
| Generate | RPC gate on `payroll.payslip.generate` and `payroll.view_all` (the one exception of section 4.3) | action guard | no direct insert |
| Mark paid | RPC gate on `payroll.payslip.mark_paid`; changes status columns only | action guard | no direct update; figures frozen by trigger |
| Void | RPC gate on `payroll.payslip.generate`; reason required; only when the void path is built | action guard | no direct update; paid facts kept |
| Export | route gate on `payroll.export`; sheets read under the caller's RLS | n/a | as above; rate sheet additionally needs `payroll.view_all` |
| Manage access | RPC gate: Super Admin; primary flag for Super Admin changes; dependency checks | action guard | grants and profiles writable by the Super Admin only; last-Super-Admin floor |

Generic function names for these gates are defined in `DATABASE.md`; this document refers to the CURRENT names only as
anchors.

### 4.5 CURRENT patterns kept as GENERIC

- `has_permission` with the implicit Super Admin rule and the active check (`20260716240000:26-44`).
- Fail-closed grant reads (`guard.ts:189-192`) and 404 page gates (`attendance/page.tsx:43`).
- SECURITY DEFINER with `set search_path = ''` and identity from `auth.uid()` only (`20260715130000:28-39`).
- A permission-scoped definer roster returning name and role only (`20260907160000:9-27`).
- Explicit revoke from PUBLIC and `anon` (`20260907130000:65-68`; `20260722170000:8-18`).
- A NULL-safe role check (`20260907130000:30`) and the `'inactive'` sentinel (PENDING, `20260916120000:53`).
- Server-side re-application of the catalogue cascade (`team-accounts.ts:240-255`).

## 5. Default grant sets per role for a new client (PROPOSAL)

This is a proposal, not a description of the reference implementation, where no migration grants any `hr_*` key and
a new member receives only `nav_dashboard` (section 2). Defaults are seed data a client edits in its access screen,
not code. Rule used to derive them: an Admin receives the actions the reference implementation already gives the Admin
role title and that no server layer in the repository refuses (correct, delete, export), plus the read keys needed to
reach them; every action the reference implementation reserves to the Super Admin at the server, or where its layers
conflict (generate, mark paid, rate edits, all-rows payroll, device management), stays with the Super Admin until the
client delegates it; Staff receive nothing beyond own-row access.

| Key | Staff | Admin | Super Admin | Basis |
|---|---|---|---|---|
| `attendance.clock_operate` | no | no | implicit | CURRENT grants the kiosk key to nobody by default; the client grants it to its kiosk operators. |
| `attendance.view_team` | no | yes | implicit | Required by `attendance.review`. |
| `attendance.review` | no | yes | implicit | Required to reach correct and delete. |
| `attendance.correct` | no | yes | implicit | CURRENT action guard and RPC gate allow Admin by role (row 6). |
| `attendance.delete` | no | yes | implicit | CURRENT action guard and Review page allow Admin (row 7); RPC gate NEEDS VERIFICATION. |
| `attendance.devices.manage` | no | no | implicit | CURRENT: Super Admin at every layer (row 9). |
| `payroll.view_all` | no | no | implicit | CURRENT: Super Admin only (row 10). |
| `payroll.rates.edit` | no | no | implicit | CURRENT layers conflict; the stricter one wins (row 15). |
| `payroll.payslip.generate` | no | no | implicit | CURRENT: Super Admin at every server layer (row 11). |
| `payroll.payslip.mark_paid` | no | no | implicit | CURRENT layers conflict; repository RLS refuses Admin (row 12). |
| `payroll.export` | no | yes | implicit | CURRENT route allows Admin by role; rows stay scoped (row 16). |

Self views (CONFIGURABLE, default off): the reference implementation shows a member their own sessions or payroll row
only when they hold a page key, so the proposal ships both self-service screens disabled. Own-row data access stays
implicit either way (principle 7).

Common delegations (examples a client may apply, not defaults):

| Duty | Keys |
|---|---|
| Kiosk operator | `attendance.clock_operate` |
| Kiosk device administrator | `attendance.clock_operate`, `attendance.devices.manage` |
| Payroll officer | `payroll.view_all`, `payroll.rates.edit`, `payroll.payslip.generate`, `payroll.payslip.mark_paid`, `payroll.export` |

## 6. RECOMMENDED TEMPLATE IMPROVEMENTS

Each item names the gap in the reference implementation and the template fix. None is a change to production.

1. Reviewer names are hidden. CURRENT: an `hr_review_attendance` holder who is not a Super Admin receives team rows with
   null names, because the reader embeds `staff_profiles` (`attendance.ts:562-570`) and `staff_profiles_read` is
   Super Admin-or-self (`20260821140000:21-22`); the UI shows a dash (`review-attendance-view.tsx:373`) and the export shows the same
   placeholder (`data-export.ts:537-540`). Template: serve review rows and names through a definer reader gated on
   `attendance.view_team`, as the roster already does (`20260907160000:9-27`).
2. The deletion-request key has a hidden, legacy-only grant path. CURRENT: `initiate_high_risk_action` is required
   (`service.ts:502`; `20260715130100:566-571`) but absent from the Manage Access catalogue (`access-catalogue.ts:37-129`)
   and never granted by a migration (only backfill: `20260805140000:16-26`). The only way to grant it is the legacy
   Super Admin console at `/admin/staff`, which has no navigation entry (`src/components/admin/staff-console.tsx:173-195`;
   `src/lib/authz/actions.ts:48-60`; `src/lib/authz/account-management.ts:35-49`). The Admin "Request delete" path
   therefore fails on a fresh install until a Super Admin grants the key on that page. Template: drop the request path
   (delete on `attendance.delete` only), or add the optional key `attendance.delete.request`, list it in the catalogue
   and check it in the queue's insert policy.
3. The kiosk write does not check the kiosk key. CURRENT: `clockInAction` / `clockOutAction` have no guard
   (`actions.ts:81-105`), the domain checks only `requireActiveStaff()` (`attendance.ts:158`, `:211`), and
   `kiosk_clock_in` checks only `is_active_staff()` (`20260907120000:25-28`). Template: check
   `attendance.clock_operate` inside both clock functions, mirrored in the action.
4. Admin payroll is self-only. CURRENT: the page gives Admin `canManagePayroll` and the Rates tab
   (`payroll/page.tsx:42-44`, `:57`), while `report_payroll` filters to self or `is_owner()` (`20260907160000:100`) and the
   rates reader sees only the Admin (`20260821140000:21-22`). Template: `payroll.view_all` in the caller filter inside
   `app_private.payroll_lines` (`DATABASE.md` section 5.13) and in the snapshot and rate read policies; controls
   rendered from the same key.
5. Mark-paid conflict between TypeScript and RLS. CURRENT: `requireOwnerOrAdmin()` (`payslip-actions.ts:106`) versus
   `payroll_snapshots_update` Super Admin-only (`20260722210000:62-65`). Template: a definer mark-paid function gated on
   `payroll.payslip.mark_paid` that changes status columns only; no direct update policy.
6. `setSalaryRate` has no TypeScript guard. CURRENT: `setHourlyRateAction` and `setSalaryRate` validate input only
   (`actions.ts:206-228`; `rate.ts:201-231`) and delegate authority to a RECONSTRUCTED function whose comments
   disagree (`rate.ts:24-29` versus `:198-199`). The static authorization sweep cannot see this, because its write
   detector matches only table insert, update and delete calls, not `.rpc(` calls
   (`tests/integration/phase11-authorization-boundary.test.ts:27-30`). Template: ship the rate function DDL gated on
   `payroll.rates.edit`, add the matching action guard, and make the sweep include RPC calls and assert per export.
7. Direct REST writes to attendance rows. CURRENT: self INSERT and UPDATE policies plus a table-wide grant
   (`20260717120000:59-75`) let any profile insert or rewrite its own sessions, including night columns; the night
   trigger fires on INSERT only (`20260722200000:46-49`). That is the repository state. A live-only migration named
   `fix_payroll_grants_and_delete_all_where` has no file in the repository and may have changed these grants, so the
   live table and column grants are NEEDS VERIFICATION (section 8). Template: SELECT-only grants; all writes through
   definer functions.
8. The device rule is app-only and fail-open. CURRENT: no device check in the live clock-in function
   (`20260907120000:14-54`); a gating-read error counts as "off" (`devices.ts:38-42`); clock-out takes no device input
   (`attendance.ts:218-220`); PENDING checks clock-in by device id only, and a member can read that id from their own
   rows (`20260916120000:431-432`, `:451-459`). Template: compare the token hash inside both clock functions; make
   "gate required" an explicit CONFIGURABLE setting; fail closed on error.
9. Deactivated accounts pass role-title gates. CURRENT: live `current_staff_role()` and `current_staff_id()` ignore
   `is_active` (`20260715130000:28-58`); PENDING fixes only the role helper (`20260916120000:46-57`). Template: both
   helpers refuse inactive profiles; gates use keys (principle 2) so `has_permission`'s active check applies.
10. NULL role gates. CURRENT: `correct_attendance_clock_out` refuses NULL explicitly (`20260907130000:30`); the
    RECONSTRUCTED delete, clock-out and rate functions cannot be checked. Template: every gate refuses NULL.
11. PUBLIC and `anon` EXECUTE on definer functions. CURRENT: explicit revokes exist for the device functions,
    `list_clock_staff` and the correction function (`20260722170000:8-18`; `20260806260000:17`, `:33-34`;
    `20260907130000:65-68`) but not for `kiosk_clock_in` in its live file, nor for the RECONSTRUCTED functions;
    PENDING revokes generically (`20260916120000:76-110`). Template: revoke in the creating migration.
12. Two Admin delete behaviours. CURRENT: request on the Attendance page (`attendance-day-details.tsx:138-150`), direct
    on the Review page (`review-attendance-view.tsx:624-629`). Template: one rule from `attendance.delete`, identical
    on every screen.
13. Kiosk status and reviewer roster are keyed wrongly. CURRENT: kiosk status reads are RLS-limited
    (`attendance.ts:111-146`), so an operator without the review key cannot clock others out; the Review filter uses a
    roster gated on the kiosk key (`20260907160000:16-19`), so a reviewer without it gets an empty filter. Template:
    the status reader and the roster are definer readers, each gated on either `attendance.clock_operate` or
    `attendance.view_team` (section 4.4; DATABASE.md section 5.13), so the kiosk operator sees every member's state and
    a reviewer without the kiosk key still gets the employee filter.
14. Exemption is enforced in the roster only. CURRENT: Super Admins are filtered from the roster but accepted by
    `kiosk_clock_in` (`20260907160000:24`; `20260907120000:30-37`); demo members are listed and then refused
    (`20260907160000:20-25`; `20260907120000:35-37`). Template: one eligibility rule checked in the roster, both clock
    functions and the payroll report.
15. Selfies are readable and attachable by every active staff member. CURRENT: `20260716300000:127-142`, `:159-165`;
    `upload.ts:67-72`; open in the repository audit (`docs/SYSTEM-AUDIT-2026-09-16.md:128`). Template: read scoped to
    the subject and `attendance.review`; attach only through `attach_attendance_photo`, which requires
    `attendance.clock_operate`, a caller who is the operator recorded on that session for that kind (`clock_in_by` or
    `clock_out_by`), and a storage path under that session prefix for that kind (`DATABASE.md` section 5.13;
    `IMPLEMENTATION_PROMPT.md` PH4).
16. Payroll money in the audit trail. CURRENT: `audit_read` allows any active staff (`20260715130100:661-662`) and
    contexts carry rates and net pay (`rate.ts:233-238`; `payslip-actions.ts:88-93`); PENDING narrows the audience by
    role title and `view_settings` (`20260916120000:290-298`). Template: payroll audit contexts readable only with
    `payroll.view_all`.
17. Payslip immutability by convention only. CURRENT: the Super Admin update policy covers every column
    (`20260722210000:62-68`). Template: status-only updates through the mark-paid function plus a trigger that freezes
    the figures (details in `PAYROLL.md`).
18. Export gating disagrees. CURRENT: the Dashboard button shows on `export_data_reports` (`dashboard/page.tsx:92`),
    the route checks role (`route.ts:18`), and Staff get a 403. Template: button and route both on `payroll.export`.
19. `attendance_devices` RLS not forced, grants implicit. CURRENT: `20260722150000:30`. Template: force RLS and declare
    grants.
20. Hard-coded primary identity. CURRENT: an email constant (`guard.ts:281`) and a SQL twin without DDL. Template: a
    primary flag on the profile, checked in SQL, with the last-Super-Admin floor trigger (PENDING `20260916120000:230-279`).
21. No MFA step-up. CURRENT: `requireAal2` is unused (`guard.ts:373-392`). Template: CONFIGURABLE step-up for payroll
    writes and access management.
22. Descriptions and comments overstate or contradict. CURRENT: key descriptions (`20260729120000:33-34`); stale
    comments `attendance/page.tsx:34-35`, `payslip-actions.ts:12-15`, `rate.ts:9-20`, `navigation.ts:64-71`,
    `actions.ts:206-209`. Template: descriptions match section 4.2; comments name the key a function checks.
23. UI authority derived from role titles. CURRENT: `canManage`, `canManagePayroll`, `isOwner` flags
    (`attendance/page.tsx:79`; `review/page.tsx:36`; `payroll/page.tsx:43`; `attendance-view.tsx:98`, `:182`) and a
    `canManage` prop that defaults to `true` (`review-attendance-view.tsx:81`). Template: flags from granted keys,
    default false.
24. Missing DDL. CURRENT: `kiosk_clock_out`, `delete_attendance_record`, `set_staff_salary_rate`,
    `staff_salary_rates`, the live `generate_payslip_snapshot` body, `set_team_member_role`,
    `set_team_member_permissions`, `is_primary_super_admin` are RECONSTRUCTED. Template: ship full DDL with the gates of
    section 4.4 (list and shapes in `DATABASE.md`).
25. Live grants of `report_payroll` unknown. CURRENT: repository grant `20260721100000:73-74`; the live function has a
    different result type (`20260907160000:30`), so it was re-created out of band. Template: declare grants after
    every create.
26. SQL tests stop at the first version of the HR gates. CURRENT: the HR pgTAP suite covers only the early self and
    Super Admin read scope with real JWTs, table grants, the anon refusal on `report_payroll`, the one-open-session
    refusal and the legacy `hourly_rate` update (`supabase/tests/26_hr_attendance.test.sql:41-163`); its
    `report_payroll` rate assertion is stale, because the live function no longer returns `hourly_rate`
    (`:142-148`; `20260907160000:30`). `has_permission` itself is tested in other suites
    (`supabase/tests/05_authz_permissions.test.sql:87-171`). No SQL test covers the `hr_review_attendance` read branch,
    the kiosk functions, correction, delete, devices or the `payroll_snapshots` policies. PENDING content is pinned by a
    file-content test (`tests/unit/security-hardening.test.ts:218-286`). Template: behavioural tests per key for every
    function in section 4.4 (see `TESTING_CHECKLIST.md`); keep file-content tests where no database is reachable.
27. Generate is offered to members who cannot generate. CURRENT: the row button and the modal footer render Generate
    whenever no snapshot exists (`payslip-button.tsx:240-261`); only the deductions input depends on `canManage`
    (`:276-299`), so a Staff member with `hr_payroll` is offered an action that `requireOwner()` and the insert policy
    refuse (row 11). Template: render Generate only from the `payroll.payslip.generate` key; without it, show the
    "not generated yet" state and no action.

## 7. PROJECT-SPECIFIC items removed from the template

Brand names, identifiers, currency and timezone may appear only in this list.

- Role wording: `owner` shown as "Super Admin", `selected_admin` as "Admin" (`access-catalogue.ts:177-182`), with
  "Owner" and "Team" wording elsewhere in the UI and copy such as "Ask the Owner" (`payslip-button.tsx:296-297`).
- `MAX_SUPER_ADMINS = 2` (`access-catalogue.ts:189`), the Primary Super Admin email constant (`guard.ts:281`, value
  not reproduced), and the legacy maximum-two-Admins trigger (`20260715120100:148-182`).
- Super Admins (role key `owner`) excluded from the clock roster, payroll and rates (`20260907160000:24`, `:99`; `rate.ts:137`): a business
  decision. That migration's header names real account holders; those comments must not be copied.
- The single approved "shop phone" model: registering a device deactivates every other device
  (`20260722150000:49`); the device cookie name `av_att_device` (`devices.ts:27`).
- Business timezone literal `Asia/Manila` in `kiosk_clock_in` (`20260907120000:45`), `report_payroll`
  (`20260907160000:41`), `listLastClockOutToday` (`attendance.ts:133`) and the PENDING `work_date` default
  (`20260916120000:367-368`); fixed `+08:00` offsets in date helpers (`reports/page.tsx:56-57`). The migration file
  `20260907120000_kiosk_clock_in_manila_work_date.sql` carries the zone in its name.
- Currency: the peso sign (PHP) and the flat night amount 300 inside UI copy (`attendance.ts:200-202`;
  `payslip-button.tsx:290-291`; `rate.ts:242`).
- Demo accounts flagged once by an email pattern on a test domain (`20260722160000:10-15`; pattern not reproduced)
  and the demo-login environment flag (`guard.ts:152`).
- The approvals engine coupling: the `attendance_delete` kind executed from the fulfillment module
  (`service.ts:735-738`) and `initiate_high_risk_action` shared with the source business's order, inventory and
  layaway approvals.
- Brand names in documents and files: "A.V. Jewelry" as the workbook creator (`data-export.ts:132`) and in payslip
  headers and file names, and "MineFlow" in the export file name (`route.ts:74`).
- Internal specification references ("Bible" sections) and dated "Owner request" notes in comments and migrations.
- The permission catalogue outside Team Management (orders, inventory, layaway, capture, printer keys) and the
  migration `20260731120000`, which belongs to a messaging integration and is cited here only for its reference to
  the primary-admin helper.

## 8. NEEDS VERIFICATION: read-only catalog checks

These queries settle open questions about the reference implementation, so they only mean something when run against
the reference implementation's own database, read-only, by the person responsible for that database. Never run them
through connectors or accounts that belong to another client. They read the catalog and change nothing; the grant
queries return counts only, no identities. The same queries also work as post-install checks on a new client's
project, where they confirm the template's own policies and grants instead.

```sql
-- Row 4: is there a reviewer branch on the profile read policy?
select polname, pg_get_expr(polqual, polrelid)
from pg_policy where polrelid = 'public.staff_profiles'::regclass and polcmd = 'r';

-- Row 8: does any live grant of the request key exist? (count only)
select count(*) from public.staff_permission_grants
where permission_key = 'initiate_high_risk_action';

-- Row 12: was the payslip update policy widened?
select polname, polcmd, pg_get_expr(polqual, polrelid), pg_get_expr(polwithcheck, polrelid)
from pg_policy where polrelid = 'public.payroll_snapshots'::regclass;

-- Rows 2, 3, 7, 15, 17: bodies and security mode of the RECONSTRUCTED functions
select n.nspname, p.proname, p.prosecdef, pg_get_functiondef(p.oid)
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in ('kiosk_clock_out', 'delete_attendance_record',
  'set_staff_salary_rate', 'generate_payslip_snapshot', 'set_team_member_role', 'set_team_member_permissions'))
   or (n.nspname = 'app_private' and p.proname in ('is_primary_super_admin', 'night_ot_bonus'));

-- Row 10 and item 25: live EXECUTE grants
select n.nspname, p.proname, p.prosecdef, p.proacl
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'app_private')
  and p.proname in ('report_payroll', 'kiosk_clock_in', 'kiosk_clock_out', 'delete_attendance_record',
    'set_staff_salary_rate', 'generate_payslip_snapshot', 'night_ot_bonus', 'current_staff_role');

-- Rows 14 and 15: rate table policies and grants
select tablename, policyname, cmd, qual, with_check
from pg_policies where tablename in ('staff_salary_rates', 'staff_hourly_rates', 'attendance_devices');
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_name in ('staff_salary_rates', 'attendance_devices', 'attendance_records', 'payroll_snapshots')
  and grantee in ('anon', 'authenticated');

-- Rows 2 and 6, item 7: live table and column privileges and triggers on sessions
-- (the live-only migration fix_payroll_grants_and_delete_all_where may have changed them)
select table_name, grantee, privilege_type from information_schema.role_table_grants
where table_name = 'attendance_records' and grantee in ('anon', 'authenticated');
select grantee, privilege_type, column_name from information_schema.column_privileges
where table_name = 'attendance_records';
select version, name from supabase_migrations.schema_migrations
where name = 'fix_payroll_grants_and_delete_all_where';
select tgname, pg_get_triggerdef(oid) from pg_trigger
where tgrelid = 'public.attendance_records'::regclass and not tgisinternal;

-- Section 1.4: which triggers exist on profiles (legacy Admin-count trigger)
select tgname from pg_trigger where tgrelid = 'public.staff_profiles'::regclass and not tgisinternal;

-- Whether the PENDING migration has been applied
select version, name from supabase_migrations.schema_migrations order by version desc limit 15;

-- Section 2: which roles hold the current keys (counts only)
select sp.role_key, g.permission_key, count(*)
from public.staff_permission_grants g join public.staff_profiles sp on sp.id = g.staff_profile_id
where g.permission_key in ('hr_attendance', 'hr_review_attendance', 'hr_payroll')
group by 1, 2;
```

## 9. Citation key

Application files cited by short name:

| Short name | Path |
|---|---|
| `guard.ts`, `permissions.ts`, `access-catalogue.ts`, `team-accounts.ts`, `request-deletion.ts` | `src/lib/authz/` |
| `actions.ts`, `attendance.ts`, `devices.ts`, `rate.ts`, `payslip-actions.ts` | `src/lib/hr/` |
| `attendance-clock.tsx`, `attendance-records.tsx`, `attendance-day-details.tsx` | `src/components/hr/` |
| `review-attendance-view.tsx`, `attendance-view.tsx`, `payslip-button.tsx` | `src/components/hr/` |
| `payroll-tabs.tsx`, `employee-rates-view.tsx` | `src/components/hr/` |
| `navigation.ts` | `src/components/shell/navigation.ts` |
| `dashboard-view.tsx` | `src/components/dashboard/dashboard-view.tsx` |
| `attendance/page.tsx`, `review/page.tsx` | `src/app/(app)/admin/attendance/page.tsx`, `src/app/(app)/admin/attendance/review/page.tsx` |
| `payroll/page.tsx`, `admin/staff/page.tsx` | `src/app/(app)/admin/payroll/page.tsx`, `src/app/(app)/admin/staff/page.tsx` |
| `settings/page.tsx`, `dashboard/page.tsx`, `reports/page.tsx` | `src/app/(app)/settings/`, `src/app/(app)/dashboard/`, `src/app/(app)/reports/` |
| `route.ts` | `src/app/api/export/all/route.ts` |
| `sections.ts`, `data-export.ts` | `src/lib/export/` |
| `service.ts` | `src/lib/fulfillment/service.ts` |
| `upload.ts` | `src/lib/attachments/upload.ts` |

Migrations in `supabase/migrations/`, cited by prefix (locate a file with the prefix; basenames are omitted here
because some carry project-specific words, see section 7):

| Prefix | Content relevant here |
|---|---|
| `20260715120100` | roles, permissions catalogue, staff profiles, grants |
| `20260715130000` | `app_private` identity helpers and their grants |
| `20260715130100` | RLS policies: profiles, grants, approvals, audit |
| `20260715130200` | device-limit and Super Admin-only Admin management triggers |
| `20260715130300` | redefinition of the legacy Admin-count trigger function |
| `20260716240000` | `has_permission` with the implicit Super Admin rule |
| `20260716300000` | attachments table and storage policies |
| `20260717120000` | `attendance_records`, open-session index, RLS and grants |
| `20260721100000` | `report_payroll` v2 and its EXECUTE grant |
| `20260722120000` | live `delete_team_member` (Super Admin-only member deletion) |
| `20260722150000` | `attendance_devices` and the device functions |
| `20260722160000` | `is_demo` flag |
| `20260722170000` | EXECUTE hardening of the device functions |
| `20260722180000` | Super Admin-only device read policy (latest) |
| `20260722200000` | night flag trigger (BEFORE INSERT) |
| `20260722210000` | `payroll_snapshots`, its RLS, repository generate function |
| `20260729120000` | `hr_*` key seeds |
| `20260731120000` | integration config; references the primary-admin helper |
| `20260804140000` | `attendance_read` with the review key (latest) |
| `20260805140000` | Manage Access redesign; the only grant backfill |
| `20260805160000` | first `list_clock_staff` |
| `20260806260000` | anon revoke for `list_clock_staff` |
| `20260821140000` | merged SELECT policies, including `staff_profiles_read` |
| `20260907120000` | live `kiosk_clock_in` |
| `20260907130000` | `correct_attendance_clock_out` |
| `20260907160000` | latest `list_clock_staff` and `report_payroll`, Super Admin exclusion |
| `20260916120000` | PENDING (not live) security hardening |
