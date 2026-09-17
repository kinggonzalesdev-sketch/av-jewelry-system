# Attendance and Payroll Template: Configuration (Phase 13)

This document separates the reusable engine of the attendance, review-attendance and payroll module from the values
that change from client to client. It defines one configuration schema. For every key it gives the reference
implementation's current behaviour (with a file:line citation), the type and allowed values, the recommended default
for a new client, and the layer that reads the key. It then gives an example configuration for a hypothetical client,
maps every hardcoded site to the key that replaces it, and lists what stays fixed by design and why. This file is the
schema of record for configuration keys. Permission keys and their default grant sets are defined in PERMISSIONS.md
sections 4.2 and 5, database objects (including the settings store) in DATABASE.md section 5, pay formulas in PAYROLL.md
and screen labels in UI_UX.md section 5. Nothing here changes the reference implementation; it describes what a new
build from the template should do.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves today, with a file:line citation. |
| GENERIC | The reusable form the template ships. |
| PROJECT-SPECIFIC | Tied to the source business. Brand, currency and timezone values are named only in section 9 (PS-n); see the exception below. |
| CONFIGURABLE | Should become a client setting. Every key in section 2 is CONFIGURABLE unless its type is marked "fixed". |
| NEEDS VERIFICATION | The repo cannot settle it; section 8 says what would. |
| RECONSTRUCTED | A live database object whose DDL is missing from the repo; described from call sites. |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation that the template should fix. Never a change to production. |

Exception to the PROJECT-SPECIFIC rule: the shared key facts (section 0) and some CURRENT cells also quote the session
night flag's 22 hour threshold and 300.00 amount and the payroll night rule's 22:00 threshold, because every document
of this set states them; they are PROJECT-SPECIFIC in those places too.

Ids such as H-n, PS-n and the numbered rules are local to this file; a reference to another document's id always names
that document.

Roles. Super Admin (role key owner), Admin (role key selected_admin) and Staff (role key staff); TypeScript mirrors the
three keys (`src/lib/authz/permissions.ts:87-91`). The Super Admin holds every permission implicitly
(`src/lib/authz/permissions.ts:127-133`; `M/20260716240000:26-44`). Reference permission keys: `hr_attendance` (open
the Attendance page and read the kiosk roster), `hr_review_attendance` (open Review and read all rows), `hr_payroll`
(open Payroll). The template replaces them with the eleven keys of PERMISSIONS.md section 4.2 and seeds the default
grant sets of PERMISSIONS.md section 5; section 2.3 maps them.

Path shorthands used in citations:

| Shorthand | Expands to |
|---|---|
| `L/` | `src/lib/hr/` |
| `C/` | `src/components/hr/` |
| `P/` | `src/app/(app)/admin/` |
| `M/<timestamp>` | the single file in `supabase/migrations/` whose name starts with that timestamp |

Layer column: TS = read by the Next.js app; SQL = read inside Postgres (functions, checks, defaults); both = read in
both places (section 1.3 says which copy wins); job = read by a scheduled server-side job. Types in tables are written
with commas instead of the TypeScript union bar. Money values are strings (section 1.5).

## 0. Reference behaviour this document assumes

- Clocking is a shared kiosk, not self-service. A signed-in operator whose page and roster need `hr_attendance`
  (`P/attendance/page.tsx:43`; `M/20260907160000:16-19`) picks a member returned by `list_clock_staff` and the RPC
  receives that member's id (`L/attendance.ts:165-169`).
- One open session per member, enforced by a unique partial index (`M/20260717120000:43-45`). One row is one session.
- `work_date` is the business-timezone date at clock-in (`M/20260907120000:45`). A day's total is the sum of its
  completed sessions (`L/sessions.ts:12-16`; `M/20260907160000:39,49`).
- Two different night rules exist. The session flag is set when the clock-in hour is 22 or later, flat 300.00, by a
  BEFORE INSERT trigger (`M/20260722200000:34-37,46-49`). Payroll counts distinct work_dates with a clock-out at or
  after 22:00 and multiplies by `app_private.night_ot_bonus()`, which is RECONSTRUCTED (`M/20260907160000:41,55,85`).
- Derived pay in `report_payroll` = round(days_worked x daily_rate + night_shifts x night bonus, 2), or null without a
  rate (`M/20260907160000:86-93`).
- Deductions are a single lump sum of 0 or more entered at payslip generation (`L/payslip-actions.ts:48-55`; column
  check `M/20260722210000:27`). A payslip is a frozen snapshot whose `payment_status` goes from `pending` to `paid`
  (`M/20260722210000:29-30`; `L/payslip-actions.ts:124-135`).
- The live body of `generate_payslip_snapshot` is RECONSTRUCTED. The repo body (`M/20260722210000:75-132`) is stale: it
  selects `hourly_rate` from `report_payroll` (`:97-100`), a column the current reader no longer returns
  (`M/20260907160000:30`). The live table also has six RECONSTRUCTED columns: `daily_rate`, `days_worked`,
  `night_shifts` and `rate_basis`, which the app reads back after generation (`L/payslip-actions.ts:78-80`), and
  `paid_at` and `paid_by`, which the mark-paid action writes (`L/payslip-actions.ts:129-130`). No repo migration creates
  any of the six (repo DDL `M/20260722210000:15-36`). How an issued payslip prices
  night pay is NEEDS VERIFICATION: night shifts x `night_ot_bonus()` as in `report_payroll`, or the uncapped sum of the
  trigger's flat amount as in the stale repo body (`M/20260722210000:106-111`) and the payslip help text
  (`C/payslip-button.tsx:290-291`). Section 8 item 10 settles it.
- There is no approval or finalization step for attendance and no period lock (`C/review-attendance-view.tsx:70-71`;
  the correction RPC has no period check, `M/20260907130000:13-63`).
- Only the clock-out can be corrected: Super Admin or Admin by role, reason required, updated in place; the old value
  survives only in a best-effort app audit event (`M/20260907130000:29-61`; `src/lib/audit/log.ts:40-64`).
- Delete is a hard delete through `delete_attendance_record`, which is RECONSTRUCTED (`L/attendance.ts:341-347`).
- Device approval stores a hashed token and puts the raw token in an httpOnly cookie (`L/devices.ts:75,83-89`;
  `M/20260722150000:52`). It is enforced in server TypeScript only (`L/attendance.ts:28-48`); the live RPC has no check
  (`M/20260907120000:14-54`); PENDING (not live) adds a clock-in check (`M/20260916120000:451-459`). With no registered
  device the gate is off (`M/20260722150000:66-69`).
- Super Admins are excluded from the roster, payroll and rates but are still accepted as a `kiosk_clock_in` target.
  Demo accounts are excluded from payroll and rates and refused as a clock-in target, but `list_clock_staff` still
  lists them (`M/20260907160000:20-25,97-99`; `M/20260907120000:30-37`; `L/rate.ts:135-137`).

## 1. Principles: engine versus configuration

### 1.1 What is engine and what is configuration

- Engine: invariants and mechanisms that keep the module correct for any client. Examples: one open session per
  employee, one row per session, day totals as the sum of completed sessions, payroll derived from attendance, frozen
  payslips, writes through SECURITY DEFINER RPCs, permission checks in the database. Section 5 lists them and why.
- Configuration: values that vary per client without changing correctness. Examples: identity and branding, locale,
  default permission grants, thresholds, amounts, labels, list defaults, retention.
- Two questions decide a borderline case. Would two clients running the same code legitimately want different values?
  If yes, it is configuration. Would changing it silently change what an issued document means? If yes, it is engine,
  or a setting whose change is audited and never touches frozen payslips (section 1.4).

### 1.2 Configuration lives in one place per layer

CURRENT: every value is hardcoded where it is used. There is no HR environment variable and no settings table; the
business timezone alone appears in three TypeScript modules and four migrations (section 4, H-8 to H-14). The only SQL
value that behaves like a setting is `app_private.night_ot_bonus()`, which is RECONSTRUCTED (called at
`M/20260907160000:85,90`), and the insert trigger repeats the amount as a literal (`M/20260722200000:37`).

GENERIC, app layer: one module `src/lib/hr/config.ts` exports a frozen, typed `HR_CONFIG` object shaped as in section 2
and validated when the module loads (section 2.9). Components, server actions and domain modules import values or
shared helpers (a money formatter, a business-date helper) from it or from the settings reader. No component holds a
client literal.

The code template ships this schema as `templates/attendance-payroll/config/attendance-payroll.config.ts.example`: type
`AttendancePayrollConfig` (this file's `HrConfig`), `DEFAULT_ATTENDANCE_PAYROLL_CONFIG` (placeholder defaults that fail
rules 4 and 15 until onboarding), `validateAttendancePayrollConfig(config, engine)` returning a result, and
`hrSettingsSeedRows(config)` for the section 2.8 seed and the section 1.3 file-content test. It neither freezes nor
validates itself: the host module freezes the object and calls the validator when it loads. Rename the file to `.ts`
when adopting.

GENERIC, rule layer: the key-value table `app_private.hr_settings(key, value jsonb, effective_from)`, whose DDL of
record is DATABASE.md 5.12. Each SQL-evaluated key is stored under its configuration key name (section 2.8). A key
under `payroll.*` may hold several effective-dated rows; every other key holds one row with `effective_from =
'-infinity'` (check `hr_settings_dated_keys`). SQL reads the store only through the readers of DATABASE.md 5.12:
`app_private.hr_setting(p_key, p_as_of)`, `business_timezone()`, `business_today()`, `night_bonus_amount(p_as_of)` and
the one night predicate `app_private.is_night_session(p_time_in, p_time_out)` (the name DATABASE.md 5.12 uses;
PAYROLL.md section 4 GENERIC and section 12 item 1 use it too, see section 7). The readers are `stable security
definer` (plpgsql where they must raise; DATABASE.md 5.12), `set search_path = ''`, executable by `authenticated` and
`service_role`. CURRENT shows why `authenticated` needs EXECUTE: the payroll reader runs with
invoker rights (`M/20260907160000:29-34` has no definer clause). The app reads the values in force through
`public.get_hr_settings()` (definer, active staff). Every SQL body that embeds a literal today calls a reader instead
(section 4), and `app_private.night_ot_bonus()` is replaced by `night_bonus_amount(p_as_of)`.

### 1.3 Keys read by both layers have one source of truth

- The client configuration file (section 3) is the only input at install. A seed migration inserts one `-infinity`
  row into `app_private.hr_settings` for every SQL-evaluated key (section 2.8); `src/lib/hr/config.ts` carries the
  app-only keys.
- After install, the store is authoritative for SQL-evaluated keys. The app reads them on the server through
  `public.get_hr_settings()` and never falls back to a TypeScript default for those keys. Without the seeded rows,
  clock and payroll writes refuse.
- Write path. By default a change is a migration (DATABASE.md 5.12). A runtime settings editor is optional.
- The editor, adopted in DATABASE.md 5.12 and 5.13: the SECURITY DEFINER function
  `public.set_hr_setting(p_key, p_value, p_effective_from)`, gated on the Super Admin, and the table keeps no
  grant to `anon` or `authenticated`, so the function is the only runtime writer. For a `payroll.*` key it inserts a
  new dated row and never updates an old one. For any other key it updates the value of the single `-infinity` row,
  which is the only row the check `hr_settings_dated_keys` allows for those keys. `locale.timezone` changes only by
  migration, because every `work_date` stamp depends on it; the function
  refuses that key. In the same transaction the function writes the audit row in SQL through
  `app_private.record_audit_event` (DATABASE.md 5.11) with the key, the old and new policy values and
  `effective_from`. An app-side audit call alone is not enough: the reference writer is best effort and never throws
  (`src/lib/audit/log.ts:40-64`; section 5 item 19).
- Consistency test: a file-content unit test asserts that the seed migration matches the client configuration file.
  The reference implementation already pins migration content this way (`tests/unit/security-hardening.test.ts:218-222`
  and following), so a runner without a database still catches drift.

### 1.4 Changing a setting that affects money

CURRENT: derived payroll reads the night bonus when the report runs (`M/20260907160000:85,90`), so a change re-prices
every period on screen. `report_payroll` does not read the amount the trigger stamps on each row
(`M/20260722200000:37`); whether the live payslip function reads it is NEEDS VERIFICATION (section 0). Issued payslips
are frozen rows (`M/20260722210000:1-13`) and are unaffected.

GENERIC: keys under `payroll.*` are effective-dated (DATABASE.md 5.12). A change is a new row with an `effective_from`
business date, and each reader takes the row in force on an as-of date. Derived payroll uses the value in force on
each as-of date below, so a change does not re-price the days before it, and an issued payslip never changes.

- As-of dates. The night predicate evaluates the night keys as in force on the business date of the session's
  clock-in (DATABASE.md 5.12), which is its `work_date`. The template uses the same date for `bonusAmount` and the other
  per-session or per-day keys (`minHoursForDay`, the overtime keys). Keys that apply to a whole period or payslip (for
  example `rateSelection` and `allowNegativeNet`) are read as of the period end, which matches how CURRENT picks the
  rate (`M/20260907160000:59-74`). DATABASE.md 5.12 states the night predicate's as-of date; the as-of dates for
  `bonusAmount`, the other per-day keys and the period-wide keys are defined here.
