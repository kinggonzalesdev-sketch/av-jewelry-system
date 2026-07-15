# UI & Feature Addendum — Owner-Approved Direction

> **Status:** UI/navigation/interaction review only, on branch `ui-owner-approved-preview`.
> **Not merged. Not production. No database migration. No real integration.**
>
> This addendum records the Owner-approved interface direction and what each screen
> means. It does **not** change any approved business rule — where this document and
> `Development-Bible.md` disagree, the **Bible governs**.

**Preview URL (local dev only):** `http://localhost:3000/preview/dashboard-report`

---

## 1. Final navigation

Sidebar order, exactly as approved:

| #   | Item                   | Route                       |
| --- | ---------------------- | --------------------------- |
| 1   | **Dashboard Report**   | `/preview/dashboard-report` |
| 2   | **Orders**             | `/preview/orders`           |
| 3   | **Invoice**            | `/preview/invoice`          |
| 4   | **Live**               | `/preview/live`             |
| 5   | Customers              | `/preview/customers`        |
| 6   | Items / Inventory      | `/preview/items`            |
| 7   | **Payments & Layaway** | `/preview/payments`         |
| 8   | Fulfillment            | `/preview/fulfillment`      |
| 9   | Reports                | `/preview/reports`          |
| 10  | **Settings**           | `/preview/settings`         |

**Dashboard Report is restored as its own tab.** **There is no separate
multi-platform Connections tab** — Pancake lives at **Settings → Integrations →
Pancake** (`/preview/settings/integrations/pancake`). **There is no Disassembly
Report** anywhere.

## 2. Landing page

For Owner prototype review the landing page is **Dashboard Report**.

**Production rule (Phase 3+, not implemented here):**

- Owner and users with Dashboard / Reports access → **Dashboard Report**;
- users without Dashboard access → **Orders**, or their first authorized page;
- otherwise → **Not Authorized**.

The prototype has no permissions, so it always lands on Dashboard Report.
**UI visibility is not authority** — production must resolve the landing page from
the caller's real grants, server-side.

### Dashboard Report vs Orders vs Reports

| Area                 | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| **Dashboard Report** | Summary overview: KPIs, charts, and the Gross Profit preview      |
| **Orders**           | The daily operational workspace — **not** a Dashboard replacement |
| **Reports**          | Separate future area: detailed exports and historical analysis    |

Dashboard Report deliberately does **not** duplicate the Reports module.

---

## 3. Sidebar

| Section          | Contents                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------- |
| **Top**          | MineFlow / A.V. Jewelry branding · user card (initials, name, role, online dot, active page) |
| **Middle**       | The nine primary items · active-page highlight · compact icons · collapsible                 |
| **Fixed bottom** | **Bluetooth / Printer status**, then **Logout** at the very bottom                           |

**Printer states:** Connected · Disconnected · Connecting · Error · Unsupported on Device.
Default is **Disconnected** — "Connected" is never shown without a verified
connection. Click the row in the prototype to cycle states for review.

**Mobile:** compact header (branding, user, printer badge) + bottom nav with Orders,
Invoice, Live, Customers, and **More** (holds the remaining pages + Logout).

---

## 3b. Dashboard Report

The summary overview. **Two internal tabs only: Dashboard and Gross Profit.**
No Disassembly Report tab, card, or chart exists — a test enforces this.

Requires `export_data_reports` in production.

### Date filters

**Today · 7 Days · 14 Days · 30 Days · This Month · Custom Date Range**

The active filter is highlighted, and the resolved **start and end date** are shown
(e.g. "Active: 7 Days · Showing 2026-07-09 to 2026-07-15"). KPI cards and charts
**visibly recalculate** with the range — Today shows ₱42,000 over 1 point, 7 Days
shows ₱209,100 over 7 points. **Refresh** and **Export Report** are present;
Export Report is a **visual prototype action only** — no file is produced.

### Dashboard tab

**Primary KPI row:** Total Sales · Checked Out · Items Sold · Shipments Today ·
Verified Payment · Unverified Payment.

**Secondary operational row:** For Invoice · Pending Payment Verification · Active
Layaway · For Preparation · Shipping Confirmed · Cancelled Orders. Kept as a
compact second row so the primary KPIs stay readable.

**Charts:**

