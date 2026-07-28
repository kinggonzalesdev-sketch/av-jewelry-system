# FINAL UI — SOURCE OF TRUTH (LOCKED)

**Status:** Owner-approved and **LOCKED**. **Locked at commit:** see `git log` for
the "Lock the approved production UI" commit on `production-ui-integration`.

This document is the authority for the approved production UI. **No UI element in
it may be removed, reordered, renamed, nested, redesigned, or replaced without an
explicit Owner request.** From this point the work is core functionality,
testing, deployment prep, and documentation — not UI redesign.

The lock is enforced in code by `tests/unit/ui-lock.test.tsx` (plus
`tests/unit/app-shell.test.tsx` and `tests/integration/production-ui-identity.test.ts`).
If a change trips those tests, the change is wrong — not the test — unless this
document is updated first by Owner decision.

---

## 1. Shell (single source of truth: `src/components/shell/navigation.ts`)

### Desktop sidebar order (verbatim, top → bottom)

| #   | Label              | Route                 | Icon |
| --- | ------------------ | --------------------- | ---- |
| 1   | Dashboard Profile  | `/dashboard`          | ▥    |
| 2   | Orders             | `/orders`             | □    |
| 3   | Invoice            | `/orders/invoice`     | ▤    |
| 4   | Live               | `/live`               | ◉    |
| 5   | Customers          | `/customers`          | ☺    |
| 6   | Items / Inventory  | `/orders/inventory`   | ◈    |
| 7   | Payments & Layaway | `/orders/payments`    | ₱    |
| 8   | Fulfillment        | `/orders/fulfillment` | ➤    |
| 9   | Reports            | `/reports`            | ▦    |
| 10  | Settings           | `/settings`           | ⚙    |

### Mobile navigation

- **Bottom bar (four primary + More):** Orders · Invoice · Live · Customers · **More**
- **Under More (Dashboard Profile first):** Dashboard Profile · Items / Inventory ·
  Payments & Layaway · Fulfillment · Reports · Settings — plus the theme toggle,
  Logout, and the footer.

### Placements that are LOCKED

- **Capture is not a nav item.** It is an action **inside Orders** — the green
  "＋ New Order" button opens the New Order form, wired to the real,
  permission-guarded capture flow (creates a Pending Claim only). The earlier
  separate "New Entry → `/live`" header link and the Invoice / Confirm / Layaway
  shortcut buttons were **removed by Owner request (2026-07-18)** as duplicates of
  the sidebar navigation. New Order is the single capture entry.
- **Fulfillment** is a **standalone** item at position 8 (route `/orders/fulfillment`).
- **Invoice**, **Payments & Layaway**, **Items / Inventory** live under the
  `/orders/*` group but appear as their own sidebar items (prototype-verbatim).
- **Staff** and **Capabilities** are **not** nav items — they are functional
  routes surfaced under **Settings → Administration**.

## 2. Global controls (LOCKED locations)

- **Desktop sidebar footer, in this order:** branding → **Light/Dark toggle** →
  **Bluetooth / Printer status** → **Logout** (Logout last, directly under the printer).
- **Profile / user area:** real authenticated identity (name + role) in the
  sidebar user card; email is discoverable (sr-only) for support.
- **Mobile:** printer status badge + theme toggle in the top header; theme
  toggle + Logout + footer in the More menu.
- **Footer wording (exact):** `Powered by King GenZ Digital`.

### Control behaviour (LOCKED, must stay honest)

- **Light/Dark** is a manual `data-theme` override on `<html>` that beats the OS
  preference and **persists across refresh** (applied pre-paint by the root
  layout script). Default = OS preference when unset.
- **Bluetooth / Printer** shows an honest state only: `Browser Preview Available`,
  `Bluetooth Unsupported`, `Bluetooth Not Connected`, `Bluetooth Validation Required`,
  or `Printer Ready` — and **`Printer Ready` only after a real-device validation**.
  It never shows a false connected/ready state.
- **Logout** runs the real `signOut` server action.

## 3. Branding (LOCKED palette)

**Emerald green** theme (2026-07-16 Owner decision, superseding the earlier
beige/black/gold): green CTAs and accents, a very pale green canvas, white cards,
with red reserved for destructive actions. Tokens live in `src/app/globals.css`.