- RECOMMENDED TEMPLATE IMPROVEMENT: the runtime editor refuses an `effective_from` earlier than business today, so a
  change never re-prices days already worked; a back-dated change goes through a reviewed migration. The settings
  screen shows the effective date before saving, and the audit row records the old and new policy value (a policy
  value, not anyone's pay).

### 1.5 Value types

- Money: strings with up to two decimals, for example "300.00". The reference implementation keeps money as strings
  end to end (`L/payroll.ts:50-64`; `L/rate.ts:225`) and sums integer minor units with BigInt
  (`C/payroll-summary-button.tsx:31-39`).
- Times of day: "HH:MM", 24-hour, interpreted in `locale.timezone`.
- Timezone: an IANA zone name only (section 2.2 explains why there is no fixed-offset key).
- Permissions: the keys in PERMISSIONS.md section 4.2 (plus the optional request key of section 2.3), never display
  labels.

### 1.6 No client value in components

CURRENT: brand, currency, timezone and pay-policy literals sit inside components, domain modules and migrations
(section 4 lists more than sixty sites).

GENERIC: a static unit test scans `src/lib/hr`, `src/components/hr` and the HR migrations for the literal list in
section 9 and fails on a match. RECOMMENDED TEMPLATE IMPROVEMENT. The reference implementation already runs static
source sweeps (`tests/integration/phase11-authorization-boundary.test.ts:27-31`), but its write detector matches only
`.insert(`, `.update(` and `.delete(` (`:30`) and never sees an RPC-only writer; the template's sweeps also match
`.rpc(` (TESTING_CHECKLIST.md).

### 1.7 What never goes into configuration

- Secrets, project URLs, keys, person identities and real names.
- The reference implementation identifies its primary Super Admin by an email constant (`src/lib/authz/guard.ts:281`,
  value not copied, PS-13). The template uses a profile flag owned by the host identity module (PERMISSIONS.md 1.4).
- The selfie purge script embeds a production project URL in its usage text (`scripts/purge-attendance-selfies.mjs:24-26`,
  value not copied, PS-15). The template reads the URL from the environment only.
- Demo login is an environment flag of the host (`src/lib/authz/guard.ts:152-154`), not an HR setting.

## 2. Configuration schema

The block is the GENERIC shape. A key typed as a literal (`1`, `true`, `false`, `'append_only'`) is fixed by the
engine and listed only so the decision is visible; section 5 explains it. Regular expressions are described in words.

```ts
// src/lib/hr/config.ts (template). Frozen and validated when the module loads (section 2.9).
type RoleKey = 'owner' | 'selected_admin' | 'staff';
type PermissionKey = string;   // a PERMISSIONS.md 4.2 key, or the optional request key (section 2.3)
type Money = string;           // digits, optionally a dot and one or two digits
type ClockTime = string;       // "HH:MM", 24-hour, business timezone
type Frequency = 'weekly' | 'bi_weekly' | 'semi_monthly' | 'monthly';

export type HrConfig = {
  branding: {
    companyName: string;
    payslipHeader: string;                 // document title on the payslip
    summaryHeader: string;                 // title on the payroll summary sheet
    logoText: string;                      // 1 to 3 characters drawn in a filled circle
    logoUrl: string | null;                // RECOMMENDED TEMPLATE IMPROVEMENT
    brandColor: string;                    // "#rrggbb": logo mark and net-pay highlight only
    documentFilePrefix: string;            // payslip PDF and export workbook file names
    cookieNamePrefix: string;              // device cookie and per-viewer storage keys
    address: string | null;                // RECOMMENDED TEMPLATE IMPROVEMENT
    taxId: string | null;                  // RECOMMENDED TEMPLATE IMPROVEMENT
    contact: string | null;                // RECOMMENDED TEMPLATE IMPROVEMENT
  };
  locale: {
    timezone: string;                      // IANA name; there is deliberately no fixed-offset key
    currencyCode: string;                  // ISO 4217
    currencySymbol: string;                // screen only
    moneyDisplay: {
      minorUnits: 2;                       // fixed by numeric(12,2) columns
      hideZeroMinorUnits: boolean;
      groupSeparator: string;
      decimalSeparator: string;
      pdfUsesCode: boolean;                // PDF prints the code, not the symbol
    };
    dateLocale: string;                    // BCP 47 tag for displayed dates
    showTimesInBusinessTimezone: boolean;
  };
  permissions: {
    // Seeded grant sets; recommended defaults are PERMISSIONS.md section 5.
    // The Super Admin holds every key implicitly and is never listed.
    defaultGrants: { selected_admin: PermissionKey[]; staff: PermissionKey[] };
  };
  exclusions: {
    excludedRoles: RoleKey[];              // sets employees.timekeeping_exempt (DATABASE.md 5.2)
    excludeDemoAccounts: true;             // demo profiles never clocked or paid
  };
  attendance: {
    clockMode: 'kiosk' | 'self_service' | null;   // set at onboarding; null fails (2.9); kiosk = CURRENT (2.4)
    selfView: boolean;                     // own sessions screen without a key; RECOMMENDED TEMPLATE IMPROVEMENT
    allowMultipleSessionsPerDay: boolean;
    maxOpenSessionsPerEmployee: 1;         // partial unique index
    sessionCrossesMidnightPolicy: 'clock_in_date';
    maxSessionHours: number | null;        // flag for review only, never an auto-close
    device: {
      mode: 'off' | 'auto' | 'required';   // 'required' = an approved device is always needed
      failMode: 'open' | 'closed';
      maxActiveDevices: number;
      cookieMaxAgeDays: number;
      defaultLabel: string;
    };
    selfie: {
      mode: 'off' | 'optional' | 'required';
      facingMode: 'user' | 'environment';
      maxEdgePx: number;
      jpegQuality: number;                 // 0 to 1
    };
    correction: {
      allowClockInCorrection: false;
      requireReason: true;
      maxWindowDays: number | null;
    };
    deletion: {
      mode: 'hard' | 'soft';
      requireReason: true;
      requireTypedConfirmation: boolean;
      confirmationPhrase: string;
      requestApprovalPath: boolean;        // default false; true needs an approval queue in the host
    };
  };
  review: {
    defaultRangeDays: number;              // 7 = today minus 6 through today
    quickRanges: Array<'today' | '7d' | 'month' | 'custom'>;
    pageSizes: number[];
    defaultPageSize: number;
    defaultStatus: 'open' | 'completed' | 'all';
    dateFilterBasis: 'time_in' | 'work_date';
    statusLabels: { open: string; completed: string };
  };
  payroll: {
    selfView: boolean;                     // own payroll row and payslips without a key; RECOMMENDED TEMPLATE IMPROVEMENT
    rateBasis: 'daily' | 'hourly' | 'monthly' | null;   // set at onboarding; null and 'monthly' fail (section 2.9)
    payFrequencies: Frequency[];
    payFrequencyLabels: Partial<Record<Frequency, string>>;
    defaultFrequency: Frequency | null;    // set at onboarding; null fails validation
    frequencyDrivesPeriod: boolean;
    rateEffectiveDating: 'append_only';
    rateSelection: 'period_end' | 'per_day';
    prorationPolicy: 'none';
    currentRateLookup: 'newest_row' | 'effective_today';
    periodPresets: Array<{ key: string; label: string; fromDay: number; toDay: number | 'month_end' }>;
    periodDefault: 'month_to_date' | 'current_preset';
    minHoursForDay: number;
    nightRule: {
      enabled: boolean;
      anchor: 'clock_in' | 'clock_out' | null;   // set at onboarding; null only while enabled is false
      thresholdTime: ClockTime | null;     // set at onboarding; null only while enabled is false
      windowEnd: ClockTime | null;         // null = time-of-day compare only (reference)
      bonusAmount: Money;
      oncePerDay: boolean;
    };
    overtimeDisplayThresholdHours: number | null;   // set at onboarding; null fails validation
    overtimeBasis: 'session' | 'day';
    overtimePayMultiplier: number;         // 0 = hours reported, never paid
    deductionsModel: 'lump_sum' | 'itemized';
    allowNegativeNet: boolean;
    rounding: { moneyScale: 2; hoursScale: 2; roundOnce: true };
    snapshot: { immutable: true; uniquePerPeriod: true };
    statuses: ['pending', 'paid', 'void'];
    statusLabels: { notGenerated: string; pending: string; paid: string; void: string };
    paidDateEditable: boolean;
    approvalRequired: boolean;
    lockPeriodAfterPayslip: 'off' | 'generated' | 'paid';
    payslip: {
      pageSize: 'a4' | 'a5' | 'letter';
      fileNamePattern: string;             // tokens {prefix} {employee} {start} {end}
      labels: Record<string, string>;      // night labels are built from nightRule.bonusAmount
    };
  };
  audit: {
    payloadIncludesAmounts: boolean;
  };
  retention: {
    selfieRetentionDays: number | null;
    signedUrlTtlSeconds: number;
    deleteSelfieWithRecord: boolean;
  };
};
```

### 2.1 Identity and branding

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `branding.companyName` | non-empty string | one literal on payslip, PDF, summary and workbook, `L/payslip-pdf.ts:69` (H-1, PS-1) | `<company-name>` | TS |
| `branding.payslipHeader` | string | "Payslip" `C/payslip-button.tsx:83` | "Payslip" | TS |
| `branding.summaryHeader` | string | "Payroll Summary" after the name `C/payroll-summary-button.tsx:93` | "Payroll Summary" | TS |
| `branding.logoText` | 1 to 3 characters | initials in a filled circle `L/payslip-pdf.ts:60-65`, `C/payslip-button.tsx:79` (H-2, PS-2) | `<XY>` | TS |
| `branding.logoUrl` | URL or null | none: no document draws an image (`L/payslip-pdf.ts:59-69`) | null. RECOMMENDED TEMPLATE IMPROVEMENT | TS |
| `branding.brandColor` | "#rrggbb" | RGB constant `L/payslip-pdf.ts:17`, hex `C/payslip-button.tsx:40`, class `C/payroll-summary-button.tsx:89` (H-3) | `<#rrggbb>` | TS |
| `branding.documentFilePrefix` | letters, digits, hyphen | brand prefix `L/payslip-pdf.ts:44-49`, `src/app/api/export/all/route.ts:74` (H-4, H-5) | `<Client>` | TS |
| `branding.cookieNamePrefix` | lowercase letters, digits, underscore | brand prefix `L/devices.ts:27`, `src/components/shell/privacy.tsx:33` (H-6, H-7) | `<client>_` | TS |
| `branding.address`, `.taxId`, `.contact` | string or null | none: the header holds only the mark and the name (`C/payslip-button.tsx:76-84`) | null. RECOMMENDED TEMPLATE IMPROVEMENT | TS |

The colour is used only for the logo mark and the net-pay highlight (`C/payslip-button.tsx:38-40`); screens use design
tokens (UI_UX.md).

### 2.2 Locale

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `locale.timezone` | IANA zone name | one zone literal in TS `L/attendance-paging.ts:41` and SQL `M/20260907120000:45` (H-8 to H-14, PS-7) | `<IANA-zone>` | both; SQL store wins |
| no key: fixed UTC offset | removed | a fixed offset beside the zone builds day bounds `L/attendance-paging.ts:42-43,77-78` (H-9) | none | TS |
| `locale.currencyCode` | ISO 4217 | code prefix in the PDF because the built-in font lacks the symbol `L/payslip-pdf.ts:12-14,21-31` (H-16, PS-8) | `<CCY>` | TS |
| `locale.currencySymbol` | string | formatter `src/lib/payments/format.ts:55`, input `src/components/ui/money-input.tsx:130` (H-15, PS-8) | `<symbol>` | TS |
| `locale.moneyDisplay.minorUnits` | fixed 2 | `numeric(12,2)` money `M/20260722210000:24-28`; inputs allow two decimals `L/rate.ts:210` | 2 | both |
| `locale.moneyDisplay.hideZeroMinorUnits` | boolean | screen hides ".00" on whole amounts `src/lib/payments/format.ts:54-55`; PDF always two `L/payslip-pdf.ts:29` | false | TS |
| `locale.moneyDisplay.groupSeparator`, `.decimalSeparator` | one character each | comma and dot by string operations `src/lib/payments/format.ts:53`, `L/payslip-pdf.ts:28` | "," and "." | TS |
| `locale.moneyDisplay.pdfUsesCode` | boolean | true `L/payslip-pdf.ts:21-31`, yet one PDF label embeds the symbol `L/payslip-pdf.ts:106` | true | TS |
| `locale.dateLocale` | BCP 47 tag | "en-US" `L/attendance-paging.ts:166-174`, `C/employee-rates-view.tsx:30` | set at onboarding (no default) | TS |
| `locale.showTimesInBusinessTimezone` | boolean | false: viewer's zone `L/attendance-paging.ts:176-179`, `C/attendance-clock.tsx:302-306` | true. RECOMMENDED TEMPLATE IMPROVEMENT | TS |

- Fixed offset: a fixed offset is exact only for a zone without daylight saving, which is the justification in the
  reference comment (`L/attendance-paging.ts:42`). The template computes business-day bounds from `locale.timezone`
  with Intl, as the reference already does for today's date (`L/attendance-paging.ts:46-48`). The "en-CA" locale used
  there is an ISO-date technique, not a display locale, and stays in code.
- Currencies: a currency with no minor units displays with `hideZeroMinorUnits = true`. A currency with three minor
  units is not supported without changing every money column scale.
- Business-zone times: today a reviewer in another zone sees shifted clock times, and the correction input converts
  from the browser's zone (`C/review-attendance-view.tsx:673-679`).

### 2.3 Roles and permissions

Authority comes from permission keys enforced in the RPC or RLS; TypeScript guards only mirror them (PERMISSIONS.md
4.1 and 4.4). The key set is the eleven keys of PERMISSIONS.md 4.2, and the recommended grant set per role is the
proposal of PERMISSIONS.md 5; this section does not redefine either. Configuration chooses only the grant set that the
seed writes per role. There are no role lists in configuration: the CURRENT role-title gates (`owner`,
`selected_admin`) for correct, delete, devices, rates, generate, mark paid and export become keys.

| Capability | Template key | CURRENT gate | Staff default | Admin default |
|---|---|---|---|---|
| Open the kiosk, read the roster, clock a member | `attendance.clock_operate` | `hr_attendance` on page and roster; write checks active staff only `L/attendance.ts:158` | no | no |
| Read team rows and open-session state | `attendance.view_team` | `hr_review_attendance` branch of `attendance_read` `M/20260804140000:8-14` | no | yes |
| Open Review, see photos | `attendance.review` | `hr_review_attendance` `P/attendance/review/page.tsx:22`, `L/actions.ts:48` | no | yes |
| Correct a clock-out | `attendance.correct` | role titles `L/attendance.ts:406`, `M/20260907130000:29-33` | no | yes |
| Delete a session | `attendance.delete` | role titles `L/attendance.ts:352`, `P/attendance/page.tsx:79`; SQL gate RECONSTRUCTED | no | yes |
| Register and revoke devices | `attendance.devices.manage` | Super Admin role `L/devices.ts:69,104`, `M/20260722150000:46-48,75-77` | no | no |
| Read every payroll row, payslip and rate; print the summary | `payroll.view_all` | rows `M/20260907160000:100`; payslips `M/20260722210000:51-55`; rates NEEDS VERIFICATION (note) | no | no |
| Edit rates | `payroll.rates.edit` | UI roles `P/payroll/page.tsx:43-44`; no TS guard `L/rate.ts:201-231`; SQL RECONSTRUCTED | no | no |
| Generate a payslip | `payroll.payslip.generate` | `requireOwner()` `L/payslip-actions.ts:28`; insert policy `M/20260722210000:58-60` | no | no |
| Mark a payslip paid | `payroll.payslip.mark_paid` | TS Super Admin or Admin `L/payslip-actions.ts:106`; repo policy Super Admin `M/20260722210000:62-65` | no | no |
| Export payroll data | `payroll.export` | role check `src/app/api/export/all/route.ts:18` | no | yes |
| Request a deletion (optional) | `attendance.delete.request` | `initiate_high_risk_action`, not in `src/lib/authz/access-catalogue.ts:116-128` | not seeded | not seeded |
| Own sessions, payroll row, payslips | none (own rows) | page key `P/payroll/page.tsx:30`; self branches `M/20260804140000:11`, `M/20260907160000:100` | own rows | own rows |

The request key exists only when `attendance.deletion.requestApprovalPath` is true. Own-row access needs no key
(PERMISSIONS.md 4.1 principle 7); `attendance.selfView` and `payroll.selfView` decide whether the self-service screens
exist.

Note on `payroll.view_all`: the rate part of the CURRENT gate cannot be read from the repo. The RLS of
`staff_salary_rates` is RECONSTRUCTED (section 8 item 5). The repo evidence is that the page loads the rate list for a
Super Admin or an Admin (`P/payroll/page.tsx:43-44`), the reader's comment says the page gates it to those two roles
(`L/rate.ts:125-126`), and the reader adds no filter of its own on the rate rows (`L/rate.ts:139-143`). So the Rates tab
expects a Super Admin or Admin to read every rate row; the RLS that decides this is RECONSTRUCTED. The print control is offered to the Super Admin only
(`C/attendance-view.tsx:98-105`); the template folds it into `payroll.view_all` (PERMISSIONS.md 4.2).

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `permissions.defaultGrants.selected_admin` | 4.2 keys, or the request key | none: keys seeded `M/20260729120000:32-34`; no migration grants an `hr_*` key | PERMISSIONS.md 5 (below) | SQL seed |
| `permissions.defaultGrants.staff` | same | none (same) | `[]` (PERMISSIONS.md 5) | SQL seed |
| `attendance.selfView` | boolean | none as a setting: a member sees own sessions only while holding the page key (`P/attendance/page.tsx:43`) | false. RECOMMENDED TEMPLATE IMPROVEMENT | TS |
| `payroll.selfView` | boolean | none as a setting: a member sees the own payroll row only while holding `hr_payroll` (`P/payroll/page.tsx:30`) | false. RECOMMENDED TEMPLATE IMPROVEMENT | TS |
| `exclusions.excludedRoles` | role keys | Super Admin removed from roster `M/20260907160000:24`, payroll `:99`, rates `L/rate.ts:137` (PS-11) | `[]`; decide at onboarding | SQL |
| `exclusions.excludeDemoAccounts` | fixed true | payroll `M/20260907160000:98`, rates `L/rate.ts:136`, clock-in target `M/20260907120000:35-37` | true, also in the roster | SQL |

- Default grants (PERMISSIONS.md 5): Admin `attendance.view_team`, `attendance.review`, `attendance.correct`,
  `attendance.delete`, `payroll.export`; Staff none. `attendance.clock_operate` is in no default set: the client grants
  it to the accounts that operate the kiosk. The Admin default satisfies the key dependencies of PERMISSIONS.md 4.3
  (`attendance.review` needs `attendance.view_team`; `attendance.correct` and `attendance.delete` need
  `attendance.review`).
- Page access follows PERMISSIONS.md 4.2 and 4.3: the Payroll page opens for holders of any `payroll.*` key except
  `payroll.export`, and for every eligible employee when `payroll.selfView` is true. Own-row data access needs no key
  either way; the two `selfView` keys decide only whether the self-service screens exist (PERMISSIONS.md 5, self views).
- Eligibility predicate (GENERIC): a member can be listed, clocked, paid or rated only when `is_active and not is_demo
  and not timekeeping_exempt` (DATABASE.md 5.2, `app_private.is_timekeeping_eligible`). The roster, both kiosk RPCs,
  the payroll reader and the rate reader test the same predicate. `excludedRoles` only sets `timekeeping_exempt` on
  existing profiles at seed time and on profiles that enter a listed role; the predicate reads the flag. RECOMMENDED
  TEMPLATE IMPROVEMENT: CURRENT excludes Super Admins in the roster but `kiosk_clock_in` accepts a Super Admin target
  (`M/20260907120000:30-37`), and the roster lists demo profiles that the RPC then refuses (`M/20260907160000:20-25`).
- `attendance.delete.request` is the one optional key outside PERMISSIONS.md 4.2. PERMISSIONS.md 4.2 drops the request
  path by default and lets a client with an approval queue add its own request key ("Not in the list, on purpose").
  The seed grants it to no role by default. It exists only when `attendance.deletion.requestApprovalPath` is true, and
  then it must appear in the Manage Access catalogue (PERMISSIONS.md 4.1 principle 8) and be checked by the queue's
  insert policy (DATABASE.md 5.13). CURRENT: its reference counterpart is not in the Manage Access catalogue and is
  granted by no migration; it is grantable only on the legacy Super Admin console reachable by URL, so the Admin
  request fails by default on a fresh install (PERMISSIONS.md 6 item 2; section 8 item 7).
- Names shown to operators and reviewers come from permission-scoped definer readers, never from a `staff_profiles`
  embed (PERMISSIONS.md 4.1 principle 6); see section 6, item 6.

### 2.4 Attendance

Sessions:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `attendance.allowMultipleSessionsPerDay` | boolean | true: "Continue Duty" runs the same clock-in RPC `C/attendance-clock.tsx:319-334`; days group rows `L/sessions.ts:4-17` | true | both |
| `attendance.maxOpenSessionsPerEmployee` | fixed 1 | partial unique index `M/20260717120000:43-45`; message `M/20260907120000:48-49` | 1 | SQL |
| `attendance.sessionCrossesMidnightPolicy` | fixed `clock_in_date` | the whole session belongs to its clock-in date `M/20260907120000:45`; only check `M/20260717120000:32` | `clock_in_date` | both |
| `attendance.maxSessionHours` | number above 0, or null | none: no maximum and no auto-close; an old open session shows only a time `C/attendance-clock.tsx:302-306` | null | TS |
| `attendance.clockMode` | `kiosk`, `self_service`; null until set | `kiosk`: operator clocks a chosen member `L/attendance.ts:165-169`; no self clock caller | set at onboarding | both |

- `clockMode`: `kiosk` is the CURRENT model. `self_service` is not in the reference implementation (RECOMMENDED
  TEMPLATE IMPROVEMENT, offered only if the client asks). It is defined in DATABASE.md 5.13 as two definer functions,
  `self_clock_in` and `self_clock_out`, in which the caller is always the target and which refuse unless the stored
  value is `self_service`; PERMISSIONS.md 4.3 opens the self-service clock page for every eligible employee without a
  key (own-row principle 7), and IMPLEMENTATION_PROMPT.md question Q4 lets the client require a key instead. The kiosk
  functions and `attendance.clock_operate` are unchanged by this key.
- `allowMultipleSessionsPerDay = false` needs a refusal inside the clock-in RPC (a second session with the same
  `work_date`), so the value is also a SQL-evaluated key (section 2.8). The value false is a RECOMMENDED TEMPLATE
  IMPROVEMENT: the reference implementation has no such refusal.
- `maxSessionHours` raises a flag on review lists and on the kiosk status. It never closes a session automatically;
  closing stays a human clock-out or correction. RECOMMENDED TEMPLATE IMPROVEMENT.

Approved device:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `attendance.device.mode` | `off`, `auto`, `required` (see Modes) | only `auto`: gate on once an active device exists `M/20260722150000:66-69`, `L/attendance.ts:32` | `auto` | both |
| `attendance.device.failMode` | `open`, `closed` | open: a failed gate read counts as no gate `L/devices.ts:38-42` | `closed`. RECOMMENDED TEMPLATE IMPROVEMENT | TS |
| `attendance.device.maxActiveDevices` | integer, 1 to 1000 (see below) | 1: registering deactivates every active device `M/20260722150000:49`; copy `C/device-manager.tsx:161` | 1 | SQL |
| `attendance.device.cookieMaxAgeDays` | integer above 0 | 365; httpOnly, secure, sameSite lax, path "/" `L/devices.ts:83-89` | 365 | TS |
| `attendance.device.defaultLabel` | string | a retail-device label `M/20260722150000:51`, `L/devices.ts:94` (PS-10) | "Time clock" | both |

- Modes. `off`: no device check. `auto` (CURRENT): the check applies while at least one active device exists; before
  the first registration any operator's browser may clock, and revoking the last device switches the gate off again
  (`M/20260722150000:78`). `required`: the check always applies; with no active device every clock action is refused.
  CURRENT has neither `off` nor `required`: no setting turns the gate off while a device is active (only revoking every
  device does), and nothing refuses clocking before the first registration. Both are RECOMMENDED TEMPLATE IMPROVEMENT
  items. Recommended practice: start with `auto`, register the kiosk device, then switch to `required`.
- `maxActiveDevices` above 1 needs a register function that refuses once the maximum is reached instead of
  deactivating every active device (DATABASE.md 5.6). RECOMMENDED TEMPLATE IMPROVEMENT.
- Where the check lives is not configurable (section 5): inside both kiosk RPCs, comparing the hash of the cookie
  token. CURRENT enforces it in TypeScript only; PENDING (not live) adds an id-based check to clock-in only
  (`M/20260916120000:451-459`); clock-out takes no device argument (`L/attendance.ts:218-220`).
- `failMode` governs only the server pre-check that produces the operator message and the blocked-device audit event.
  Once the RPC checks the token, a failed database check refuses regardless of this key.

Photos (selfies):

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `attendance.selfie.mode` | `off`, `optional`, `required` (below) | as `optional`: camera step always runs, skipped on failure `C/attendance-clock.tsx:106-128` | `off` | TS; SQL if `required` |
| `attendance.selfie.facingMode` | `user`, `environment` | `user` `C/attendance-clock.tsx:117-121` | `user` | TS |
| `attendance.selfie.maxEdgePx` | integer above 0 | 1600 `src/lib/attachments/image.ts:18` | 1600 | TS |
| `attendance.selfie.jpegQuality` | number from 0 to 1 | 0.82 `src/lib/attachments/image.ts:21` | 0.82 | TS |

- CURRENT upload order: the clock action commits first, the photo uploads after it, and an upload failure is only a
  soft notice (`C/attendance-clock.tsx:157-176`). No server check requires a photo. `required` therefore needs an
  RPC-level check and a different upload order; it is not implemented. RECOMMENDED TEMPLATE IMPROVEMENT.
- Why the default is `off`: facial images carry access and retention duties. A client opts in after deciding
  `retention.selfieRetentionDays`. `off` is itself a RECOMMENDED TEMPLATE IMPROVEMENT: CURRENT has no setting that
  skips the camera step.
- Prerequisites for any mode other than `off`: the response header keeps `Permissions-Policy` with
  `camera=(self)` explicit (`next.config.ts:45-48`). A header that denies the camera to the app's own origin (for
  example `camera=()`) makes `getUserMedia` fail and every clock event falls back to "without photo"; whether omitting
  the header is harmless depends on the browser's default allowlist: NEEDS VERIFICATION in a browser. Photo reads are
  limited to the subject and `attendance.review` holders (PERMISSIONS.md 4.4; CURRENT
  any active staff member, `M/20260716300000:127-129,159-161`).

