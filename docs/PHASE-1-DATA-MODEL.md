# Phase 1 — Data Model & Integrity Spine

> **Status:** Phase 1 complete on branch `phase-1-data-spine`. **Not merged. Not production-ready.**
>
> This phase delivers the database and its integrity guarantees. It delivers **no
> business workflow, no UI, and no authorization enforcement** — those are Phase 2
> and later. A table existing is not a workflow working.

**Source of truth:** `Development-Bible.md` (§1–36, APPROVED). Status vocabulary comes
from **Bible §22 — Status Transition Rules**, which is the sole authority. No status
was invented; see [Deliberately not modelled](#deliberately-not-modelled).

---

## Schema overview

37 tables in `public`, plus a private `app_private` schema for helper functions.

| Area                          | Tables                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Audit & idempotency**       | `audit_events`, `idempotency_records`                                                                                                             |
| **Identity & access**         | `roles`, `permissions`, `scopes`, `staff_profiles`, `staff_permission_grants`, `staff_scope_assignments`, `trusted_devices`, `role_device_limits` |
| **Customers**                 | `customers`, `customer_aliases`, `customer_duplicate_references`                                                                                  |
| **Live & inventory**          | `live_batches`, `live_batch_items`, `inventory_items`, `item_photos`                                                                              |
| **Claims & reservations**     | `claims`, `miner_positions`, `inventory_reservations`, `waitlist_entries`                                                                         |
| **Labels**                    | `label_jobs`, `print_attempts`                                                                                                                    |
| **Invoicing & orders**        | `invoice_drafts`, `invoice_draft_claims`, `official_orders`, `official_order_claims`                                                              |
| **Messages**                  | `customer_messages`, `message_send_attempts`                                                                                                      |
| **Payments**                  | `payments`, `payment_evidence`, `payment_verifications`                                                                                           |
| **Layaway**                   | `layaway_arrangements`, `layaway_installments`                                                                                                    |
| **Fulfillment**               | `fulfillment_records`                                                                                                                             |
| **Approvals & returns**       | `owner_approval_requests`, `price_overrides`, `returned_to_stock_reviews`                                                                         |
| **Notifications & migration** | `notifications`, `migration_batches`, `migration_source_records`                                                                                  |

### Identifiers

Every table uses a **UUID primary key** as its stable internal identifier. Business-facing
reference numbers are **separate values**, never foreign keys:

| Reference         | Table             | Format            |
| ----------------- | ----------------- | ----------------- |
| `claim_reference` | `claims`          | `CLM-YYYY-NNNNNN` |
| `order_number`    | `official_orders` | `ORD-YYYY-NNNNNN` |
| `invoice_number`  | `official_orders` | `INV-YYYY-NNNNNN` |
| `batch_reference` | `live_batches`    | `LB-YYYY-NNNNNN`  |

Generated from Postgres sequences. Order number and invoice number are **distinct
values from distinct sequences** — one order carries exactly one of each.

---

## Inventory reservation lifecycle

This is the heart of the system (Bible §22.3):

```
Pending Claim        -> NO reservation exists
Confirmed Claim      -> exactly ONE reservation, state = 'provisional'
Invoice Draft        -> reservation unchanged (no second deduction)
Official Order       -> state = 'committed'  (no second deduction)
Payment / Fulfilment -> reservation untouched
Cancel/Expire/Reject -> state = 'released' -> Returned-to-Stock Review
Approved return      -> quantity available again
```

### How each rule is actually enforced

| Rule                               | Mechanism                                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Pending Claim holds no reservation | Trigger `enforce_reservation_rules` rejects any reservation whose claim is not `confirmed_claim` |
| Reserve **exactly once**           | `UNIQUE (claim_id)` on `inventory_reservations` — a retry fails at the database                  |
| Never exceed available quantity    | Same trigger sums active reservations under `SELECT … FOR UPDATE` on the item row                |
| **No second deduction** at commit  | Trigger `enforce_no_second_deduction` rejects any quantity change on `provisional → committed`   |
| Released is terminal               | Same trigger rejects `released → provisional`; return requires Returned-to-Stock Review          |
| Only 1st/2nd Miner                 | `CHECK (position IN (1,2))` — a 3rd Miner is **unrepresentable**                                 |
| No auto-promotion                  | No trigger promotes anyone; a switch records `switched_from_claim_id` + reason                   |
| Excess stays waitlist              | `waitlist_entries`; no code path allocates from it automatically                                 |

### Availability is derived, never stored

```sql
app_private.available_quantity(item) = quantity_total - Σ(provisional + committed)
```

There is deliberately **no stored `available_quantity` counter**. A counter can drift
out of step with reality, and drift here means selling the same item twice. The
derived value cannot drift.

### Concurrency

`enforce_reservation_rules` takes `SELECT … FOR UPDATE` on the inventory item **before**
summing reservations. Two simultaneous confirmations for the last unit serialise: the
second waits, re-reads, and is rejected. Without that lock both could read the same
availability and both succeed.

`enforce_selected_admin_limit` takes an `EXCLUSIVE` table lock for the same reason —
two concurrent promotions could otherwise each see one existing admin and both commit,
yielding three.

---

## Idempotency design

Three independent layers, because one is not enough:

1. **Structural uniqueness** — the primary guarantee.
   - `official_orders.invoice_draft_id` is `UNIQUE` → **one draft can only ever yield one Official Order.** A retried send raises `23505` instead of creating a second order.
   - `payment_verifications.payment_id` is `UNIQUE` → one Verify Payment, one verified record.
   - `label_jobs.claim_id` is `UNIQUE` → a reprint is a new _attempt_, never a new job.
   - `official_order_claims.claim_id` is `UNIQUE` → a claim can never be sold twice.
   - `inventory_reservations.claim_id` is `UNIQUE` → reserve exactly once.

2. **The idempotency ledger** — `idempotency_records`, keyed `UNIQUE (scope, idempotency_key)`.
   A caller claims a key _before_ acting; a concurrent duplicate loses the insert race
   rather than performing the action twice. `result_id` lets a retry return the
   **original** outcome.

3. **Atomicity** — every guard runs inside the caller's transaction, so a rejected write
   leaves **no partial record**. Test: `A refused over-reservation leaves no partial record`.

### Official Order creation boundary

One successful _Approve & Send Invoice_ produces exactly: **one Official Order + one
order number + one invoice number**, and flips the reservation to `committed`. Retry
cannot duplicate any of it. A message send failure never creates a second order —
`message_send_attempts` records attempts against the existing message.

---

## Audit-event strategy

`audit_events` is **append-only**, enforced twice over:

- `BEFORE UPDATE` and `BEFORE DELETE` triggers raise `insufficient_privilege`
- privileges are revoked from `anon` and `authenticated`

**Attribution is an immutable snapshot.** The actor is stored as `actor_auth_uid` +
`actor_label` — the label captured _at the time of the event_. This is why renaming or
deactivating a staff member cannot rewrite history (proved by test _"Audit attribution
survives deactivation AND rename"_). `staff_profiles.auth_user_id` uses
`ON DELETE RESTRICT`, so a user with history cannot be deleted at all.

`outcome` is one of `succeeded | failed | denied` — a failed action is recorded as a
failure, never a false success (Bible §31 r7).

---

## RLS posture (Phase 1)

**Every table** in `public` has:

- `ENABLE ROW LEVEL SECURITY`
- `FORCE ROW LEVEL SECURITY` — so even the table owner cannot bypass it
- privileges **revoked** from `anon` and `authenticated`
- RLS enabled **in the same migration that creates the table** — no table ever exists in an exposed state

**Phase 1 adds zero permissive policies.** The posture is **deny-by-default**: with RLS
on and no policy, nothing is readable or writable. Access is additionally refused at the
_privilege_ layer (`42501`) before RLS is consulted — defense in depth.

This is proved, not asserted: tests show `anon` and a merely-authenticated user are both
refused reads and writes on customers, claims, orders, payments, staff profiles, and
audit events, and cannot self-promote to Owner.

**Phase 2 adds the permission-aware policies.** Until then, only the service role (used
strictly server-side) can reach data.

### Owner-only authority at the database

`enforce_owner_only_decision` rejects any approval decision by a non-Owner. This is the
**last line of defence behind** Phase 2's server-side checks, not a replacement for them.
`owner_approval_execution_ck` makes execution impossible unless `status = 'approved'` —
approval and execution stay separate events.

---

## Deliberately not modelled

Bible §22.19 lists these as open. **Inventing them would silently create business rules
the client never approved**, so they are absent by design:

| Not modelled                                            | Why                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Paid in Full**                                        | Definition remains To be confirmed (§22.9, §22.19). `Required Payment Verified` must **not** be read as Paid in Full. |
| **Outstanding Balance**                                 | Definition To be confirmed.                                                                                           |
| **Delivered / Read** message statuses                   | Integration-dependent and To be confirmed (§22.10). No Pancake/Meta status is invented.                               |
| Accepted payment methods                                | Open item (Roadmap Phase 6) — `payments.method_note` is free text, with no invented CHECK list.                       |
| Layaway fee application point / rounding                | Open item (Roadmap Phase 6).                                                                                          |
| Held/Unavailable sub-states, forfeited-item disposition | Open items (§22.19).                                                                                                  |

Two tests enforce this: no constraint anywhere may contain `paid_in_full` /
`outstanding_balance`, and `customer_messages` may not contain `delivered` / `read`.

---

## Migration & operations

### Applying migrations

```bash
npx supabase start          # requires Docker Desktop
npx supabase db reset       # drops, recreates, applies all migrations in order
npx supabase test db        # runs the pgTAP suite
```

Migrations are applied **in sequence** by timestamp. Never edit a migration that has been
applied to a shared environment — **correct forward** with a new migration.

### Migration files

| File                                                              | Contents                                                                        |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `20260715115900_phase1_test_harness.sql`                          | pgTAP extension (test-only)                                                     |
| `20260715120000_phase1_foundation.sql`                            | extensions, `app_private`, reference sequences, audit spine, idempotency ledger |
| `20260715120100_phase1_identity_access.sql`                       | roles, permissions, scopes, staff profiles, grants, devices                     |
| `20260715120200_phase1_customers_live_inventory.sql`              | customers, aliases, duplicates, live batches, items, photos                     |
| `20260715120300_phase1_claims_reservations.sql`                   | **claims, miners, reservations, waitlist — the integrity spine**                |
| `20260715120400_phase1_labels_invoicing_orders.sql`               | label jobs, print attempts, invoice drafts, Official Orders                     |
| `20260715120500_phase1_messages_payments_layaway_fulfillment.sql` | messages, payments, layaway, fulfillment                                        |
| `20260715120600_phase1_approvals_rts_migration.sql`               | Owner approvals, price overrides, Returned-to-Stock, notifications, migration   |

### Seed data

Seeded: **role names**, the **permission catalog**, and **role device-limit targets** —
structural reference data only.

**Not seeded:** any staff member, customer, item, claim, order, or payment. Tests create
their own fixtures inside a transaction and `ROLLBACK`, so no test data ever persists.

---

## Test suite

`supabase/tests/` — **80 assertions, all passing** against real local PostgreSQL.

| File                                     | Covers                                                                                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `01_reservation_integrity.test.sql` (16) | Pending→no reservation; confirm→exactly one; no second deduction; released terminal; multi-stock ceiling; no partial record                                                                    |
| `02_order_idempotency.test.sql` (14)     | One claim per active draft; retry→no second order; separate order/invoice numbers; claim never sold twice; cancellation needs Owner approval; ledger duplicate rejection; reprint→no new claim |
| `03_rls_and_authority.test.sql` (28)     | RLS enabled+forced everywhere; deny-by-default; anon/authenticated refused; max-two Selected Admin; Owner-only decisions; audit append-only; no 3rd Miner                                      |
| `04_schema_and_migration.test.sql` (22)  | UUID ids; unique references; `search_path` on definer functions; TBC statuses not invented; migration source preserved; attribution survives deactivation+rename                               |

---

## Known limitations

1. **No authorization enforcement.** RLS is deny-by-default; there are no permission-aware
   policies yet. Phase 2 owns this.
2. **Concurrent-device limits are NOT enforced.** `trusted_devices` and `role_device_limits`
   record the approved targets (Owner 2 / Selected Admin 2 / Staff 1) with
   `enforcement_implemented = false`. Binding Supabase sessions to this registry is Phase 2.
   **This is recorded, not enforced — it must not be described otherwise.**
3. **No MFA enforcement.** `staff_profiles.mfa_enrolled` is a flag only. aal1/aal2
   enforcement is Phase 2.
4. **Database triggers are not the authorization layer.** `enforce_owner_only_decision`
   is a safety net; sensitive actions must still be authorized server-side at execution
   time (Bible §29.3).
5. **Status transition _sequences_ are not fully enforced.** Constraints enforce the
   critical invariants (reservation, idempotency, Owner approval, miner ceiling). A full
   state machine per §22 belongs with the workflow phases that own each transition.
6. **Password policy (12-char minimum) is not enforced here** — it is an auth-layer
   concern for Phase 2.
7. Several §22.19 items remain open; see [Deliberately not modelled](#deliberately-not-modelled).

---

## Deferred to Phase 2

- Permission-aware RLS policies for every table
- Server-side authorization helpers; `requirePermission` at execution time
- Role/permission management UI boundary; Owner-only Selected Admin management
- TOTP MFA enrollment/verification; aal1 vs aal2 enforcement
- Session + trusted-device runtime enforcement
- 12-character password-policy validation
- Owner MFA readiness state before pilot

## Not production-ready

**This system must not be deployed to production or used for real business
operations.** Phase 1 is a database with proven integrity guarantees and
**no application on top of it**. There is no authorization enforcement, no MFA, no
workflow, and no UI.
