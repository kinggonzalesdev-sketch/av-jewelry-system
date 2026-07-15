# Backup & Restore Drill — Staging Only

**Why this document exists:** Bible §34.6 blocks Production Ready while
backup/restore is untested. **A backup that has never been restored is not a
backup — it is a hope.** This drill turns it into a fact.

> ## ⚠️ Do not run any part of this against production
>
> Every step below targets **Staging** and a **separate scratch test project**.
> Nothing here touches production data, and the restore target must be a
> **different project** from the source — restoring over the source would destroy
> the very thing you are trying to prove you can recover.
>
> When the real production project exists, the Owner re-runs this same drill
> against a **production backup restored into a scratch project** — never into
> production itself.

---

## 1. Before you start

|                                                                   |                      |
| ----------------------------------------------------------------- | -------------------- |
| **Drill date**                                                    | \_\_\_\_\_\_\_\_\_\_ |
| **Run by**                                                        | \_\_\_\_\_\_\_\_\_\_ |
| **Source project** (Staging)                                      | \_\_\_\_\_\_\_\_\_\_ |
| **Restore target** (scratch — **must be a different project**)    | \_\_\_\_\_\_\_\_\_\_ |
| Source loaded with the UAT dataset?                               | ☐                    |
| Confirmed the target is **not** production and **not** the source | ☐                    |

**You will need:** the Supabase dashboard (or CLI) for both projects, and about
an hour. Time it — §5 asks how long it took, and that number is the answer to
"how long are we down if this happens for real?"

---

## 2. Step 1 — Record what you are about to save

Before backing up, write down what is in the source. If you do not know what
went in, you cannot tell whether it all came out.

Run in the **source** SQL editor:

```sql
select 'customers'              as table_name, count(*) from public.customers
union all select 'inventory_items',        count(*) from public.inventory_items
union all select 'claims',                 count(*) from public.claims
union all select 'inventory_reservations', count(*) from public.inventory_reservations
union all select 'label_jobs',             count(*) from public.label_jobs
union all select 'invoice_drafts',         count(*) from public.invoice_drafts
union all select 'official_orders',        count(*) from public.official_orders
union all select 'payments',               count(*) from public.payments
union all select 'payment_verifications',  count(*) from public.payment_verifications
union all select 'layaway_arrangements',   count(*) from public.layaway_arrangements
union all select 'fulfillment_records',    count(*) from public.fulfillment_records
union all select 'owner_approval_requests',count(*) from public.owner_approval_requests
union all select 'returned_to_stock_reviews', count(*) from public.returned_to_stock_reviews
union all select 'staff_profiles',         count(*) from public.staff_profiles
union all select 'staff_permission_grants',count(*) from public.staff_permission_grants
union all select 'audit_events',           count(*) from public.audit_events
order by table_name;
```

Write the numbers in the **Before** column of §5.

Also record these three, which are the ones that matter most:

```sql
-- The newest order. It must survive the restore intact.
select order_number, invoice_number, status, created_at
from public.official_orders order by created_at desc limit 1;

-- The newest audit event. Audit history is the thing you can never rebuild.
select occurred_at, actor_label, action, entity_type
from public.audit_events order by occurred_at desc limit 1;

-- Total verified money. If this changes, the restore is wrong.
select coalesce(sum(p.amount), 0) as total_verified
from public.payments p
where exists (select 1 from public.payment_verifications v where v.payment_id = p.id);
```

|                                         | Value before backup |
| --------------------------------------- | ------------------- |
| Newest order number                     |                     |
| Newest audit event (timestamp + action) |                     |
| **Total verified payments**             |                     |

---

## 3. Step 2 — Take the backup and record the timestamp

**Supabase dashboard:** Project → **Database** → **Backups** → note the latest
daily backup, or trigger one if the plan allows.

**Or by CLI** (from the project folder):

```bash
supabase db dump --db-url "<SOURCE_DB_URL>" -f uat-backup.sql
```