Corrections:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `attendance.correction.allowClockInCorrection` | fixed false | the RPC updates `time_out` only `M/20260907130000:55-59` | false | both |
| `attendance.correction.requireReason` | fixed true | action `L/actions.ts:174`, domain `L/attendance.ts:421-422`, SQL `M/20260907130000:35-37` | true | both |
| `attendance.correction.maxWindowDays` | integer, 1 or more, or null | none: any past session, bounded only by clock-in and now `M/20260907130000:48-53` | null | SQL |

- Who may correct is the `attendance.correct` key (section 2.3). A window of N days refuses a correction whose
  `work_date` is more than N days before business today. RECOMMENDED TEMPLATE IMPROVEMENT; the period lock
  (`payroll.lockPeriodAfterPayslip`) is the stronger control.
- Overlap and row locking are engine rules (section 5).

Deletion:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `attendance.deletion.mode` | `hard`, `soft` | `hard` through `delete_attendance_record` (RECONSTRUCTED); photo left in storage `L/attendance.ts:345-346` | `soft` | SQL |
| `attendance.deletion.requireReason` | fixed true | none on the direct path; the request path asks for one `C/attendance-day-details.tsx:143-148` | true | both |
| `attendance.deletion.requireTypedConfirmation` | boolean | true, checked on the server `L/actions.ts:146-148`; UI `C/attendance-day-details.tsx:182` | true | TS |
| `attendance.deletion.confirmationPhrase` | non-empty string | "DELETE" (same lines; `C/review-attendance-view.tsx:857`) | "DELETE" | TS |
| `attendance.deletion.requestApprovalPath` | boolean | Admin requests on Attendance `C/attendance-day-details.tsx:138-150` but deletes directly on Review | false (PERMISSIONS.md 4.2) | TS |

- `soft` is a RECOMMENDED TEMPLATE IMPROVEMENT: the row keeps `deleted_at`, `deleted_by` and `delete_reason`, the
  open-session index ignores it, and payroll excludes it (DATABASE.md 5.3). `hard` removes the row.
- The typed phrase is checked in the server action only. It guards against an accidental click, not an unauthorized
  caller; the RPC gate is the `attendance.delete` key, and the RPC takes a reason (DATABASE.md 5.13
  `delete_attendance_record(p_record_id, p_reason)`).
- `requestApprovalPath`: default false, as PERMISSIONS.md 4.2 drops the request path; deletion is then governed by
  `attendance.delete` alone, the request key does not exist and no request control renders. A client whose host has an
  approval queue may set true: a holder of `attendance.delete.request` sends a request that a holder of
  `attendance.delete` executes, and both pages behave the same (section 2.3). CURRENT pages disagree
  (`C/review-attendance-view.tsx:624-629`).

### 2.5 Review and record lists