| Chart                              | Shape                       | Notes                                                                                                                               |
| ---------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Sales for the Period**           | Line + area, hover tooltips | Dates on X, sales on Y; follows the selected range                                                                                  |
| **Order Status**                   | Horizontal bars             | Pending · For Invoice · For Preparation · Shipped · Cancelled                                                                       |
| **Payment Verification Breakdown** | Donut                       | Added because it earns its place: it shows Verified vs Evidence Submitted vs Awaiting, reinforcing that **Verified ≠ Paid in Full** |

Charts are hand-rolled SVG — no chart library was added, so the approved stack
stays pinned.

### Gross Profit tab

Month selector · **COGS Costing Mode (System / Manual)** · As Of · Company / Shop ·
Total Items Sold · Average Selling Price · Total Sales · COGS · Gross Profit ·
Gross Profit Rate · Export Report.

**Graph:** Sales vs COGS vs Gross Profit, grouped bars, month periods on the X axis.

**Always visible on the tab:**

> Preview calculation using sample data. Final COGS rules remain subject to business validation.

**This is not accounting logic.** It is arithmetic on invented numbers, shown to
review the shape of the screen. System vs Manual only changes a sample cost ratio
(₱716,582 vs ₱709,760 for Jul 26) so the control is demonstrably live — it models
no real costing method. No production formula is implied.

---

## 4. Orders dashboard

**Header actions:** New Entry · Prepare All Eligible Invoices · Invoice Center · Refresh.

**Status cards (all clickable filters):** Total Active · For Invoice · For Reminder ·
For Preparation · For Payment Confirmation · Shipping Confirmed · Keep · For
Cancellation Review · Cancelled · Payment Evidence Submitted.

**Filters:** global search · status · order date · shipping date · shop/page ·
assigned staff · payment arrangement · fulfillment method · Hide/Show Keep · pagination.

**Search covers:** Order Number · Invoice Number · Claim Number · Customer Name ·
Facebook Name / Alias · Item Code · Tracking Number · Amount.

**Desktop columns:** select · status · shop/page · order number · invoice number ·
customer · quantity · amount · payment state · fulfillment state · assigned staff ·
actions. **Mobile:** cards, no horizontal overflow.

### Row actions

| Control                         | Permission (production)                          |
| ------------------------------- | ------------------------------------------------ |
| Invoice                         | `invoice_preparation`                            |
| Prepare Shipment                | `fulfillment_preparation`                        |
| **More** → View Details         | read                                             |
| **More** → Send Reminder        | `message_sending`                                |
| **More** → Verify Payment       | `payment_verification`                           |
| **More** → Mark as Keep         | `claim_review`                                   |
| **More** → Request Cancellation | `initiate_high_risk_action` → **Owner approval** |
| **More** → View Audit Trail     | `export_data_reports`                            |

**There is deliberately no direct destructive Cancel for an Official Order.**

### Dynamic action labels

| Record stage             | Label                        |
| ------------------------ | ---------------------------- |
| Pending Claim            | **Withdraw Claim**           |
| Confirmed Claim          | **Controlled Withdrawal**    |
| Official Order           | **Request Cancellation**     |
| Final cancellation       | **Owner approval**           |
| Availability restoration | **Returned-to-Stock Review** |

---

## 5. New Entry

**Fields:** Shop/Page · Staff/Salesperson · Customer Search · Item Search · Item Code ·
Grams Per Piece · Quantity · Total Price Per Piece · **Required Item Photo** · Entry
Mode · Notes.

**Photo controls:** Take Photo · Choose from Gallery · Flip Camera · Retake · Remove ·
Upload Progress · Retry Upload. The normal jewelry workflow **visibly requires** a photo.

### Entry modes → dynamic primary button

| Mode                        | Button                          | Permission                  | Effect                                        |
| --------------------------- | ------------------------------- | --------------------------- | --------------------------------------------- |
| Pending Claim               | **Save Pending Claim**          | `claim_capture`             | **No reservation.** Capture does not confirm. |
| Confirmed Claim             | **Confirm Claim & Print Label** | `confirm_claim_print_label` | **Reserves exactly once** + queues label      |
| Invoice Draft Entry         | **Add to Invoice Draft**        | `invoice_preparation`       | Keeps reservation, **no second deduction**    |
| Existing Record / Migration | **Save Existing Record**        | `existing_record_entry`     | Historical status, **no fake claim**          |

**There is no generic "Confirm Order" button.**