|                                             |                                         |
| ------------------------------------------- | --------------------------------------- |
| **Backup timestamp (exact, with timezone)** | \_\_\_\_\_\_\_\_\_\_                    |
| Method                                      | ☐ Dashboard backup ☐ `supabase db dump` |
| Backup file / snapshot reference            | \_\_\_\_\_\_\_\_\_\_                    |
| File size                                   | \_\_\_\_\_\_\_\_\_\_                    |
| **Time backup started**                     | \_\_\_\_\_\_\_\_\_\_                    |
| **Time backup finished**                    | \_\_\_\_\_\_\_\_\_\_                    |

> **The timestamp is the whole point.** In a real incident the question is "how
> much work did we lose?" — the answer is everything between this timestamp and
> the failure. Write it down exactly.

---

## 4. Step 3 — Restore into the separate target

**Confirm once more that the target is not the source and not production.** ☐

```bash
supabase db reset --db-url "<TARGET_DB_URL>"
psql "<TARGET_DB_URL>" -f uat-backup.sql
```

|                           |                                |
| ------------------------- | ------------------------------ |
| **Time restore started**  | \_\_\_\_\_\_\_\_\_\_           |
| **Time restore finished** | \_\_\_\_\_\_\_\_\_\_           |
| Restore reported errors?  | ☐ No ☐ Yes → record them below |

Errors (if any):

```

```

---

## 5. Step 4 — Validate row counts

Run the **same** count query from §2 against the **target**. Fill both columns.

| Table                     | Before | After restore | Match? |
| ------------------------- | ------ | ------------- | ------ |
| audit_events              |        |               | ☐      |
| claims                    |        |               | ☐      |
| customers                 |        |               | ☐      |
| fulfillment_records       |        |               | ☐      |
| inventory_items           |        |               | ☐      |
| inventory_reservations    |        |               | ☐      |
| invoice_drafts            |        |               | ☐      |
| label_jobs                |        |               | ☐      |
| layaway_arrangements      |        |               | ☐      |
| official_orders           |        |               | ☐      |
| owner_approval_requests   |        |               | ☐      |
| payment_verifications     |        |               | ☐      |
| payments                  |        |               | ☐      |
| returned_to_stock_reviews |        |               | ☐      |
| staff_permission_grants   |        |               | ☐      |
| staff_profiles            |        |               | ☐      |

**Any mismatch is a Fail.** Do not explain it away. A row that did not come back
is a customer, an order, or a payment that did not come back.

| Spot check                  | Before | After | Match? |
| --------------------------- | ------ | ----- | ------ |
| Newest order number         |        |       | ☐      |
| Newest audit event          |        |       | ☐      |
| **Total verified payments** |        |       | ☐      |

---

## 6. Step 5 — Validate the critical workflows on the restored copy

Row counts prove the data arrived. These prove it still **works**. Point the app
at the **restored target** and run each one.

| #   | Check                             | Expected                                              | Result        |
| --- | --------------------------------- | ----------------------------------------------------- | ------------- |
| 1   | Sign in as `UAT-STAFF-FULL`       | Works                                                 | ☐ Pass ☐ Fail |
| 2   | Open the restored Official Order  | Same order number, same total                         | ☐ Pass ☐ Fail |
| 3   | Capture a **new** claim           | Creates a Pending Claim                               | ☐ Pass ☐ Fail |
| 4   | Confirm it                        | One reservation, stock down once                      | ☐ Pass ☐ Fail |
| 5   | Confirm it **again** (double-tap) | **Still one** reservation                             | ☐ Pass ☐ Fail |
| 6   | Approve & Send an invoice         | One order, new number, no clash with restored numbers | ☐ Pass ☐ Fail |
| 7   | Verify a payment                  | Verified ≠ Paid in Full                               | ☐ Pass ☐ Fail |

> **Check 6 matters more than it looks.** Order and invoice numbers come from
> database sequences. If a restore resets a sequence, the next order can collide
> with a restored one — a duplicate business reference, which is an **S1**. This
> is the single most likely way a restore looks fine and is not.

---

## 7. Step 6 — Auth and permissions survived