These keys drive both the Review page and the history list on the Attendance page.

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `review.defaultRangeDays` | integer, 1 or more | 7, today minus 6 to today `L/attendance-paging.ts:57-65`; `P/attendance/page.tsx:51-55` | 7 | TS |
| `review.quickRanges` | subset of `today`, `7d`, `month`, `custom` | all four, labels in two copies `C/review-attendance-view.tsx:63-68`, `C/attendance-records.tsx:51-56` | all four | TS |
| `review.pageSizes` | positive integers | 25, 50, 100 `L/attendance-paging.ts:14` | [25, 50, 100] | TS |
| `review.defaultPageSize` | a member of `pageSizes` | 25 `L/attendance-paging.ts:16` | 25 | TS |
| `review.defaultStatus` | `open`, `completed`, `all` | `all`; tabs Open, Completed, All `C/review-attendance-view.tsx:72-76,90` | `all` | TS |
| `review.dateFilterBasis` | `time_in`, `work_date` | lists filter clock-in times `L/attendance.ts:615-616`; payroll `M/20260907160000:44` uses `work_date` | `work_date` | both |
| `review.statusLabels` | `{ open, completed }` | "Clocked in"/"Completed" `C/attendance-records.tsx:502-508`; "Open"/"Complete" `C/review-attendance-view.tsx:509-515` | "Open", "Completed" | TS |

- `dateFilterBasis = work_date` is a RECOMMENDED TEMPLATE IMPROVEMENT so that lists, the export
  (`src/lib/export/data-export.ts:533`) and payroll select the same sessions. The reference filters lists by clock-in
  time because older kiosk rows were stamped with the UTC date (`M/20260907120000:1-8`); a new install stamps the
  business date from the first row.
- One label set for every screen, filter and PDF is defined in UI_UX.md section 5; the two keys above must match it.

### 2.6 Payroll

Rates and frequencies:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `payroll.rateBasis` | `daily`, `hourly`, `monthly` | `daily` `M/20260907160000:86-93`; `hourly` on old payslips only `C/payslip-button.tsx:107-121` | set at onboarding | TS; SQL row basis |
| `payroll.payFrequencies` | subset of `weekly`, `bi_weekly`, `semi_monthly`, `monthly` (see below) | weekly, bi_weekly, monthly only `L/rate.ts:213-216` | set at onboarding (no default) | both |
| `payroll.payFrequencyLabels` | map | Weekly, Bi-Weekly, Monthly in two copies `C/attendance-view.tsx:38-42`, `C/employee-rates-view.tsx:33-37` | set at onboarding (no default) | TS |
| `payroll.defaultFrequency` | a member of `payFrequencies` | `weekly` `M/20260907160000:84`, `L/payroll.ts:54`, `L/rate.ts:213` | set at onboarding (no default) | TS |
| `payroll.frequencyDrivesPeriod` | boolean | false: stored and shown, drives nothing `M/20260907160000:84-93` | false | TS |
| `payroll.rateEffectiveDating` | fixed `append_only` | each save inserts a row, per docstring `L/rate.ts:193-199`; function body RECONSTRUCTED (section 8 item 3) | `append_only` | both |
| `payroll.rateSelection` | `period_end`, `per_day` | `period_end`: newest row dated on or before the period end, for every day `M/20260907160000:59-74` | `period_end` | SQL |
| `payroll.prorationPolicy` | fixed `none` | a rate is never scaled for a partial period (`M/20260907160000:86-93`) | `none` | SQL |
| `payroll.currentRateLookup` | `newest_row`, `effective_today` | `newest_row`: no "dated on or before today" filter `L/rate.ts:139-143` | `effective_today` | TS |

- Each rate row stores its own basis and frequency (DATABASE.md 5.8); `rateBasis` is the basis the editor offers for
  new rows. `hourly` and `monthly` engine support is a RECOMMENDED TEMPLATE IMPROVEMENT: `report_payroll` computes the
  daily basis only (`M/20260907160000:86-93`). `hourly` passes validation, because PAYROLL.md section 11 step 4 defines
  its formula (total hours x rate, the rule of the old hourly payslips); a build must add that branch to the payroll
  computation before a client selects it. The code template implements the hourly branch. `monthly` has no formula in the reference implementation; it fails validation
  (section 2.9 rule 14) until the client defines one in PAYROLL.md.
- `per_day` applies to each `work_date` the rate in force on that date. RECOMMENDED TEMPLATE IMPROVEMENT; with
  `period_end`, the payroll screen warns when a rate changes inside the period.
- `effective_today` is a RECOMMENDED TEMPLATE IMPROVEMENT: CURRENT shows a future-dated rate as the current one.
- `frequencyDrivesPeriod = true` is a RECOMMENDED TEMPLATE IMPROVEMENT and requires `periodPresets` per frequency.
- `semi_monthly` is a RECOMMENDED TEMPLATE IMPROVEMENT: the reference allowlist has no such value (`L/rate.ts:214`).
- Frequencies in SQL: `pay_frequency` has no column check because the list is a setting; `set_staff_salary_rate`
  validates the value against `payroll.payFrequencies` (DATABASE.md 5.8). Every rate row stores its frequency, so
  `defaultFrequency` is only the editor's default. CURRENT also uses `weekly` as a SQL fallback for a rate row without
  a frequency (`M/20260907160000:84`); the template needs none.

Periods, days and hours:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `payroll.periodPresets` | list of `{ key, label, fromDay, toDay }` | none: free From and To inputs `C/attendance-view.tsx:76-97`, unvalidated `P/payroll/page.tsx:33-34` | `[]` (free range) | TS |
| `payroll.periodDefault` | `month_to_date`, `current_preset` | month to date in the business zone `P/payroll/page.tsx:32-34` | `month_to_date` | TS |
| `payroll.minHoursForDay` | number, 0 or more; above 0 is a RECOMMENDED TEMPLATE IMPROVEMENT | 0: any completed session counts a day `M/20260907160000:52` | 0 | SQL |
| `payroll.overtimeDisplayThresholdHours` | number above 0 | 8, reported and never paid `M/20260907160000:50-51` | set at onboarding (no default) | SQL |
| `payroll.overtimeBasis` | `session`, `day` | `session`: two 5-hour sessions give 0 overtime hours `M/20260907160000:51` | `session` | SQL |
| `payroll.overtimePayMultiplier` | 0, or a number of 1 or more | none: pay uses days and the night bonus only `M/20260907160000:86-93` | 0 | SQL |

- Presets are day-of-month cutoffs such as 1 to 15 and 16 to month end; weekly periods stay free ranges. RECOMMENDED
  TEMPLATE IMPROVEMENT. Period membership itself is fixed: `work_date` between from and to, inclusive (section 5).
- `overtimeBasis = day` and any multiplier other than 0 are RECOMMENDED TEMPLATE IMPROVEMENT items that are not
  implemented in the reference implementation; the code template implements `overtimeBasis = day` (display only), and
  any multiplier other than 0 stays unimplemented. Paying overtime hours needs a formula in PAYROLL.md first.

Night rule:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `payroll.nightRule.enabled` | boolean | always on: trigger `M/20260722200000:34-37`; `report_payroll` `M/20260907160000:41,55` | false (client policy, PS-9) | both |
| `payroll.nightRule.anchor` | `clock_in`, `clock_out` | two anchors: flag on clock-in `M/20260722200000:34-35`; pay on clock-out `M/20260907160000:41` | set at onboarding (no default) | SQL |
| `payroll.nightRule.thresholdTime` | "HH:MM" | "22:00" in both places: hour 22 `M/20260722200000:34-35`; time 22:00 `M/20260907160000:41` | set at onboarding (no default) | SQL |
| `payroll.nightRule.windowEnd` | "HH:MM" or null | none: a clock-out after midnight never qualifies `M/20260907160000:41` | null; decide at onboarding | SQL |
| `payroll.nightRule.bonusAmount` | money, 0 or more | trigger 300.00 `M/20260722200000:37`; report `night_ot_bonus()` RECONSTRUCTED `M/20260907160000:85,90`; payslips: note | "0.00" | both |
| `payroll.nightRule.oncePerDay` | boolean | true in `report_payroll` `M/20260907160000:53-55`; display mirror `L/sessions.ts:116-118`; payslips: note | true | SQL |

Note on issued payslips: for `bonusAmount` and `oncePerDay` the CURRENT cells above hold for `report_payroll` only. The
live payslip body is RECONSTRUCTED, so its night-pay source is NEEDS VERIFICATION: it may use night shifts x
`night_ot_bonus()`, or, like the stale repo body, sum every completed session's flag amount with no per-day cap
(`M/20260722210000:106-111`; help text `C/payslip-button.tsx:290-291`). Section 8 item 10 settles it.

- GENERIC rule, one predicate `app_private.is_night_session(time_in, time_out)`: a completed session qualifies when
  the business-time time of day of its anchored instant is at or after `thresholdTime`, or, when `windowEnd` is set,
  before `windowEnd`. Night shifts are the distinct work_dates with a qualifying session when `oncePerDay` is true,
  otherwise the qualifying sessions. Night pay is night shifts x `bonusAmount`. RECOMMENDED TEMPLATE IMPROVEMENT.
- The rule is computed on read by payroll, the payslip function and any review badge; there is no stored night flag
  and no night trigger (DATABASE.md 5.3; section 5 item 14). A Postgres generated column cannot read settings (its
  expression must be immutable), so a badge calls the predicate or reads a view.
- Onboarding values. `rateBasis`, `defaultFrequency`, `overtimeDisplayThresholdHours`, `nightRule.anchor` and
  `nightRule.thresholdTime` have no template default: the reference values in the CURRENT column are client policy
  (PS-9), and validation (section 2.9) fails until the client sets them.
- The CURRENT difference matters for real shifts: 14:00 to 22:30 is counted by `report_payroll` but shows no badge;
  22:15 to 00:30 shows the badge but is not counted by `report_payroll`. Payslip treatment of both is NEEDS
  VERIFICATION (section 8 item 10): if the live payslip body sums the trigger's flat amount, as the stale repo body does,
  the second session is paid on the payslip and the first is not. A `windowEnd` makes after-midnight clock-outs
  qualify; its value is client policy.

Deductions, rounding, payslips:

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `payroll.deductionsModel` | `lump_sum`, `itemized` | `lump_sum`: one amount `C/payslip-button.tsx:169`, validated `L/payslip-actions.ts:48-55`, check `M/20260722210000:27` | `lump_sum` | both |
| `payroll.allowNegativeNet` | boolean | true in effect: no check on `net_salary` `M/20260722210000:28`; payslip body RECONSTRUCTED (note) | false | SQL |
| `payroll.rounding.moneyScale` | fixed 2 | `round(..., 2)` `M/20260907160000:88-92` | 2 | SQL |
| `payroll.rounding.hoursScale` | fixed 2 | SQL rounds totals `M/20260907160000:79-80`; TS rounds each session then the sum `L/sessions.ts:90-91` | 2 | both |
| `payroll.rounding.roundOnce` | fixed true | false in effect: the two layers round in a different order (`L/format.ts:12`) | true | both |
| `payroll.snapshot.immutable` | fixed true | by convention: no delete grant `M/20260722210000:67-68`; update policy not column-limited `:62-65` | true | SQL |
| `payroll.snapshot.uniquePerPeriod` | fixed true | not enforced: two plain indexes `M/20260722210000:41-44`; reader keeps the newest `L/payslip.ts:76-80` | true | SQL |
| `payroll.statuses` | fixed `pending`, `paid`, `void` | `pending`, `paid` `M/20260722210000:29-30`; no reverse path | `pending`, `paid`, `void` | SQL |
| `payroll.statusLabels` | map of four labels | "Unpaid" `C/attendance-view.tsx:218`, `L/payslip-pdf.ts:89`; "Pending" `C/payslip-button.tsx:99`; summary: note | UI_UX.md 5 | TS |
| `payroll.paidDateEditable` | boolean | false: the action reads a date the dialog never sends; business today `L/payslip-actions.ts:115-116` | true | TS |
| `payroll.approvalRequired` | boolean | false: no approval step; `approved_by` is never written `M/20260722210000:32` | false | SQL |
| `payroll.lockPeriodAfterPayslip` | `off`, `generated`, `paid` | `off`: a correction ignores payslips `M/20260907130000:13-63` | `off` | SQL |
| `payroll.payslip.pageSize` | `a4`, `a5`, `letter` | A5 portrait, 36 pt margin `L/payslip-pdf.ts:52-55` | `a5` | TS |
| `payroll.payslip.fileNamePattern` | text with the four tokens | brand prefix, "Payslip", employee, start_end `L/payslip-pdf.ts:44-49` | "{prefix}-Payslip-{employee}-{start}_{end}.pdf" | TS |
| `payroll.payslip.labels` | map | literals `C/payslip-button.tsx:111-114`, `L/payslip-pdf.ts:104-107`; night label embeds amount and symbol | set at onboarding (no default) | TS |

- Notes on CURRENT cells. The deductions clamp `greatest(coalesce(p_deductions, 0), 0)` (`M/20260722210000:93`) and
  the stored net `gross - deductions` (`:125`) are in the stale repo body; the live payslip body is RECONSTRUCTED, and
  whether it guards a negative net is unknown (section 8 item 10). The Payroll Summary prints the raw `payment_status`
  (capitalised by CSS) or "not generated" (`C/payroll-summary-button.tsx:156`), a third wording beside "Unpaid" and
  "Pending"; `statusLabels.notGenerated` replaces it.
- `deductionsModel`: `lump_sum` shows one field, stores the amount in the snapshot's `deductions` column and leaves
  `payroll_adjustments` empty; `itemized` writes `payroll_adjustments` rows in the same transaction, and their
  deduction sum equals `deductions` (DATABASE.md 5.10). `itemized` is a RECOMMENDED TEMPLATE IMPROVEMENT.
- Payslip night pay: the template's `generate_payslip_snapshot` reads the same payroll computation as the report
  (DATABASE.md 5.13, `app_private.payroll_lines`), so an issued payslip and the payroll table price night pay with
  one rule. CURRENT cannot show that they agree, because the live payslip body is RECONSTRUCTED (section 0).
- `allowNegativeNet = false` makes generation refuse deductions above gross (DATABASE.md 5.13); a client that never
  allows a negative net also adds `check (net_salary >= 0)` at install (DATABASE.md 5.9). RECOMMENDED TEMPLATE
  IMPROVEMENT: CURRENT allows a negative net, and the summary parser then adds a wrong amount to
  "Total payroll" (section 6, item 9).