The accent tokens are still **named** `--gold` / `--gold-strong` (renaming them
across the codebase would be large, risky churn) but they now **hold green** —
read `bg-gold` / `text-gold-strong` as "the brand accent," which is green. Dark
mode is token-driven; the manual toggle is honest. Components must use the brand
TOKENS, never a hardcoded palette.

## 4. Approved page structure

> **Owner decision 2026-07-16 — production adopts the prototype's full layout.**
> Earlier, production ran simpler real-data screens and the `/preview` prototype
> was excluded (old §4/§5). The Owner has reversed this: **the production
> Dashboard Profile, Orders, and New Order screens now match the `/preview`
> prototype's full structure, backed by REAL data** (never sample arrays), plus a
> newly-approved **Layaway** workflow. The prototype in `src/components/preview/*`
> is the VISUAL reference; production is the real implementation.

- **Dashboard Profile** — matches the prototype's Dashboard Report: two internal
  tabs (**Dashboard**, **Gross Profit** — there is deliberately no third tab), a
  **date-range selector** with the current selected range shown, **Refresh**, and
  **Export Reports** (export gated by `export_data_reports`); **metric cards**, an
  **Order Status chart**, and a **Sales for the Period chart**, plus the
  operational and Layaway summary rows. All figures are real aggregation. **At
  zero data the charts stay VISIBLE** — container, title, and axis labels remain,
  with **"No data for this period"** inside the plot area (₱0.00 / 0 in cards).
  A failed query still shows an explicit error, never a fake zero.
  - **Second charts row** (added 2026-07-21): **Sales Snapshot** (money bar chart —
    Total Sales / Verified Collected / Outstanding / This Month) and **Work Queues**
    (count bar chart — For Invoice / Pending Verification / Active Layaway / For
    Fulfillment / Pending Claims). Real data; money bars scale by a width-only
    weight while each figure shows the authoritative peso string.
  - **Gross Profit tab** was **removed** 2026-07-21 (Owner request). It had been an
    honest-unavailable placeholder (no cost/COGS rules); rather than keep an empty
    tab, the Owner asked for more charts instead. Disassembly Report stays.
- **Orders** — the **New Order** action (the Invoice / Confirm / Layaway shortcut
  buttons and the "New Entry" header link were removed 2026-07-18 as duplicates of
  the sidebar nav), the approved **status cards**, search +
  **Order Date** / **Ship Date** / **Hide Keep** filters, the full table (row
  selection, status, shop, order, customer, qty, amount, actions), pagination, and
  status-specific row actions. Cards/filters use REAL order data; cards with no
  real backing (e.g. Keep) show an honest 0, never fabricated counts.
- **New Order Entry** — the approved form (Shop, Salesperson, Customer search,
  Item search, Unit Price, Qty, **Photo Attachment** with camera / file / retake /
  preview, **Reprint Last**, and a dynamic Confirm) wired to the REAL customer,
  inventory, claim/order, attachment, invoice, and approval workflows.
- **Layaway** — reachable from the Orders workflow control and from **New Layaway
  Entry** in Payments & Layaway; both use the SAME Official Order + Layaway
  records (no duplicates), reflected across Orders, Payments & Layaway, customer
  history, reports, balances, installment schedule, and forfeiture status.
- Every primary nav item is a **real route** — there are no placeholder pages in
  the primary navigation.

## 5. Honest placeholders / not-yet-operational (INTENTIONALLY retained)

These stay in place, honest, and clearly labelled — never faked into "complete":

- **Bluetooth/printer hardware (XP-236B)** — gated OFF; the status control tells
  the truth and never claims "Printer Ready" without a real-device validation
  recorded at Capabilities. (Bible §27.18)
- **Pancake / Facebook integration** — Live shows an honest "Not Connected" /
  display-only state; no live connection exists. (Bible §14.28)
- **Payment-correction _initiation_ UI** — the correction RULES are enforced in
  the database (unverified corrections by authorized staff; verified corrections
  require Owner approval; balances exclude `correction_pending`), but a
  staff-facing screen to _start_ a correction is **not built**. Financial-policy
  sensitive; not to be added speculatively. (Bible §4, Phase 6 UI deferral)