### Reprint Last Label

Requires `retry_reprint_label`. Creates **only a new print attempt**. Does **not**
create a new claim, another reservation, or another Official Order. Audit required;
reason may be required.

---

## 6. Invoice workspace

Invoice queue · customer search · status filters · previous/next navigation · invoice
preview · item list · quantity · price · total · order number · invoice number ·
required deposit · remaining balance · payment arrangement · fulfillment arrangement ·
hold expiry · shop/page · assigned staff.

**Actions:** Review Invoice · **Approve & Send Invoice** · Copy Invoice Message ·
Mark as Sent · Prepare All Eligible Invoices · Approve & Send All Ready Invoices.

**Stated on screen:**

- **Copy ≠ Sent** · **Mark as Sent ≠ Delivered** · **Delivered ≠ Read**
- A send retry **never creates another Official Order**
- **Required Deposit Verified is not Paid in Full** (Paid in Full has no approved definition)

---

## 7. Invoice All — one click, represented as two steps

**Step 1: Prepare All Eligible Invoices** → **Step 2: Approve & Send All Ready Invoices**

| Behaviour                                      | Implemented in prototype             |
| ---------------------------------------------- | ------------------------------------ |
| Show eligible record count                     | ✅                                   |
| Group only same customer                       | ✅                                   |
| Require same payment arrangement               | ✅                                   |
| Require same fulfillment arrangement           | ✅                                   |
| Exclude claims already in another active draft | ✅ (sample record `ORD-2026-000113`) |
| Show excluded records separately + reason      | ✅                                   |
| Require confirmation                           | ✅ (checkbox gate)                   |
| Show individual success/failure                | ✅                                   |
| Retry failed messages only                     | ✅                                   |
| Prevent duplicate invoices                     | ✅ (one draft per group)             |
| Audit each action                              | Stated; production behaviour         |

**Approval is never bypassed** — Step 2 is an explicit, confirmed approval.

---

## 8. Live

Open Live Batch · Current Live Batch · Live Batch History · Quick Add Item · Current
Flex Item · Post-Live Item Entry · Withdraw Item · Selected Facebook Page · Pancake
Connection Status · **Manual Capture Fallback**.

**Honest statuses only:** Not Connected · Connected Demo · Needs Reauthorization ·
API Access Pending Validation · Connection Error. Default **Not Connected**.

Closing a batch never auto-confirms claims, invoices, creates orders, or changes
inventory. Reopening is an **Owner approval**.

---

## 9. Pancake integration (V1 = Facebook only)

**Architecture:**

```
Facebook Page → connected inside Pancake → MineFlow connects to Pancake
              → MineFlow reads the approved Facebook Page from Pancake
```

**Panel:** Connection Status · Pancake Workspace · Connected Channel · Facebook Page ·
Default Live Page · Last Sync · API Health · Connection Notes.
**Buttons:** Connect Pancake · Test Connection · Sync Facebook Page · Reconnect · Disconnect.

| Role           | May                                                           |
| -------------- | ------------------------------------------------------------- |
| **Owner**      | connect, reconnect, disconnect, **approve the Facebook Page** |
| Selected Admin | test or sync **only with explicit permission**                |
| Staff          | view and use the **approved Page only**                       |

**Connected Channel: Facebook.** Future channels (TikTok, Shopee, Lazada) are shown as
_available later through Pancake, after subscription upgrade and API validation_ —
**never as separate active connectors**.

**No real tokens. No real API calls. No credentials. The integration does not work yet.**

---

## 9b. Payments & Layaway

**The navigation label is "Payments & Layaway", not "Payments".** A generic
"Payments" label hid layaway entirely — it has its own queues, its own
Owner-gated forfeiture path, and its own rules, so the label names it.

**Six internal tabs:** Payment Verification · Layaway Accounts · Installments ·
Overdue / Grace Period · Forfeiture Review · Payment History.

### Approved rules represented on screen

