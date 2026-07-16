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
| 1   | Dashboard Report   | `/dashboard`          | ▥    |
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
- **Under More (Dashboard Report first):** Dashboard Report · Items / Inventory ·
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

- **Orders** — real Official Orders list (authoritative money, payment +
  fulfillment status) + the New Entry action. Read-only; row links lead to the
  action workspaces.
- **Dashboard / Payments** graphs use **real database aggregation only** (no
  sample arrays); a failed query shows an error, never a blank/zero chart.
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
  sample data only. Not part of the production app.

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
