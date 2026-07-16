# Production UI Integration — Prototype → Production Audit & Status

**Branch:** `production-ui-integration` (from `43bba9c`)
**Goal:** apply the Owner-approved `/preview` MineFlow visual system to the real,
functional production pages — real identity, real data, real actions, no sample
records, `/preview` still unreachable in production.

This is a **reskin**, not a redesign: the prototype is the visual source of
truth; the production routes/actions/RLS/tests are the functional source of
truth.

---

## 1. ⚠️ Decision required before the shell can be reskinned

**The two approved sources disagree on navigation, and I will not guess it.**

|              | Bible §8.2 (frozen, test-enforced)        | `/preview` prototype                       |
| ------------ | ----------------------------------------- | ------------------------------------------ |
| Model        | **Exactly 5** bottom-nav items            | **10-item** sidebar                        |
| Mobile items | Dashboard · Live · Claims · Orders · More | Orders · Invoice · Live · Customers · More |
| Enforced by  | `tests/unit/app-shell.test.tsx`           | —                                          |

The prototype sidebar also links to **Customers, Reports, Settings** — routes
that **do not exist in production yet** (they are Batch 4). Applying the
prototype nav verbatim would either (a) override a Bible-pinned rule and break
its test, or (b) link to dead routes / 404. Both are forbidden by the task
("do not invent business rules", "no step may redirect / 404").

**Owner/Developer must choose:**

1. **Reconcile as desktop-vs-mobile (recommended).** Keep the Bible's 5-item
   _mobile_ bottom nav; let the _desktop_ sidebar show the fuller list, but only
   linking to routes that exist. Customers/Reports/Settings appear only once
   their production routes are built (Batch 4). This satisfies both sources.
2. **Adopt the prototype nav wholesale.** Requires formally superseding Bible
   §8.2's 5-item rule and updating its test — a governance change, not a reskin.

Until this is answered, the shell keeps the **existing 5-item production nav**
and only its _visuals_ + _real identity_ are upgraded (done — see §4).

---

## 2. Palette note (surface, do not silently resolve)

The task lists an interface preference of **"beige, black, and gold"**, but the
actual approved prototype under `/preview` renders in **emerald green + slate +
white**. These conflict. The prototype is the concrete approved artifact, so the
reskin follows it (emerald/slate). **Flagged for the Owner** — if beige/gold is
intended, that is a prototype change first, then a reskin, not something to
invent mid-migration.

---

## 3. Screen-by-screen inventory

Legend: **F** functional (real data + real actions) · **P** prototype-only
(sample data) · **—** no production route yet.

| Prototype screen         | Production route                          | Real loader                                                          | Real action(s)                        | Permission                           | State                                              |
| ------------------------ | ----------------------------------------- | -------------------------------------------------------------------- | ------------------------------------- | ------------------------------------ | -------------------------------------------------- |
| Shell / sidebar / header | `(app)/layout.tsx` + `components/shell/*` | `getCurrentStaffProfile`                                             | `signOut`                             | active staff                         | **F — reskin pending nav decision; identity done** |
| Dashboard Report         | `/dashboard`                              | `dashboard_counts`, `listAuditEvents`, `listNotifications`, `search` | refresh, ack, report                  | scoped RLS                           | **F, plain styling**                               |
| Orders                   | `/orders`                                 | order list loader                                                    | invoice/prepare/more                  | scoped                               | **F, plain**                                       |
| Invoice                  | `/orders/invoice`                         | `invoice-workspace` loaders                                          | `approveAndSendAction` etc.           | invoice_preparation                  | **F, plain**                                       |
| Live                     | `/live`                                   | `listLiveBatches`, `listLiveBatchItems`, `listCaptureCustomers`      | capture, flex, batch                  | live_batch_operation / claim_capture | **F, plain**                                       |
| Claim Review             | `/claims`                                 | `listClaimReviewQueue`                                               | confirm, retry/reprint/void           | confirm_claim_print_label            | **F, plain**                                       |
| Payments & Layaway       | `/orders/payments`                        | `paymentVerificationQueue`, `listPayableOrders`, layaway loaders     | record, verify, reject, layaway       | payment_verification                 | **F, plain**                                       |
| Fulfillment              | `/orders/fulfillment`                     | `listFulfillments`, `listOwnerApprovals`                             | prepare, release, dispatch, approvals | fulfillment_*                        | **F, plain**                                       |
| Items / Inventory        | `/orders/inventory`                       | inventory monitor loaders                                            | RTS, duplicate review                 | inventory_monitoring                 | **F, plain**                                       |
| Customers                | —                                         | _(none)_                                                             | —                                     | —                                    | **P only — route not built (Batch 4)**             |
| Reports                  | —                                         | (reports live under dashboard)                                       | export                                | export_data_reports                  | **P only — no dedicated route**                    |
| Settings                 | —                                         | _(none)_                                                             | —                                     | —                                    | **P only — route not built (Batch 4)**             |
| Staff Administration     | `/admin/staff`                            | `listStaffAccounts`, `listScopes`, `listAccountAuditTrail`           | grant/revoke/scope/etc.               | Owner only                           | **F, plain**                                       |
| Capabilities             | `/admin/capabilities`                     | `capability_status`                                                  | validate/enable                       | admin                                | **F, plain**                                       |

Shared prototype primitives available to reuse (in `components/preview/`):
`Card`, `StatusBadge`, `SectionTitle`, `Field`, `PreviewButton`, `charts.tsx`,
`primitives.tsx`. These import sample data in places, so the reskin **extracts
the styling** into neutral production primitives rather than importing them.

---

## 4. What is done (Batch 1 groundwork — committed)

- **Real authenticated identity** replaces the prototype's hardcoded
  "A.V. Owner / Owner". New `getCurrentStaffProfile()` reads the caller's OWN
  `staff_profiles` row via the `staff_profiles_read_self` RLS policy (works for
  every role); the header renders the real full name + a real role label
  (Owner / Selected Admin / Staff).
- **Guard tests**: production shell imports no prototype fixtures; identity is
  read, not hardcoded; `/preview` still 404s in production; no production route
  links into `/preview`.

## 5. Remaining (Batches 1–4)

- **Batch 1 (rest):** shell/sidebar visual reskin — **blocked on the §1 nav
  decision**. Dashboard card restyle to prototype look (real data).
- **Batch 2:** Live, Claim Review, Invoice, Orders.
- **Batch 3:** Payments & Layaway, Fulfillment.
- **Batch 4:** Customers (new route), Inventory, Reports (new route), Settings
  (new route), Staff Administration.

Each batch: format · lint · typecheck · tests · build · real browser
verification · one atomic commit. Full polished UAT-12 is the final proof.

## 6. Invariants held throughout

No sample records in production · every action stays server-authorized (hiding a
button is not authorization) · RLS/audit/idempotency unchanged · `/preview`
guard intact · no fake totals/charts/identity · empty states distinguished from
read failures (already the pattern from the balance/queue fixes).