| Rule                                        | Where it shows                                               |
| ------------------------------------------- | ------------------------------------------------------------ |
| Minimum **20%** down payment                | Rules panel + every account's Required Down Payment          |
| Maximum **3 months**                        | Rules panel + "N of 3 max" on each account                   |
| Maximum **10-day** grace period             | Rules panel + Grace Period End on each account               |
| Layaway **belongs to an Official Order**    | Stated on every account detail, with the order number        |
| Evidence and verification **stay separate** | Two distinct columns in the installment schedule             |
| **Non-cancellable after deposit**           | Shown once the down payment is verified                      |
| **Forfeiture requires Owner approval**      | Only "Request Forfeiture" exists — no direct Forfeit control |
| Forfeited → **Returned-to-Stock Review**    | Stated in the flow and on the action                         |
| **No automatic forfeiture**                 | Stated on the Overdue and Forfeiture Review tabs             |
| **No automatic stock return**               | Stated with the forfeiture action                            |

### The safe flow (shown on two tabs)

```
Overdue → Grace Period → Forfeiture Review → Owner Approval
→ Execute Forfeiture → Returned-to-Stock Review
```

Reaching the end of the grace period only makes an account
**Forfeiture-Eligible**. Eligibility is not approval.

### Layaway account details

Customer · Official Order Number · Invoice Number · Item summary · Total Order
Amount · Required Down Payment · Down Payment Paid · Remaining Balance · Start
Date · Due Date · Grace Period End · Number of Months · Layaway Fee ·
Installment Schedule · Payment Evidence · Payment Verification Status · Financer
· Current Layaway Status · Available actions.

### Layaway fee — concept only

The fee is computed as **₱150 × grams × number of months** and displayed with its
working shown (e.g. ₱150 × 12.4g × 3).

> **The exact fee application — per piece, per order, or applied differently —
> remains subject to final business confirmation.**

Whether the fee is per piece, per order, per item line, or charged at a different
point is **not decided**, and the prototype does not invent an answer.

### Dashboard Report layaway cards

**Active Layaways · Installments Due · Overdue / Grace Period ·
Forfeiture-Eligible**, with a direct link into the workspace. Forfeiture-Eligible
is labelled as eligible for _review_, never as forfeited.

---

## 9c. Night mode

A **Night mode** toggle sits in the sidebar (and the mobile header). It starts in
**day mode**, so the approved clean-white direction is what a reviewer sees first.

**It uses a `night:` variant, not `dark:`.** Production's dark mode is OS-driven
through `prefers-color-scheme` on CSS variables. Redefining `dark:` to be
class-based would silently change its meaning for every future production
component, so the prototype has its own variant and leaves `dark:` alone.

The `night` class is applied to the **prototype root only** — never to `<html>` —
so the toggle cannot reach outside `/preview`.

**Sidebar bottom order is preserved:** Night mode → Collapse → **Bluetooth /
Printer → Logout (last)**. Night mode and Collapse sit _above_ the printer;
anything placed below Logout would break the approved rule.

---

## 10. Settings

1. Business Profile · 2. Shops / Pages · 3. **Invoice Settings** · 4. **Reminder and
   Hold Settings** · 5. Order Defaults · 6. **Sticker and Printing** · 7. Feature Toggles ·
2. **Integrations** · 9. Import Records · 10. **Data Maintenance** · 11. Audit Log.

**Invoice Settings:** Header · Footer · Default Message · Preview · Save.
New settings affect **future invoices only** — sent invoices are never rewritten.

**Reminder and Hold:** Days Before First Reminder · Days Before Cancellation Review ·
Maximum Reminder Attempts · Reminder Interval · Header · Footer · Automatic Reminder
Preparation. **No automatic cancellation.** Approved flow shown on screen:

```
Hold Period Reached → For Cancellation Review → Owner Review
→ Owner Approval → Execute Cancellation → Returned-to-Stock Review
```

**Order Defaults:** Social Channel (Facebook) · Shop/Page · Item · Sticker Note ·
Payment Arrangement · Fulfillment Method · Printer · Label Size · Camera Behavior.

### Feature toggles

| Toggle                    | State                                     |
| ------------------------- | ----------------------------------------- |
| Order Form Photo Required | **Locked ON** — approved jewelry workflow |
| Track Unpaid Orders       | **Locked ON**                             |
| Inventory Tracking Mode   | **Locked ON** — core system dependency    |
| Use Pancake Integration   | Optional · **Pending Validation**         |
| Open Camera Immediately   | User preference                           |
| Auto Print                | Optional · printer-readiness controlled   |

**Removed:** Use Meta Main App · Use TikTok Main App · Shopee direct · Lazada direct.