- `roundOnce`, `immutable` (freeze trigger), `uniquePerPeriod` (supersede instead of a silent second row), `void`
  (the only reverse path, with a reason) and `paidDateEditable = true` are RECOMMENDED TEMPLATE IMPROVEMENT items;
  DATABASE.md 5.9 carries the DDL.
- `approvalRequired = true` makes payroll count only approved days and needs the optional `attendance_day_reviews`
  module. `lockPeriodAfterPayslip` makes correct and delete refuse a session whose `work_date` lies inside the period of
  a current (not superseded, not void) payslip for that employee: with `generated` as soon as that payslip exists, with
  `paid` once it is paid. DATABASE.md 5.5 defines the lock as a read of `payroll_snapshots` that needs no day-review
  column. Both are RECOMMENDED TEMPLATE IMPROVEMENT items.
- Label defaults: "Days worked", "Total hours" (CURRENT says "Regular hours" for total hours,
  `C/attendance-view.tsx:141`), "Night shifts ({bonusAmount} each)", "Daily rate", "Regular salary", "Night bonus",
  "Gross salary", "Deductions", "Net pay", "Employee signature", "Approved by" (`C/payslip-button.tsx:143-145`).

### 2.7 Audit and retention

| Key | Type: allowed values | CURRENT | Default | Layer |
|---|---|---|---|---|
| `audit.payloadIncludesAmounts` | boolean | true: `daily_rate` `L/rate.ts:233-238`, `net_salary` `L/payslip-actions.ts:88-93`, overtime `L/attendance.ts:188-196` | false | TS and SQL |
| `retention.selfieRetentionDays` | integer, 1 or more, or null | none: kept; only a one-off script removes blobs `scripts/purge-attendance-selfies.mjs:3-9` | null while photos are off | job |
| `retention.signedUrlTtlSeconds` | integer above 0 | 300 with a download disposition `L/attendance.ts:496-500`; `src/lib/attachments/service.ts:15` | 300 | TS |
| `retention.deleteSelfieWithRecord` | boolean | false: a deleted session leaves its photo `L/attendance.ts:345-346` | true | job |

- CURRENT audit read access admits every active staff member (`M/20260715130100:661-662`); PENDING (not live) narrows
  it (`M/20260916120000:290-298`). Read access is not configuration here: the read policy is DDL, defined by
  DATABASE.md 5.11 with PERMISSIONS.md 4.2 keys; there is no audit read-access key. With
  `payloadIncludesAmounts = false` the audit context holds ids and a change marker, not rates or pay.
- Photo blobs cannot be removed by SQL: a storage trigger blocks deleting storage objects from SQL, so the reference
  purge runs through the Storage API with the service-role key (`scripts/purge-attendance-selfies.mjs:7-9,21-22`).
  Retention and `deleteSelfieWithRecord` therefore run as a scheduled service-role job that removes the blobs of
  expired photos and of hard-deleted or purged sessions. RECOMMENDED TEMPLATE IMPROVEMENT; no scheduled job touches
  attendance today.

### 2.8 SQL-evaluated keys in the settings store

Storage follows DATABASE.md 5.12: one row per key in `app_private.hr_settings`, with `key` equal to the configuration
key name below and `value` a jsonb scalar, array or null. "Dated rows" says whether the check `hr_settings_dated_keys`
allows more than the `-infinity` row. "Read by" names the function that uses the value; it reads through the named
reader where DATABASE.md 5.12 defines one, otherwise through `app_private.hr_setting(p_key, p_as_of)` with a cast.

| Key | jsonb value | Dated rows | Read by |
|---|---|---|---|
| `locale.timezone` | string | no | `business_timezone()`, `business_today()` |
| `payroll.nightRule.enabled` | boolean | yes | `is_night_session` |
| `payroll.nightRule.anchor` | string | yes | `is_night_session` |
| `payroll.nightRule.thresholdTime` | string "HH:MM" | yes | `is_night_session` |
| `payroll.nightRule.windowEnd` | string "HH:MM" or null | yes | `is_night_session` |
| `payroll.nightRule.bonusAmount` | string (money) | yes | `night_bonus_amount(p_as_of)` |
| `payroll.nightRule.oncePerDay` | boolean | yes | payroll computation (`app_private.payroll_lines`) |
| `payroll.overtimeDisplayThresholdHours` | number | yes | payroll computation |
| `payroll.overtimeBasis` | string | yes | payroll computation |
| `payroll.minHoursForDay` | number | yes | payroll computation |
| `payroll.rateSelection` | string | yes | payroll computation |
| `payroll.approvalRequired` | boolean | yes | payroll computation |
| `payroll.allowNegativeNet` | boolean | yes | `generate_payslip_snapshot` |
| `payroll.lockPeriodAfterPayslip` | string | yes | `correct_attendance_clock_out`, `delete_attendance_record` (DATABASE.md 5.5) |
| `payroll.payFrequencies` | array of strings | yes | `set_staff_salary_rate` (DATABASE.md 5.8) |
| `payroll.overtimePayMultiplier` | number | yes | payroll computation (0 until overtime pay exists, section 2.9 rule 9) |
| `payroll.deductionsModel` | string | yes | `generate_payslip_snapshot`: `payroll_adjustments` rows only under `itemized` (DATABASE.md 5.10) |
| `attendance.device.mode` | string | no | `kiosk_clock_in`, `kiosk_clock_out`, `attendance_gating_active` |
| `attendance.device.maxActiveDevices` | number | no | `register_attendance_device` |
| `attendance.device.defaultLabel` | string | no | `register_attendance_device`, for a blank label (CURRENT literal `M/20260722150000:51`) |
| `attendance.allowMultipleSessionsPerDay` | boolean | no | `kiosk_clock_in` and `self_clock_in` (DATABASE.md 5.13) |
| `attendance.clockMode` | string | no | `self_clock_in`, `self_clock_out` (DATABASE.md 5.13; refuse unless `self_service`) |
| `attendance.correction.maxWindowDays` | number or null | no | `correct_attendance_clock_out` |
| `attendance.deletion.mode` | string | no | `delete_attendance_record` |
| `attendance.selfie.mode` (only `required`) | string | no | clock functions, once `required` is built |
| `review.dateFilterBasis` | string | no | `review_attendance_page` (DATABASE.md 5.13) |
| `exclusions.excludedRoles` | array of strings | no | the role trigger that sets `timekeeping_exempt` (DATABASE.md 5.2) |
| `exclusions.excludeDemoAccounts` | boolean (fixed true) | no | `is_timekeeping_eligible` (DATABASE.md 5.2) |
| `audit.payloadIncludesAmounts` | boolean | no | the SQL functions that build context for `app_private.record_audit_event` (DATABASE.md 5.11) |

In `templates/attendance-payroll` the rows for `approvalRequired`, `lockPeriodAfterPayslip`, `overtimePayMultiplier`,
`deductionsModel`, `clockMode`, `selfie.mode` and `review.dateFilterBasis` are seeded but no function reads them yet;
the store accepts only values that need no unbuilt module.

- DATABASE.md 5.12 names the store, its readers and the key naming, but lists no complete key set; this table is the
  key set of record. Its as-of rules are in section 1.4; `deductionsModel` is a period-wide key, read as of the period
  end.
- Every key whose Layer in sections 2.2 to 2.7 is SQL or both, and whose type is not fixed, has a row here, except
  `payroll.rateBasis`: its SQL side reads the basis stored on each rate row (DATABASE.md 5.8), not the key. Fixed keys
  with that Layer (`locale.moneyDisplay.minorUnits`, `attendance.maxOpenSessionsPerEmployee`,
  `attendance.sessionCrossesMidnightPolicy`, `attendance.correction.allowClockInCorrection` and `.requireReason`,
  `attendance.deletion.requireReason`, `payroll.rateEffectiveDating`, `payroll.prorationPolicy`, `payroll.rounding.*`,
  `payroll.snapshot.*`, `payroll.statuses`) have no row: DDL and function bodies carry them (section 5).
  `exclusions.excludeDemoAccounts` is the one fixed key with a row, because DATABASE.md 5.2 names it as an input of the
  eligibility predicate. `permissions.defaultGrants.*` are seeded into the host's grant tables, not into this store.
- The app reads `locale.timezone`, `bonusAmount` and the other night keys through `public.get_hr_settings()` to build
  business dates and labels, so screens and SQL use the same values. It reads `review.dateFilterBasis`,
  `attendance.device.defaultLabel` and `audit.payloadIncludesAmounts` the same way for its own list filters, the
  register form and the app-side audit writer, never from a TypeScript default (section 1.3).

### 2.9 Validation when the configuration loads

The module refuses to load, and the seed migration refuses to run, when any rule fails. Every rule below needs a
failing unit case; TESTING_CHECKLIST.md U6 (section 4.1) lists one per rule, 1 to 15.

1. `locale.timezone` is accepted by the Intl date-time formatter (an unknown zone throws a RangeError).
2. Every "HH:MM" value is two digits from 00 to 23, a colon, and two digits from 00 to 59.
3. Every money value is digits, optionally a dot and one or two digits; `bonusAmount` is 0 or more.
4. `defaultFrequency` is in `payFrequencies`; `payFrequencies` is not empty; every frequency has a label.
5. `defaultPageSize` is in `pageSizes`; every page size is a positive integer; `defaultRangeDays` is 1 or more.
6. Every grant in `permissions.defaultGrants` is a key from PERMISSIONS.md 4.2, or `attendance.delete.request` when
   `attendance.deletion.requestApprovalPath` is true; `owner` is never listed; each grant set satisfies the key
   dependencies of PERMISSIONS.md 4.3.
7. `attendance.selfie.mode` other than `off` requires a non-null `retention.selfieRetentionDays`.
8. `attendance.selfie.mode = required` and `payroll.deductionsModel = itemized` fail until the engine supports them.
9. `payroll.overtimePayMultiplier` is 0 until overtime pay is implemented.
10. `payroll.approvalRequired = true` requires the day-review module (DATABASE.md 5.5); `lockPeriodAfterPayslip`
    other than `off` requires the lock checks in the correct and delete functions.
11. `attendance.deletion.requestApprovalPath = true` requires the host approvals module.
12. `branding.logoText` has 1 to 3 characters; `brandColor` is "#" plus six hexadecimal digits; `cookieNamePrefix`
    uses lowercase letters, digits and underscore; `documentFilePrefix` uses letters, digits and hyphen.
13. `payroll.periodDefault = current_preset` requires at least one preset.
14. `payroll.rateBasis = monthly` fails until PAYROLL.md defines its formula (section 2.6; IMPLEMENTATION_PROMPT.md
    V3). `hourly` is accepted, because PAYROLL.md section 11 step 4 defines its formula; the build implements that
    branch before the value is used (section 2.6).
15. Keys set at onboarding have a value: `payroll.rateBasis`, `payroll.defaultFrequency`,
    `payroll.overtimeDisplayThresholdHours` and `attendance.clockMode` are not null; `locale.dateLocale` is not empty;
    `payroll.payFrequencies` has been chosen (rule 4 then requires its labels); `payroll.payslip.labels` is not empty;
    and `payroll.nightRule.anchor` and `payroll.nightRule.thresholdTime` are not null while
    `payroll.nightRule.enabled` is true.

Store limits and engine check. The settings store refuses values outside these ranges, so validation checks them too:
`payroll.overtimeDisplayThresholdHours` above 0 and at most 24; `payroll.minHoursForDay` 0 to 24;
`payroll.nightRule.bonusAmount` at most ten integer digits; `attendance.device.maxActiveDevices` an integer from 1 to
1000; `attendance.correction.maxWindowDays` null or an integer from 1 to 3650; `attendance.device.defaultLabel` 1 to 80
characters. `attendance.clockMode = self_service` fails while `self_clock_in` and `self_clock_out` are not built.

## 3. Example configuration for a hypothetical client

Placeholders in angle brackets are filled per client. The rule values are an example, not advice for any business.
The seed migration writes the keys listed in section 2.8 into `app_private.hr_settings` as `-infinity` rows; the rest
stays in `src/lib/hr/config.ts`. This client has an approval queue in its host, so its Admins request deletions instead
of deleting (validation rules 6 and 11), and it enables the payroll self view. `config/example.client.config.json` in
the code folder (`templates/attendance-payroll/`) is a second example shaped for the code template.