- **Sales-over-time trend chart** — deferred; needs a new read-only aggregation
  RPC (`report_sales_series`) validated by a real-Staff-JWT pgTAP test.
- **`/preview`** — the Owner-approved prototype; **guarded to 404 in production**,
  sample data only. It is the **visual reference** for the production screens (§4),
  which are the real implementation; the prototype route itself is not shipped.
- **Gross Profit** — the Dashboard's Gross Profit tab was **removed** 2026-07-21
  (Owner request); it had been an honest "unavailable" placeholder (no cost/COGS
  rules). See the Change log.

None of these interfere with the core workflow below.

## 6. Core functional workflow (the happy path — complete)

Live / New Entry → Pending Claim → Confirm Claim & Print → Invoice Draft →
Review → Approve & Send → **Official Order** → Record Payment → Verify Payment →
(Outstanding Balance updates) → Prepare Fulfillment → **Audit Trail**.

Every step is real and server-authorized; the exception path "Correct Outstanding
Balance" is enforced at the database level but its initiation UI is a known
limitation (§5).

---

**Change control:** to change anything above, the Owner requests it explicitly,
this document is updated, then the locking tests are updated to match — in that
order.

### Change log

- **2026-07-22 — Sidebar restructure: collapsible Team Management + Settings moved
  to the footer (Owner request).** Main nav order is now Dashboard Profile · Orders ·
  Customers · Items / Inventory · Payments & Layaway · Fulfillment · **Scrap**, then
  a clickable **collapsible Team Management** parent (chevron ▸/▾; click only
  expands/collapses, never navigates; auto-expands when inside Attendance / Review
  Attendance / Payroll; submenu indented; active submenu highlighted). **Settings**
  moved out of the scrolling nav into the **fixed footer** (subtle divider above it,
  above Logout) — both stay visible while the nav scrolls; `SETTINGS_ITEM` +
  `navRows()` + `canSeeNavItem()` keep the config reusable (not hardcoded markup).
  Review Attendance is **Owner-only** in the nav (`ownerOnly`) because only the
  Owner's RLS returns all records; broadening to Selected Admin needs an RLS change
  first (follow-up). Mobile More is role-filtered and gains Settings. Not done
  (would be a redesign, out of "smallest safe change"): a desktop icons-only
  collapse mode with floating submenus, and a mobile drawer (mobile stays the
  existing bottom-nav + More). Lock tests (`ui-lock`, `app-shell`) updated.
- **2026-07-22 — Team Management sidebar group; Attendance/Payroll split (Owner
  request, Phase 1 of the connected attendance+payroll workflow).** The old single
  "Attendance & Payroll" item became a **Team Management** group heading over three
  items: **Attendance** (`/admin/attendance`, route preserved — clock in/out + own
  records), **Review Attendance** (`/admin/attendance/review`, NEW, Owner-only —
  read-only all-records view with employee/date/status filters), and **Payroll**
  (`/admin/payroll`, NEW — the derived payroll table + Owner rate editor, split out
  unchanged). Reuse: `AttendanceView` gained `showClock/showPayroll/showRecords`
  toggles so the three pages share it; `report_payroll`/`getPayroll`, `listAttendance`,
  clock in/out, RLS, and the rate editor are unchanged. `NavItem` gained an optional
  `section` for group headings. **Deferred to Phase 2** (security-sensitive, not yet
  built): camera-only selfie gate before clock in/out, admin device registration +
  secure device token, `attendance_records` columns (device/photos/edited_by/reason/
  status), Late/Undertime/Overtime, admin corrections + audit, and payroll from
  APPROVED attendance only. Lock tests (`ui-lock`, `app-shell`) updated.