**Import Records:** Download Template · Upload File · Column Mapping · Preview ·
Duplicate Warning · Validation Results · Import Results. Requires
`existing_record_entry`. Imports create **no fake claims, reservations, orders, or payments**.

**Data Maintenance:** **Archive Closed Orders** · **Archive Inactive Customers**.
There is **no Clear All Orders / Clear All Customers**.
**Reset Test Data** (local/staging only): Owner only · AAL2 required later · typed
confirmation `RESET TEST DATA` · reason required · strong warning · audited · disabled
in production.

---

## 11. Owner-only controls

Pancake connect/reconnect/disconnect · approve the Facebook Page · business-wide
invoice templates · reminder and hold rules · cancellation thresholds · inventory mode ·
global printer settings · archive actions · Reset Test Data.

---

## 12. Safety rules held by this prototype

1. Capture does not confirm.
2. Pending Claim creates no reservation.
3. Confirmed Claim reserves exactly once.
4. Invoice Draft does not deduct inventory again.
5. Official Order does not deduct inventory again.
6. **Approve & Send Invoice remains the Official Order trigger.**
7. Required Deposit Verified is not automatically Paid in Full.
8. No automatic miner promotion.
9. No automatic waitlist allocation.
10. No automatic stock return.
11. No automatic customer merge.
12. No silent payment/order reassignment.
13. Owner-only actions remain Owner-only.
14. **UI visibility is not authority.**
15. Pancake and Facebook remain unverified until tested.

---

## 13. Responsive behaviour

| Screen             | Desktop                                                | Mobile                                     |
| ------------------ | ------------------------------------------------------ | ------------------------------------------ |
| Sidebar            | Fixed 256px rail, collapsible to 68px                  | Compact header + bottom nav + More sheet   |
| Dashboard Report   | KPI row of 6, full-width charts                        | KPI cards 2-up, filters wrap, charts scale |
| Gross Profit       | Controls in a row, 3×2 figures                         | Stacked controls, 2-up figures             |
| Orders             | 10 status cards in ONE row at 2xl, 5 at xl, full table | 2-column cards, no horizontal overflow     |
| Payments & Layaway | Six tabs, account detail + schedule                    | Stacked, scrollable schedule               |
| New Entry          | Two-column (form + photo rail)                         | Stacked                                    |
| Invoice            | Queue + preview side by side                           | Stacked                                    |
| Live               | Workspace + connection rail                            | Stacked                                    |
| Settings           | Section list + panel                                   | Stacked                                    |
| Pancake            | Panel + rail                                           | Stacked                                    |

**Mobile bottom nav** carries Orders · Invoice · Live · Customers · More.
Dashboard Report is the landing page but deliberately **not** in the bottom four:
on a phone the daily work is Orders/Invoice/Live, and a summary screen would
displace one of them. It sits one tap away under **More**. Verified: no horizontal
overflow at 375px.

---

## 14. Prototype-only / unverified

**Everything on `/preview/**` is prototype-only.** Specifically:

- All records are **sample data**, invented for review.
- **No database access.** No Supabase client is imported (a test enforces this).
- **No external API call.** No `fetch` exists in the prototype (a test enforces this).
- **No credentials or tokens.**
- Buttons are wired to local state or do nothing; none performs a real operation.
- **No server-side workflow is complete.** The prototype proves _layout and intent_, not behaviour.
- **Pancake/Facebook: unverified.** No connection exists.
- Printer/Bluetooth: display states only; integration unverified (Bible §27).

### Isolation

- Prototype lives in `src/components/preview/**` and `src/app/(preview)/**`.
- **ESLint blocks production code from importing it.**
- The preview layout **returns 404 when `NODE_ENV=production`** — it can never be served from a production build.
- The session proxy **excludes `/preview`**, so reviewing screens needs no Supabase.

---

## 15. Acceptance criteria

