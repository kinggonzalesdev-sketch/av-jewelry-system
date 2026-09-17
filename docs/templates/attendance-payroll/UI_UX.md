# Attendance and Payroll Template: UI and UX (Phases 8 and 9)

This document records how the three HR screens of the reference implementation look and behave (the shared attendance
kiosk, the Review Attendance workspace and the Payroll page) and restates them as a reusable user-interface
specification for systems built for other clients on the same architecture: Next.js App Router with server actions,
Supabase Postgres with RLS, and SECURITY DEFINER RPCs. Phase 8 (sections 1 to 8) covers the shared building blocks, each
screen's layout, actions, confirmations, states and post-action behaviour, the status visuals, interaction patterns,
accessibility and responsive guidance. Phase 9 (section 9) maps every current component to a generic component with a
props interface in words. Section 10 lists the UI defects the template must fix; section 11 lists the project-specific
values removed from the template. Rules for clocking, correction, pay, roles and database objects appear here only where
a screen shows them: PAYROLL.md, PERMISSIONS.md, DATABASE.md and CONFIGURATION.md own those rules, and
TESTING_CHECKLIST.md (sections 4.4 to 4.6) turns this document into UI, responsive and print checks.

## How to read this

| Label | Meaning |
|---|---|
| CURRENT | How the reference implementation behaves today, with a file:line citation. |
| GENERIC | The reusable form the template should ship. |
| PROJECT-SPECIFIC | Tied to the source business. Exact values are named only in section 11 (one exception below the table). |
| CONFIGURABLE | Should become a client setting (key names follow CONFIGURATION.md section 2). |
| NEEDS VERIFICATION | The repository cannot settle it; the text says what would. |
| RECONSTRUCTED | A live database object whose DDL is missing from the repository (named here only where a screen depends on it). |
| PENDING (not live) | Content of migrations 20260916120000, 20260916130000 or 20260917120000: written, not applied. |
| RECOMMENDED TEMPLATE IMPROVEMENT | A gap in the reference implementation the template should fix. Never a change to production. |

Exception to the PROJECT-SPECIFIC rule: the shared key facts and some CURRENT descriptions also quote the session night
flag's 22 hour threshold and 300.00 amount and the payroll night rule's 22:00 threshold, because every document of this
set states them; they are PROJECT-SPECIFIC in those places too.

Conventions:

- "Computed from code" marks a statement that follows from cited CSS classes, React state rules or framework behaviour
  but was not observed in a browser or on a device. Every such statement is also NEEDS VERIFICATION.
- Roles: Super Admin (role key owner), Admin (role key selected_admin), Staff (role key staff). Quoted UI copy of the
  reference implementation says "Owner" for the Super Admin; quotes keep that word.
- Permission keys: hr_attendance (open the Attendance/clock page and read the kiosk roster), hr_review_attendance (open
  Review and read all rows), hr_payroll (open Payroll).