- **2026-07-22 — Invoice folded into Orders → For Invoice (Owner request).**
  Removed **Invoice** as a standalone sidebar item; the Invoice workspace now
  renders INSIDE the Orders page under the **For Invoice** card (bulk _Prepare All
  Eligible_ / _Approve & Send All Ready_, per-draft _Review_ / _Approve & Send_,
  and the message _Copy / Mark as Sent / Retry_ controls — the same
  `InvoiceWorkspace` component and the same `lib/invoicing/*` actions, reused
  unchanged). Invoice numbers in the Orders table are clickable → open the For
  Invoice view. New sidebar order: Dashboard Profile · Orders · Customers · Items /
  Inventory · Payments & Layaway · Fulfillment · Attendance & Payroll · Scrap ·
  Settings (9 items); mobile primary is now Orders · Customers. The
  `/orders/invoice` route STILL EXISTS and **redirects** to `/orders?view=invoice`
  (old links never 404). No invoice logic, data, DB functions, permissions, audit,
  or status transitions were changed. Not yet built (follow-ups): in-place edit of
  customer/order info and a printable invoice. Lock tests (`ui-lock`, `app-shell`)
  and the phase-5 invoice-route test updated.
- **2026-07-22 — Settings: removed the Profile card, added the Team Members portal
  (Owner request + Owner decision).** Deleted the read-only Profile card. Added
  **Portal & Access → Team Members** (Owner-only): roster with sign-in email +
  temp-password status, **Add member** (auto-generated one-time temp password,
  shown once), and **Set/Reset password**. Added **Change my password** for any
  signed-in member (clears the temp flag). **Security (deliberate ADR §11
  override):** account create/reset run through the service-role admin client
  (`lib/authz/team-accounts.ts`), which BYPASSES RLS — so every op re-checks
  `requireOwner()` first; the module is `server-only`; the profile row is still
  inserted via the Owner's RLS-checked client; the member's own change-password
  path uses no service-role. New column `staff_profiles.password_is_temp` +
  self-scoped `clear_my_temp_password_flag()` (migration `20260722100000`, applied
  to the remote via MCP). The `server-only-boundary` lock test now permits exactly
  one admin-client caller (team-accounts). Skipped the "Clients" read-only portal
  tab (separate concept, not built). Needs `SUPABASE_SERVICE_ROLE_KEY` set on the
  deployment (it is).
- **2026-07-22 — Removed Reports from the sidebar (Owner request).** New order:
  Dashboard Profile · Orders · Invoice · Customers · Items / Inventory · Payments &
  Layaway · Fulfillment · Attendance & Payroll · Scrap · Settings (10 items). The
  `/reports` route and `ReportsView` still exist (reachable by URL; the Dashboard's
  Reports tab is unchanged) — only the sidebar entry was removed. Lock tests
  (`ui-lock`, `app-shell`) updated.
- **2026-07-22 — Sidebar nav + Settings reshaped (Owner request).** Sidebar: removed
  **Live**; added **Attendance & Payroll** (`/admin/attendance`) and **Scrap**
  (`/admin/scrap`, renamed from "Scrap Income") before Settings. New order:
  Dashboard Profile · Orders · Invoice · Customers · Items / Inventory · Payments &
  Layaway · Fulfillment · Reports · Attendance & Payroll · Scrap · Settings (11
  items). Mobile primary is now Orders · Invoice · Customers (Live removed). The
  `/live` route still EXISTS (reachable by URL; Live capture is unchanged) — only
  its sidebar entry was removed. **Settings** now keeps only **Integration
  (Pancake)** under Administration — removed Staff Management, Capabilities,
  Attendance & Payroll (moved to sidebar), Scrap Income (moved to sidebar),
  Security, and Audit trail links; and removed the whole **Device & display**
  section (the printer control lives only in the sidebar now, and the theme toggle
  only at the lower-left sidebar control). The admin ROUTES (staff, capabilities,
  security, audit) still exist and re-check permission server-side. Lock tests
  (`ui-lock`, `app-shell`, `production-ui-identity`) updated to the new nav +
  Settings.
