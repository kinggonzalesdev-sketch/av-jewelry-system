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

- **New Entry** is **not** a nav item. It is an action **inside Orders** (a
  gold "＋ New Entry" button) that links to the real claim-capture flow on
  `/live`. It never re-implements capture.
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

Warm **beige · black · gold · white/cream**, with restrained warm neutrals.
Tokens live in `src/app/globals.css` (`--gold`, `--gold-strong`, cream/charcoal
surfaces). **No emerald/slate** (that was the prototype's reference palette, not
the brand). Dark mode is token-driven; the manual toggle is honest.

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
  - **Gross Profit tab** is retained but **honest-unavailable**: no cost/COGS
    rules exist in the backend, so it shows "unavailable — COGS rules not defined"
    rather than invented numbers (§5).
- **Orders** — matches the prototype: top workflow controls (**New Order**,
  **Invoice**, **Confirm**, **Layaway**), the approved **status cards**, search +
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
- **Gross Profit** — the Dashboard's Gross Profit tab is retained in structure but
  shows "unavailable" until real cost/COGS rules are defined; no invented numbers.

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