- The currency symbol is written `<cur>`, the business timezone "business timezone", the device noun used in copy
  `<device noun>`, and the accent design token `<accent>` (in class names such as `bg-<accent>/10`, called "the accent
  token" or "the accent tone" in prose). Their real values, and every brand string, are listed only in section 11.
- Quoted copy is verbatim except typographic glyphs, which are written in ASCII: arrow as `->`, middle dot as `-`, en
  dash as `-`, em dash as `--`, ellipsis as `...`, multiplication sign as `x`. Status glyphs are named in words.
- Citations match the repository at commit c31af2b. Path shorthands:

| Shorthand | Expands to |
|---|---|
| `C/` | `src/components/hr/` |
| `U/` | `src/components/ui/` |
| `L/` | `src/lib/hr/` |
| `P/` | `src/app/(app)/admin/` |
| `T/` | `tests/unit/` |
| `M/<timestamp>` | the single file in `supabase/migrations/` whose name starts with that timestamp |

## 0. Scope and shared facts

### 0.1 Screens, routes and files

| Screen | Route | Page gate (else 404) | Evidence |
|---|---|---|---|
| Attendance: kiosk, device manager, summary, history | `/admin/attendance` | hr_attendance | `P/attendance/page.tsx:43` |
| Review Attendance | `/admin/attendance/review` | hr_review_attendance | `P/attendance/review/page.tsx:22` |
| Payroll: payroll table, Employee Rates tab, payslip, summary | `/admin/payroll` | hr_payroll | `P/payroll/page.tsx:30` |

Files per screen (CURRENT):

- Attendance: `P/attendance/page.tsx`, `C/device-manager.tsx`, `C/attendance-clock.tsx`, `C/attendance-summary-cards.tsx`,
  `C/attendance-records.tsx`, `C/attendance-day-details.tsx`, `src/components/approvals/request-deletion-button.tsx`.
- Review Attendance: `P/attendance/review/page.tsx`, `C/review-attendance-view.tsx` (seven components in one file).
- Payroll: `P/payroll/page.tsx`, `C/payroll-tabs.tsx`, `C/attendance-view.tsx` (the payroll table, despite its name),
  `C/employee-rates-view.tsx`, `C/payslip-button.tsx`, `C/payroll-summary-button.tsx`, `L/payslip-pdf.ts`.

Navigation (CURRENT): the route to permission map is `src/components/shell/navigation.ts:91-93`. The three items are
not bottom-bar items on phones, so they are reached through the "More" sheet (`docs/FINAL-UI-SOURCE-OF-TRUTH.md:42-45`).
A missing permission calls `notFound()` and renders the generic "Page not found" with "Go to Dashboard"
(`src/app/not-found.tsx:9, 17`). The repository does have a not-authorized route (`src/app/(app)/not-authorized/page.tsx:1-16`)
and a `NotAuthorized` state component (`src/components/states/not-authorized.tsx:12-29`, `data-testid="not-authorized"`)
used by another admin page (`src/app/(app)/admin/staff/page.tsx:4, 36`), but the three HR pages do not use either; they
call `notFound()` instead. The template chooses one convention for the host (section 1.9).

### 0.2 Shared facts every screen must agree with

1. Clocking is a shared KIOSK, not self-service: a signed-in operator holding hr_attendance picks a member from
   `list_clock_staff` and clocks that member (`C/attendance-clock.tsx:63-65, 137-150`; `L/actions.ts:85-89`). The page
   docstring still says "self-service" (`P/attendance/page.tsx:34-35`), which is stale.
2. One open session per member (a unique partial index; DATABASE.md section 2.1). `work_date` is the business-timezone
   date at clock-in. A day's total is the sum of completed sessions (`L/sessions.ts:90-91`).
3. Two DIFFERENT night rules exist. The session flag: clock-in hour 22 or later sets a flat 300 on the row, by a BEFORE
   INSERT trigger (`M/20260722200000:34-37, 47-49`). Payroll: distinct work dates with a clock-out at or after 22:00,
   times `app_private.night_ot_bonus()` (`M/20260907160000:41, 55, 90`). The Review "OT" badge shows the first rule;
   the salary uses the second (PAYROLL.md section 4).
4. Salary = round(days_worked x daily_rate + night_shifts x night bonus, 2), computed in SQL (`M/20260907160000:86-93`).
   Deductions are a single lump sum of zero or more entered when the payslip is generated. A payslip is a frozen
   snapshot whose `payment_status` goes pending -> paid only (PAYROLL.md section 7).
5. There is no approval or finalization step for attendance and no period lock. Only the clock-out can be corrected
   (Super Admin or Admin, by role; reason required; in-place update; the old value survives only in a best-effort app
   audit event). Delete is a hard delete through a RECONSTRUCTED RPC (DATABASE.md sections 3.5 and 3.6).
6. Device approval is a hashed token in an httpOnly cookie, enforced in server TypeScript only for both clock-in and
   clock-out (`L/attendance.ts:28-48, 161, 214`). The live database has no device check; PENDING (not live) adds one to
   clock-in only. With no device registered the gate is off (fail-open).
7. Super Admins are excluded from the kiosk roster (`M/20260907160000:23-24`) and from payroll and rates
   (`M/20260907160000:97-99`; `L/rate.ts:134-137`). Demo accounts are excluded from payroll and rates and refused as a
   clock-in target (`M/20260907120000:35-37`), but the CURRENT roster RPC does not filter them, so they still appear in
   the kiosk list (RECOMMENDED TEMPLATE IMPROVEMENT, section 10 item 19).
8. Payroll rows are visible per caller: the Super Admin sees every eligible member; everyone else sees only their own
   row (`M/20260907160000:100`). Details in PERMISSIONS.md section 3.

## 1. Shared building blocks

### 1.1 Breakpoints, shell and page chrome

| Item | CURRENT | Evidence |
|---|---|---|
| Breakpoints | Tailwind 4 defaults (no config file, no `--breakpoint-*` override): `sm` 640px, `md` 768px, `lg` 1024px | computed from code |
| Card-table media query | `@media (max-width: 639px)`, aligned with `sm` | `src/app/globals.css:315` |
| Touch enlargement query | `@media (pointer: coarse)` | `globals.css:396` |
| Desktop sidebar | `lg:flex` only; width `w-64` (256px) or collapsed `w-16` (64px) | `src/components/shell/app-sidebar.tsx:350-351` |
| Phone chrome | mobile header `lg:hidden`; fixed 64px bottom bar `lg:hidden`; full bar labels from 360px | `app-sidebar.tsx:503, 545-549, 579-583` |
| Main padding | `p-3` (12px) below 640px, `sm:p-5` (20px) from 640px; bottom `calc(5rem + safe-area)` below 1024px | `app-sidebar.tsx:522-525` |
| Content width cap | none: no `max-w` on `<main>`, tables stretch to the content width | `app-sidebar.tsx:522-525` |
| Viewport | `width=device-width`, `maximumScale: 5` (pinch zoom kept), `viewportFit: 'cover'` | `src/app/layout.tsx:30-38` |
| Skip link | "Skip to main content" to `#main-content` | `layout.tsx:65-70` |
| Page header | `PageHeader`: `h1 text-xl sm:text-2xl font-bold`, optional description | `U/page-primitives.tsx:17-41` |
| Card | `rounded-lg border`, header and content padding 20px (`p-5`, content `pt-0`) | `U/card.tsx:13, 22, 39` |

Consequence (computed from code): from 640px to 1023px the screens show desktop tables and inline filters under the
phone header and bottom bar. GENERIC: keep one breakpoint (640px) for table-to-card and inline-filters-to-sheet and one
(1024px) for the sidebar.

### 1.2 Modal: bottom sheet on phones, centred dialog from 640px

`U/modal.tsx` is the only dialog primitive.

| Behaviour | CURRENT | Evidence |
|---|---|---|
| Sizes | `sm` 460px, `md` 640px (default), `lg` 780px, `xl` 1040px as `sm:max-w-[...]`; `maxWidthClass` override | `U/modal.tsx:28-33, 41-42, 62-64` |
| Below 640px | bottom sheet: `items-end`, no outer padding, full width, `rounded-t-2xl`, max height 100dvh minus top safe area | `:156, 190` |
| 640px and up | centred card: `sm:items-center sm:p-4` (16px gutter), `sm:rounded-xl`, `sm:max-h-[90dvh]` | `:156, 190` |
| Layers | portal to `document.body`, `z-50`, overlay `bg-black/50` | `:150-151, 171-181, 232` |
| ARIA | `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the title, or `aria-label` | `:157-168` |
| Focus | focus moves to the panel (`tabIndex={-1}`) on open; Tab and Shift+Tab are trapped; focus returns to the opener | `:79-125, 187` |
| Escape and overlay | close a normal dialog; a `critical` dialog ignores both (only the X or Cancel close it) | `:138-141, 171-181` |
| Unsaved-changes hook | a `critical` dialog registers as unsaved work: the user-tapped PWA "Update now" then warns and needs "Update anyway" | `:127-131`; `docs/MOBILE-PWA.md:72-78` |
| Scroll lock | `document.body.style.overflow = 'hidden'` while open | `:136-137, 143` |
| Header | title `h2 text-base font-semibold`; description `text-xs`; `no-print` action area with the X (28px, `tap-44`) | `:193-219` |
| Body and footer | body `flex-1 overflow-y-auto px-5 py-4`; footer `flex justify-end gap-2 border-t px-5 py-3` | `:223, 225-229` |
| Click containment | `stopPropagation` on the portal root, so a click inside never reaches a clickable row behind | `:159-163` |
| Form grid | `ModalFormGrid` = `grid gap-3 sm:grid-cols-2`; `ModalFieldFull` = `sm:col-span-2` | `:241-248` |
| Escape scope | each open Modal adds its own document-level keydown listener, so nested dialogs all receive one Escape | `:138-141` |
| Tests | closed renders nothing; X, overlay and Escape close; critical ignores overlay and Escape | `T/modal.test.tsx:18-67` |

GENERIC: keep `Modal`; add an Escape scope so only the top-most dialog closes (section 10 item 8).

### 1.3 Tables: density, column helpers and stacked phone cards

| Item | CURRENT | Evidence |
|---|---|---|
| Header cells | `padding 8.5px 12px; height 41px; 14px; bold; uppercase; nowrap; sticky top 0; background var(--muted)` | `globals.css:212-231` |
| Body cells | `padding 6px 12px; height 36px; 13px; nowrap` | `globals.css:237-247` |
| Cascade | unlayered CSS, so it overrides the Tailwind cell padding and font utilities the HR tables also set | `globals.css:194-201` |
| Sticky header | pins only when the table's own wrapper scrolls vertically (`.table-scroll`); no HR table uses it | `globals.css:222-225, 296-302` |
| Column helpers | `.col-num`, `.col-center`, `.col-actions` (centred, nowrap, 8px gaps), `.col-grow` (width 100%), `.col-clip` | `globals.css:257-281, 488-492` |
| `.data-table--stack` below 640px | each `<tr>` becomes a card (8px 10px padding, 1px border, 12px radius, card background) | `globals.css:343-349` |
| Stacked cell | flex row "label ... value", label from `td::before { content: attr(data-label) }`, value right-aligned | `globals.css:350-367` |
| Actions cell | `td.col-actions` spans the card with a top divider and wraps; colspan rows are not cards | `globals.css:371-391` |
| Header when stacked | visually hidden with clip-path, still in the accessibility tree | `globals.css:326-333` |
| Label stamping | `labelStackedTables()` copies each `<th>` text into `data-label`; skips rows with a different cell count | `U/stacked-table.ts:13-25` |
| Stamping exclusions | colspan cells and `col-actions` cells get no label | `U/stacked-table.ts:27` |
| Stamping trigger | `StackedTableLabels` mounted once in the root layout (MutationObserver plus requestAnimationFrame) | `src/app/layout.tsx:78`; `U/stacked-table-labels.tsx:13-23` |
| Who opts in | Payroll table and Employee Rates only; the attendance history and Review render a separate `<ul>` card list | `C/attendance-view.tsx:118`; `C/employee-rates-view.tsx:160` |

GENERIC: keep the CSS and the stamping helper unchanged; every action `<td>` must carry `col-actions` (the Payroll table
omits it, section 4.2).

### 1.4 StatusBadge and the status colour system

| Item | CURRENT | Evidence |
|---|---|---|
| Component | pill `rounded-full border px-2 py-0.5 text-xs font-medium` + leading glyph (`aria-hidden`) + label | `U/page-primitives.tsx:118-145` |
| Tones | the accent token, `neutral` (gray), `strong`, `warning` (amber), `danger` (red), `success` (green), `info` (blue) | `:81-104` |
| Glyphs | filled circle for every tone except `danger` (cross) and `success` (check mark) | `:106-115` |
| Colour tokens | `--st-green`, `--st-amber`, `--st-blue`, `--st-red`, `--st-gray` plus `-bg`, light and dark values | `globals.css:423-460` |
| Classes | `.badge-green`, `.badge-amber`, `.badge-blue`, `.badge-red`, `.badge-gray` | `globals.css:461-485` |
| Stated rule | one meaning, one colour; the accent is the brand accent only, never a status; colour + text + icon | `globals.css:415-422`; `U/page-primitives.tsx:84-88` |

CURRENT contradiction: the HR screens use the accent tone for the "Clocked in" / "Open" status
(`C/attendance-records.tsx:504`; `C/review-attendance-view.tsx:511`), against the rule quoted above. The template label
set in section 5 uses status tones only.

### 1.5 Button, inputs and tap targets

| Item | CURRENT | Evidence |
|---|---|---|
| `.tap-44` | on coarse pointers an absolutely positioned `::after` of at least 44x44px; the visual size is unchanged | `globals.css:394-409` |
| Button | every Button carries `tap-44`; sizes `default h-11` (44px), `sm h-9` (36px), `lg h-12`, `icon h-11 w-11` | `U/button.tsx:12-14, 26-32` |
| Input | default `h-11` and `text-base` ("prevents iOS zoom-on-focus"); HR screens override the height to `h-9` or `h-8` | `U/input.tsx:13-14` |
| Hand-rolled selects | native `<select>` with `h-9` (filters, rows, frequency) or `h-10` (kiosk), all `text-sm` | `C/attendance-records.tsx:48-49`; `C/attendance-clock.tsx:223` |

### 1.6 Money display, privacy mask and money input

| Item | CURRENT | Evidence |
|---|---|---|
| Formatter | shared formatter: `<cur>` + comma grouping by string operations; drops `.00` on whole amounts (name in section 11) | `src/lib/payments/format.ts:51-56` |
| `<Money>` | masks to `<cur>` plus six bullets in Privacy Mode; the real value is still emitted for print (`hidden print:inline`) | `src/components/shell/privacy.tsx:107-121` |
| `usePrivacyMoney()` | the same mask as a string formatter, for string contexts | `privacy.tsx:88-91` |
| Mode persistence | Privacy Mode is remembered in localStorage under a brand-prefixed key (section 11) | `privacy.tsx:33` |
| `MoneyInput` | `<cur>` prefix (`aria-hidden`), live grouping, digits and one dot, up to two decimals, `inputMode="decimal"` | `U/money-input.tsx:20-30, 126-138` |
| Submitted value | a hidden input named `name` carries the raw value without grouping | `U/money-input.tsx:152` |

GENERIC: `CurrencyInput` with `currencySymbol` and `decimals`; a masked money display with a `formatter` and a `mask`;
one formatter reading `locale.currencySymbol` and `locale.moneyDisplay.hideZeroMinorUnits` (CONFIGURABLE).

### 1.7 Empty, error, loading and denied states

| State | CURRENT | Evidence |
|---|---|---|
| `EmptyState` | dashed box `px-6 py-12`, title, optional description and action, `data-testid="empty-state"` | `src/components/states/empty-state.tsx:21-22` |
| `ReadError` | `role="alert"`, destructive tint; fixed sentence "This is not an empty result -- data may exist and is not shown." | `U/page-primitives.tsx:147-174` |
| `LoadingState` | `role="status" aria-live="polite"`, "Loading..." | `src/components/states/loading-state.tsx:11-13` |
| Route loading | the route-group fallback renders `LoadingState`; none of the three HR routes has its own `loading.tsx` | `src/app/(app)/loading.tsx:9-11` |
| Route error | root error boundary: "Something went wrong", a digest reference, "Try again" | `src/app/error.tsx:36-47` |
| Denied | `notFound()` (section 0.1) | as cited |
| Skeleton | `SkeletonRows` exists (`data-testid="skeleton-rows"`) and is not used by the HR screens | `U/skeleton.tsx:25` |

The repository's own rule is that a failed read must never render as an empty result (`U/page-primitives.tsx:147-152`).
Several HR readers break it; each case is listed per screen and collected in section 10 item 1.

### 1.8 Print CSS injection

CURRENT: two dialogs inject a `<style>` element into the open modal (`C/payslip-button.tsx:26-36, 271`;
`C/payroll-summary-button.tsx:18-29, 85`). Inside `@media print` the rule set hides everything (`body * { visibility:
hidden }`), reveals one element by id (`#payslip-doc` or `#payroll-summary-doc`), and makes it `position: fixed; inset:
0; margin: 0; background #fff; color #000` with 32px (payslip) or 24px plus `overflow: auto` (summary) padding;
`.no-print { display: none }`. The Modal header action area carries `no-print` (`U/modal.tsx:205`). There is no `@page`
rule anywhere in these files. Consequences are in section 6.4. GENERIC: one print-isolation helper (section 9.3).

### 1.9 Shared primitives that exist but the HR screens do not use

CURRENT: `Pagination` (`U/pagination.tsx`: rows 25/50/100/250, optional sticky footer, "Page X of Y", test ids
`pagination`, `pagination-prev`, `pagination-next` at `:48, 78, 88`), `Tabs` (`U/tabs.tsx`, `role="tablist"`,
`aria-selected`, test id `tab-{key}` at `:27, 36-39`), `Select`, `SearchInput`, `DataTable`, `SkeletonRows`, `Alert` and
`NotAuthorized` (`src/components/states/not-authorized.tsx:12-29`, with its route `src/app/(app)/not-authorized/page.tsx`).
The HR screens hand-roll pagination (twice), tabs (twice, two different ways), selects and the filter toolbar (twice), and
render the generic 404 for a missing permission. GENERIC: consolidate onto the shared primitives (section 10 item 15);
the template may use `NotAuthorized` for a denied page when the host prefers an explicit denial to a 404.

### 1.10 How screens refresh after a write

| Mechanism | CURRENT | Evidence |
|---|---|---|
| Server revalidation | clock and device actions revalidate `/admin/attendance`; correction and delete revalidate all three routes | `L/actions.ts:91, 102, 114, 130, 153-155, 179-181` |
| Client refresh | components call `router.refresh()` after a successful action | per screen, sections 2 to 4 |
| Realtime nudge | an app-wide provider calls `router.refresh()` on any Postgres change the user may read, except a deny-list | `src/components/shell/dashboard-sync.tsx:86-97, 153-160` |
| Reconciliation | the same provider refreshes on reconnect, on `online` and when the tab becomes visible | `dashboard-sync.tsx:161-173` |
| Realtime tables | `attendance_records` and `payroll_snapshots` are added to the realtime publication in the repository | `M/20260731130000:27-28` |

NEEDS VERIFICATION: live publication membership (DATABASE.md section 2.12; query V12 in DATABASE.md section 8). The rates
table `staff_salary_rates` (RECONSTRUCTED: read by `L/rate.ts:139-143`, no DDL in the repository, DATABASE.md section 2.5)
is not in that list, so a rate saved in another tab reaches this screen only through a refresh or revalidation.

What `router.refresh()` does and does not update (computed from code, NEEDS VERIFICATION in a browser): props from the
server are replaced, but React keeps component state. The attendance and Review lists keep their rows in state
(`useState(initialPage)`), yet their load effect depends on `filters`, which is memoised on the `roster` prop; a refresh
deserialises a new `roster` array, so the effect re-runs and the LIST reloads with the current filters
(`C/review-attendance-view.tsx:125-133, 142-162`; `C/attendance-records.tsx:104-117, 128-148`). What stays stale is
state that is not derived from props: an OPEN day-details modal (`viewing`), the kiosk's selected member, and a payslip
dialog's local snapshot.

Success detection (CURRENT; computed from code, NEEDS VERIFICATION in a browser): the dialog forms detect success with
`useActionState` and an effect that runs only when `state.success` differs from a `lastSuccess` ref
(`C/review-attendance-view.tsx:697-704, 816-823`; `C/attendance-day-details.tsx:127-134`; `C/device-manager.tsx:47-53`;
`C/attendance-view.tsx:259-266`; `C/employee-rates-view.tsx:49-56`). The server returns fixed success strings ("Clock-out
corrected.", the device registration sentence, `L/actions.ts:117, 182`), and the rate message repeats whenever the
same rate, frequency and date are saved again (`L/rate.ts:239-242`). A second identical success on the SAME mounted
component therefore neither closes the dialog nor calls `router.refresh()`, and shows no message; the dialog simply stays
open. Cases: correcting the same session twice while its day modal stays open, registering a device a second time without
a reload, saving the same rate twice from the same row. The server-side `revalidatePath` still runs, so the page behind
may update. Template fix: section 10 item 32.

### 1.11 Response header the selfie step depends on

CURRENT: every response carries `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=(), usb=()`,
kept so the camera stays available for attendance selfies (`next.config.ts:38, 45-48`). GENERIC: a header that denies the
camera to the app's own origin (for example `camera=()`) makes `getUserMedia` fail and every clock event falls back to
"without photo"; keep `camera=(self)` explicit. Whether omitting the header is harmless depends on the browser's default
allowlist: NEEDS VERIFICATION in a browser.

## 2. Screen: Attendance (kiosk) - `/admin/attendance`

### 2.1 Composition and layout

| Aspect | CURRENT | Evidence |
|---|---|---|
| Gate | hr_attendance else 404; then `requireActiveStaff()` | `P/attendance/page.tsx:43-44` |
| Header | "Attendance"; description "Clock in and out. You see your own records; the Owner sees all." (reviewers also see all) | `:86-89` |
| Flags | `isOwner` = role key owner; `canSeeTeam` = Super Admin or hr_review_attendance; `canManage` = owner or selected_admin | `:45, 49, 79` |
| Server reads | in parallel: first history page (last 7 days, 25 rows), open sessions, last clock-out today, roster | `:57-77` |
| More reads | today's session staff (only if `canSeeTeam`), gating active, this device approved; device list after, Super Admin only | `:57-77, 80` |
| Vertical order | blocked-device banner, DeviceManager (Super Admin), "Attendance today" card with the clock, summary tiles, history | `:90-131` |
| Spacing | `space-y-4` stack | `:90` |
| Nested cards | the page wraps the clock in `Card > CardContent pt-4`; the clock renders its own `Card > CardContent pt-6` | `:110-119`; `C/attendance-clock.tsx:205-206` |

Desktop (640px and up): the vertical stack above at full content width; the clock's select is centred and capped at
`max-w-md` (448px), its buttons at `max-w-sm` (384px); the history card shows inline filters and a table.
Phone (below 640px): the same stack; the inner card costs another 42px of width around the kiosk controls (1px border
and 20px padding per side, `U/card.tsx:13, 39`; 84px for the two cards together); history
filters collapse to a "Filters (n)" button and a bottom sheet; the table is replaced by a card list; every dialog is a
bottom sheet. Nothing inside these components changes between 360px and 639px.

### 2.2 Blocked-device banner

CURRENT: shown when gating is active and this device is not approved (`P/attendance/page.tsx:81, 91`); `role="alert"`,
`data-testid="device-blocked"`, `rounded-xl border-destructive/40 bg-destructive/10 p-3`; title "This device cannot clock
in/out" (`text-destructive font-semibold`); body "It is not the approved <device noun>. Use the registered device, or ask
the Owner to register this one below." (`:92-104`). The clock controls below are NOT disabled. A clock attempt is refused
on the server with "This device is not the approved <device noun>. Clock in/out from the registered device." and an audit
event (`L/attendance.ts:28-48`). If the gating read fails, `isAttendanceGatingActive()` returns false and the banner is
hidden (`L/devices.ts:38-42`), which is the fail-open rule seen in the UI.

### 2.3 DeviceManager (Super Admin only) - `C/device-manager.tsx`

| Aspect | CURRENT | Evidence |
|---|---|---|
| Default layout | compact banner: coloured dot + one-line label + one action; `flex-wrap rounded-xl border px-3 py-2 text-sm` | `:58-91` |
| Approved | `border-<accent>/40 bg-<accent>/10`, dot `bg-<accent>`; "Approved <device noun>"; `sm` outline "Manage" / "Hide" (`aria-expanded`) | `:61, 69, 73, 76-85` |
| Not approved | `border-border bg-secondary/40`, dot `bg-muted-foreground`; "<device noun> not registered"; `sm` "Register this device" | `:61, 69, 73, 87-89` |
| Manage panel | Card: "+ Register this device", then "Registered device(s)" (active only): label, "- registered {Month D, YYYY}", Revoke | `:106-154` |
| Register modal | `sm`; "Register this device"; description says it deactivates any previous device; "Device label" (`h-9`, optional) | `:157-189` |
| Register footer | Cancel / "Register this device" ("Registering..."); closes once per new success (repeat caveat, 1.10) | `:163-176, 47-53` |
| Feedback | one `role="status"` line under the banner: error in destructive, success in muted text | `:93-103`; `L/actions.ts:117, 131` |
| Phone | identical markup at every width (`flex-wrap`); the label truncates | `:58-72, 120-124` |

Confirmations: Revoke has NONE; it is a plain form submit with a destructive `sm` button (`:136-146`). Reachability: the
Manage toggle, and therefore the device list and Revoke, render only when THIS device is approved (`:75-90`); from any
other browser the Super Admin can only register, which deactivates the previous device. Revoked devices are never listed
(`:39`). Empty and error states: `listDevices()` returns an empty list on a read error (`L/devices.ts:129`), so the panel
shows no devices rather than an error. After actions: server revalidation of the page (`L/actions.ts:114, 130`); no
client refresh call. GENERIC: DeviceManager (section 9) with a confirm step on revoke and a `showRevoked` option.

### 2.4 AttendanceClock (the kiosk card) - `C/attendance-clock.tsx`

Member picker (CURRENT): a centred prompt "Select who is signing in" above a full-width native `<select>`
(`h-10 max-w-md text-sm`, `aria-label="Select who is signing in"`, `data-testid="clock-staff-select"`), placeholder option
"Select a team member", options show the member NAME only (the role is hidden on purpose); the option value is the profile
id (`:209-235`). Changing the selection clears the error and notice lines (`:216-220`). An empty roster shows "No active
team members found." (`:236-240`). Nothing else renders until a member is selected (`:244`).

State machine per selected member (first matching row wins; `:66-71, 244-353`):

| State | Trigger | What renders | Evidence |
|---|---|---|---|
| No selection | initial | picker only | `:244` |
| Camera (selfie step) | Clock In, Clock Out, or confirmed Continue Duty | picker hidden; "Take a selfie to clock in/out"; live `<video>` | `:106-128, 244-263` |
| Camera problem | no `getUserMedia`, or permission rejected | destructive box with the reason and "You can still clock in/out without a photo." | `:111-115, 124-127, 249-253` |
| Clocked in | an open session exists | "Clocked in since {time}." + full-width Clock Out | `:300-318` |
| Clocked out today | a clock-out today and no open session | "Clocked out at {time}. Returning to work?" + Continue Duty | `:319-334` |
| Idle | no open session, no clock-out today | 56px accent circle with an arrow (`aria-hidden`) + full-width Clock In | `:335-352` |

Selfie step (CURRENT): mirrored preview (`-scale-x-100 max-h-72 rounded-lg bg-black object-cover`,
`data-testid="clock-selfie-video"`) from the front camera (`facingMode: { ideal: 'user' }`) (`:117-121, 255-262`); buttons
Cancel (outline) and Capture ("Saving...") (`:264-297`); when the camera is unavailable, Cancel and "Clock in/out without
photo" ("Working...") (`:275-286`). When the camera works there is no skip button; a capture or encode failure proceeds
silently without a photo (`:188-202`). The frame is resized to a 1600px long edge at JPEG quality 0.82
(`:27-40`; `src/lib/attachments/image.ts:18, 21`) and uploaded AFTER the clock action succeeded, as an attachment with a
file name starting `clock-in-selfie-` or `clock-out-selfie-` (`:157-166`). The Review reader tells in from out only by
that file name (`L/attendance.ts:553`). The preview is mirrored by CSS only; the saved image is not (computed from code).

Status line detail (CURRENT): "Clocked in since {time}.", "Clocked out at {time}." and the Continue Duty body use
`new Date(iso).toLocaleTimeString()` with NO options (`:305, 322, 387`), so the time follows the viewer device's locale and
timezone and, in most locales, includes seconds ("9:02:03 AM"). The tables use `clockTime()`, hour and two-digit minute
("9:04 AM", `L/attendance-paging.ts:176-179`). `clockTime()` passes no `timeZone` option either (its comment says "the
viewer's locale and timezone"), so the history table and cards, the Review table and cards, and both day-details modals
also show times in the viewer device's timezone (`C/attendance-records.tsx:371, 374, 417`;
`C/review-attendance-view.tsx:378, 421, 596, 598`; `C/attendance-day-details.tsx:76, 78`). A device set to another zone
shows every time shifted, while work dates and range presets stay in the business timezone. The status line shows no
date, so a session left open since an earlier day reads like today.

Notice and error lines (CURRENT): below the card body, an error renders as centred `role="alert"` destructive text and a
notice as centred `role="status"` muted text; the notice is hidden while an error shows (`:394-403`). Error sources:
"Select who is signing in first." (`:138-141`), the server message (device refusal, database refusal such as the
one-open-session message) passed through with the "ERROR:" prefix stripped (`:151-154`; `L/attendance.ts:170-176`), or
"Could not clock in. Please try again." / "Could not clock out. Please try again." on an exception (`:181-183`). Success
notices: "Clocked in.", "Clocked in. Overtime -- <cur>{amount} was added (clock-in at/after 10 PM)." (the session-flag
night rule, `L/attendance.ts:198-206`) or "Clocked out." (`:236`); a failed selfie upload is appended softly as
"(Selfie could not be saved: {reason})" (`:167-173`).

Kiosk visibility caveat (CURRENT): the open-session and last-clock-out maps are plain RLS-scoped reads that ignore errors
(`L/attendance.ts:111-146`). For an operator without hr_review_attendance they contain only the operator's own rows, so
every other member looks idle: Clock Out is never offered for them (a Clock In attempt is then refused by the database's
one-open-session rule), and Continue Duty is never offered (harmless: Clock In runs the same RPC). The same blindness
happens for any operator when those reads fail. Template fix: section 10 item 18.

### 2.5 AttendanceSummaryCards - `C/attendance-summary-cards.tsx`

CURRENT: rendered only when `canSeeTeam` (`P/attendance/page.tsx:121`). Three tiles in `grid grid-cols-3 gap-2` at every
width: "Present today", "Clocked in now", "Completed today"; tile `rounded-xl border bg-card px-3 py-2.5`, value
`text-xl font-semibold tabular-nums`, label `text-[11px] leading-tight` (`:24-33`). Definitions
(`L/attendance-paging.ts:141-150`): present = distinct members with a session that STARTED today in the business
timezone; clocked in now = distinct members with an open session of ANY date; completed today = present and not currently
open. There is deliberately no "Needs attention" tile because no review or flag state is stored (`:3-8`). The today read
returns an empty list on error (`L/attendance.ts:677`), so a failed read shows zeros.

### 2.6 AttendanceRecords (history) - `C/attendance-records.tsx`

| Aspect | CURRENT | Evidence |
|---|---|---|
| Container | Card "Attendance records"; count "No sessions" or "{first}-{last} of {N} session(s)" (`attendance-count`) | `:270-279` |
| Unit | the server pages SESSION rows; the UI renders DAYS (member + work date) from the page plus `completion` rows | `:150-156`; `L/attendance-paging.ts:30-39` |
| Search | always visible: `type=search`, "Search team member...", `h-9`, 300ms debounce, matched against roster names | `:98-102, 284-292` |
| Filters, 640px and up | inline: Date range chips Today / Last 7 days / This month / Custom (`aria-pressed`); Custom shows From / To dates | `:169-225, 304` |
| More filters | "Team member" select ("All staff", only when `canFilterStaff`); "Status" select All / Open / Completed | `:227-264` |
| Filters, below 640px | outline `sm` "Filters" or "Filters (n)" (`sm:hidden`) opens a `sm` Modal "Filters" with the same controls | `:293-317` |
| Sheet footer | "Done" closes the sheet only; filters already apply live | `:310-314` |
| Active count | status not All + member picked + range not Last 7 days | `:166-167` |
| Desktop table | `hidden sm:block overflow-x-auto`; `data-table min-w-[680px]` | `:336-340` |
| Columns | Staff (`col-grow`) / Date (+ "{n}x" chip, `title="{n} work sessions"`) / First in / Final out / Total worked / Status / Details | `:341-352` |
| Cell values | Final out "--" while any session is open; Total worked right-aligned "8h 30m"; Details button "View" (`tap-44`) | `:370-391` |
| Phone cards | `<ul class="space-y-2 sm:hidden">`; one `li` per day, `rounded-xl border bg-card p-3` | `:399-405` |
| Card anatomy | name (truncate) + status badge; date (+ " - n sessions"); "{first in} -> {final out or --}" | `:406-418` |
| Card total | "Total" or "Completed so far" + duration; full-width outline "View details" (`min-h-11`) | `:419-434` |
| Status | a day with an open session: StatusBadge "Clocked in" (the accent tone); else "Completed" (tone `success`) | `:502-508` |
| Pagination | footer: "Rows" select 25/50/100 (`h-9`), "Page X of Y", outline `sm` Previous / Next | `:442-486` |
| Paging rules | first render reuses the server page; any filter or page-size change returns to page 1 | `:119-148` |
| Details | "View" / "View details" opens AttendanceDayDetails for that day | `:489-496` |

Date semantics (CURRENT): the presets are business-timezone dates; the server filters the CLOCK-IN timestamp between
fixed-offset day bounds, not the stored `work_date` (`L/attendance-paging.ts:57-80`; `L/attendance.ts:606, 615-616`).
A Staff operator without hr_review_attendance sees only their own rows (RLS) and no member filter, but the search box
still matches every roster name. Searching another member's name sends that member's id; RLS then returns a count of 0,
so `total` is 0 and the list shows the EmptyState "No attendance in this range" (`C/attendance-records.tsx:325-331`;
`L/attendance.ts:623-627`), which falsely suggests the member has no attendance at all. "No matching records" appears
only when `total` is above 0 and no day row is assembled, for example when the row read fails after the count succeeded
(`L/attendance.ts:635`).

Names (CURRENT): this screen uses the same page reader and the same `staff_profiles` embed as Review (section 3.8). For a
`canSeeTeam` holder who is not the Super Admin (an hr_review_attendance holder, `P/attendance/page.tsx:49`), every other
member's name is null, so the history table and cards show "--" (`C/attendance-records.tsx:357, 408`), the day-details
title reads "Staff -- {date}" (`C/attendance-day-details.tsx:45`) and the delete copy says "this staff member" (`:193`).
The kiosk picker and the search still show names because they come from the definer roster RPC.

### 2.7 AttendanceDayDetails and delete - `C/attendance-day-details.tsx`

CURRENT: Modal `md`, title "{Staff} -- {Mon D, YYYY}", description "{n} work session(s)", footer Close (`:42-53`). Each
session is a bordered block `rounded-md p-2.5`: "Session {n}" with a "Continued Duty" chip for sessions 2 and later, its
duration on the right, and "{in} -> {out}" or accent "still clocked in" (`:61-82`). Between sessions a centred
`text-[11px]` line "Off duty - {duration} -- not counted" when the gap is positive (`:89-93`). A footer row "Total worked"
+ duration (`:97-100`).

Delete, Super Admin (CURRENT): a small "Delete" button (`tap-44`, destructive text, `attendance-delete-{recordId}`)
opens a `critical` Modal `sm` "Permanently delete attendance record" / "This cannot be undone."; body "Delete the {date}
record for {name}? Payroll totals will recompute without it."; label "Type DELETE to confirm", input placeholder DELETE
(`h-9`, `autoComplete="off"`); destructive "Delete permanently" ("Deleting...") disabled until the text equals DELETE
exactly (`:152-216`). The server re-checks the word ("Type DELETE to permanently delete this record.",
`L/actions.ts:146-148`) and then calls the RECONSTRUCTED hard-delete RPC.

Delete, Admin (CURRENT): the button is replaced by "Request delete" (`:140-150`;
`src/components/approvals/request-deletion-button.tsx`): Modal `sm` "Request attendance record deletion", description
"Sent to the Owner for approval -- nothing is deleted yet.", "Reason (for the Owner)" (`h-9`), "Send request"
("Sending..."), then "Request sent. The Owner reviews it in Approvals -- nothing is deleted until then." in a hard-coded
`text-emerald-600` (`:74-75, 92, 99-100, 111, 119`). PROJECT-SPECIFIC: the approvals module. The permission this path
needs is absent from the Manage Access catalogue and granted by no migration; it is grantable only on the legacy Super
Admin console reachable by URL (`src/components/admin/staff-console.tsx:35`), so the Admin request fails by default on a
fresh install (section 10 item 4). Staff see no delete control (`canManage` false).

### 2.8 Actions and confirmations (Attendance)

| Action | Offered to (UI) | Confirmation | Server check | After success |
|---|---|---|---|---|
| Clock In | any page user, member idle | none (selfie step) | active staff; device gate (TS); `kiosk_clock_in` | notice; idle; `router.refresh()` |
| Continue Duty | member clocked out today | "Continue Duty?" dialog, then selfie step | same as Clock In | same |
| Clock Out | member with a visible open session | none (selfie step) | active staff; device gate (TS); `kiosk_clock_out` (RECONSTRUCTED) | same |
| Without photo | camera unavailable or denied | none | same | same |
| Register device | Super Admin | Register dialog | Super Admin in TS (`L/devices.ts:69`) and SQL | status line; page revalidated |
| Revoke device | Super Admin, on an approved device | NONE | Super Admin (`L/devices.ts:104`) | status line; page revalidated |
| Delete record | Super Admin | critical type-DELETE dialog | word re-checked; delete RPC (RECONSTRUCTED) | dialog closes; `router.refresh()` |
| Request delete | Admin | request dialog with reason | approval-request permission (legacy console grant only) | "Request sent..." |

The Continue Duty dialog (`C/attendance-clock.tsx:357-392`): Modal `sm` "Continue Duty?", body "Your previous duty ended at
{time}. A new work session will be added to today's attendance. The gap since your last clock-out is off-duty and is not
counted.", footer Cancel / Continue Duty (`clock-continue-cancel`, `clock-continue-confirm`); confirming opens the camera.

### 2.9 Empty, loading and error states (Attendance)

| Situation | CURRENT | Evidence |
|---|---|---|
| Client paging in progress | `useTransition`; the list dims to `opacity-60`; Previous / Next disabled; no skeleton, no `aria-busy` | `C/attendance-records.tsx:95, 333, 469, 479` |
| Paging action throws | `role="alert"` "Could not load attendance records. Please retry." above the previous (stale) list | `:141-143, 319-323` |
| Empty | EmptyState "No attendance in this range" (total 0) or "No matching records"; "Adjust the date range or filters..." | `:325-331` |
| SILENT: history read fails | count error returns an EMPTY page; row error returns `{rows: [], total}`; both render as the EmptyState | `L/attendance.ts:626, 635` |
| SILENT: roster read fails | `listClockStaff()` returns `[]`, so the kiosk says "No active team members found." | `L/attendance.ts:102` |
| SILENT: status reads fail | open-session and last-clock-out reads ignore errors, so every member looks idle | `L/attendance.ts:113-121, 134-145` |
| SILENT: gating read fails | the banner is hidden and the gate is treated as off | `L/devices.ts:38-42` |
| SILENT: today summary read fails | tiles show zeros | `L/attendance.ts:677` |
| Search with no roster match | an empty page is returned without querying | `L/attendance-paging.ts:156-163`; `L/attendance.ts:604` |
| Route loading / error | route-group `LoadingState`; root error boundary | section 1.7 |

The two unit tests that "surface a read failure" only exercise a thrown action (`T/attendance-records.test.tsx:170-177`);
no test covers the silent server paths.

### 2.10 What happens after actions (Attendance)

- After a clock action: the clock sets the notice, returns to idle and calls `router.refresh()`
  (`C/attendance-clock.tsx:169-180`). New server props re-drive the state machine (`openSessions`, `lastOutToday` are
  props), the summary tiles update, and the history list reloads through the new `roster` prop (section 1.10, computed
  from code). The selected member stays selected. Between the action result and the refresh arriving, the previous button
  (for example Clock In) is visible again; a second tap is refused by the database (computed from code).
- After a delete: the delete dialog closes once per new success and calls `router.refresh()`
  (`C/attendance-day-details.tsx:127-134`). The list reloads, but the still-open day-details modal keeps showing the
  deleted session because `viewing` is state (`C/attendance-records.tsx:94`). NEEDS VERIFICATION in a browser.
- After register or revoke: server revalidation only; the banner and list change on the re-render that follows.

## 3. Screen: Review Attendance - `/admin/attendance/review`

### 3.1 Gate, header, flags and layout

CURRENT: hr_review_attendance else 404; header "Review Attendance", description "Review and inspect attendance records."
(`P/attendance/review/page.tsx:22, 40-43`). The server reads the first page (last 7 days, 25 rows, status All) and the
roster in parallel (`:25-33`). `canManage` = role key owner or selected_admin, decided by role, not by a permission
(`:35-36`). The component prop `canManage` DEFAULTS TO TRUE when omitted (`C/review-attendance-view.tsx:81`); the server
still guards every write. There are no summary tiles on this page.

Desktop (640px and up): status tabs row; search; inline filters; count line; bordered table (640px minimum); pagination
footer; the day modal opens as a centred `lg` (780px) dialog. Phone (below 640px): tabs row (wraps); search plus
"Filters (n)"; count line; card list; pagination footer; all dialogs are bottom sheets. Inside the day sheet only the
correction and delete buttons wrap (`flex flex-wrap gap-2`, `:625`). The time text ("{in} -> {out}" or "still clocked
in") and the In / Out selfie thumbnails share one row that does not wrap (`flex items-center justify-between gap-3` at
`:594`, thumbnails in `flex items-center gap-2` at `:603`), which is a tight spot at 360px (section 8.1).

### 3.2 Filters

| Filter | CURRENT | Evidence |
|---|---|---|
| Status tabs | Open / Completed / All (default All); `role="tablist"`, `aria-label="Attendance status"`, each `role="tab"` | `C/review-attendance-view.tsx:72-76, 90, 264-276` |
| Tab styling | `tap-44 rounded-lg border px-3 py-1.5 text-sm`; active `border-<accent>/40 bg-<accent>/15 text-<accent>-strong` | `:277-282` |
| Tab semantics | filters SESSION rows in SQL (`time_out` null or not) | `L/attendance.ts:618-619` |
| Search | "Search employee...", `aria-label="Search attendance by employee"`, `h-9`, 300ms debounce, roster name match | `:119-133, 291-299` |
| Date range | chips Today / Last 7 days (default) / This month / Custom; Custom shows From / To (`h-9`, cross `min` / `max`) | `:181-237` |
| Employee | select "All employees" + roster names (`h-9`) | `:239-257` |
| Phone sheet | "Filters (n)" (`sm:hidden`; n = employee picked + range not default; status excluded) opens Modal `sm` "Filters" | `:179, 300-324` |
| Sheet footer | "Apply filters", which only closes the sheet; the filters already applied live | `:317-321` |
| Count | "No records" or "Showing {a}-{b} of {N} record(s)" (`review-count`), counting session rows | `:326-330` |
| URL | filters, page and tab live in React state only | `:90-104` |

Roster caveat (CURRENT): `list_clock_staff` raises for a caller without hr_attendance (`M/20260907160000:16-19`) and the
reader then returns `[]` (`L/attendance.ts:102`). A reviewer who holds hr_review_attendance but not hr_attendance gets an
Employee select with only "All employees", and every name search maps to no ids, which shows an empty result. Super
Admins and deactivated members are never in the roster, so their rows cannot be isolated by name.

### 3.3 Table, day grouping and badges

| Aspect | CURRENT | Evidence |
|---|---|---|
| Wrapper | `hidden overflow-x-auto rounded-xl border bg-card sm:block`; `data-table min-w-[640px]`; rows `hover:bg-accent/40` | `:350-355, 371` |
| Columns | Employee (`col-grow`) / Date (muted) / Time / Total worked (right) / Status / Details (`col-actions`) | `:357-364` |
| Time cell | "{first in} -> {final out or --}" plus badges | `:377-380` |
| Details | button "Details" (`tap-44`, `review-day-view-{key}`) | `:387-395` |
| Day grouping | one row per (member, work date); sessions of the same day on other pages are fetched as `completion` rows | `L/attendance.ts:639-656` |
| Session badge | "{n} sessions", neutral chip `border-border text-[10px] text-muted-foreground`, only when n > 1 | `:522-529` |
| OT badge | "OT {amount}" in `border-<accent>/40 bg-<accent>/10 text-[10px] font-medium text-<accent>-strong` when a session has the flag | `:530-537` |
| Status | a day with an open session: "Open" (the accent tone); else "Complete" (tone `success`) | `:509-515` |
| Tab nuance | the Completed tab can show an "Open" day: `completion` rows are fetched without the status filter | `L/attendance.ts:645-650` |
| Names | the Employee cell renders "--" when the embedded profile name is null (section 3.8) | `:373, 413` |

The OT badge reflects the session-flag night rule (clock-in hour 22 or later), not the payroll rule, so a day can show an
OT badge and earn no night bonus, or earn one without a badge (section 0.2 fact 3).

### 3.4 Phone cards

CURRENT: `<ul class="space-y-2 sm:hidden">` (`review-cards`), one `li` per day: name (truncate) + status badge; date;
"{first in} -> {final out}"; "Total worked: {duration}"; a badges row; full-width outline `sm` "Details" (`min-h-11`)
(`:404-444`). Both the table and the card list are always in the DOM; CSS hides one (`:350, 404`).

### 3.5 ReviewDayModal with selfies

CURRENT: Modal `lg`, title "{Staff} -- {Mon D, YYYY}", description "{n} work session(s)", footer Close (`:561-572`). The
session blocks match section 2.7, plus per session: selfie thumbnails loaded lazily when the day opens ("Loading
selfies..." while pending, `:110-117, 604-607`); for a flagged session a `text-[11px] text-<accent>-strong` line "Overtime
(night) - {amount}" (`:619-623`); and, when `canManage`, the correction and delete buttons (`:624-629`).

`SelfieThumb` (`:649-671`): with no URL, "In --" or "Out --" in muted text; otherwise a 36px (`h-9 w-9`) `rounded
object-cover ring-1` image (`alt="In selfie"` / `"Out selfie"`) inside a link with `target="_blank" rel="noopener
noreferrer" download` and a small caption. URLs are signed for 300 seconds with a download disposition
(`L/attendance.ts:544-550`). A thumbnail that has already loaded stays visible, and nothing re-mounts it on refresh; after
300 seconds, opening or downloading through the thumbnail link uses the expired signed URL and returns an expired-URL
error, and any re-render that changes an image `src` to an expired URL fails to load (computed from code, NEEDS
VERIFICATION in a browser).

SILENT selfie failures (CURRENT): the selfie reader returns `{}` on a query error and `null` for a URL that fails to sign
(`L/attendance.ts:533, 549-550`), and the component's load has no `.catch` (`:114-116`); every case renders "In --" /
"Out --", indistinguishable from "no photo was taken".

### 3.6 ClockOutCorrectionModal (CURRENT name `ReviewRowCorrect`)

| Aspect | CURRENT | Evidence |
|---|---|---|
| Trigger | `tap-44` button "Correct clock-out" (completed session) or "Set clock-out" (open session); manage only | `:717-724` |
| Dialog | Modal `sm`, NOT critical; "Correct clock-out time" / "Set clock-out time" | `:726-731` |
| Description | "Closes or shortens this session. Clock-in is unchanged; payroll recomputes." | `:730` |
| Body text | "{name} clocked in at {date time} and out at {date time}." or "... and has no clock-out (session still open)." | `:750-761` |
| Body times | `toLocaleString()`: device locale and device timezone | `:752, 756` |
| Time field | "New clock-out time", `datetime-local`, `h-9` (`review-correct-time-{id}`) | `:762-774` |
| Reason field | "Reason *", textarea `rows=2 text-sm`, placeholder example (`review-correct-reason-{id}`) | `:775-789` |
| Seed value | current `time_out`, else `time_in`, converted to DEVICE local time and truncated to the MINUTE | `:674-679, 707` |
| Submit | hidden `timeOut` = `new Date(localValue).toISOString()` (device timezone); Save disabled while pending, empty, no reason | `:713, 737-743` |
| Server messages | "Enter a clock-out time.", "A correction reason is required.", success "Clock-out corrected." | `L/actions.ts:173-174, 182` |
| RPC messages | "Clock-out cannot be before clock-in.", "Clock-out cannot be in the future." | `M/20260907130000:45-53` |
| Error display | `role="alert"` destructive text inside the form | `:790-794` |
| After success | closes once per new success; `router.refresh()`; a second correction of the same session stays open (1.10) | `:697-704` |

Minute-truncation defect (CURRENT): `time_in` normally carries seconds, so for an OPEN session the seed is earlier than
`time_in` and an unchanged save is refused with "Clock-out cannot be before clock-in."; for a COMPLETED session an
unchanged save is accepted and silently rewrites `time_out` to the start of its minute, stamping the editor and the reason
(`:674-679`; `M/20260907130000:48-50`). Rule summary (all documents agree): only the clock-out is correctable, by Super
Admin or Admin, reason required, in-place update, no approval, no period lock (DATABASE.md section 3.5).

Overlap not checked (CURRENT): the picker has no `min` or `max`, and the RPC checks only "not before clock-in" and "not in
the future" (`M/20260907130000:48-53`). Nothing in the repository compares the new clock-out with the same member's next
session, so a corrected clock-out can run past the next session's clock-in and the overlapping hours count twice in the
day total and in payroll. Template fix: the `maxTime` bound in section 9.2 and section 10 item 2.

### 3.7 AttendanceDeleteModal (CURRENT name `ReviewRowDelete`)

CURRENT: the same critical type-DELETE dialog as section 2.7 (`:807-894`), but with NO Super Admin / Admin split: an
Admin deletes directly here, while the Attendance page sends the same Admin to "Request delete". The server accepts both
roles (`L/attendance.ts:351-352`). The confirm input has no test id (`:875-883`).

Nested dialogs (computed from code, NEEDS VERIFICATION): the correction and delete dialogs are rendered from inside the
open day modal. Both register document Escape listeners, so Escape while the (non-critical) correction dialog is open
closes both; with the critical delete dialog open, Escape closes the parent day modal, which unmounts the child.

### 3.8 Names are blank for reviewers who are not the Super Admin

CURRENT: the page reader embeds the member name from `staff_profiles` (`L/attendance.ts:562-563, 570`), whose only SELECT
policy in the repository is Super Admin or self (`M/20260821140000:21-22`). For an hr_review_attendance holder who is not
the Super Admin the embed returns null for everyone else, and the UI renders "--" (table and cards, `:373, 413`),
"Staff" (modal title, `:564`), "This staff member" (correction copy, `:751`) and "this staff member" (delete copy,
`:868`). The Attendance page's history uses the same reader and is name-blind the same way for the same callers
(section 2.6). The only escape would be a live-only second SELECT policy: NEEDS VERIFICATION (query V7 in DATABASE.md
section 8). Template fix: section 10 item 3.

### 3.9 Actions and confirmations (Review)

| Action | Offered to (UI) | Confirmation | Server check | After success |
|---|---|---|---|---|
| Tab, search, range, employee, rows, page | page users | none | `hr_review_attendance` on the paging action | list reloads at page 1 (page moves keep filters) |
| Open Details | page users | none | selfie action needs `hr_review_attendance` | day modal; selfies lazy-load |
| Open a selfie | page users | none | signed URL (300s) | new tab, download disposition |
| Set / Correct clock-out | Super Admin, Admin | reason required, Save disabled until set | role gate in TS and RPC | dialog closes; `router.refresh()` |
| Delete record | Super Admin, Admin | critical type-DELETE dialog | word re-checked; delete RPC (RECONSTRUCTED) | dialog closes; `router.refresh()` |

Gates: `L/actions.ts:48, 77`.

### 3.10 Empty, loading and error states (Review)

Same patterns as section 2.9 (`C/review-attendance-view.tsx:148-162, 332-348`): opacity-only loading; client error line
"Could not load attendance records. Please retry." when the action throws; empty titles "No attendance records found for
this filter." (total 0) or "No matching records", description "Adjust the status, date range or employee to see more.";
SILENT empty page when the server read fails (same reader, `L/attendance.ts:626, 635`); SILENT empty roster (section
3.2); SILENT selfies (section 3.5). Tests: `T/review-attendance-records.test.tsx:62-126` (seven cases; the read-failure
case at `:121-126` exercises a thrown action only).

### 3.11 What happens after actions (Review)

After a correction or delete the dialog closes and calls `router.refresh()` (`:697-704, 816-823`). The table reloads
through the new `roster` prop (computed from code); the OPEN day modal keeps the pre-correction day object, including old
times, totals and a deleted session, because `viewing` is state (`:107, 495-503`). The Review page is also revalidated
on the server (`L/actions.ts:154, 179`). NEEDS VERIFICATION in a browser: correct a record, confirm that the table row
updates without touching the filters while the open modal still shows the old times.

## 4. Screen: Payroll - `/admin/payroll`

### 4.1 Gate, period, flags and tabs

| Aspect | CURRENT | Evidence |
|---|---|---|
| Gate and header | hr_payroll else 404; title "Payroll", no description | `P/payroll/page.tsx:30, 48` |
| Period | query string `?from=&to=`; default first day of the current month to today, business timezone; no validation | `:32-34` |
| Reads | active staff, `report_payroll`, and the payslips of that exact period, in parallel | `:36-40` |
| Flags | `isOwner`; `canManagePayroll` = owner or selected_admin; rates are read only for managers | `:41-44` |
| Visible rows | Super Admin: every eligible member; anyone else: only their own row (Admins included) | `M/20260907160000:100` |
| Tabs | only when `canManageRates` (= `canManagePayroll`); otherwise the payroll card alone | `C/payroll-tabs.tsx:49` |
| Tab bar | two `sm` Buttons "Payroll" / "Employee Rates": active `default`, inactive `outline`, `aria-pressed` | `C/payroll-tabs.tsx:53-74` |
| Tab state | local state, not in the URL; a period change (full GET navigation) returns to the Payroll tab | `C/payroll-tabs.tsx:36` |
| Period form | plain `<form method="GET">`: From / To dates (`h-8`, no cross min/max), outline `sm` "Apply" | `C/attendance-view.tsx:76-97` |
| Summary trigger | Super Admin only, only when rows exist: primary `sm` "Print Payroll Summary" in the same wrap row | `C/attendance-view.tsx:98-105` |

Desktop: tab bar, then the Payroll card with the period row and a 900px-minimum table inside `overflow-x-auto`. Phone:
the tab bar and period row wrap; the table becomes stacked cards (section 1.3); the payslip and summary dialogs are
bottom sheets.

### 4.2 PayrollTable - `C/attendance-view.tsx`

| Aspect | CURRENT | Evidence |
|---|---|---|
| Container | Card "Payroll" | `:71-74` |
| Table | `overflow-x-auto`; `data-table data-table--stack min-w-[900px]`; colgroup 15/12/12/10/12/10/8/8/13 %; `payroll` | `:116-131` |
| Columns | Employee / Role / Regular Hours / Overtime Hours / Salary Rate / Pay Frequency / Salary / Status / Actions | `:133-161` |
| Role | the role KEY with underscores as spaces, CSS `capitalize` (shows "Selected Admin", not the UI word "Admin") | `:172-174` |
| Regular Hours | shows `totalHours`, ALL completed hours including those above 8, as "8h 30m" | `:175-177` |
| Overtime Hours | sum over sessions of hours above 8, reported for visibility only; pay uses the night bonus | `:178-180`; `M/20260907160000:50-51` |
| Salary Rate | Super Admin: inline editor button (section 4.7); others "No rate set" (`text-[11px]`) or "{rate} /day" | `:181-197` |
| Pay Frequency | Weekly, Bi-Weekly or Monthly; stored and shown, drives no computation | `:38-42, 198-200` |
| Salary | "No rate set" or `computed_salary` through `<Money>` (formula in section 0.2 fact 4) | `:201-209` |
| Status | pill "Paid" or "Unpaid" (section 4.3) | `:210-220` |
| Actions | PayslipButton (section 4.4); the `<td>` lacks `col-actions` | `:221-229` |

Phone defect (CURRENT): because the actions `<td>` has no `col-actions`, the stamping helper labels it "Actions" and the
button renders as a labelled row instead of spanning the card; Employee Rates does it correctly
(`C/employee-rates-view.tsx:212`; `U/stacked-table.ts:27`).

### 4.3 Paid pill

CURRENT: an inline span, not `StatusBadge`: `inline-block rounded-full border px-2 py-0.5 text-[11px]`; "Paid" in
`border-green-600/40 bg-green-600/10 text-green-700` when the period's latest payslip is paid, otherwise "Unpaid" in
`border-amber-500/40 bg-amber-500/10 text-amber-600`, INCLUDING rows with no payslip at all (`:164-167, 210-220`). No
glyph, hard-coded palette, no dark-mode variant. Status honesty: `listPayslipsForPeriod` matches the EXACT from/to pair
and returns `{}` on a read error (`L/payslip.ts:66-73`), so a failed read, or a period that differs by one day from the
generated one, shows every row "Unpaid" and offers "Generate Payslip" again.

### 4.4 PayslipModal (CURRENT `PayslipButton`) - `C/payslip-button.tsx`

| State | CURRENT | Evidence |
|---|---|---|
| Row trigger | outline `sm` "Generate Payslip" when the prop snapshot is null, else "View payslip" (`generate-payslip-{id}`) | `:253-261` |
| Dialog | Modal `md`; "Payslip"; "Payroll period {from} - {to}. Figures are a frozen snapshot."; injects print CSS | `:263-271` |
| Generate form (manager) | "Deductions" MoneyInput (`max-w-[12rem]`, `h-9`, default "0") | `:276-288` |
| Generate note | "Overtime pay = the recorded <cur>300 flat late-night overtime for the period." | `:289-292` |
| Generate footer | Cancel / "Generate payslip" ("Generating..."), primary | `:240-249` |
| Non-manager, none | "No payslip has been generated for this period yet. Ask the Owner to generate it." | `:294-299` |
| Non-manager footer | STILL "Generate payslip": the footer depends on snapshot presence only | `:218, 240-249` |
| Generated | white PayslipDocument (section 4.5) | `:272-273` |
| Generated footer | Close / "Download PDF" (`payslip-download-pdf`) / "Print" (`window.print()`) / "Mark as Paid" | `:218-239` |
| Mark as Paid shown | manager AND status pending; label "Saving..." while pending | `:234-238` |
| Errors | `role="alert"`; "The payslip could not be generated." fallback; server messages | `:182-191, 300-311` |
| Mark-paid failure | server message, e.g. "Could not mark the payslip as paid. It may already be paid." | `:203-206`; `L/payslip-actions.ts:137-143` |
| Tests | generate form for a manager; document + Download PDF + Print + Mark as Paid for a pending snapshot | `T/payslip-button.test.tsx:37-69` |

Confirmations (CURRENT): none for Generate (the dialog itself is the step) and NONE for Mark as Paid, which is
irreversible in the UI: the server only flips pending to paid and writes the paid date and user (PAYROLL.md section 7.5).
No regenerate button exists.

Permission mismatches (CURRENT): the page passes `canManagePayroll` (owner or selected_admin), which shows the Deductions
form to an Admin, but generation requires the Super Admin (`L/payslip-actions.ts:28`), so an Admin sees a working-looking
form that fails. Mark as Paid allows Super Admin or Admin in TypeScript (`L/payslip-actions.ts:106`) while the repository's
snapshot UPDATE policy is Super Admin only (NEEDS VERIFICATION of the live policy, PAYROLL.md section 7.5).

After actions (CURRENT): Generate stores the returned snapshot in local state and calls `router.refresh()` (`:186-187`);
Mark as Paid patches local state to paid with today's business date and calls `router.refresh()` (`:207-212`). Mark as
Paid has `try / finally` but no `catch` (`:195-216`), so a thrown action leaves no message. The local snapshot is
initialised once from the prop (`:166`): if another user generates a payslip and a refresh arrives, the row trigger reads
"View payslip" (prop) but the dialog still shows the generate form (state), and a second generate is possible
(computed from code, NEEDS VERIFICATION).

### 4.5 PayslipDocument - `C/payslip-button.tsx:64-149`

CURRENT: `div#payslip-doc`, `rounded-lg bg-white p-6 text-sm text-black` at every theme (`:71`).

1. Header row (`:73-102`): a 32px circle with the logo initials on a hard-coded accent hex, the brand name and "Payslip"
   (PROJECT-SPECIFIC, section 11); on the right the employee name, the role key (capitalised), the period, and a status
   line "Paid - {date}" (`text-green-700`) or "Pending" (`text-amber-600`).
2. Summary `grid grid-cols-2 gap-x-8` at EVERY width (`:105-138`). Left column on the daily basis: Days worked, Regular
   hours, "Night shifts (<cur>300 each)", Daily rate; on a legacy hourly basis: Regular hours, Overtime hours, Hourly
   rate. Right column: Regular salary, Overtime pay, Gross salary, Deductions ("- {money}"), Net pay (bold, accent hex).
3. Signature row `grid-cols-2 gap-8 text-xs`: "Employee signature" and "Approved by" over a top rule (`:141-146`).

Money renders through `<Money>`, so Privacy Mode masks the dialog on screen and prints real values (section 1.6).

### 4.6 PayrollSummaryDocument (CURRENT `PayrollSummaryButton`) - `C/payroll-summary-button.tsx`

CURRENT: Modal `lg` "Payroll Summary", description "Period {from} - {to}", footer Close / "Print / Save as PDF"
(`window.print()`) (`:68-84`). The document `#payroll-summary-doc` (`bg-white p-5 text-black`, `:86`) has a 40px
`bg-amber-500` circle with logo initials and "{brand} -- Payroll Summary" plus the period (`:87-99`, PROJECT-SPECIFIC).
Table `data-table min-w-[720px] text-xs` inside `overflow-x-auto`, NOT stacked (`:101-102`): Employee / Reg. hrs
(`toFixed(2)` decimal hours, unlike "8h 30m" elsewhere) / OT hrs / Rate (no unit) / Gross / Deductions / Net / Status
(`snap.paymentStatus` or "not generated", CSS `capitalize`) (`:113-157`). Footer "Total payroll" = per row the snapshot
net if a payslip exists, else the computed salary, else 0, summed in integer minor units with BigInt (`:54-60, 162-171`).
Footnote: "Gross is from attendance in SQL. Deductions / Net / Status come from each generated payslip; rows without a
payslip show gross as net." (`:174-177`).

Defects (CURRENT): the minor-unit parser rejects a non-numeric whole part such as a leading minus and substitutes 0 but
keeps the fraction, so a snapshot with net -100.50 (possible: net has no check) adds +0.50 to the total (`:31-36`;
PAYROLL.md section 6.6). The document uses `.data-table`, whose header cells get `background-color: var(--muted)` and
14px bold uppercase text; in the dark theme `--muted` is a dark colour, so the white sheet shows a dark header band on
screen (computed from code, `globals.css:129, 229`).

### 4.7 EmployeeRatesTable and the two RateEditors

| Aspect | CURRENT | Evidence |
|---|---|---|
| Rates tab table | bordered `rounded-xl` wrapper; `data-table data-table--stack min-w-[720px]`; colgroup 22/13/14/14/13/13/11 % | `C/employee-rates-view.tsx:158-171` |
| Columns | Employee Name / Role / Salary Rate / Pay Frequency / Effective Date / Last Updated / Actions (managers) | `:172-183` |
| Cells | rate "{money} /day" or "No rate set"; effective date raw `YYYY-MM-DD`; last updated `en-US` long date | `:192-210` |
| Empty | EmptyState "No active team members" | `:154-156` |
| Rows | active, non-demo, non-Super-Admin profiles; the "current" rate is the newest row with no "effective by today" filter | `L/rate.ts:134-143` |
| Rate source | table `staff_salary_rates` (RECONSTRUCTED: no DDL in the repository; DATABASE.md section 2.5) | `L/rate.ts:139-143` |
| Tab editor trigger | "Edit rate" (`edit-rate-{id}`, `text-xs`, no `tap-44`, no per-row accessible name) in a `col-actions` cell | `:62-73, 212-214` |
| Tab editor dialog | Modal `sm` "Salary rate -- {name}"; `ModalFormGrid` (1 column on phones, 2 from 640px) | `:75-93` |
| Tab editor fields | "Salary amount (per day)" MoneyInput; "Pay frequency" select; "Effective date" (business-timezone today, not required) | `:94-133, 43` |
| Tab editor after save | closes once per new success; `router.refresh()`; no success message shown | `:49-56` |
| Inline editor trigger | Super Admin only: button with the rate or "Set rate", `aria-label="Edit salary rate for {name}"`, no `tap-44` | `C/attendance-view.tsx:182-183, 272-279` |
| Inline editor dialog | Modal `sm` "Salary rate -- {name}"; the same three fields stacked at `max-w-[12rem]` | `C/attendance-view.tsx:281-338` |
| Inline editor date | `required`, default = the DEVICE-local date | `C/attendance-view.tsx:44-50, 330-337` |
| Inline editor after save | closes once per new success; no `router.refresh()` call | `C/attendance-view.tsx:259-266` |
| Server validation | amount up to 10 integer digits and 2 decimals, zero or more; frequency in the three keys; date required | `L/rate.ts:209-220` |
| Server success | "Salary rate saved: <cur>{rate} per day, {frequency}, effective {date}." is returned; neither editor shows it | `L/rate.ts:239-242` |
| Stale comment | the inline editor's docstring says an empty amount clears the rate; the server rejects empty | `C/attendance-view.tsx:247-252` |
| Authority | the action and `setSalaryRate` have no TypeScript authority check; the rate RPC and its gate are RECONSTRUCTED | `L/rate.ts:201-231` |
| Repeat save | saving the same rate, frequency and date again returns the same message, so the dialog stays open (section 1.10) | `L/rate.ts:239-242` |

Consequences: the Rates tab is offered to Admins while the inline editor is Super Admin only, and no known server rule
matches either (PERMISSIONS.md section 3). A silent read: `listEmployeeRates()` ignores both query errors
(`L/rate.ts:131-144, 157, 172`), so a failed read shows "No active team members" or "No rate set" for everyone.

### 4.8 Actions and confirmations (Payroll)

| Action | Offered to (UI) | Confirmation | Server check | After success |
|---|---|---|---|---|
| Apply period | page users | none | none (dates not validated) | full GET navigation; tab resets |
| Switch tab | Super Admin, Admin | none | none | local state |
| Edit rate (tab) | Super Admin, Admin | dialog | none in TS; RPC gate RECONSTRUCTED | `router.refresh()` |
| Edit rate (inline) | Super Admin | dialog | same | no client refresh |
| Generate payslip | form: Super Admin, Admin; footer: everyone | the dialog | Super Admin (`L/payslip-actions.ts:28`) | local snapshot; `router.refresh()` |
| Download PDF | any user who can open a generated payslip | none | none (client jsPDF) | file download |
| Print payslip | same | browser print dialog | none | none |
| Mark as Paid | Super Admin, Admin, pending only | NONE | Super Admin or Admin in TS; RLS NEEDS VERIFICATION | local patch; `router.refresh()` |
| Print Payroll Summary | Super Admin, rows exist | dialog, then browser print | none | none |

### 4.9 Empty, loading and error states (Payroll)

| Situation | CURRENT | Evidence |
|---|---|---|
| Payroll read fails | `ReadError` "Payroll unavailable" / "The payroll totals could not be read." (the honest pattern) | `C/attendance-view.tsx:108-112`; `L/payroll.ts:42` |
| Empty | EmptyState "No attendance in this range" | `C/attendance-view.tsx:113-114` |
| Empty, meaning | rows come from eligible PROFILES left-joined to sessions, so members with no attendance still appear with 0h | `M/20260907160000:94-99` |
| Empty, when | only when the caller sees no eligible profile, for example a caller whose own profile is excluded | `M/20260907160000:97-100` |
| Loading | route-group `LoadingState` during the GET navigation; no skeleton | `src/app/(app)/loading.tsx:9-11` |
| SILENT: payslip read fails | every row "Unpaid"; "Generate Payslip" offered again | `L/payslip.ts:73` |
| SILENT: rates read fails | "No active team members" or "No rate set" everywhere | `L/rate.ts:131-144` |
| Invalid period | `from` after `to` returns rows with zero totals, no message | `M/20260907160000:44` |

## 5. Status visuals

### 5.1 CURRENT labels, classes and colours

| Meaning | Label(s) | Classes / tone | Where |
|---|---|---|---|
| Day with an open session (history) | "Clocked in" | StatusBadge in the accent tone: `bg-<accent>/15 text-<accent>-strong border-<accent>/30`, filled circle | `C/attendance-records.tsx:504` |
| Day without an open session (history) | "Completed" | StatusBadge `success`: `.badge-green`, check mark | `C/attendance-records.tsx:506` |
| Day with an open session (Review) | "Open" | StatusBadge in the accent tone | `C/review-attendance-view.tsx:511` |
| Day without an open session (Review) | "Complete" | StatusBadge `success` | `C/review-attendance-view.tsx:513` |
| Status filter options | "All", "Open", "Completed" | select options (history), tab buttons (Review) | `C/attendance-records.tsx:260-262`; Review `:72-76` |
| Open session in details | "still clocked in" | `text-<accent>-strong` | `C/attendance-day-details.tsx:80`; Review `:600` |
| Phone card total on an open day | "Completed so far" | muted text | `C/attendance-records.tsx:420` |
| Second and later session | "Continued Duty" | chip `border-<accent>/40 bg-<accent>/10 px-1.5 py-0.5 text-[10px] text-<accent>-strong` | `C/attendance-day-details.tsx:65-69` |
| Multi-session day | "{n}x" (history table), " - n sessions" (history card), "{n} sessions" (Review) | neutral chip `text-[10px]` | `C/attendance-records.tsx:360-368, 414` |
| Night flag, day (Review only) | "OT {amount}" | chip `border-<accent>/40 bg-<accent>/10 text-[10px] font-medium text-<accent>-strong` | `C/review-attendance-view.tsx:530-537` |
| Night flag, session (Review modal) | "Overtime (night) - {amount}" | `text-[11px] text-<accent>-strong` | `C/review-attendance-view.tsx:619-623` |
| Off-duty gap | "Off duty - {h m} -- not counted" | `text-[11px] text-muted-foreground`, centred | `C/attendance-day-details.tsx:89-93` |
| Paid (payroll table) | "Paid" | hard-coded `border-green-600/40 bg-green-600/10 text-green-700`, no glyph | `C/attendance-view.tsx:211-219` |
| Not paid (payroll table) | "Unpaid", also when no payslip exists | hard-coded `border-amber-500/40 bg-amber-500/10 text-amber-600`, no glyph | same |
| Payslip document | "Paid - {date}" / "Pending" | `text-green-700` / `text-amber-600` | `C/payslip-button.tsx:92-100` |
| Payslip PDF | "Paid - {date}" / "Unpaid" | grey text | `L/payslip-pdf.ts:86-89` |
| Payroll Summary | "Pending" / "Paid" / "Not Generated" (CSS `capitalize`) | plain text | `C/payroll-summary-button.tsx:155-157` |
| Missing rate | "No rate set" | `text-[11px] text-muted-foreground` | `C/attendance-view.tsx:185-187, 203-205` |
| Device approved | "Approved <device noun>" | banner `border-<accent>/40 bg-<accent>/10`, dot `bg-<accent>` (`aria-hidden`) | `C/device-manager.tsx:61, 69, 73` |
| Device not registered | "<device noun> not registered" | banner `border-border bg-secondary/40`, dot `bg-muted-foreground` | same |
| This device blocked | "This device cannot clock in/out" | `border-destructive/40 bg-destructive/10`, `role="alert"` | `P/attendance/page.tsx:92-104` |
| Revoke action | "Revoke" | `Button variant="destructive"` | `C/device-manager.tsx:138-145` |
| Revoked devices | not shown | filtered out | `C/device-manager.tsx:39` |
| Camera problem | "{reason} You can still clock in/out without a photo." | `border-destructive/40 bg-destructive/5 text-xs text-destructive` | `C/attendance-clock.tsx:249-253` |
| Inline errors | action error text | `text-sm text-destructive`, `role="alert"` | `C/attendance-clock.tsx:394-398` |
| Success notices | server message | `text-muted-foreground`, `role="status"` | `C/attendance-clock.tsx:399-403` |
| Request sent | "Request sent. ..." | hard-coded `text-emerald-600` | `src/components/approvals/request-deletion-button.tsx:99` |
| Read failure | "Payroll unavailable" | `ReadError` destructive box | `C/attendance-view.tsx:108-112` |
| Warnings (`warning` tone) | none used by the HR screens | - | - |

### 5.2 Inconsistencies (CURRENT)

1. The open / closed day state is "Clocked in" / "Completed" on Attendance, "Open" / "Complete" on Review, while both
   filters say "Open" / "Completed".
2. The not-paid state is "Unpaid" (table, PDF), "Pending" (payslip dialog, summary) and "Not Generated" (summary only);
   the table cannot tell "not generated" from "pending".
3. The payroll pill bypasses `StatusBadge` and the token rule ("Components must use the brand TOKENS, never a hardcoded
   palette", `docs/FINAL-UI-SOURCE-OF-TRUTH.md:91-93`).
4. The accent token is used as a status tone for "Open", against the rule in section 1.4.
5. The night badge exists on Review only, reflects the session flag rule, and can disagree with pay (section 0.2).
6. The Role column shows role keys ("Selected Admin") while the rest of the UI says "Admin".

### 5.3 RECOMMENDED TEMPLATE IMPROVEMENT: one label set

One label set for every screen, filter, dialog, printed document and PDF. Tones are StatusBadge status tones only; the
accent token is never a status.

| State | Label | Tone | Glyph | Replaces |
|---|---|---|---|---|
| Day or session with an open session | Open | `info` | filled circle | "Clocked in", "Open", "still clocked in" |
| Day with every session closed | Completed | `success` | check mark | "Completed", "Complete" |
| Running total on an open day | "Total so far" (text) | - | - | "Completed so far" |
| Status filter options | All / Open / Completed | - | - | same words |
| Second and later session | Continued Duty | `neutral` | filled circle | accent chip |
| Several sessions in a day | "{n} sessions" | `neutral` | none (chip) | "{n}x", " - n sessions" |
| Night bonus earned (one configured rule) | "Night bonus" + amount | `info` | filled circle | "OT {amount}", "Overtime (night) - {amount}" |
| Payslip not generated | Not generated | `neutral` | filled circle | "Unpaid" (table), "Not Generated" |
| Payslip generated, unpaid | Pending | `warning` | filled circle | "Unpaid" (table, PDF), "Pending" |
| Payslip paid | Paid (+ date where space allows) | `success` | check mark | "Paid", "Paid - {date}" |
| Payslip voided (only when the optional void path is built) | Void | `danger` | cross | nothing: no reverse path today |
| Payslip status could not be read | an error line, never a status word | `ReadError` | - | "Unpaid" shown after a failed read |
| Salary cannot be computed | No rate set | `warning` | filled circle | muted text |
| Device approved | Approved device | `success` | check mark | accent banner |
| No device registered | No device registered | `neutral` | filled circle | grey banner |
| This device not approved | Device not approved | `danger` | cross | destructive banner |
| Role column | the configured role label (Super Admin, Admin, Staff) | - | - | capitalised role key |

CONFIGURABLE: the words map to `review.statusLabels` (open, completed) and to `payroll.statusLabels`
`{ notGenerated, pending, paid, void }`, both already defined in CONFIGURATION.md section 2 (schema at section 2, payroll
keys at section 2.6; the alignment table in section 7 fixes the payslip labels as Not generated, Pending, Paid, Void).
The stored payslip statuses are `pending`, `paid` and `void` (`payroll.statuses`). The reverse path is decided: PAYROLL.md
section 12 item 6 adds a `void` status with a reason, the actor and the time, keeping `paid_at`, and IMPLEMENTATION_PROMPT.md
P15 makes `void_payslip(p_snapshot_id, p_reason)` optional, gated on `payroll.payslip.generate`, with a confirmation. When
the void path is not built, no Void control and no Void label appear. The `danger` tone and cross glyph for Void are this
document's choice for a payslip that no longer counts; the tone is not a configuration key. The reference implementation
has only `pending` and `paid` (`M/20260722210000:29-30`).

## 6. Interaction patterns

### 6.1 Modal and bottom-sheet inventory

| Dialog | Size | Critical | Closes with | Evidence |
|---|---|---|---|---|
| Continue Duty? | sm (460px) | no | X, overlay, Escape, Cancel | `C/attendance-clock.tsx:357-392` |
| Attendance filters (phone only) | sm | no | X, overlay, Escape, Done | `C/attendance-records.tsx:305-317` |
| Day details (Attendance) | md (640px) | no | X, overlay, Escape, Close | `C/attendance-day-details.tsx:42-53` |
| Delete attendance record (both screens) | sm | YES | X, Cancel | `C/attendance-day-details.tsx:166-187`; Review `:841-862` |
| Request deletion | sm | no | X, overlay, Escape, Cancel | `src/components/approvals/request-deletion-button.tsx:70-97` |
| Review filters (phone only) | sm | no | X, overlay, Escape, Apply filters | `C/review-attendance-view.tsx:312-324` |
| Review day | lg (780px) | no | X, overlay, Escape, Close | `C/review-attendance-view.tsx:561-572` |
| Set / Correct clock-out | sm | no | X, overlay, Escape, Cancel | `C/review-attendance-view.tsx:726-746` |
| Register this device | sm | no | X, overlay, Escape, Cancel | `C/device-manager.tsx:157-177` |
| Salary rate (inline and tab) | sm | no | X, overlay, Escape, Cancel | `C/attendance-view.tsx:281-296`; `C/employee-rates-view.tsx:75-90` |
| Payslip | md | no | X, overlay, Escape, Cancel or Close | `C/payslip-button.tsx:263-270` |
| Payroll Summary | lg | no | X, overlay, Escape, Close | `C/payroll-summary-button.tsx:68-84` |

Patterns (CURRENT): forms put `form id=...` in the body and `<Button type="submit" form={id}>` in the footer
(`C/attendance-day-details.tsx:178-189`); success is detected with `useActionState` plus a `lastSuccess` ref so a dialog
closes once per new success (`C/review-attendance-view.tsx:697-704`). Because the ref compares message text, a second
identical success on the same mounted dialog does not close it or refresh (section 1.10; computed from code, NEEDS
VERIFICATION). Only the two delete dialogs are `critical`; the correction, rate and payslip forms are not, so Escape or an
overlay tap discards typed input, and the PWA update flow does not protect them: the update never reloads on its own, but
a user-tapped "Update now" reloads without the unsaved-work warning, which is raised only while a `critical` dialog is
open (then "Update anyway" is required) (`U/modal.tsx:127-131`; `docs/MOBILE-PWA.md:72-78`). No drawer component is
used; on phones every dialog is the bottom sheet from section 1.2.

### 6.2 Filters on desktop and in the phone bottom sheet

| Filter | Attendance history | Review | Evidence |
|---|---|---|---|
| Name search | always visible, roster match, 300ms | same | `C/attendance-records.tsx:98-102`; Review `:119-123` |
| Quick range | Today / Last 7 days (default) / This month / Custom | same | `L/attendance-paging.ts:57-65` |
| Custom dates | From / To `type=date`, cross `min` / `max` | same | `C/attendance-records.tsx:194-225` |
| Member picker | "All staff", only when `canFilterStaff` | "All employees", always | `C/attendance-records.tsx:228-248`; Review `:239-257` |
| Status | select All / Open / Completed (inside filters) | tabs Open / Completed / All (outside filters) | `C/attendance-records.tsx:249-264`; Review `:264-287` |
| Phone trigger | "Filters (n)", n includes status | "Filters (n)", n excludes status | `C/attendance-records.tsx:166-167`; Review `:179` |
| Phone sheet footer | "Done" (closes only) | "Apply filters" (closes only) | `C/attendance-records.tsx:310-314`; Review `:317-321` |
| Apply model | live: every change re-queries page 1 | same | `C/attendance-records.tsx:119-148` |
| Date semantics | business-day bounds on the clock-in time | same | `L/attendance-paging.ts:67-80` |
| Payroll period | GET `?from&to`, no presets, no validation | - | `C/attendance-view.tsx:76-97` |

Duplicated DOM (CURRENT): the same `filterControls` element renders inline (hidden below 640px by `hidden sm:block`)
AND inside the open Filters sheet (`C/attendance-records.tsx:304, 316`; `C/review-attendance-view.tsx:311, 323`), so ids
such as `att-from`, `att-staff`, `review-staff` and their test ids exist twice while the sheet is open.

GENERIC: one filter component that renders its controls once (inline at 640px and up, in the sheet below); the sheet
footer says "Done" because filters apply live; the active count counts only controls inside the sheet.

### 6.3 Pagination

CURRENT: server paging of SESSION rows with page sizes 25 / 50 / 100, default 25 (`L/attendance-paging.ts:14-16`), newest
clock-in first with an exact HEAD count (`L/attendance.ts:623-634`). The controls are hand-rolled twice
(`C/attendance-records.tsx:442-486`; `C/review-attendance-view.tsx:449-493`): "Rows" native select (`h-9`), "Page X of
Y", outline `sm` Previous / Next disabled at the bounds or while loading; not sticky; no first, last or jump. Page count
is `max(1, ceil(total / size))` (`L/attendance-paging.ts:188-190`). Any filter or page-size change resets to page 1. The
count text counts sessions while the list shows days, so "1-25 of 60 sessions" can sit above fewer than 25 day rows.
Payroll and Employee Rates are not paginated. The shared `Pagination` and `DataTable` components are unused (section 1.9).

GENERIC: extend the shared `Pagination` with `countText`, `disabled` and `testIdPrefix`, and use it on both screens; page
by day or label the count honestly (section 10 item 16).

### 6.4 Print and PDF

| Output | CURRENT | Evidence |
|---|---|---|
| Payslip print | `window.print()` with the injected rule set (section 1.8); `#payslip-doc` fixed at `inset: 0`, 32px padding | `C/payslip-button.tsx:26-36, 231` |
| Payslip PDF | jsPDF, A5 portrait, pt units, 36pt margin, rows 15pt apart, Net pay 11pt bold in the accent RGB | `L/payslip-pdf.ts:17, 53-55, 123, 148-155` |
| PDF amounts | "<currency code> 1,234.00" by string operations; a negative value keeps its sign | `L/payslip-pdf.ts:21-31` |
| PDF file name | brand prefix + "-Payslip-" + employee + "-" + start_end + ".pdf" (prefix in section 11) | `L/payslip-pdf.ts:44-49, 168` |
| Payroll Summary | `window.print()`; `#payroll-summary-doc` fixed, 24px padding, `overflow: auto`; no PDF library | `C/payroll-summary-button.tsx:18-29, 79-81` |
| Privacy Mode | masked money prints the real value | `src/components/shell/privacy.tsx:113-119` |

NEEDS VERIFICATION (print preview and a generated PDF):

1. There is no `@page` rule, so paper size and margins follow the browser default.
2. A `position: fixed` print container generally does not paginate, so a Payroll Summary longer than one page may be
   clipped to the first page.
3. The PDF label "Night shifts (<cur>300 each)" (`L/payslip-pdf.ts:106`) uses the currency glyph although the same file
   states that the built-in fonts lack it (`:12-14`); the glyph may render wrongly.
4. The screen document and the PDF disagree on the unpaid word ("Pending" versus "Unpaid").

GENERIC: a print-isolation helper with static positioning and an `@page` rule, a paper-size setting
(`payroll.payslip.pageSize`), an embedded font that carries the currency glyph, and one label set.

## 7. Accessibility

### 7.1 Tap targets on touch devices

| Control | Visual height | 44px hit area | Evidence |
|---|---|---|---|
| Every `Button` (including `sm`, 36px) | 36 to 48px | yes (`tap-44`) | `U/button.tsx:14, 26-32` |
| Range chips, Review tabs, View / Details, Delete, Correct / Set clock-out | about 30px | yes (`tap-44`) | `C/attendance-records.tsx:182, 387`; Review `:194, 278, 392, 721, 836` |
| Phone card "View details" / "Details" | 44px (`min-h-11`), full width | yes | `C/attendance-records.tsx:431`; Review `:438` |
| Modal X | 28px | yes (`tap-44`) | `U/modal.tsx:207-217` |
| Kiosk member select | 40px (`h-10`) | NO | `C/attendance-clock.tsx:223` |
| Filter selects, Rows select, frequency selects | 36px (`h-9`) | NO | `C/attendance-records.tsx:48-49, 451`; `C/employee-rates-view.tsx:114` |
| Search, date, DELETE, device label, deductions, rate inputs | 36px (`h-9`) | NO | `C/attendance-records.tsx:291`; `C/attendance-day-details.tsx:207` |
| Correction time input | 36px (`h-9`) | NO | `C/review-attendance-view.tsx:772` |
| Payroll period date inputs | 32px (`h-8`) | NO | `C/attendance-view.tsx:86, 93` |
| Inline rate button, "Edit rate", "Request delete" | about 26px, no `tap-44` | NO | `C/attendance-view.tsx:276`; `C/employee-rates-view.tsx:70` |
| "Request delete" trigger | about 26px, no `tap-44` | NO | `src/components/approvals/request-deletion-button.tsx:66` |
| Selfie thumbnail links | 36px image | NO | `C/review-attendance-view.tsx:654-667` |

### 7.2 ARIA

- Dialogs: `role="dialog"`, `aria-modal`, named by the title or `aria-label` (section 1.2).
- Kiosk select `aria-label="Select who is signing in"` (`C/attendance-clock.tsx:222`); the arrow circle is `aria-hidden`
  (`:337-341`); the `<video>` has no accessible name (`:255-262`).
- Search inputs carry `aria-label` (`C/attendance-records.tsx:289`; `C/review-attendance-view.tsx:296`); filter selects
  use `<Label htmlFor>` (`C/attendance-records.tsx:230-237`).
- Range chips use `aria-pressed` (`C/attendance-records.tsx:179`). Payroll tabs are Buttons with `aria-pressed`
  (`C/payroll-tabs.tsx:58, 68`). Review status tabs use `role="tablist"` / `role="tab"` with `aria-selected` but no
  `aria-controls`, no `tabpanel` and no arrow-key roving focus (`C/review-attendance-view.tsx:264-286`); the shared `Tabs`
  has the same limitation (`U/tabs.tsx:27-39`).
- Device Manage toggle `aria-expanded` (`C/device-manager.tsx:82`); the status dot is `aria-hidden` next to a text label.
- Errors use `role="alert"`, notices `role="status"`. Loading is opacity only: no `aria-busy`, and the count text is not a
  live region (`C/attendance-records.tsx:274, 333`).
- Selfie images have `alt="In selfie"` / `"Out selfie"` (`C/review-attendance-view.tsx:665`).
- The inline rate button has `aria-label="Edit salary rate for {name}"` (`C/attendance-view.tsx:275`); "Edit rate",
  "View", "Details", "Delete" and "Correct clock-out" buttons have no per-row accessible name.
- Stacked tables keep `<thead>` in the accessibility tree while visually hidden; the `::before` labels are for sighted
  users (`globals.css:326-333, 361-367`).
- Status glyphs are `aria-hidden`; the label text carries the meaning (`U/page-primitives.tsx:139-142`).
- Reduced motion is honoured globally (`globals.css:181-191`).

### 7.3 Keyboard, Escape and focus

- There are no clickable rows; every action is a real `<button>` or `<a>`.
- Focus moves to the dialog panel on open, Tab is trapped inside, and focus returns to the opener on close
  (`U/modal.tsx:79-125`).
- Escape closes every non-critical dialog through a document listener; with nested dialogs one Escape reaches all of
  them (sections 1.2 and 3.7). Critical dialogs ignore Escape.
- The duplicated filter controls while the sheet is open (section 6.2) give two elements per id, which can confuse label
  association, assistive technology and test queries.

### 7.4 iOS zoom on focus

Computed from the repository's own rule that `text-base` prevents zoom on focus (`U/input.tsx:13`): inputs built on
`Input` keep `text-base` when only their height is overridden, but the hand-rolled native selects (kiosk, filters, Rows,
frequency) and the correction reason textarea use `text-sm` (14px) (`C/attendance-clock.tsx:223`;
`C/attendance-records.tsx:48-49`; `C/review-attendance-view.tsx:787`; `C/employee-rates-view.tsx:114`), so iOS Safari may
zoom when they receive focus. NEEDS VERIFICATION on an iPhone.

### 7.5 Test ids

`{key}` = `{staffProfileId}__{workDate}` (`L/attendance-paging.ts:95-96`); `{id}` = record, member or employee id.

| Area | Test ids | Evidence |
|---|---|---|
| Attendance page | `device-blocked` | `P/attendance/page.tsx:95` |
| Device manager | `this-device-status`, `device-manage-toggle` | `C/device-manager.tsx:63, 81` |
| Kiosk | `clock-staff-select`, `clock-selfie-video`, `clock-cancel`, `clock-no-photo`, `clock-capture` | `C/attendance-clock.tsx:221, 260, 271, 281, 293` |
| Kiosk actions | `clock-out`, `clock-continue`, `clock-in`, `clock-continue-cancel`, `clock-continue-confirm` | `C/attendance-clock.tsx:314, 330, 348, 368, 378` |
| Summary | `attendance-summary`, `summary-present`, `summary-clocked-in`, `summary-completed` | `C/attendance-summary-cards.tsx:11-24` |
| History filters | `attendance-count`, `attendance-search`, `attendance-filters-button`, `attendance-range-{today, 7d, month, custom}` | `C/attendance-records.tsx:180, 274, 290, 298` |
| History filters | `attendance-from`, `attendance-to`, `attendance-staff-filter`, `attendance-status-filter` | `C/attendance-records.tsx:207, 221, 238, 258` |
| History list | `attendance-days`, `attendance-sessions-{key}`, `attendance-day-view-{key}` | `C/attendance-records.tsx:339, 364, 386` |
| History cards | `attendance-cards`, `attendance-card-{key}`, `attendance-card-view-{key}` | `C/attendance-records.tsx:399, 404, 430` |
| History paging | `attendance-page-size`, `attendance-page`, `attendance-prev`, `attendance-next` | `C/attendance-records.tsx:452, 462, 471, 481` |
| Day details | `attendance-delete-{id}`, `attendance-request-delete-{id}` (+ `-send`, `-sent`) | `C/attendance-day-details.tsx:146, 160` |
| Review filters | `review-tab-{open, completed, all}`, `review-search`, `review-filters-button`, `review-range-{k}` | `C/review-attendance-view.tsx:192, 276, 297, 305` |
| Review filters | `review-from`, `review-to`, `review-staff-filter`, `review-count` | `C/review-attendance-view.tsx:219, 233, 248, 326` |
| Review list | `review-attendance`, `review-day-view-{key}`, `review-cards`, `review-card-{key}`, `review-card-view-{key}` | `:353, 391, 404, 409, 437` |
| Review badges and paging | `review-sessions-{key}`, `review-ot-{key}`, `review-page-size`, `review-page`, `review-prev`, `review-next` | `:525, 533, 459, 469, 478, 488` |
| Review details | `review-correct-{id}`, `review-correct-time-{id}`, `review-correct-reason-{id}`, `review-delete-{id}` | `:720, 771, 786, 835` |
| Payroll | `payroll`, `payroll-tab-payroll`, `payroll-tab-rates`, `employee-rates`, `edit-rate-{id}` | `C/attendance-view.tsx:119`; tabs `:59, 69`; rates `:161, 69` |
| Payslip | `generate-payslip-{id}`, `payslip-download-pdf` | `C/payslip-button.tsx:258, 227` |
| Primitives | `modal`, `modal-overlay`, `modal-close`, `empty-state`, `read-error`, `loading-state`, `skeleton-rows` | `U/modal.tsx:178, 191, 211`; section 1.7 |

CURRENT gaps: no test id for Register, Revoke, the delete confirm input, Save correction, Save rate, Generate payslip,
Mark as Paid, Print or Print Payroll Summary.

### 7.6 UI unit tests (line anchors verified)

| Test file | Cases | Lines |
|---|---|---|
| `T/attendance-clock.test.tsx` | Clock In with no attendance today; Clock Out while open; Continue Duty behind a confirmation | `:25-65` |
| `T/attendance-overtime.test.tsx` | Review OT badge; lazy selfies in Details; member selection required; selfie step + Cancel; Clock Out step | `:67-99, 100-113, 118-128, 129-142, 143-156` |
| `T/review-attendance-records.test.tsx` | seven cases: server page, Time column + Open, session badge, tab re-query, Next, empty, thrown read error | `:62-126` |
| `T/attendance-clock-out-correct.test.tsx` | Set clock-out on an open session; Correct on a completed one; reason required; payload; hidden without manage | `:75-131` |
| `T/attendance-records.test.tsx` | server page; "Clocked in" status; no Sessions column; status re-query; debounce; Next; member filter hidden | `:84-169` |
| `T/attendance-records.test.tsx` | thrown read error | `:170-177` |
| `T/payslip-button.test.tsx` | generate form; generated document with Download PDF, Print and Mark as Paid | `:37-69` |
| `T/modal.test.tsx` | closed renders nothing; open; X, overlay, Escape; critical ignores overlay and Escape | `:18-67` |

No unit test covers the Review delete dialog, the device manager, the Payroll Summary total, the rate editors, the silent
server read paths, or nested-dialog Escape. TESTING_CHECKLIST.md section 4.4 lists the template's required UI tests.

## 8. Responsive guidance

Every width below is COMPUTED FROM CSS CLASSES (main padding `p-3` / `sm:p-5`; sidebar `w-64` / `w-16`; Card 1px border
and 20px content padding; Modal body `px-5`; payslip document `p-6`). Nothing was measured on a device, and the
repository holds no HR-specific device evidence; `docs/MOBILE-PWA.md:143-148` records that physical verification on a
notched iPhone is still outstanding. NEEDS VERIFICATION on real phones at 360, 390 and 430px and on a tablet.

### 8.1 Phones: 360px, 390px, 430px (below 640px)

Mode: bottom-sheet dialogs, card lists, stacked tables, "Filters (n)" sheets, mobile header and 64px bottom bar; the
three modules are opened from the "More" sheet. Full bottom-bar labels show from 360px (`app-sidebar.tsx:579-583`).
No HR component has a rule between 360px and 639px (no `min-[390px]` or `min-[430px]` class).

| Measure (computed) | 360px | 390px | 430px |
|---|---|---|---|
| Content width (viewport - 24px) | 336px | 366px | 406px |
| Kiosk controls (inside two nested cards) | 252px | 282px | 322px |
| Summary tile, outer / text | 107 / 81px | 117 / 91px | 130 / 104px |
| History day card (inside the records Card) | 294px | 324px | 364px |
| Review day card (no wrapping Card) | 336px | 366px | 406px |
| Payroll stacked row, label + value space | 272px | 302px | 342px |
| Employee Rates stacked row, label + value space | 312px | 342px | 382px |
| Bottom-sheet body | 318px | 348px | 388px |
| Payslip document column (two columns at every width) | 119px | 134px | 154px |

Known tight spots:

1. Payslip document at 360px: two fixed columns of about 119px; the night-shift label and money values wrap onto
   several lines (`C/payslip-button.tsx:105`).
2. Summary tiles at 360px: "Completed today" in 11px text in about 81px may wrap to two lines (`:24-33`).
3. Payroll Summary inside the sheet: the 720px-minimum table scrolls sideways at every phone width.
4. Payroll stacked cards: the Actions cell renders as a labelled row, not a full-width action row (section 4.2).
5. Kiosk: the nested inner card narrows the controls by another 42px (84px for both cards; section 2.1).
6. History pagination footer inside the records Card (294px at 360px): the Rows group, "Page X of Y" and two buttons
   need more width than available and wrap onto two lines (estimate from classes).
7. Undersized touch controls: 32 to 40px selects and inputs, the rate buttons, "Request delete" and selfie links (7.1).
8. Review day sheet at 360px: the session block leaves about 296px (318px body minus the block's 1px border and 10px
   padding per side); the time text and two 36px selfie links share one non-wrapping row (section 3.1), so
   "{in} -> still clocked in" next to both thumbnails, or next to "Loading selfies...", is close to the limit
   (`C/review-attendance-view.tsx:580, 594, 603`; estimate from classes).

### 8.2 Tablet: 640px to 1023px (for example 768px portrait)

Mode: tables and inline filters appear at 640px; dialogs become centred cards (width = size token, capped at viewport
minus 32px); the phone header and bottom bar remain until 1024px. `docs/MOBILE-PWA.md:37-39` confirms that a 1024px
landscape tablet shows the desktop sidebar. Content width = viewport - 40px.

| Table (needs) | 640px | 768px | 834px | 1023px | Fits from (computed) |
|---|---|---|---|---|---|
| Attendance history (680px inside a Card) | 558px, scrolls | 686px, fits | 752px, fits | 941px, fits | 762px |
| Review (640px inside a 1px border) | 598px, scrolls | 726px, fits | 792px, fits | 981px, fits | 682px |
| Payroll (900px inside a Card) | 558px, scrolls | 686px, scrolls | 752px, scrolls | 941px, fits | 982px |
| Employee Rates (720px inside a 1px border) | 598px, scrolls | 726px, fits | 792px, fits | 981px, fits | 762px |

The Payroll table therefore scrolls sideways on every common portrait tablet. The `lg` day modal (780px) is capped at
viewport minus 32px below 812px.

### 8.3 Desktop: 1024px and up

Mode: sidebar 256px expanded (64px collapsed), main `p-5`, no maximum content width. Content width = viewport - sidebar -
40px. At 1024px with the expanded sidebar the content is 728px, the same constraints as a 768px tablet: history, Review
and Rates fit, Payroll scrolls. The Payroll table fits without horizontal scroll from about 1238px with the expanded
sidebar and from about 1046px with the collapsed sidebar. Table headers do not stay pinned during page scroll (section
1.3). Long lists grow the page; there is no in-table scroll area.

### 8.4 Template rules derived from the above

1. Keep 640px for table-to-card and inline-filters-to-sheet, and 1024px for the sidebar.
2. Give the Payroll table a stacked or reduced-column mode up to 1024px, or a minimum width that fits a 768px tablet.
3. Make the payslip summary `grid-cols-1 sm:grid-cols-2`.
4. Put `col-actions` on every action `<td>` in stacked tables.
5. Raise touch form controls to 44px (`h-11`) and `text-base`, or give them a `tap-44` equivalent.
6. Remove the nested card around the kiosk.
7. Let summary tiles use two lines by design (fixed label height) or a 1-column layout below 360px.
8. Verify each rule on real devices (TESTING_CHECKLIST.md section 4.5).

## 9. Reusable component list (Phase 9)

### 9.1 Mapping: current component to reusable component

Generic names: AttendanceClockCard, CurrentAttendanceStatus, AttendanceSummaryCards, AttendanceHistory,
AttendanceDayCard, AttendanceDayDetailsModal, AttendanceReviewFilters, AttendanceReviewTable, ClockOutCorrectionModal,
AttendanceDeleteModal, DeviceManager, PayrollPeriodSelector, PayrollTable, PayrollEmployeeRow, PayslipModal,
PayslipDocument, PayrollSummaryDocument, EmployeeRatesTable, RateEditor. Shared primitives keep their own names.

Dependency words: "ext" = imports from outside `src/components/ui` and `src/components/hr`; "copy" = hard-coded English
strings; "accent" = accent-token classes; "cur" = currency glyph or formatter; "tz" = business-timezone helper or device
time; "brand" = brand strings (section 11); "approvals" = the approvals module.

Attendance page:

| CURRENT FILE | CURRENT PURPOSE | PROJECT-SPECIFIC DEPENDENCIES | REUSABLE VERSION |
|---|---|---|---|
| `P/attendance/page.tsx` | gate, parallel reads, banner, devices, kiosk, tiles, history | ext: authz guard, hr readers; role keys; "Owner" copy | route page (composes the rows below) |
| `P/attendance/page.tsx:91-105` (inline) | blocked-device alert | copy with `<device noun>` and "Owner" | DeviceManager (blocked banner slot) |
| `C/device-manager.tsx` | register this browser, list and revoke devices | ext: hr actions, devices type; accent banner; `en-US` date; single-device copy | DeviceManager |
| `C/attendance-clock.tsx` | member picker, state machine, camera step, no-photo fallback | ext: attachments actions, image helper; accent circle; file-name rule | AttendanceClockCard |
| `C/attendance-clock.tsx:300-334` | "Clocked in since" / "Clocked out at" lines | tz: device locale time with seconds; copy | CurrentAttendanceStatus |
| `C/attendance-summary-cards.tsx` | three team-today tiles | ext: paging type; three fixed labels | AttendanceSummaryCards |
| `C/attendance-records.tsx` (shell) | filtered, server-paged per-day history: table, cards, pagination | ext: paging action and helpers, sessions, format; tz ranges; copy | AttendanceHistory |
| `C/attendance-records.tsx:399-437` | phone card per day | copy; status words | AttendanceDayCard |
| `C/attendance-records.tsx:169-317` | search, range chips, dates, member, status; inline or sheet | accent active chips; "Done"; duplicated DOM | AttendanceReviewFilters (`statusMode` select) |
| `C/attendance-records.tsx:442-486` | Rows select, Page X of Y, Previous / Next | sizes 25/50/100 hard-coded | shared `Pagination` (extended) |
| `C/attendance-records.tsx:502-508` (`DayStatus`) | open / completed badge | the accent tone for a status; "Clocked in" | AttendanceDayCard status (StatusBadge) |
| `C/attendance-day-details.tsx:30-104` | one day's sessions, gaps and total | ext: paging and format helpers; "Continued Duty", "Off duty" copy; accent chip | AttendanceDayDetailsModal |
| `C/attendance-day-details.tsx:112-219` | type-DELETE critical delete; Admin request split | ext: hr actions, approvals button; the word DELETE; copy | AttendanceDeleteModal |
| `src/components/approvals/request-deletion-button.tsx` | ask the approver to delete, with a reason | approvals; "Owner" copy; `text-emerald-600` | AttendanceDeleteModal (request path) |

Review Attendance page:

| CURRENT FILE | CURRENT PURPOSE | PROJECT-SPECIFIC DEPENDENCIES | REUSABLE VERSION |
|---|---|---|---|
| `P/attendance/review/page.tsx` | server composition: gate, first page, roster, role-based manage flag | ext: authz guard, hr readers; role keys | route page composing the rows below |
| `C/review-attendance-view.tsx:78-506` | tabs, toolbar, count, table, cards, paging, day modal | ext: hr actions, `Money`; "Open" / "Complete"; manage default true | AttendanceReviewTable |
| `C/review-attendance-view.tsx:181-324` | search, range, dates, employee; inline or sheet; status tabs | accent tab and chip classes; "Apply filters" | AttendanceReviewFilters (`statusMode` tabs) |
| `C/review-attendance-view.tsx:404-444` | phone card per day with badges | copy | AttendanceDayCard |
| `C/review-attendance-view.tsx:509-540` (`DayStatus`, `DayBadges`) | status badge; session count and OT chips | ext: `Money` (cur); "OT" label; accent chip | AttendanceDayCard badges |
| `C/review-attendance-view.tsx:547-646` (`ReviewDayModal`) | day sessions with selfies, OT line, actions | copy; accent classes; night-flag rule | AttendanceDayDetailsModal (`size` lg) |
| `C/review-attendance-view.tsx:649-671` (`SelfieThumb`) | in / out photo thumbnail link | "In" / "Out" copy; download behaviour | AttendanceDayDetailsModal media slot |
| `C/review-attendance-view.tsx:674-799` (`ReviewRowCorrect`) | set or correct a clock-out with a reason | ext: hr actions; tz: device-local picker; minute truncation | ClockOutCorrectionModal |
| `C/review-attendance-view.tsx:807-894` (`ReviewRowDelete`) | type-DELETE critical delete, no role split | ext: hr actions; the word DELETE; copy | AttendanceDeleteModal |

Payroll page:

| CURRENT FILE | CURRENT PURPOSE | PROJECT-SPECIFIC DEPENDENCIES | REUSABLE VERSION |
|---|---|---|---|
| `P/payroll/page.tsx` | gate, default period, parallel reads, manager flag | ext: authz guard, payroll, payslip and rate readers; tz helper; role keys | route page (composes rows below) |
| `C/payroll-tabs.tsx` | Payroll / Employee Rates switch | two labels; local state | no dedicated component: shared `Tabs` with a URL parameter |
| `C/attendance-view.tsx:76-106` | From / To GET form, Apply, summary trigger | tz default period; no presets | PayrollPeriodSelector |
| `C/attendance-view.tsx:51-241` (`AttendanceView`) | payroll card, table, read error, empty state | ext: payroll types, `Money`; "/day"; frequency labels; green / amber pill | PayrollTable |
| `C/attendance-view.tsx:164-231` (row) | one row: hours, rate, frequency, salary, status, payslip | "Regular Hours" on total hours; role key label; no `col-actions` | PayrollEmployeeRow |
| `C/attendance-view.tsx:253-348` (`RateCell`) | inline salary-rate dialog | ext: hr actions; tz: device-local date; cur via MoneyInput; "per day" | RateEditor (inline trigger) |
| `C/employee-rates-view.tsx:146-222` | current rate per employee table | ext: `usePrivacyMoney` (cur); `en-US` date; "/day" | EmployeeRatesTable |
| `C/employee-rates-view.tsx:39-144` (`EditRate`) | tab salary-rate dialog | ext: hr actions, tz helper; cur via MoneyInput; frequency list | RateEditor (table trigger) |
| `C/payslip-button.tsx:151-315` (`PayslipButton`) | generate, view, print, PDF, mark paid dialog | ext: payslip actions, PDF, tz helper, `Money`; "Ask the Owner"; night-bonus note | PayslipModal |
| `C/payslip-button.tsx:64-149` (`PayslipDocument`) | printable white payslip | brand name and initials; accent hex; night-shift label with cur and amount | PayslipDocument (screen and print) |
| `C/payslip-button.tsx:26-36` (`PRINT_CSS`) | print isolation for the payslip | none (generic, duplicated) | print-isolation helper (9.3) |
| `L/payslip-pdf.ts` | jsPDF A5 payslip download | brand name, initials, accent RGB, currency code, file-name prefix, cur glyph in one label | PayslipDocument (PDF renderer) |
| `C/payroll-summary-button.tsx` | period summary dialog, print, total | ext: payroll and payslip types, `Money`; brand; `bg-amber-500`; signed-money bug | PayrollSummaryDocument (+ its dialog) |

Shared components used by these screens:

| CURRENT FILE | CURRENT PURPOSE | PROJECT-SPECIFIC DEPENDENCIES | REUSABLE VERSION |
|---|---|---|---|
| `U/modal.tsx` | dialog, bottom sheet, focus trap, critical mode | ext: PWA unsaved-changes hook (no-op without provider) | keep `Modal`; add Escape scoping |
| `U/page-primitives.tsx` | `PageHeader`, `MetricCard`, `StatusBadge`, `ReadError` | brand name in the file comment; tone named after the accent token | keep; rename the accent tone to `accent` |
| `U/button.tsx`, `U/input.tsx`, `U/label.tsx`, `U/card.tsx` | primitives with `tap-44` on Button | none | keep |
| `U/money-input.tsx` | money input with live grouping | cur prefix | `CurrencyInput` (`currencySymbol`, `decimals`) |
| `src/components/shell/privacy.tsx` (`Money`, `usePrivacyMoney`) | masked money display | cur mask and formatter; brand-prefixed storage key | masked money display (`formatter`, `mask`) |
| `U/stacked-table.ts`, `U/stacked-table-labels.tsx`, `.data-table--stack` CSS | phone cards from real tables | none | keep unchanged |
| `src/components/states/empty-state.tsx`, `loading-state.tsx` | empty and loading states | none | keep; add route skeletons |
| `U/pagination.tsx`, `U/tabs.tsx`, `U/select.tsx`, `U/skeleton.tsx` | shared primitives, unused by HR | none | adopt (section 1.9) |
| `src/components/shell/dashboard-sync.tsx` | realtime nudge to `router.refresh()` | brand-prefixed channel name | keep as host infrastructure |

### 9.2 Props interfaces (in words)

Permission booleans below are computed on the server from the capability keys in PERMISSIONS.md section 4.2 and are
never defaults that grant access; every write is re-checked on the server.

- AttendanceClockCard: `roster` (id, display name); `openSessions` (member id to clock-in time); `lastOutToday` (member
  id to last clock-out time); `onClockIn(memberId)` and `onClockOut(memberId)` returning ok with record id and message,
  or an error; `onAttachPhoto(recordId, image, kind in or out)`; `photoMode` off / optional (`attendance.selfie.mode`,
  default off; the key's `required` value is not implemented in the template and fails configuration validation,
  CONFIGURATION.md sections 2.9 and 7); `imageMaxEdge` and `imageQuality`; `allowContinueDuty`; `blocked` (disables
  every clock button and shows the banner); `formatTime`; `timeZone`; a labels bundle. Renders CurrentAttendanceStatus.
- CurrentAttendanceStatus: `state` idle / open / clocked-out-today; `since` time; `timeZone` (business timezone when
  `locale.showTimesInBusinessTimezone` is true); `formatTime` (hour and minute, no seconds); `showDateWhenNotToday`
  (default true); `longSessionHours` (optional warning threshold, CONFIGURABLE); a labels bundle.
- AttendanceSummaryCards: `items` (label, value, test id); `columns` (default 3); `readState` ok / error so a failed read
  never shows zeros.
- AttendanceHistory: `initialPage`; `loadPage(filters, page, size)` returning rows, completion rows and total, or an
  explicit error (never an empty page on failure); `roster`; `canFilterMembers`; `canDelete`, `canRequestDelete` and
  `deletion` (the same as AttendanceReviewTable); `defaultRange`; `pageSizes` and `defaultPageSize` (`review.pageSizes`,
  `review.defaultPageSize`); `statusLabels`; `timeZone`; `renderDayDetails(day)`; a labels bundle. Member names come
  from the same permission-scoped reader as AttendanceReviewTable, and the name search matches only members whose rows
  the caller may read, so it never produces a misleading empty range (section 2.6). Composes AttendanceReviewFilters, AttendanceDayCard and `Pagination`.
- AttendanceDayCard: `day` (member name, work date, session count, first in, final out, total hours, has open, night
  bonus flag and amount); `statusLabels`; `showNightBonus`; `formatMoney`; `formatTime`; `onView`; `testIdPrefix`.
- AttendanceDayDetailsModal: `day` (member name, work date, sessions with in, out, duration and continued flag, gaps,
  total); `size` md or lg; `renderSessionMedia(session)` (photo thumbnails, lazy, with an explicit error state);
  `renderSessionFlags(session)`; `renderSessionActions(session)`; `formatTime`; `formatDuration`; `onClose`; labels.
  The open day is looked up by key from the latest rows, so a refresh updates or closes it.
- AttendanceReviewFilters: `search` and `onSearch` (debounce milliseconds); `ranges` (key, label, resolver) and
  `range`; `customFrom` and `customTo`; `memberOptions` and `memberId`; `statusMode` select / tabs / none;
  `statusOptions`; `activeCount`; `sheetTitle`; `sheetDoneLabel`; `breakpoint` (default 640px). Renders its controls
  once, inline or in the sheet, never both.
- AttendanceReviewTable: `initialPage`; `loadPage`; `loadPhotos(recordIds)` returning in and out URLs with an expiry, or
  an error; `roster` from a reader that works for every reviewer; `canCorrect`; `canDelete`; `canRequestDelete`;
  `deletion` = the `attendance.deletion.*` settings (`mode`, `requireReason`, `requireTypedConfirmation`,
  `confirmationPhrase`, `requestApprovalPath`), mapped one to one onto the AttendanceDeleteModal props below; the
  Attendance history passes the same object, so both screens share one policy; `statusTabs`; labels. Names come from a permission-scoped reader, never from an RLS-blind embed. `canCorrect`,
  `canDelete` and `canRequestDelete` have no true default.
- ClockOutCorrectionModal: `session` (id, member name, time in, time out); `onSubmit(timeOut, reason)`; `timeZone`
  (business timezone for the picker and the body text); `requireReason` (`attendance.correction.requireReason`);
  `minTime` (the clock-in); `maxTime` = the earlier of now and the same member's next session clock-in (`nextTimeIn`,
  nullable), with an inline error when the value is past it, because the picker is only a convenience and the RPC
  refuses the same overlap (IMPLEMENTATION_PROMPT.md R7); one precision, the minute (the picker shows and sends hour and
  minute only); `seed` = the stored clock-out truncated to its minute for a completed session, or the clock-in rounded
  UP to the next minute for an open session; for a completed session the same minute as the stored clock-out counts as
  unchanged; Save disabled until a reason is present and, for a completed session, the chosen minute differs from the
  stored clock-out's minute (IMPLEMENTATION_PROMPT.md R7 and R8);
  `critical` true while dirty; labels.
- AttendanceDeleteModal: `entityLabel` (member name and date); `deletionMode` soft / hard (`attendance.deletion.mode`,
  default soft); `requireReason` (`attendance.deletion.requireReason`, fixed true: a reason field on EVERY path);
  `requireTypedConfirmation` and `confirmPhrase` (`attendance.deletion.requireTypedConfirmation`,
  `attendance.deletion.confirmationPhrase`, the phrase checked on the server as well); `requestApprovalPath`
  (`attendance.deletion.requestApprovalPath`, only with a host approvals module); `canDelete` and `canRequestDelete`;
  `onDelete(reason)` for direct deletion and `onRequest(reason)` for the request path, both returning ok or error;
  `approverLabel`; `testIdPrefix` (including the confirm input and the reason field). Copy follows the mode: "Delete"
  with a note that the record is hidden from every list and report for `soft`, "Delete permanently" and "This cannot be
  undone." only for `hard`. The dialog is `critical` (IMPLEMENTATION_PROMPT.md U8).
- DeviceManager: `devices` (id, label, active, created, revoked); `thisDeviceApproved`; `gatingState` on / off / error;
  `onRegister(label)`; `onRevoke(id)` behind a confirmation; `showRevoked`; `maxActiveDevices`
  (`attendance.device.maxActiveDevices`); `deviceNoun` and `defaultLabel` (`attendance.device.defaultLabel`); `locale`;
  a `blockedBanner` slot (title, body, optional action); labels.
- PayrollPeriodSelector: `period` (from, to); `presets` (`payroll.periodPresets`); `defaultPeriod`
  (`payroll.periodDefault`); `onChange` or GET parameter names; validation (from on or before to, real dates) with an
  inline error; `tabParam` so the active tab survives a period change; `actions` slot (summary trigger).
- PayrollTable: `rows`; `period`; `readState` ok / error / empty with honest wording; `columns` (labels, visibility,
  order); `rateUnitLabel` from `payroll.rateBasis`; `frequencyLabels`; `roleLabels`; `canEditRates`; `canGenerate`;
  `canMarkPaid`; `canPrintSummary`; `payStatusFor(row)` returning not generated / pending / paid / unknown (read
  failed), plus void only when the optional void path is built; `formatMoney`; `formatHours`; `stackBelow` (default
  1024px for this table). Renders PayrollEmployeeRow.
- PayrollEmployeeRow: `row` (name, role, total hours, overtime hours, days worked, night shifts, rate, frequency,
  salary); `payStatus`; `rateEditor` slot; `payslipAction` slot; the action cell always carries `col-actions`.
- PayslipModal: `employee` (id, name); `period`; `snapshot` (nullable, re-read from props on every refresh);
  `grossForPeriod` (from the payroll line, used for the deductions check); `canGenerate`; `canMarkPaid`; `canVoid`
  (holders of `payroll.payslip.generate`, only when the void path is built); `onGenerate(deductions)`;
  `onRegenerate(deductions)` for a current `pending` snapshot, only with `canGenerate`: it requests generation with
  regenerate set, which supersedes that snapshot (IMPLEMENTATION_PROMPT.md P14);
  `allowNegativeNet` (`payroll.allowNegativeNet`, default false): when false the dialog refuses deductions above gross
  with an inline message before submit and shows the server's refusal if it still arrives (PAYROLL.md section 12 item 4);
  `onMarkPaid(snapshotId, paymentDate)` behind a confirmation that names the member, the period and the net amount;
  `paidDateEditable` (`payroll.paidDateEditable`): when true the confirmation holds a paid-date input defaulting to the
  business-timezone today, otherwise no date input appears and the server stamps today's business date;
  `onVoid(snapshotId, reason)` behind a confirmation that names the member, the period and the net amount and requires
  a reason (IMPLEMENTATION_PROMPT.md P15); the void confirmation is `critical`; `onDownloadPdf(snapshot)`; `onPrint`;
  `renderDocument(snapshot)`; the footer is chosen by permission and snapshot status together (Mark as Paid and
  Regenerate only for `pending`; Void for `pending` or `paid`; none of them for `void`); every async handler has an error
  path; labels.
- PayslipDocument: `snapshot`; `branding` (company name, logo text or URL, brand colour); `rowsForBasis` (daily, hourly);
  `nightBonusLabel` derived from the configured amount; `statusLabels` (section 5.3: not generated, pending, paid,
  void); `signatureLabels`; `formatMoney`; `layout` screen / print / pdf, where pdf adds `pageSize`
  (`payroll.payslip.pageSize`), `currencyCode`, an embedded font with the currency glyph and `fileNamePattern`
  (`payroll.payslip.fileNamePattern`).
- PayrollSummaryDocument: `rows`; `payslips`; `period`; `branding`; `columns`; `totalRule` net-else-gross using signed
  money; `statusLabels`; `hoursFormat` (the same as the table); `paginate` true (static positioning and `@page`); labels.
- EmployeeRatesTable: `rows` (name, role, rate, frequency, effective date, last updated, future-dated flag); `canEdit`;
  `formatMoney`; `formatDate` (`locale.dateLocale`); `rateUnitLabel`; `renderEditor(row)`; `readState`.
- RateEditor: `employee` (id, name); `current` (rate, frequency, effective date); `frequencies`
  (`payroll.payFrequencies`); `rateUnitLabel`; `defaultEffectiveDate` (business-timezone today); `requireEffectiveDate`
  (true); `onSave(rate, frequency, effectiveDate)`; `showSuccessMessage` (true); `currencySymbol`; `critical` true while
  dirty. One component serves both the inline trigger and the table trigger, and both refresh on success.

### 9.3 Helpers that generalise cleanly

- `L/attendance-paging.ts`: quick ranges, day-page assembly, summary counts, page maths. PROJECT-SPECIFIC constants: the
  timezone and the fixed UTC offset used for day bounds (`:41-43`, values in section 11); a template computes day bounds
  from the configured timezone. `elapsedHours` (`:181-185`) has no caller today and would serve CurrentAttendanceStatus.
- `L/sessions.ts`: day grouping and totals; the once-per-day night rule mirror is PROJECT-SPECIFIC (PAYROLL.md section 4).
- `L/format.ts`: `durationHours` and `formatDuration` ("8h 30m", `:8-21`).
- Print isolation: the two `PRINT_CSS` blocks become one helper taking a target id, padding, page size and a multi-page
  flag (static positioning plus `@page` instead of `position: fixed`).

## 10. UI RECOMMENDED TEMPLATE IMPROVEMENTS

Each item names the reference-implementation defect, its evidence, and what the template does instead. None is a change to
production.

1. Silent-empty reads. The paged attendance reader returns an empty page on a count or row error; the roster, open-session,
   last-clock-out, today-summary, selfie, payslip-status, rates and gating readers also swallow errors
   (`L/attendance.ts:102, 113-121, 134-145, 533, 626, 635, 677`; `L/payslip.ts:73`; `L/rate.ts:131-144`;
   `L/devices.ts:38-42`). Template: every loader returns a typed result with an error case; screens render `ReadError`,
   as the payroll table already does (`C/attendance-view.tsx:108-112`); tests cover the server error paths.
2. Correction seed truncated to the minute: an unchanged save is refused (open session) or silently rewrites a completed
   session to the start of its minute (`C/review-attendance-view.tsx:674-679, 707, 713`; `M/20260907130000:48-50`).
   The correction also has no overlap bound, so a clock-out can run past the member's next session and its hours count
   twice (`M/20260907130000:48-53`, section 3.6). Template: ClockOutCorrectionModal seed rule, business-timezone picker,
   Save disabled until the value changes, and `maxTime` = the earlier of now and the next session's clock-in, with an
   inline error and the same check in the RPC.
3. Review AND the Attendance history are name-blind for `hr_review_attendance` holders who are not the Super Admin ("--",
   "Staff", "this staff member") because names come from an RLS-scoped embed (`L/attendance.ts:562-563`;
   `M/20260821140000:21-22`; `C/review-attendance-view.tsx:373, 413, 564, 751, 868`; `C/attendance-records.tsx:357, 408`;
   `C/attendance-day-details.tsx:45, 193`). Template: names on both screens from a permission-scoped definer reader, as
   the kiosk roster already does.
4. Delete policy differs by screen (Admin requests on Attendance, deletes on Review), the direct path takes no reason,
   and the request key is absent from the Manage Access catalogue and granted by no migration, grantable only on the
   legacy Super Admin console reachable by URL, so the request fails by default on a fresh install
   (`C/attendance-day-details.tsx:140-150`;
   `C/review-attendance-view.tsx:624-629`; `L/actions.ts:139-157`). Template: one deletion policy for both screens from
   the `attendance.deletion.*` keys (`mode` soft by default, a reason on every path, typed confirmation,
   `requestApprovalPath`); the request path ships only with a grantable permission (PERMISSIONS.md section 6).
5. Payroll Summary total ignores the sign of a negative net (`C/payroll-summary-button.tsx:31-36`). Template: signed
   money parsing, and a generation rule that forbids or flags a negative net (PAYROLL.md section 6.6 and section 12
   item 3).
6. Payslip permission mismatch: Admins see a generate form that the server refuses, and non-managers see a "Generate
   payslip" footer (`C/payslip-button.tsx:218, 240-249, 276-299`; `L/payslip-actions.ts:28`). Template: the footer and
   form are chosen by the same capability the server enforces.
7. No confirmation and no undo for Mark as Paid and device Revoke, no chosen paid date, and no deductions ceiling
   (`C/payslip-button.tsx:195-216, 234-238`; `L/payslip-actions.ts:115-116`; `C/device-manager.tsx:136-146`;
   `M/20260722210000:27-28`). Template: confirmation dialogs that name the member, the period and the net amount, or the
   device; a paid-date input when `payroll.paidDateEditable` is true; an inline refusal of deductions above gross when
   `payroll.allowNegativeNet` is false; and the decided reverse path, an optional Void action with a required reason
   behind a critical confirmation (PAYROLL.md section 12 items 4 and 6; IMPLEMENTATION_PROMPT.md P15; section 9.2
   PayslipModal).
8. One Escape closes nested dialogs together (`U/modal.tsx:138-141`). Template: an Escape scope that closes only the
   top-most dialog (verify the CURRENT behaviour in a browser first).
9. Stale state after `router.refresh()`: the open day modal keeps deleted or pre-correction sessions
   (`C/review-attendance-view.tsx:107`; `C/attendance-records.tsx:94`); the payslip dialog keeps a local snapshot that can
   disagree with its own trigger (`C/payslip-button.tsx:166, 260`); the kiosk shows the previous button until the refresh
   arrives. Template: derive open items from refreshed props by key, re-read snapshots from props, and disable the
   kiosk buttons until the refresh lands.
10. Several vocabularies for the same state and a hard-coded paid pill (section 5.2). Template: the label set in section
    5.3 and a pay-status badge built on `StatusBadge`.
11. Misleading payroll labels: "Regular Hours" shows total hours (`C/attendance-view.tsx:140-142, 175-177`); the Role
    column shows role keys; the summary shows decimal hours while the table shows "8h 30m"; the empty state says "No
    attendance in this range" although rows come from profiles. Template: "Total hours", configured role labels, one hours
    format, and an empty message that names what is missing.
12. Mixed time sources: kiosk times and correction picker in device timezone; every table and day-details time through
    `clockTime()`, which has no `timeZone` option (history table and cards, Review table and cards, both day modals);
    inline rate date device-local; tab rate date business timezone (`C/attendance-clock.tsx:305`;
    `C/review-attendance-view.tsx:674-679`; `L/attendance-paging.ts:176-179`; `C/attendance-records.tsx:371, 417`;
    `C/review-attendance-view.tsx:378, 421, 596`; `C/attendance-day-details.tsx:76`; `C/attendance-view.tsx:44-50`;
    `C/employee-rates-view.tsx:43`). Template: every displayed and entered time, including tables and dialogs, uses the
    business timezone (`locale.showTimesInBusinessTimezone`).
13. Kiosk status line shows seconds and no date (`C/attendance-clock.tsx:305, 322`). Template: CurrentAttendanceStatus.
14. Two night rules on one screen set: the OT badge (clock-in rule) can disagree with pay (clock-out rule)
    (`M/20260722200000:34-37`; `M/20260907160000:41, 55`). Template: one configured rule, one "Night bonus" label and one
    amount source for every string that mentions it.
15. Hand-rolled pagination, tabs, selects and filter toolbars duplicated across screens, a filter DOM rendered twice, and an
    "Apply filters" button that only closes (sections 1.9, 6.2, 6.3). Template: shared primitives and one
    AttendanceReviewFilters.
16. The count text counts sessions while the list shows days (`C/attendance-records.tsx:274-278`). Template: page and
    count by day, or label the unit honestly.
17. Selfies: signed URLs expire after 300 seconds while the modal stays open (`L/attendance.ts:546`), so after that the
    thumbnail link (view or download) returns an expired-URL error and any re-render that changes an image `src` fails to
    load, although an already loaded thumbnail stays visible; in and out are told apart by a file-name substring (`:553`);
    load failures look like "no photo". Template: re-sign on demand (`retention.signedUrlTtlSeconds`), an explicit photo
    kind, and an error state.
18. Kiosk status is RLS-blind for operators without hr_review_attendance, so they cannot clock other members out
    (`L/attendance.ts:111-146`). Template: a permission-scoped status reader for kiosk operators.
19. The kiosk roster lists demo accounts that clock-in then refuses (`M/20260907160000:20-25`; `M/20260907120000:35-37`).
    Template: the roster applies the same exclusions as the clock-in check.
20. The blocked-device banner does not disable the clock controls, and a failed gating read hides it (`P/attendance/page.tsx:91-105`;
    `L/devices.ts:38-42`). Template: disable the buttons while blocked; gating mode and fail mode are explicit settings
    (`attendance.device.mode`, `attendance.device.failMode`).
21. Print: `position: fixed` containers, no `@page`, a currency glyph in a PDF label, "Pending" versus "Unpaid", and a
    dark header band on the white summary in dark theme (section 6.4; section 4.6). Template: print-isolation helper with
    static positioning and `@page`, an embedded font, one label set, and print-scoped table styles.
22. Responsive gaps: Payroll table 900px minimum scrolls on portrait tablets; payslip columns fixed at two; summary tiles
    wrap at 360px; Payroll actions cell lacks `col-actions`; 32 to 40px form controls; nested kiosk cards (section 8).
    Template: the rules in section 8.4.
23. Two rate editors with different default dates, `required` flags and refresh behaviour, neither showing the server's
    success message (`C/attendance-view.tsx:44-50, 259-266, 330-337`; `C/employee-rates-view.tsx:43, 49-56, 125-132`;
    `L/rate.ts:239-242`). Template: one RateEditor.
24. Rate-edit authority in the UI (Rates tab for Admins, inline for Super Admins) matches no known server rule, and the
    action has no TypeScript check (`L/rate.ts:201-231`). Template: one `canEditRates` capability for both triggers, the
    action and the RPC.
25. Typed forms are not protected: the correction, rate and payslip dialogs are not `critical`, so Escape or an overlay
    tap discards input, and a user-tapped PWA "Update now" reloads without the unsaved-work warning that a `critical`
    dialog would raise (`U/modal.tsx:127-131`; `docs/MOBILE-PWA.md:72-78`). Template: dialogs with typed input become
    `critical` while dirty.
26. `canManage` defaults to TRUE on the Review workspace (`C/review-attendance-view.tsx:81`). Template: permission props
    have no granting default.
27. Mark as Paid has no `catch` (`C/payslip-button.tsx:195-216`). Template: every async handler reports failure.
28. Period form: no presets, no validation, tab lost on Apply (`C/attendance-view.tsx:76-97`; `C/payroll-tabs.tsx:36`).
    Template: PayrollPeriodSelector with validation and a tab URL parameter.
29. Missing test ids (section 7.5) and missing UI tests (section 7.6). Template: add both (TESTING_CHECKLIST.md 4.4).
30. Hard-coded palette leaks: `text-emerald-600`, `bg-amber-500`, green and amber pill classes, the accent hex on printed
    documents, and the accent tone used as a status (sections 1.4, 5.1). Template: status tokens on screen and a separate
    print palette from `branding.brandColor`.
31. Stale comments the template must not inherit: kiosk described as self-service (`P/attendance/page.tsx:34-35`); "empty
    clears the rate" (`C/attendance-view.tsx:247-252`); Review described as the place for review or approval although no
    approval exists (`C/attendance-day-details.tsx:27-28`); stale Review "owner-only" notes
    (`src/components/shell/navigation.ts:64-72`; `docs/FINAL-UI-SOURCE-OF-TRUTH.md:192-194`).
32. Success detected by message text: the dialog effects compare `state.success` with the previous string, and the
    server returns fixed strings (`L/actions.ts:117, 182`; `L/rate.ts:239-242`), so a second identical success on the
    same mounted dialog neither closes it nor refreshes and shows no message (`C/review-attendance-view.tsx:697-704`;
    `C/device-manager.tsx:47-53`; `C/attendance-view.tsx:259-266`; `C/employee-rates-view.tsx:49-56`; section 1.10;
    computed from code, NEEDS VERIFICATION). Template: detect success with a per-submission token or the identity of the
    returned state object, never with message text, and always refresh (and show the message) on every success.

## 11. PROJECT-SPECIFIC values removed from the template

This list is the only place in this document where the source business's brand strings, currency and timezone appear.
Each value becomes a client setting (key names from CONFIGURATION.md section 2) or is deleted.

| Value in the reference implementation | Where | Template setting |
|---|---|---|
| Brand name "A.V. Jewelry" on the payslip, PDF and summary | `C/payslip-button.tsx:82`; `L/payslip-pdf.ts:69`; `C/payroll-summary-button.tsx:93` | `branding.companyName` |
| Brand name "A.V. Jewelry" in the mobile header and the primitives file comment | `src/components/shell/app-sidebar.tsx:507`; `U/page-primitives.tsx` header comment | `branding.companyName` |
| Logo initials "AV" (payslip, PDF) and "A.V" (summary) | `C/payslip-button.tsx:79`; `L/payslip-pdf.ts:65`; `C/payroll-summary-button.tsx:90` | `branding.logoText` or `branding.logoUrl` |
| PDF file-name prefix "AV-Jewelry-Payslip-" | `L/payslip-pdf.ts:44-48` | `branding.documentFilePrefix`, `payroll.payslip.fileNamePattern` |
| Printed accent "Soft Gold": `#b28b3f` (`SOFT_GOLD`), RGB 178, 139, 63; summary `bg-amber-500` | `C/payslip-button.tsx:38-40`; `L/payslip-pdf.ts:17`; summary `:89` | `branding.brandColor` |
| Accent token names `--gold` / `--gold-strong` (holding an emerald green) and classes `bg-gold`, `text-gold-strong` | `src/app/globals.css:108-109`; every HR component | rename to an accent token |
| App name "MineFlow" in the table CSS comment and the realtime channel `mineflow-live-sync` | `globals.css:205`; `src/components/shell/dashboard-sync.tsx:154` | host naming |
| Currency: peso sign in `formatPeso`, the `Money` mask and the `MoneyInput` prefix | `src/lib/payments/format.ts:51-56`; `privacy.tsx:34`; `U/money-input.tsx:130` | `locale.currencySymbol` |
| Peso sign (U+20B1) in copy: "Overtime -- {sign}{amount}", "Night shifts ({sign}300 each)" | `L/attendance.ts:201`; `C/payslip-button.tsx:113, 290`; `L/payslip-pdf.ts:106` | derived labels |
| Currency code "PHP" in PDF amounts; `.00` hidden on screen | `L/payslip-pdf.ts:21-31`; `src/lib/payments/format.ts:51-56` | `locale.currencyCode`, `locale.moneyDisplay.*` |
| Timezone `Asia/Manila` and fixed offset `+08:00` | `L/attendance-paging.ts:41-43`; `L/attendance.ts:133` | `locale.timezone` |
| `manilaToday()`, `manilaMonthStart()` (`src/lib/format/manila-date.ts`) | `P/payroll/page.tsx:33-34`; `C/employee-rates-view.tsx:43`; `C/payslip-button.tsx:210` | business-date helper |
| Timezone in SQL and in a migration basename: `20260907120000_kiosk_clock_in_manila_work_date.sql` | `M/20260722200000:34`; `M/20260907160000:41` | `locale.timezone` (SQL reader) |
| Night bonus: flat 300, at or after 10 PM / 22:00, clock-in anchored flag versus clock-out anchored pay | section 0.2 fact 3 | `payroll.nightRule.*` |
| Wording "per day", "/day"; frequencies Weekly / Bi-Weekly / Monthly | `C/attendance-view.tsx:38-42, 193, 301`; `C/employee-rates-view.tsx:33-37, 96, 198` | `payroll.rateBasis`, `.payFrequencies` |
| Device noun "shop phone" (for example "Approved shop phone") | `C/device-manager.tsx:73, 161, 186`; `P/attendance/page.tsx:101`; `L/attendance.ts:46` | `attendance.device.defaultLabel` |
| Device cookie name `av_att_device` | `L/devices.ts:27` | `branding.cookieNamePrefix` |
| Privacy Mode storage key `av-privacy-mode` | `src/components/shell/privacy.tsx:33` | `branding.cookieNamePrefix` |
| "Owner" in copy ("Ask the Owner", "the Owner sees all") | `C/payslip-button.tsx:296-297`; `P/attendance/page.tsx:88`; request button `:111` | role labels (PERMISSIONS.md section 7) |
| Super Admins excluded from roster, payroll and rates | `M/20260907160000:24, 99`; `L/rate.ts:137` | `exclusions.excludedRoles` |
| Approvals module behind "Request delete" | `src/components/approvals/request-deletion-button.tsx` | optional `attendance.deletion.requestApprovalPath` |
| `en-US` date formatting (device list, Employee Rates, work dates) | `C/device-manager.tsx:129`; `C/employee-rates-view.tsx:30`; `L/attendance-paging.ts:169` | `locale.dateLocale` |
| Navigation group, icons and bottom-bar layout locked by UI tests | `src/components/shell/navigation.ts:174-197`; `tests/unit/ui-lock.test.tsx` | host navigation config |
| PWA update-guard coupling inside `Modal` | `U/modal.tsx:6, 131`; `docs/MOBILE-PWA.md` | keep as a no-op provider or drop |

## 12. NEEDS VERIFICATION (UI items)

1. Browser: after a correction or delete, the Review table row updates without a filter change while the open details
   modal keeps the old times (sections 1.10, 3.11); after a clock action the history list reloads (section 2.10).
2. Browser: one Escape closes both nested dialogs (section 3.7).
3. Browser: the payslip dialog shows the generate form while its trigger says "View payslip" after another user's
   generation (section 4.4).
4. Browser, dark theme: the Payroll Summary sheet shows a dark header band on screen (section 4.6).
5. DevTools: the unlayered `.data-table` rules override the HR tables' Tailwind cell utilities (section 1.3).
6. Print preview: paper size, and whether a Payroll Summary longer than one page is clipped (section 6.4).
7. Generated PDF: rendering of the currency glyph in the night-shift label (section 6.4).
8. iPhone: zoom on focus for 14px selects and the reason textarea; safe-area behaviour of bottom sheets; the camera
   permission flow in an installed PWA (sections 7.4, 1.11).
9. Physical phones at 360, 390 and 430px and a portrait tablet: summary tile wrapping, payslip column wrapping, pagination
   footer wrapping, Payroll table scroll (section 8).
10. Production catalogue: a second SELECT policy on `staff_profiles` (section 3.8; query V7); the live snapshot UPDATE
    policy, which decides whether an Admin's Mark as Paid succeeds (section 4.4; query V5); the live rate RPC and its gate
    on the RECONSTRUCTED `staff_salary_rates` (section 4.7; queries V1 and V2); realtime publication membership (section
    1.10; query V12). The queries are in DATABASE.md section 8.
11. PENDING (not live) UI effects: migration 20260916120000 makes `kiosk_clock_in` refuse a missing, unregistered or
    revoked device while any device is active, raising "This device is not an approved time clock.", which would reach
    the kiosk error line through the message passthrough (`L/attendance.ts:170-176`); in normal use the TypeScript gate
    refuses first with its own message. The same migration sets a business-timezone default for `work_date`. Migrations
    20260916130000 and 20260917120000 contain no attendance or payroll change.
12. Browser: a second identical success on the same mounted dialog (correct the same session twice with the day modal
    open; register a device twice without a reload; save the same rate twice) leaves the dialog open with no message
    (sections 1.10 and 10 item 32).
13. Browser: after 300 seconds with the Review day modal open, a thumbnail link returns an expired-URL error while the
    already loaded image stays visible (section 3.5).
14. Browser, device set to a timezone other than the business timezone: table and day-details times shift while work
    dates do not (section 2.4).