- **2026-07-21 — ONE shared Bluetooth printer connection (connect once, print
  many).** Owner request + Owner decision. The XP-236B is now connected in a
  single place — the sidebar **Bluetooth / Printer** control — and the connection
  is held in a shared `PrinterProvider` context (wrapped around the shell), so the
  New Order slip and any future print reuse it (the modal's own Connect UI was
  removed; it now shows status only). The sidebar control (Connect / device name /
  Test print / format / channel / details) uses the context. **Honesty rule
  updated (Owner-approved):** now that real Bluetooth printing works, the control
  shows the ACTUAL connection — it says "connected" only when there is a real GATT
  connection you can Test-print to, and "unavailable" where Web Bluetooth is absent
  (iOS / non-HTTPS). `printer.ts`/`derivePrinterState` (the /admin/capabilities
  gate) is unchanged. Also fixed a print bug: `asciify` must keep CR/LF (stripping
  them collapsed the TSPL label to one line) and folds the em dash (—) so a real
  slip prints like the ASCII test did.
- **2026-07-21 — New Order: Web Bluetooth direct printing to the XP-236B.** Owner
  request (they now have the physical printer). A "Connect printer" control in the
  New Order modal opens the browser Bluetooth chooser, connects the printer's GATT
  server, and finds a writable characteristic (tries well-known BLE serial/printer
  services, then scans). On Confirm, the slip is encoded (`receipt-encoders.ts`:
  TSPL for the 40×30 label — default — or ESC/POS, operator-selectable) and written
  in BLE chunks (`bluetooth-printer.ts`); **a failed write falls back to the browser
  print dialog** so the slip always comes out. Honest: only shows "connected" after a
  real GATT connection, and states plainly that Web Bluetooth reaches **BLE** printers
  only (Classic-SPP printers can't be reached by any browser). Needs real-device
  testing; the printer language/UUIDs may need tuning. Encoders unit-tested
  (`receipt-encoders`). The gated `printer_xp236b_bluetooth` capability + honest
  "Reprint Last" are unchanged.
- **2026-07-21 — New Order form: pick-OR-type customer & item, print on confirm.**
  Owner request. Customer and Item are now datalist comboboxes: choose an existing
  record from the suggestions, OR type a new name. A typed customer becomes a real
  customer (`createCustomer`, gated by `claim_capture` + `customers_insert` RLS); a
  typed item becomes a real available inventory item (`createPostLiveItem`, gated by
  its own item-entry permission). Then the same Pending-Claim-only capture runs
  (`captureManualOrder` → `captureClaim`) — no reservation, no order. For a NEW item
  the operator may set its **unit price** (editable field, kept a string not a float,
  via `createManualItem`); an EXISTING item's price stays read-only (a per-order
  override needs an Owner-approved price override). On a successful
  Confirm, the browser's **own print dialog** opens with an order slip of the entered
  details (honest manual-fallback print — the gated XP-236B thermal integration is
  untouched; "Reprint Last" stays honestly gated). A newly-typed item has no
  catalogue price (applied at invoicing) and its photo is added later from the item.
  Files: `lib/customers/create.ts`, `lib/orders/manual-order.ts`, `lib/orders/actions.ts`,
  `lib/print/order-receipt.ts`, `components/orders/new-order-workflow.tsx`. Lock tests
  (`ui-lock`, `production-ui-identity`) + `new-order-workflow` updated.
- **2026-07-21 — Dashboard: removed the Gross Profit tab, added two bar charts.**
  Owner request. The Gross Profit tab was an honest-unavailable placeholder (no
  cost/COGS rules); rather than keep an empty tab, it was removed and the Dashboard
  gained a second charts row: **Sales Snapshot** (Total Sales / Verified Collected /
  Outstanding / This Month, money bars) and **Work Queues** (For Invoice / Pending
  Verification / Active Layaway / For Fulfillment / Pending Claims, count bars).
  Both reuse the honest `BarChart` (visible at zero, never invented). Money bars
  scale by a width-only weight; every peso value shown is the authoritative string.
  Disassembly Report tab stays. Lock test `dashboard-view` updated (tabs list no
  longer includes gross-profit; new charts asserted). `/preview` prototype unchanged.