| #   | Check                                      | Expected                                | Result        |
| --- | ------------------------------------------ | --------------------------------------- | ------------- |
| 1   | All 6 UAT accounts present                 | 6 profiles                              | ☐ Pass ☐ Fail |
| 2   | `UAT-STAFF-LIMITED` still limited          | Capture only; **cannot** confirm        | ☐ Pass ☐ Fail |
| 3   | `UAT-STAFF-NOPERM` still powerless         | Signed in, can do nothing               | ☐ Pass ☐ Fail |
| 4   | `UAT-OWNER` still the only Owner           | Owner-only approvals refuse `UAT-ADMIN` | ☐ Pass ☐ Fail |
| 5   | A deactivated account is still deactivated | No access; history intact               | ☐ Pass ☐ Fail |

> A restore that brings the data back but **widens** permissions is worse than a
> failed restore: it fails open and nobody notices.

---

## 8. Step 7 — Audit history survived and is still append-only

| #   | Check                                                            | Expected                      | Result        |
| --- | ---------------------------------------------------------------- | ----------------------------- | ------------- |
| 1   | Audit row count matches §5                                       | Exact match                   | ☐ Pass ☐ Fail |
| 2   | Newest audit event matches §2                                    | Same timestamp, actor, action | ☐ Pass ☐ Fail |
| 3   | A departed staff member's name still appears                     | Attribution survives          | ☐ Pass ☐ Fail |
| 4   | Try `update public.audit_events set action = 'x'` as an app user | **Refused**                   | ☐ Pass ☐ Fail |
| 5   | Try `delete from public.audit_events` as an app user             | **Refused**                   | ☐ Pass ☐ Fail |

Checks 4 and 5 exist because Phase 11 found that a later migration had already
eroded one of the three append-only defences once, without anything going red
(`docs/PHASE-11-TEST-PLAN.md` §5). A restore is exactly the kind of event that
could quietly reset grants. **Verify, do not assume.**

---

## 9. Step 8 — Elapsed time

|                                               |                  |
| --------------------------------------------- | ---------------- |
| Backup duration                               | \_\_\_\_\_\_ min |
| Restore duration                              | \_\_\_\_\_\_ min |
| Validation duration                           | \_\_\_\_\_\_ min |
| **Total wall-clock time**                     | \_\_\_\_\_\_ min |
| **Realistic recovery time if this were real** | \_\_\_\_\_\_ min |

> The last row is the number to tell staff. "If the database dies mid-live, we
> are back in about \_\_\_ minutes, having lost at most the work since the last
> backup." If that answer is unacceptable, the backup **frequency** is what needs
> to change — not this drill.

---

## 10. Result

|                 |                                     |
| --------------- | ----------------------------------- |
| **Overall**     | ☐ **Pass** ☐ **Fail** ☐ **Blocked** |
| Blocked because | \_\_\_\_\_\_\_\_\_\_                |
| Defects raised  | \_\_\_\_\_\_\_\_\_\_                |

**Pass requires all of:**

- [ ] Backup completed and its **timestamp recorded**
- [ ] Restore completed into a **separate** project with no errors
- [ ] **Every** row count matches
- [ ] All 7 workflow checks pass — **including sequence check 6**
- [ ] All 5 auth/permission checks pass
- [ ] All 5 audit checks pass
- [ ] Elapsed time recorded

**Anything less is a Fail.** §34.6 lists untested backup/restore as a hard
blocker on Production Ready. A partial pass is an untested restore with extra
steps.

|                    |                                                    |
| ------------------ | -------------------------------------------------- |
| **Run by**         | \_\_\_\_\_\_\_\_\_\_ **Date** \_\_\_\_\_\_\_\_\_\_ |
| **Owner sign-off** | \_\_\_\_\_\_\_\_\_\_ **Date** \_\_\_\_\_\_\_\_\_\_ |

---

## 11. Owner decisions this drill depends on (§35.18)

Still open. The drill can be **run** on Staging without them, but production
readiness cannot be **declared** without them:

- [ ] **Backup frequency** — how much work may we lose? (daily = up to a day)
- [ ] **Retention** — how far back must we be able to go?
- [ ] **Who may restore** — production restore is a destructive privilege
- [ ] **Where backups live** — and who can read them (they contain everything)
- [ ] **How often this drill repeats** — a restore proven once is proven once