| #   | Criterion                                                     | Status                  |
| --- | ------------------------------------------------------------- | ----------------------- |
| 1   | Sidebar order matches approved list (Dashboard Report first)  | ✅ tested               |
| 2   | No separate Connections tab                                   | ✅ tested               |
| 3   | Landing is Dashboard Report                                   | ✅ tested               |
| 3a  | Dashboard Report is its own tab, separate from Orders/Reports | ✅ tested               |
| 3b  | **No Disassembly Report** anywhere — tab, card, or chart      | ✅ tested               |
| 3c  | Dashboard Report has exactly two internal tabs                | ✅ tested               |
| 3d  | All six date filters; cards and charts respond to range       | ✅ tested               |
| 3e  | Selected start and end dates displayed                        | ✅ tested               |
| 3f  | Gross Profit preview note always visible                      | ✅ tested               |
| 3g  | Costing Mode visibly changes the figures                      | ✅ tested               |
| 3h  | Reports module not duplicated inside Dashboard Report         | ✅ tested               |
| 4   | Printer status sits directly above Logout, Logout last        | ✅                      |
| 5   | "Connected" never shown without a verified connection         | ✅ default Disconnected |
| 6   | All 10 status cards present                                   | ✅                      |
| 7   | All filters + search fields present                           | ✅                      |
| 8   | No direct Cancel for an Official Order                        | ✅ tested               |
| 9   | Dynamic entry-mode button, no generic Confirm Order           | ✅                      |
| 10  | Item photo visibly required                                   | ✅                      |
| 11  | Invoice All is two-step with confirmation                     | ✅                      |
| 12  | Exclusions shown with reasons                                 | ✅ tested               |
| 13  | Copy ≠ Sent ≠ Delivered ≠ Read stated                         | ✅                      |
| 14  | Pancake-first, Facebook-only, no other connectors             | ✅ tested               |
| 15  | Owner-only controls labelled                                  | ✅                      |
| 16  | Reset Test Data requires typed phrase + reason                | ✅                      |
| 17  | Sample data clearly labelled                                  | ✅ tested               |
| 18  | Desktop + mobile for all 7 screens                            | ✅                      |
| 19  | No production migration                                       | ✅ none created         |
| 20  | No real integration or credential                             | ✅ tested               |

---

## 16. Phase assignment for production implementation

| Screen / feature                               | Production phase                                                |
| ---------------------------------------------- | --------------------------------------------------------------- |
| Sidebar, navigation, permission-aware landing  | **Phase 3** (shell)                                             |
| Dashboard Report — KPIs and charts             | **Phase 9** (reads records built in Phases 1–8)                 |
| Gross Profit tab                               | **Phase 9+**, and only after COGS/accounting rules are approved |
| New Entry — Pending/Confirmed Claim, photo     | **Phase 3–4**                                                   |
| Reprint Last Label, print attempts             | **Phase 4**                                                     |
| Invoice workspace, Approve & Send, Invoice All | **Phase 5**                                                     |
| Live workspace, Quick Add, Current Flex Item   | **Phase 3**                                                     |
| Payments, deposit, layaway                     | **Phase 6**                                                     |
| Fulfillment                                    | **Phase 7**                                                     |
| Customers, Items, Import Records               | **Phase 8**                                                     |
| Reports, Audit Log surfacing                   | **Phase 9**                                                     |
| Pancake integration                            | **Phase 10** (gated, non-blocking, unverified)                  |
| Printer / Bluetooth                            | **Phase 10** (unverified)                                       |
| Settings, Owner-only controls                  | alongside the phase that owns each setting                      |

**Nothing in this addendum authorises Phase 3 to begin.**

---

## 17. Open questions for the Owner

1. **Keep** — is it a distinct order status, or a flag on an order? Modelled here as a status.
2. **Payment Evidence Submitted** vs **For Payment Confirmation** — these overlap; are they one queue or two? Both currently appear as Orders status cards AND as Dashboard counts.
3. **Mobile bottom nav** carries Orders/Invoice/Live/Customers + More, with Dashboard Report under More. Should Dashboard Report replace one of the four?
4. **Reports** and **Payments** were not designed in this round — placeholders only.
5. **Green accent depth** — currently emerald-600. Lighter or deeper?
6. **Sidebar default** — expanded or collapsed on first load?
7. **COGS rules are undefined.** The Gross Profit tab shows a _shape_, not a calculation. Before it can be built for real we need: what counts as cost (metal, labour, freight, wastage?), what System vs Manual costing actually means, and whether Gross Profit is per shop, per period, or both.
8. **"Checked Out"** — the KPI is shown as approved, but its definition is not in the Bible. What event marks an order as checked out?
9. **"Shipments Today"** ignores the date filter by design (it is a _today_ metric). Should it instead follow the selected range?
10. **Dashboard vs Reports overlap** — Dashboard Report has Export Report buttons. Do exports belong only in Reports, to keep the boundary clean?