```json
{
  "branding": {
    "companyName": "<Client Company Ltd>",
    "payslipHeader": "Payslip",
    "summaryHeader": "Payroll Summary",
    "logoText": "<CC>",
    "logoUrl": null,
    "brandColor": "<#rrggbb>",
    "documentFilePrefix": "<ClientCo>",
    "cookieNamePrefix": "<clientco>_",
    "address": "<street, city, country>",
    "taxId": "<tax-registration-number>",
    "contact": "<payroll-contact>"
  },
  "locale": {
    "timezone": "<IANA-zone>",
    "currencyCode": "<CCY>",
    "currencySymbol": "<symbol>",
    "moneyDisplay": {
      "minorUnits": 2,
      "hideZeroMinorUnits": false,
      "groupSeparator": ",",
      "decimalSeparator": ".",
      "pdfUsesCode": true
    },
    "dateLocale": "<bcp47-tag>",
    "showTimesInBusinessTimezone": true
  },
  "permissions": {
    "defaultGrants": {
      "selected_admin": [
        "attendance.view_team",
        "attendance.review",
        "attendance.correct",
        "attendance.delete.request",
        "payroll.export"
      ],
      "staff": []
    }
  },
  "exclusions": {
    "excludedRoles": ["owner"],
    "excludeDemoAccounts": true
  },
  "attendance": {
    "clockMode": "kiosk",
    "selfView": false,
    "allowMultipleSessionsPerDay": true,
    "maxOpenSessionsPerEmployee": 1,
    "sessionCrossesMidnightPolicy": "clock_in_date",
    "maxSessionHours": 14,
    "device": {
      "mode": "required",
      "failMode": "closed",
      "maxActiveDevices": 2,
      "cookieMaxAgeDays": 180,
      "defaultLabel": "Front desk tablet"
    },
    "selfie": {
      "mode": "optional",
      "facingMode": "user",
      "maxEdgePx": 1600,
      "jpegQuality": 0.82
    },
    "correction": {
      "allowClockInCorrection": false,
      "requireReason": true,
      "maxWindowDays": 45
    },
    "deletion": {
      "mode": "soft",
      "requireReason": true,
      "requireTypedConfirmation": true,
      "confirmationPhrase": "DELETE",
      "requestApprovalPath": true
    }
  },
  "review": {
    "defaultRangeDays": 7,
    "quickRanges": ["today", "7d", "month", "custom"],
    "pageSizes": [25, 50, 100],
    "defaultPageSize": 25,
    "defaultStatus": "all",
    "dateFilterBasis": "work_date",
    "statusLabels": { "open": "Open", "completed": "Completed" }
  },
  "payroll": {
    "selfView": true,
    "rateBasis": "daily",
    "payFrequencies": ["semi_monthly", "monthly"],
    "payFrequencyLabels": { "semi_monthly": "Semi-monthly", "monthly": "Monthly" },
    "defaultFrequency": "semi_monthly",
    "frequencyDrivesPeriod": false,
    "rateEffectiveDating": "append_only",
    "rateSelection": "period_end",
    "prorationPolicy": "none",
    "currentRateLookup": "effective_today",
    "periodPresets": [
      { "key": "first_half", "label": "1st to 15th", "fromDay": 1, "toDay": 15 },
      { "key": "second_half", "label": "16th to month end", "fromDay": 16, "toDay": "month_end" }
    ],
    "periodDefault": "current_preset",
    "minHoursForDay": 0,
    "nightRule": {
      "enabled": true,
      "anchor": "clock_out",
      "thresholdTime": "<HH:MM>",
      "windowEnd": "<HH:MM>",
      "bonusAmount": "<amount>",
      "oncePerDay": true
    },
    "overtimeDisplayThresholdHours": "<hours, a number>",
    "overtimeBasis": "session",
    "overtimePayMultiplier": 0,
    "deductionsModel": "lump_sum",
    "allowNegativeNet": false,
    "rounding": { "moneyScale": 2, "hoursScale": 2, "roundOnce": true },
    "snapshot": { "immutable": true, "uniquePerPeriod": true },
    "statuses": ["pending", "paid", "void"],
    "statusLabels": { "notGenerated": "Not generated", "pending": "Pending", "paid": "Paid", "void": "Void" },
    "paidDateEditable": true,
    "approvalRequired": false,
    "lockPeriodAfterPayslip": "paid",
    "payslip": {
      "pageSize": "a4",
      "fileNamePattern": "{prefix}-Payslip-{employee}-{start}_{end}.pdf",
      "labels": {
        "daysWorked": "Days worked",
        "totalHours": "Total hours",
        "nightShifts": "Night shifts ({bonusAmount} each)",
        "dailyRate": "Daily rate",
        "regularSalary": "Regular salary",
        "nightBonus": "Night bonus",
        "grossSalary": "Gross salary",
        "deductions": "Deductions",
        "netPay": "Net pay",
        "employeeSignature": "Employee signature",
        "approvedBy": "Approved by"
      }
    }
  },
  "audit": {
    "payloadIncludesAmounts": false
  },
  "retention": {
    "selfieRetentionDays": 90,
    "signedUrlTtlSeconds": 300,
    "deleteSelfieWithRecord": true
  }
}
```

Values in this example that need engine work beyond the reference implementation before the file validates or behaves
as described:

- Built in `templates/attendance-payroll`: `attendance.device.mode = required` with token checks in both RPCs,
  `maxActiveDevices` above 1 in the register RPC, `correction.maxWindowDays`, `deletion.mode = soft`,
  `nightRule.windowEnd`, `allowNegativeNet` as a guard, `void`, `semi_monthly` in the rate validation, and the
  effective-dated settings store with its readers.
- Still needing engine or host work: `maxSessionHours` flags, `requestApprovalPath` with a grantable request key and the
  host queue, the `payroll.selfView` screen, `selfie.mode` with its retention job, the `dateFilterBasis` reader,
  `currentRateLookup = effective_today`, `periodPresets`, `paidDateEditable` in the UI, `lockPeriodAfterPayslip` with the
  payslip lookup, the optional `net_salary` CHECK, and the address block on documents. With the code template as
  shipped, `validateAttendancePayrollConfig` refuses this file even with its placeholders filled (rule 10 for
  `lockPeriodAfterPayslip = paid`, rule 11 for `requestApprovalPath`), and the settings store refuses
  `lockPeriodAfterPayslip = paid`.

## 4. Migration of hardcoded values

Each row is a site in the reference implementation that holds a client value in code, and the key or accessor that
replaces it. Brand, currency and timezone values are described, not quoted; section 9 lists them.

| # | Site | What is hardcoded | Replaced by |
|---|---|---|---|
| H-1 | `L/payslip-pdf.ts:69`; `C/payslip-button.tsx:82`; `C/payroll-summary-button.tsx:93`; `src/lib/export/data-export.ts:132` | company name (PS-1) | `branding.companyName` |
| H-2 | `L/payslip-pdf.ts:65`; `C/payslip-button.tsx:79`; `C/payroll-summary-button.tsx:90` | logo initials (PS-2) | `branding.logoText` |
| H-3 | `L/payslip-pdf.ts:17`; `C/payslip-button.tsx:40`; `C/payroll-summary-button.tsx:89` | accent colour (PS-3) | `branding.brandColor` |
| H-4 | `L/payslip-pdf.ts:44-49` | payslip file-name prefix (PS-4) | `branding.documentFilePrefix`, `payroll.payslip.fileNamePattern` |
| H-5 | `src/app/api/export/all/route.ts:74` | export file-name prefix (PS-5) | `branding.documentFilePrefix` |
| H-6 | `L/devices.ts:27` | device cookie name (PS-6) | `branding.cookieNamePrefix` plus the fixed suffix `att_device` |
| H-7 | `src/components/shell/privacy.tsx:33` | privacy-mode storage key (PS-6) | `branding.cookieNamePrefix` |
| H-8 | `L/attendance-paging.ts:41` | timezone constant (PS-7) | `locale.timezone` |
| H-9 | `L/attendance-paging.ts:42-43,77-78` | fixed UTC offset for day bounds (PS-7) | removed; bounds from `locale.timezone` with Intl |
| H-10 | `L/attendance.ts:133` | zone literal for "today" (PS-7) | business-date helper reading `locale.timezone` |
| H-11 | `src/lib/format/<zone>-date.ts:16-26` | zone constant; file and function names carry the zone (PS-7) | `locale.timezone`; `businessToday`, `businessMonthStart` |
| H-12 | `M/20260722200000:34` | zone in the night trigger (PS-7) | trigger removed (H-19) |
| H-13 | `M/20260907120000:45` | zone in the `work_date` stamp (PS-7) | `app_private.business_today()` |
| H-14 | `M/20260907160000:41`; PENDING (not live) `M/20260916120000:367-368` | zone in the payroll night rule and the column default (PS-7) | `is_night_session`; default `business_today()` |
| H-15 | `src/lib/payments/format.ts:55`; `src/components/ui/money-input.tsx:130`; `src/components/shell/privacy.tsx:34` | currency symbol (PS-8) | `locale.currencySymbol` |
| H-16 | `L/payslip-pdf.ts:21-31` | currency code in the PDF (PS-8) | `locale.currencyCode`, `locale.moneyDisplay.pdfUsesCode` |
| H-17 | `L/attendance.ts:201`; `L/rate.ts:242` | currency symbol inside server messages (PS-8) | shared formatter with `locale.currencySymbol` |
| H-18 | `C/payslip-button.tsx:113,290-291`; `L/payslip-pdf.ts:106`; comment `C/attendance-view.tsx:27-30` | night amount, symbol in labels and a comment (PS-8, PS-9) | `payroll.payslip.labels` |
| H-19 | `M/20260722200000:34-37,46-49` | clock-in hour 22 and 300.00 in a BEFORE INSERT trigger (PS-9) | trigger dropped; `payroll.nightRule.*` via `is_night_session` |
| H-20 | `M/20260907160000:41` | clock-out 22:00 in `report_payroll` (PS-9) | `payroll.nightRule.thresholdTime`, `.anchor`, `.windowEnd` |
| H-21 | `M/20260907160000:85,90` (`app_private.night_ot_bonus()`, RECONSTRUCTED) | night bonus amount | `app_private.night_bonus_amount(p_as_of)` |
| H-22 | `M/20260907160000:53-55`; `L/sessions.ts:116-118` | one bonus per day | `payroll.nightRule.oncePerDay` |
| H-23 | `M/20260907160000:50-51` | overtime display threshold 8, per session | `payroll.overtimeDisplayThresholdHours`, `payroll.overtimeBasis` |
| H-24 | `M/20260907160000:52` | a day is any completed session | `payroll.minHoursForDay` |
| H-25 | `M/20260907160000:59-74` | rate as of the period end | `payroll.rateSelection` |
| H-26 | `M/20260907160000:84`; `L/payroll.ts:54`; `L/rate.ts:167,186,213` | default frequency `weekly` (SQL, payroll reader, rate reader, rate writer) | `payroll.defaultFrequency` |
| H-27 | `L/rate.ts:214-216`; `C/attendance-view.tsx:38-42,320-322`; `C/employee-rates-view.tsx:33-37,116-118` | frequency list and labels | `payroll.payFrequencies`, `payroll.payFrequencyLabels` |
| H-28 | `L/rate.ts:139-143` | newest rate row counts as current | `payroll.currentRateLookup` |
| H-29 | `M/20260907160000:24,99`; `L/rate.ts:137` | Super Admin role excluded (PS-11) | `exclusions.excludedRoles` setting `timekeeping_exempt` |
| H-30 | `M/20260907160000:98`; `L/rate.ts:136`; `M/20260907120000:35-37` | demo accounts excluded, not in the roster | eligibility predicate (section 2.3) |
| H-31 | `M/20260722160000:10-15` | one-off demo backfill by an email pattern (PS-12) | removed; the seed sets `is_demo` |
| H-32 | `P/payroll/page.tsx:32-34` | default period month to date | `payroll.periodDefault` |
| H-33 | `C/attendance-view.tsx:76-97` | free From and To inputs only | `payroll.periodPresets` |
| H-34 | `P/attendance/page.tsx:51-55`; `P/attendance/review/page.tsx:25`; `C/review-attendance-view.tsx:91-92`; `C/attendance-records.tsx:64` | default range 7 days | `review.defaultRangeDays` |
| H-35 | `L/attendance-paging.ts:14-16` | page sizes and default | `review.pageSizes`, `review.defaultPageSize` |
| H-36 | `C/review-attendance-view.tsx:63-76,90`; `C/attendance-records.tsx:51-56` | quick-range labels, status tabs, default status | `review.quickRanges`, `review.defaultStatus` |
| H-37 | `L/attendance.ts:615-616`; `L/attendance-paging.ts:72-80` | list dates filtered on clock-in time | `review.dateFilterBasis` |
| H-38 | `C/attendance-records.tsx:502-508`; `C/review-attendance-view.tsx:509-515` | two wordings for the day status | `review.statusLabels` |
| H-39 | `C/attendance-view.tsx:218`; `L/payslip-pdf.ts:86-90`; `C/payslip-button.tsx:97-99`; `C/payroll-summary-button.tsx:156` | three status wordings | `payroll.statusLabels` |
| H-40 | `L/devices.ts:88` | cookie max age 365 days | `attendance.device.cookieMaxAgeDays` |
| H-41 | `M/20260722150000:49`; `C/device-manager.tsx:161` | one active device | `attendance.device.maxActiveDevices` |
| H-42 | `M/20260722150000:51`; `L/devices.ts:94`; `C/device-manager.tsx:186` | default device label (PS-10) | `attendance.device.defaultLabel` |
| H-43 | `L/attendance.ts:41,46`; `L/actions.ts:117`; `P/attendance/page.tsx:97-103`; `C/device-manager.tsx:73,161` | retail-device wording (PS-10) | device label map (UI_UX.md 11) |
| H-44 | `M/20260722150000:66-69`; `L/devices.ts:38-42`; `L/attendance.ts:32` | gate on when a device exists; fail open | `attendance.device.mode`, `attendance.device.failMode` |
| H-45 | `C/attendance-clock.tsx:117-121` | front camera | `attendance.selfie.facingMode` |
| H-46 | `src/lib/attachments/image.ts:18,21` | 1600 px and quality 0.82 | `attendance.selfie.maxEdgePx`, `attendance.selfie.jpegQuality` |
| H-47 | `L/attendance.ts:498`; `src/lib/attachments/service.ts:15` | signed URL lifetime 300 s | `retention.signedUrlTtlSeconds` |
| H-48 | `L/actions.ts:146-148`; `C/attendance-day-details.tsx:182`; `C/review-attendance-view.tsx:857` | typed phrase "DELETE" | `attendance.deletion.confirmationPhrase` |
| H-49 | `C/attendance-day-details.tsx:138-150`; `C/review-attendance-view.tsx:624-629` | request on one page, direct delete on the other | `attendance.deletion.requestApprovalPath` plus keys |
| H-50 | `L/payslip-pdf.ts:52-55` | A5 page, 36 pt margin | `payroll.payslip.pageSize` |
| H-51 | `C/payslip-button.tsx:109-120,143-145`; `L/payslip-pdf.ts:102-107,165-166`; `C/attendance-view.tsx:141` | document and column labels | `payroll.payslip.labels` |
| H-52 | `P/attendance/review/page.tsx:35-36`; `L/attendance.ts:352,406`; `M/20260907130000:29-33` | role titles for correct and delete | `attendance.correct`, `attendance.delete` |
| H-53 | `L/payslip-actions.ts:28,106`; `M/20260722210000:58-65` | role titles for generate and mark paid | `payroll.payslip.generate`, `payroll.payslip.mark_paid` |
| H-54 | `P/payroll/page.tsx:41-44`; `C/attendance-view.tsx:98,182`; `C/payroll-tabs.tsx:49` | role checks for rates, summary and "manage payroll" | `payroll.rates.edit`, `payroll.view_all` |
| H-55 | `L/devices.ts:69,104`; `M/20260722150000:46-48,75-77`; `P/attendance/page.tsx:107` | Super-Admin-only device management | `attendance.devices.manage` |
| H-56 | `M/20260907160000:100`; `M/20260722210000:53-55` | payroll rows for self or Super Admin only | own-row access (no key) or `payroll.view_all`; screen per `payroll.selfView` |
| H-57 | `L/attendance.ts:158,211`; `M/20260907120000:25-28` | clock writes check active staff only | `attendance.clock_operate` in the action and the RPC |
| H-58 | `L/attendance.ts:188-196`; `L/rate.ts:233-238`; `L/payslip-actions.ts:88-93` | money in audit contexts | `audit.payloadIncludesAmounts` |
| H-59 | `L/payslip-actions.ts:115-116` | paid date always business today | `payroll.paidDateEditable` |
| H-60 | `C/payslip-button.tsx:169`; `L/payslip-actions.ts:48-55`; stale repo body `M/20260722210000:93` | one deductions field, default "0" | `payroll.deductionsModel` |
| H-61 | `next.config.ts:45-48` | camera allowed for the app origin | kept; required when `attendance.selfie.mode` is not `off` |
| H-62 | `C/attendance-view.tsx:44-50,335` | Payroll-tab rate editor: effective date defaults to the device's local date, not the business date | business-date helper, `locale.timezone` |
| H-63 | `P/attendance/page.tsx:79`; `C/attendance-day-details.tsx:83` | role titles show the Attendance page's delete controls | `attendance.review`, `attendance.delete`; `requestApprovalPath` |
| H-64 | `C/payslip-button.tsx:210` | the optimistic paid date is business today from the zone-named helper | the date chosen under `payroll.paidDateEditable`; business-date helper |
| H-65 | `C/payslip-button.tsx:296-297` | copy that sends the viewer to a role title to generate the payslip | label map (UI_UX.md 5), naming no role title |
| H-66 | live payslip function (RECONSTRUCTED); stale body `M/20260722210000:106-111`; `C/payslip-button.tsx:290-291` | payslip night-pay source (NEEDS VERIFICATION) | `payroll.nightRule.*` |
| H-67 | `C/attendance-clock.tsx:139,212,222,225,247,332,360,380`; `L/actions.ts:131` | kiosk and device copy (prompts, "Continue Duty", revoke message) | label map (UI_UX.md 2.4, 5.3); not a key |
| H-68 | `src/components/shell/navigation.ts:174-199` | navigation section title, item labels and icons for the three screens | host navigation config (UI_UX.md 11) |
| H-69 | `P/attendance/page.tsx:86-89` | page description that names a role title as the only one who sees all rows (stale since reviewers also do) | label map (UI_UX.md 2.1), naming no role title |
| H-70 | `L/payroll.ts:46-47`; `L/payslip.ts:25-26`; `L/rate.ts:183-184` | fallback names "Staff member" and "Team member", fallback role `staff` | one fallback name in the label map (UI_UX.md) |