- **2026-07-21 — #3 deeper: rider-vs-LBC collection split + collected-vs-remitted
  - printable waybill.** Migration `20260721110000` adds `collection_channel`
    (rider/lbc), `collected_at/by`, `collected_amount` (numeric→string), and
    `remitted_at/by` to `fulfillment_records`, with CHECK constraints (collection
    only on COD, a collection carries who+amount+channel, remittance never before
    collection). `report_money_in_transit` keeps `in_transit_to_collect` (now
    "still to collect" = not-yet-collected) and adds `rider_to_collect`,
    `lbc_to_collect`, `collected_unremitted` — all still strings, all summed in SQL.
    Fulfillment queue gains per-order controls (set channel, record collection with
    the real amount, record remittance) and a **Waybill** link →
    `/orders/fulfillment/[id]/waybill` (printable via the browser's own dialog;
    honest COD box — never a false zero). Dashboard Money-in-Transit shows the new
    buckets. Writes are `fulfillment_release`-gated and DB-enforced. All fields
    provisional (§18.25). pgTAP `25_money_in_transit` (11) + `28_fulfillment_
collection_remittance` (9); unit `fulfillment-format` (2). Not a nav change.
- **2026-07-21 — Demo login buttons on the sign-in page (for client demos).**
  One-tap sign-in as Owner / Selected Admin / Staff, so the Owner can show a
  client the real system without typing credentials. OFF by default: renders and
  works only when `DEMO_LOGIN_ENABLED=true` and `DEMO_LOGIN_PASSWORD` are set
  (see `.env.example`), re-checked server-side. Signs into the REAL seeded UAT
  accounts — nothing is faked; buttons are absent otherwise. The password is
  server-only (`demo.server.ts`); buttons send only a role key. Must never be
  enabled on the live production tenant. Unit test `demo-login` (6). Files:
  `src/lib/auth/demo.ts` (client-safe), `demo.server.ts` (gate + credentials),
  `demo-actions.ts` (action), `sign-in/demo-login-buttons.tsx`.
- **2026-07-21 — HR #4 polish: hourly-rate editor on Attendance & Payroll.** The
  `staff_profiles.hourly_rate` field and the payroll math already existed; only
  the Owner could see/edit it (RLS `staff_profiles_update_owner`), and there was
  no UI to set it. Added an inline, Owner-only rate editor in the payroll table
  (`/admin/attendance`), backed by `report_payroll` now returning the rate
  (numeric in SQL → string, migration `20260721100000`). The rate stays a string
  end to end (never a JS float); an empty input clears it (blanking salary again);
  the `>= 0` check constraint is the final authority. Non-Owners still see only
  their own read-only rate. Not a nav change. pgTAP `26_hr_attendance` (19),
  unit `hr-format` (8).
- **2026-07-18 — Removed the Orders "New Entry" header link and the Invoice /
  Confirm / Layaway shortcut buttons.** Owner request: they duplicated the sidebar
  navigation (Invoice, Payments & Layaway) and the capture entry. Capture now has
  a single entry — the New Order form. Lock tests (`ui-lock`,
  `production-ui-identity`, `new-order-workflow`) updated to match.
- **2026-07-16 — Brand switched to an EMERALD GREEN theme (§3).** Owner decision
  from the reference mockups, superseding beige/black/gold. Applied in
  `globals.css` (token values), with the `--gold*` token NAMES retained to avoid
  codebase-wide churn — they now carry green. Lock-test descriptions updated to
  match; the assertion that components use tokens (not hardcoded colors) stands.
- **2026-07-16 — Production adopts the prototype's full Dashboard/Orders/New
  Order layout + Layaway.** Explicit Owner decision reversing the old §4/§5 split
  (production had simpler real-data screens; the prototype was excluded). Now the
  production screens match the `/preview` prototype's structure, backed by REAL
  data, with charts kept visible at zero ("No data for this period"), a
  honest-unavailable Gross Profit tab, and a newly-approved Layaway workflow.
  Applied doc-first, then implemented Dashboard → Orders → New Order → Layaway.
- **2026-07-16 — Nav item #1 renamed `Dashboard Report` → `Dashboard Profile`.**
  Explicit Owner decision. Route unchanged (`/dashboard`). Applied in this order:
  this document (§1 + mobile), then the lock tests (`ui-lock.test.tsx`,
  `app-shell.test.tsx`), then the shell (`navigation.ts`) and the page heading /
  metadata (`app/(app)/dashboard/page.tsx`). The frozen `/preview` prototype keeps
  its original `Dashboard Report` wording as a historical reference (§5).