Engine constants that stay in code and are not in the table: the ISO-date technique (`L/attendance-paging.ts:47`), the
300 ms search debounce, the export read page and row cap (`src/lib/export/data-export.ts:94-97`), the export's fallback
payroll range 2000-01-01 to 2100-01-01 when no range is applied (`src/lib/export/data-export.ts:565-567`), the 10 MiB
upload limit (`src/lib/attachments/image.ts:10`), the storage path convention (`src/lib/attachments/upload.ts:107`), the
note length check (`M/20260717120000:28`), the rate input limit (`L/rate.ts:210`), the audit action names, and the rule
that only GET and HEAD reads are retried (`src/lib/supabase/server.ts:26-30`).

Out of scope, no key: holiday pay, rest-day premiums, a night differential beyond the flat night bonus, and statutory
items. CURRENT has none of them; a provisional-fields row records that overtime, night-differential and holiday policy
were awaiting client confirmation (`M/20260717120000:138-141`), and PAYROLL.md section 5 lists holiday pay and rest-day
premiums as absent. The template adds no key for them unless PAYROLL.md defines their rules; the nearest existing hook is
`payroll.deductionsModel = itemized` (PAYROLL.md section 10.4 row 25; DATABASE.md 5.10).

## 5. Not configurable by design

Each rule gives the CURRENT enforcement and why a client setting would be wrong.

1. One open session per employee. CURRENT: partial unique index `M/20260717120000:43-45`; friendly message
   `M/20260907120000:48-49`. Why: it guards against double taps, retries and a second device, and clock-out targets
   the single open session.
2. Session-row model. CURRENT: one row per session `M/20260717120000:20-33`; a day groups rows by member and
   `work_date` `L/sessions.ts:4-17`. Why: display and payroll share one definition of a day, and there is no day row
   to keep in sync (DATABASE.md 5.4).
3. Day total = sum of completed sessions. CURRENT: `L/sessions.ts:12-16,90-91`; `M/20260907160000:39,43,49`.
   Why: off-duty gaps are never paid, and the screen and payroll agree.
4. Server time on clock events. CURRENT: `time_in` defaults to `now()` `M/20260717120000:26`; the RPC call sends no
   time `L/attendance.ts:165-169`. Why: the record is tamper-evident only if a client cannot supply timestamps.
5. Status derived from timestamps. CURRENT: open means `time_out` is null `L/sessions.ts:89`; the stored `status`
   column is unused. Why: a stored status can disagree with the times; a derived one cannot.
6. Payroll derived from attendance. CURRENT: `report_payroll` recomputes on read `M/20260907160000:29-102`; the table
   comment says "never hand-entered" `M/20260717120000:35-36`. Why: client policy enters only through settings and rates.
7. Period membership by `work_date`. CURRENT: stamped at clock-in in the business zone `M/20260907120000:45`;
   inclusive filter `M/20260907160000:44`. Why: both layers agree which day and period a session belongs to.
8. Writes only through SECURITY DEFINER RPCs. CURRENT: the kiosk writes through `M/20260907120000:14-54`, but RLS and
   table grants still allow own-row insert and update `M/20260717120000:59-75`. Why: device, photo, reason and audit
   rules cannot be bypassed. Revoking direct writes is a RECOMMENDED TEMPLATE IMPROVEMENT.
9. Permission checks in the RPC or RLS. CURRENT: the kiosk write checks active staff only `M/20260907120000:25-28`.
   Why: a TypeScript guard is a mirror, never the only check (PERMISSIONS.md 4.1 principle 3 and 4.4).
10. Device check inside both kiosk RPCs, bound to the token. CURRENT: TypeScript only live `L/attendance.ts:28-48`;
    PENDING (not live) id check for clock-in only `M/20260916120000:451-459`. Why: a device id is readable from
    attendance rows; only the token proves the browser. RECOMMENDED TEMPLATE IMPROVEMENT.
11. Clock-out is the only correctable time. CURRENT: `M/20260907130000:55-59`. Why: editing clock-in can move a
    session across days and night boundaries; a client that needs it gets a separate audited RPC, not a flag.
12. Reasons for corrections and deletions. CURRENT: required at three layers for corrections (section 2.4); none on
    the direct delete path. Why: the audit trail needs the why. The deletion reason is a RECOMMENDED TEMPLATE IMPROVEMENT.
13. A corrected clock-out may not overlap the member's next session, and the row is locked while it is corrected.
    CURRENT: neither is checked; the RPC reads the row without `for update` `M/20260907130000:39-53`. Why: otherwise
    hours are counted twice or the audited old value is stale. RECOMMENDED TEMPLATE IMPROVEMENT.
14. One night predicate, computed on read. CURRENT: two rules (section 0). Why: the badge and pay cannot disagree.
    RECOMMENDED TEMPLATE IMPROVEMENT.
15. Money is numeric in SQL, strings in the app, rounded once. CURRENT: `L/payroll.ts:50-64`;
    `C/payroll-summary-button.tsx:31-39`. Why: a float can lose a minor unit; one rounding place keeps screen and
    payroll equal.
16. Rates are append-only history. CURRENT: per the docstring `L/rate.ts:193-199`, each save inserts a new row; the
    body of `set_staff_salary_rate` is RECONSTRUCTED, so what a second save for the same date does is unknown
    (section 8 item 3). Why: historical pay must be reproducible. The template makes append-only a fixed engine rule.
17. Snapshot immutability and one current payslip per period. CURRENT: no delete grant `M/20260722210000:67-68`; the
    update policy is not column-limited `:62-65`; the reader keeps the newest row `L/payslip.ts:76-80`. Why: an issued
    payslip is a record, and a regenerated pending row must never hide a paid one. The freeze trigger and supersede
    column are in DATABASE.md 5.9.
18. `void` is the only reverse path for a payslip. CURRENT: no reverse path. Why: it keeps the paid facts and adds a
    reason. RECOMMENDED TEMPLATE IMPROVEMENT.
19. Audit rows are also written by the SQL functions, and the old value is kept. CURRENT: the RPC returns the old
    value `M/20260907130000:61` and only the app event stores it; the writer never throws `src/lib/audit/log.ts:40-64`.
    Why: a direct RPC call leaves the same trace (DATABASE.md 5.1). RECOMMENDED TEMPLATE IMPROVEMENT.
20. Writes are never retried automatically. CURRENT: GET and HEAD are retried, POST never
    `src/lib/supabase/server.ts:26-30`; `src/lib/supabase/retry-fetch.ts:58-61`. Why: a clock action must never be
    applied twice without a human.
21. Photo in or out is recorded explicitly. CURRENT: told apart by a file-name substring `L/attendance.ts:505`. Why: a
    client-chosen name is not a record (DATABASE.md 5.7). RECOMMENDED TEMPLATE IMPROVEMENT.
22. Photo blobs are removed only by a service-role job. CURRENT: SQL delete of storage objects is blocked
    `scripts/purge-attendance-selfies.mjs:7-9`. Why: SQL and RLS cannot delete the blobs.

## 6. Defects carried into the template

Each item is a RECOMMENDED TEMPLATE IMPROVEMENT tied to a key or an engine rule above. None is a change to production.

1. Two night rules, and a clock-out after midnight earns nothing (`M/20260722200000:34-37`; `M/20260907160000:41`).
   Fix: `payroll.nightRule.*` through one predicate (section 2.6).
2. The night bonus lives in a function with no DDL (RECONSTRUCTED) plus a trigger literal, and the live payslip function
   that may read either one is RECONSTRUCTED too (section 0). Fix: effective-dated settings rows read through
   `night_bonus_amount(p_as_of)` by the one payroll computation; changes audited in SQL and never applied to issued
   payslips (sections 1.3 and 1.4).
3. The device gate is app-only live, fails open on a read error, and switches off when the last device is revoked
   (`L/devices.ts:38-42`; `M/20260722150000:66-69,78`). Fix: `attendance.device.mode`, `failMode`, token check in RPCs.
4. The kiosk permission is not enforced on the write path (`L/attendance.ts:158,211`; `M/20260907120000:25-28`).
   Fix: `attendance.clock_operate` checked in the action and both RPCs.
5. Kiosk status reads are RLS-scoped (`L/attendance.ts:111-122`; `M/20260804140000:8-14`), so an operator without the
   review key is never offered Clock Out for another member. Fix: a permission-scoped definer status reader
   (DATABASE.md 5.13).
6. A reviewer who is not the Super Admin sees no employee names: the reader embeds `staff_profiles.full_name`
   (`L/attendance.ts:562-563`) under a Super-Admin-or-self read policy (`M/20260821140000:21-22`). Fix: a definer reader
   that returns names to key holders (PERMISSIONS.md 4.1 principle 6).
7. Super Admin exclusion is roster-level only and the roster lists demo profiles (section 2.3). Fix: the eligibility
   predicate in the roster, both RPCs and payroll.
8. The two pages disagree on Admin deletion, and the request key cannot be granted from the catalogue
   (`C/attendance-day-details.tsx:138-150`; `C/review-attendance-view.tsx:624-629`;
   `src/lib/authz/access-catalogue.ts:116-128`). Fix: `attendance.deletion.requestApprovalPath` plus catalogued keys.
9. A negative net is possible (`M/20260722210000:28,125`), and the summary parser replaces a non-digit whole part with
   0 while keeping the fraction, so -100.50 adds +0.50 to "Total payroll" (`C/payroll-summary-button.tsx:32-35`).
   Fix: `payroll.allowNegativeNet = false` as a CHECK, plus signed parsing (TESTING_CHECKLIST.md).
10. The correction input is seeded at minute precision (`C/review-attendance-view.tsx:674-679`). An unchanged save on
    an open session is refused as before clock-in (`M/20260907130000:48-50`); on a completed session it silently
    rewrites `time_out` to the start of its minute. Fix: a UI rule in UI_UX.md; not a configuration key.
11. Admins are shown payroll controls that the server refuses: generate (`L/payslip-actions.ts:28`), mark paid under
    the repo policy (`M/20260722210000:62-65`), rows (`M/20260907160000:100`). Fix: the UI, the action and the RPC read
    the same keys.
12. Rate edits have no TypeScript guard and an unknown database gate (`L/rate.ts:201-231`). Fix: `payroll.rates.edit`
    enforced in the rate RPC shipped with DDL.
13. A future-dated rate shows as current (`L/rate.ts:139-143`). Fix: `payroll.currentRateLookup = effective_today`.
14. Hours are rounded in a different order in TypeScript and SQL (`L/sessions.ts:90-91`; `M/20260907160000:79`).
    Fix: `payroll.rounding.roundOnce`.
15. No unique payslip per period, no reverse path, and no chosen paid date (`M/20260722210000:41-44`;
    `L/payslip-actions.ts:115-116`). Fix: `snapshot.uniquePerPeriod`, `void`, `paidDateEditable`.
16. Pay frequency drives nothing (`M/20260907160000:84`). Fix: `frequencyDrivesPeriod` with `periodPresets`, or drop it.
17. Lists filter on clock-in time while payroll and the export use `work_date`. Fix: `review.dateFilterBasis`.
18. Status wording differs by surface (H-38, H-39). Fix: `review.statusLabels`, `payroll.statusLabels`, UI_UX.md 5.
19. Rates, net pay and overtime amounts sit in audit contexts that every active staff member can read live
    (`M/20260715130100:661-662`). Fix: `audit.payloadIncludesAmounts = false` and the read policy of DATABASE.md 5.11.
20. Photos are readable by every active staff member, kept indefinitely and left behind on delete
    (`M/20260716300000:127-129,159-161`; `L/attendance.ts:345-346`). Fix: `selfie.mode = off` by default, the
    `retention.*` keys, and the service-role job.
21. Staff can insert and update their own attendance rows directly (`M/20260717120000:59-75`). Fix: section 5.
22. The camera header is an unstated prerequisite (`next.config.ts:45-48`). Fix: stated in section 2.4 and checked
    by TESTING_CHECKLIST.md.
23. Stale comments contradict behaviour: self-service clocking (`P/attendance/page.tsx:34-35`), Super-Admin-only mark paid
    (`L/payslip-actions.ts:13-15` against `:106`), and an RLS-based rate authority model (`L/rate.ts:9-20` against
    `:201-231`). Fix: template comments describe the key and settings model only.

## 7. Alignment with sibling documents

This file is the schema of record for configuration keys and their defaults, with two exceptions it follows rather
than sets: the permission keys and default grant sets (PERMISSIONS.md 4.2 and 5) and the DDL, including the settings
store (DATABASE.md 5). Where another document names a configuration key, a settings key or a default, it uses the
value below.

| Decision | Value of record | Documents that must use it |
|---|---|---|
| Authorization model | PERMISSIONS.md 4.2 keys; grants as PERMISSIONS.md 5 (section 2.3); no role lists; no `payroll.view_own` | PERMISSIONS.md 4-5; DATABASE.md 5.1; PAYROLL.md 10 (note a) |
| Self views | `attendance.selfView` and `payroll.selfView`, both default false | PERMISSIONS.md 5; IMPLEMENTATION_PROMPT.md |
| Delete request path | `requestApprovalPath` default false; key `attendance.delete.request` only when true | PERMISSIONS.md 4.2; DATABASE.md 5.1, 5.13; IMPLEMENTATION_PROMPT.md |
| Settings store | `app_private.hr_settings` key rows, dated `payroll.*` rows; sections 1.2 to 1.4 and 2.8 | DATABASE.md 5.12; IMPLEMENTATION_PROMPT.md; BUSINESS_RULES.md A13 |
| Settings editor (optional) | `public.set_hr_setting`; insert for `payroll.*` keys, update of the `-infinity` row otherwise (section 1.3) | DATABASE.md 5.12, 5.13 (note d) |
| Night predicate | `app_private.is_night_session(time_in, time_out)`, computed on read; no stored flag | PAYROLL.md 4, 12 item 1; DATABASE.md 5.3, 5.12 (note a) |
| Night keys | `enabled`, `anchor`, `thresholdTime`, `windowEnd`, `bonusAmount`, `oncePerDay` | PAYROLL.md 10.3, 11; DATABASE.md 5.12 |
| Device | `mode` default `auto`, `failMode` default `closed`; enforcement in RPCs is engine, not a key | DATABASE.md 5.6 (note c), 5.12; IMPLEMENTATION_PROMPT.md |
| Clock mode | `clockMode` set at onboarding; `self_clock_in`, `self_clock_out`; self-service page, no key (2.4) | DATABASE.md 5.13; PERMISSIONS.md 4.3; IMPLEMENTATION_PROMPT.md Q4 (note d) |
| Photos | `selfie.mode` default `off`; `required` not implemented | IMPLEMENTATION_PROMPT.md; UI_UX.md |
| Clock-in correction | fixed false (engine) | PERMISSIONS.md 4.2; IMPLEMENTATION_PROMPT.md |
| Deletion | `mode` default `soft`; reason required; typed phrase checked in the server action; `delete_attendance_record` | DATABASE.md 5.13; IMPLEMENTATION_PROMPT.md |
| Payslip states | `pending`, `paid`, `void`; labels Not generated, Pending, Paid, Void | DATABASE.md 5.9; UI_UX.md 5; IMPLEMENTATION_PROMPT.md |
| Deductions | `lump_sum` default, in the snapshot's `deductions` column; `itemized` as `payroll_adjustments` rows | DATABASE.md 5.10; PAYROLL.md 10; IMPLEMENTATION_PROMPT.md (note b) |
| Net pay | `allowNegativeNet` default false | DATABASE.md 5.9, 5.12 |
| Rates | `rateSelection` default `period_end`; bases `daily`, `hourly`, `monthly` (`monthly` refused, 2.9 rule 14); rate function checks frequency | DATABASE.md 5.8; PAYROLL.md 11 |
| Overtime | `overtimeBasis` default `session`; `overtimePayMultiplier` 0 means unpaid | PAYROLL.md 10; TESTING_CHECKLIST.md |
| Periods | `periodDefault` `month_to_date` or `current_preset`; `lockPeriodAfterPayslip` `off`, `generated`, `paid`, a read of `payroll_snapshots` | DATABASE.md 5.5; IMPLEMENTATION_PROMPT.md |
| Exemption | eligibility predicate on `timekeeping_exempt`; `excludedRoles` sets the flag; demo exclusion fixed | DATABASE.md 5.2; PERMISSIONS.md 5; UI_UX.md 11 |
| Summary and export | no key for the summary (offered to `payroll.view_all`); `payroll.export` for export | PERMISSIONS.md 4.2; IMPLEMENTATION_PROMPT.md |
| Money units | `minorUnits` fixed 2 | IMPLEMENTATION_PROMPT.md |
| Payslip page | `payslip.pageSize` default `a5` | IMPLEMENTATION_PROMPT.md |

Notes. They were checked against the sibling files on 2026-09-17. Those files are revised in parallel, so search for
each named identifier again before relying on a note.

a. No sibling document defines a `payroll.view_own` key any more: DATABASE.md 5.1 treats own rows as keyless and marks
   `attendance.delete.request` as optional, and PAYROLL.md no longer names the key. Own-row access needs no key
   (PERMISSIONS.md 4.1 principle 7). DATABASE.md and PAYROLL.md now give the night predicate one name: PAYROLL.md uses
   `is_night_session` in section 4 GENERIC and section 12 item 1, as DATABASE.md 5.12 does.
b. An earlier version of this file described a single-row, undated settings store in which a change applied to every
   period without a payslip, a lump sum written as one `payroll_adjustments` row, and a period lock tied to the
   day-review module. This version follows the DDL of record, DATABASE.md 5.5, 5.10 and 5.12.
c. DATABASE.md now agrees with this file on four points that an earlier version of it handled as setting keys: the
   note length is an engine column check (DATABASE.md 5.3), there is no stored night flag and no night trigger (5.3),
   where the device check runs is engine (5.6), and audit read access is DDL, not configuration (5.11). Every setting
   key that DATABASE.md section 5 names is defined in section 2 of this file.
d. Two groups of objects first proposed by this file are now adopted by the documents of record. The runtime settings
   editor `public.set_hr_setting`, with an insert for `payroll.*` keys and an update of the `-infinity` row for any other
   key (section 1.3), is in DATABASE.md 5.12 and 5.13. The self-service clock functions `self_clock_in` and
   `self_clock_out` (section 2.4) are in DATABASE.md 5.13, and the page gate for that mode (no key, every eligible
   employee) is in PERMISSIONS.md 4.3; IMPLEMENTATION_PROMPT.md question Q4 lets a client require a key instead.

## 8. NEEDS VERIFICATION before a client value is copied from the live system

The repo cannot settle the following. Each query is read-only and must be run by the owner of the correct project,
never through a connector attached to a different client.

1. Value and grants of `app_private.night_ot_bonus()` (feeds `payroll.nightRule.bonusAmount`). Unknown because the
   function is RECONSTRUCTED; UI strings say 300, and `report_payroll` runs as invoker, so `authenticated` needs
   EXECUTE. Settled by: `select app_private.night_ot_bonus();` plus `pg_get_functiondef` and `proacl` for it.
2. Live night trigger body (`payroll.nightRule.anchor`). A missing migration may have redefined it. Settled by:
   `select pg_get_functiondef('public.attendance_apply_overtime'::regproc);`
3. Role gate and write behaviour of `set_staff_salary_rate` (`payroll.rates.edit`, `payroll.rateEffectiveDating`).
   RECONSTRUCTED: comments disagree on the gate (`L/rate.ts:9-20`, `:198-199`), and only a docstring says each save
   inserts a row (`L/rate.ts:193-199`), so a same-date save may insert, update or fail. Settled by: `pg_get_functiondef`
   of that function, plus the unique constraints of `staff_salary_rates` (item 5).
4. Live update policy of `payroll_snapshots` (`payroll.payslip.mark_paid`). A missing migration may have widened it
   for Admins. Settled by:
   `select polname, polcmd, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.payroll_snapshots'::regclass;`
5. Live DDL, CHECK constraints and policies of `staff_salary_rates` (`payroll.payFrequencies`). RECONSTRUCTED.
   Settled by: `information_schema.columns`, `pg_constraint` and `pg_policy` for that table.
6. Whether PENDING 20260916120000 is applied. Deployment state is not in the repo. Settled by:
   `select version, name from supabase_migrations.schema_migrations order by version desc limit 15;`
7. Whether the approval-request key is granted anywhere (`attendance.deletion.requestApprovalPath`). No repo migration
   grants it. Settled by (count only):
   `select count(*) from staff_permission_grants where permission_key = 'initiate_high_risk_action';`
8. Whether production added a reviewer branch to the `staff_profiles` read policy (section 6, item 6). The repo has
   only a Super-Admin-or-self policy (`M/20260821140000:21-22`). Settled by:
   `select polname, pg_get_expr(polqual, polrelid) from pg_policy where polrelid = 'public.staff_profiles'::regclass;`
9. `kiosk_clock_out` body and whether it checks a device (`attendance.device.mode`). RECONSTRUCTED. Settled by:
   `select pg_get_functiondef('public.kiosk_clock_out(uuid)'::regprocedure);`
10. Live body of `generate_payslip_snapshot` (`payroll.nightRule.oncePerDay`, `.bonusAmount`, `payroll.deductionsModel`,
    `payroll.allowNegativeNet`). RECONSTRUCTED: the repo body is stale (section 0). Decides whether issued payslips
    price night pay as night shifts x `night_ot_bonus()` or as the uncapped sum of `overtime_amount`, how deductions
    are clamped, whether a missing rate is refused, and the security mode. Settled by:
    `select pg_get_functiondef('public.generate_payslip_snapshot'::regproc);`
11. Live columns of `payroll_snapshots`, including the six RECONSTRUCTED ones: `daily_rate`, `days_worked`,
    `night_shifts` and `rate_basis` (read back after generation, `L/payslip-actions.ts:78-80`) and `paid_at` and
    `paid_by` (written by mark paid, `L/payslip-actions.ts:129-130`); no repo migration creates them. Settled by:
    `select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'payroll_snapshots';`
12. Body and gate of `delete_attendance_record` (`attendance.delete`, `attendance.deletion.mode`). RECONSTRUCTED:
    only comments describe the role gate, and whether it removes photo rows or writes an audit row is unknown. Settled
    by: `select pg_get_functiondef('public.delete_attendance_record(uuid)'::regprocedure);`

## 9. PROJECT-SPECIFIC values removed from the template

This is the only section that names the reference implementation's brand, currency and timezone values. Its pay-policy
values (for example the night threshold and amount, the default frequency and the overtime display threshold) also
appear in the sections above as CURRENT facts with citations; PS-9 collects them here. Each id is referenced from the
sections above. None belongs in IMPLEMENTATION_PROMPT.md or in template code; each
becomes the key shown. The static test in section 1.6 scans for these values.

| Id | Value in the reference implementation | Where | Template key |
|---|---|---|---|
| PS-1 | Company name "A.V. Jewelry" | H-1 | `branding.companyName` |
| PS-2 | Logo text "AV" and "A.V" | H-2 | `branding.logoText` |
| PS-3 | Accent "Soft Gold" `#b28b3f` (RGB 178,139,63), an amber utility class on the summary, and `gold` design tokens | H-3 | `branding.brandColor`; tokens in UI_UX.md 11 |
| PS-4 | Payslip file prefix "AV-Jewelry-Payslip-" | H-4 | `branding.documentFilePrefix` |
| PS-5 | Export file prefix "MineFlow-Data-Export-" | H-5 | `branding.documentFilePrefix` |
| PS-6 | Cookie `av_att_device`; storage key `av-privacy-mode`; realtime channel name with a brand prefix (`src/components/shell/dashboard-sync.tsx:154`) | H-6, H-7 | `branding.cookieNamePrefix` |
| PS-7 | Timezone `Asia/Manila` and fixed offset `+08:00`; module and migration names carrying the zone (note a) | H-8 to H-14, H-62, H-64 | `locale.timezone` |
| PS-8 | Currency: the peso sign (U+20B1) on screen and in labels; the code "PHP" in PDFs | H-15 to H-18 | `locale.currencySymbol`, `locale.currencyCode` |
| PS-9 | Pay policy: daily rate, weekly default frequency, flat 300.00 night bonus at 22:00 once per day, 8-hour display threshold (note b) | H-18 to H-26 | `payroll.*` |
| PS-10 | Device wording "Shop phone", "Approved shop phone", "Shop phone not registered", "approved shop device" | H-42, H-43 | `attendance.device.defaultLabel` and label map |
| PS-11 | The decision that Super Admins are not on payroll and do not clock; the migration header names real account holders (names not copied) | H-29 | `exclusions.excludedRoles` |
| PS-12 | Demo accounts backfilled once by an auth-email pattern on a non-routable test domain (pattern not copied) | H-31 | seed sets `is_demo` |
| PS-13 | Primary Super Admin identified by an email constant (value not copied) | `src/lib/authz/guard.ts:281` | profile flag in the host identity module |
| PS-14 | Comments citing "Bible section F", "Owner request" and dated "Owner decision" notes | for example `L/payslip-actions.ts:13`, `C/attendance-view.tsx:27` (H-18) | removed |
| PS-15 | Production project URL in the selfie purge script usage text (value not copied) | `scripts/purge-attendance-selfies.mjs:24-26` | environment variable only |
| PS-16 | Person-name test fixtures paired with salary figures (not copied) | `tests/unit/payslip-button.test.tsx` fixtures | synthetic names |

Notes:

a. The business-date module is `src/lib/format/manila-date.ts` with `manilaToday`, `manilaMonthStart` and
   `manilaAddDays`; the kiosk clock-in migration file is `20260907120000_kiosk_clock_in_manila_work_date.sql`. The
   template uses neutral names (H-11).
b. The night amount and threshold are marked provisional in `app_private.provisional_fields` rows
   (`M/20260722200000:70-73`; `M/20260722210000:137-142`). Five migrations (13 references) cite a spec section ("Bible
   section F") that is not in the repo, so the rationale cannot be recovered; treat these values as unexplained client
   policy, never as template defaults.
