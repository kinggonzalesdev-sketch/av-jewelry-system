# UAT Execution Checklist — A.V. Jewelry (MineFlow) V1

**Print this. Fill it in by hand or on screen. One row per test.**

|                       |                                                   |
| --------------------- | ------------------------------------------------- |
| **UAT round**         | ☐ 1st ☐ Re-test                                   |
| **Start date**        | \_\_\_\_\_\_\_\_\_\_                              |
| **Environment**       | ☐ Staging (test data only) — **never production** |
| **Owner running UAT** | \_\_\_\_\_\_\_\_\_\_                              |

> **Before you start**, complete the setup in
> `docs/UAT-SETUP-ACCOUNTS-DATA-DEVICES.md`. You need the accounts, the sample
> data, and the devices ready, or tests will be blocked for the wrong reason.

---

## How to fill this in

- **Actual result** — write **what you saw**, not what you expected. "The screen
  said 'Not authorized: confirming a claim requires…'" is useful. "OK" is not.
- **Pass / Fail / Blocked** — **Blocked** means you could not run it (missing
  device, missing data). Blocked is not a Fail; it means try again later.
- **Evidence** — a screenshot filename. Suggested name:
  `UAT-04_step2_2026-07-20.png`. Put them all in one folder.
- **Defect ref** — if it failed, give it a number: `D-01`, `D-02`… and log it in
  §3.
- **Owner approval** — the Owner initials each scenario **after** reading the
  actual result. A tester cannot approve their own test.

**Do not fill in a result you did not personally observe.** An untested row left
blank is honest and useful. A guessed row is worse than no row at all — the
whole point of this system is that it refuses to pretend (Bible §34.2 r1).

**Severity scale** (from `docs/PHASE-11-TEST-PLAN.md` §3):

|        | Meaning                                                                                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------------ |
| **S1** | Critical — duplicate record, double stock deduction, unauthorized write, audit loss, wrong money. **Blocks everything.** |
| **S2** | Major — a rule is not enforced on some path, or a separation collapses. **Blocks pilot.**                                |
| **S3** | Moderate — confusing wording, weakened defence with another still holding. Blocks production, not pilot.                 |
| **S4** | Minor — cosmetic. Blocks nothing.                                                                                        |

---

## 1. Scenarios

### UAT-01 — Staff account works, then stops when deactivated

**Workflow:** Account access & deactivation · **Severity if failed:** S1
**Accounts:** `UAT-OWNER` + `UAT-STAFF-FULL`
**Sample data:** any item from the UAT set
**Device:** Android phone (Staff) + Windows desktop (Owner)

**Steps**

1. `UAT-STAFF-FULL` signs in and captures one claim.
2. `UAT-OWNER` deactivates the `UAT-STAFF-FULL` account.
3. `UAT-STAFF-FULL` tries to do anything (refresh, capture another claim).
4. `UAT-OWNER` opens the audit log and finds the claim from step 1.

**Expected**

- Step 3 is refused.
- Step 4 **still shows the Staff member's name** against the step-1 claim.

| Field                 | Fill in |
| --------------------- | ------- |
| Actual result         |         |
| Pass / Fail / Blocked |         |
| Evidence              |         |
| Tester                |         |
| Date                  |         |
| Defect ref            |         |
| Owner approval        |         |

---

### UAT-02 — A Selected Admin cannot do what they were not granted

**Workflow:** Granular permissions · **Severity if failed:** S1
**Accounts:** `UAT-OWNER` + `UAT-ADMIN`
**Sample data:** one Pending Claim
**Device:** Windows desktop

**Steps**

1. `UAT-OWNER` grants `UAT-ADMIN` **only** Claim Review. No other permission.
2. `UAT-ADMIN` opens a Pending Claim and tries **Confirm Claim & Print Label**.

**Expected**

- Refused. The message **names the missing permission**.
- Being an "Admin" grants nothing by itself.

| Field                 | Fill in |
| --------------------- | ------- |
| Actual result         |         |
| Pass / Fail / Blocked |         |
| Evidence              |         |
| Tester                |         |
| Date                  |         |
| Defect ref            |         |
| Owner approval        |         |

---

### UAT-03 — Live capture keeps up, and only creates Pending Claims

**Workflow:** Live Batch + Current Flex + capture · **Severity if failed:** S1 / S2
**Accounts:** `UAT-STAFF-FULL`
**Sample data:** `UAT-M01` (multi-stock, 5 units), `UAT-U01`, `UAT-U02`; customers `UAT-C01`–`UAT-C05`
**Device:** **Android phone** (this is how it will really be used)

**Steps**

1. Open a Live Batch. Set `UAT-U01` as the Current Flex Item.
2. Capture 10 claims as fast as is comfortable. **Time it.**
3. Switch Current Flex to `UAT-M01`. Capture 2 more.
4. Open the claim queue and count.

**Expected**

- 12 Pending Claims, correct customers.
- **No reservations. No stock moved.** Available quantity unchanged.
- The Flex switch affected only the claims captured _after_ it.

| Field                          | Fill in |
| ------------------------------ | ------- |
| Actual result                  |         |
| **Seconds per claim** (step 2) |         |
| Pass / Fail / Blocked          |         |
| Evidence                       |         |
| Tester                         |         |
| Date                           |         |
| Defect ref                     |         |
| Owner approval                 |         |

---

### UAT-04 — The double-tap does not reserve twice

**Workflow:** Confirm Claim & Print Label · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL`
**Sample data:** one Pending Claim on `UAT-M01` (5 units), quantity 2
**Device:** Android phone

**Steps**

1. Note `UAT-M01`'s available quantity. It should read **5**.
2. Open the Pending Claim. Tap **Confirm Claim & Print Label** **twice, fast** —
   like someone unsure the first tap registered.
3. Check the claim, the reservation, and the available quantity.

**Expected**

- One Confirmed Claim · one reservation · one label job.
- Available quantity reads **3**, not 1. Deducted **once**.

| Field                           | Fill in |
| ------------------------------- | ------- |
| Actual result                   |         |
| Available qty after (must be 3) |         |
| Pass / Fail / Blocked           |         |
| Evidence                        |         |
| Tester                          |         |
| Date                            |         |
| Defect ref                      |         |
| Owner approval                  |         |

---

### UAT-05 — Two staff confirm one claim at once

**Workflow:** Concurrent confirmation · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL` + `UAT-STAFF-2`
**Sample data:** one Pending Claim on `UAT-M01`
**Device:** **Two phones**, same claim open on both

**Steps**

1. Both testers open the same Pending Claim.
2. Count down out loud and both tap **Confirm** at the same moment.
3. Check the reservation count and the available quantity.

**Expected**

- **One** reservation. Stock deducted once.
- The second tester is told it was **already confirmed** — not shown an error
  that makes them think they broke something or should retry.

| Field                   | Fill in |
| ----------------------- | ------- |
| Actual result           |         |
| What the 2nd tester saw |         |
| Pass / Fail / Blocked   |         |
| Evidence                |         |
| Tester(s)               |         |
| Date                    |         |
| Defect ref              |         |
| Owner approval          |         |

---

### UAT-06 — "Confirmed but not printed" is understood

**Workflow:** Label failure handling · **Severity if failed:** S2
**Accounts:** `UAT-STAFF-FULL`
**Sample data:** one Pending Claim
**Device:** Android phone, **no printer connected**

**Steps**

1. Confirm a claim with no printer available.
2. Read the message on screen.
3. **Say out loud what you think happened.** The tester's own words are the test.
4. **Retry** the print. Then **Reprint** it (a reason is required).
5. Open the **label preview** in the browser.
6. Re-check the claim, the reservation, and the available quantity.

**Expected**

- Message reads like: "Claim confirmed — label printing failed."
- The tester says **the claim is fine and only the label needs reprinting**.
- Retry and Reprint both work **without any Bluetooth hardware**.
- **Neither creates a new claim, a new reservation, or a new deduction.**

| Field                                                         | Fill in                  |
| ------------------------------------------------------------- | ------------------------ |
| Actual result (exact message)                                 |                          |
| **Tester's own words** (step 3)                               |                          |
| Retry worked?                                                 | ☐ Yes ☐ No               |
| Reprint worked (with reason)?                                 | ☐ Yes ☐ No               |
| Label preview readable?                                       | ☐ Yes ☐ No               |
| **Reservation count after retry + reprint (must still be 1)** |                          |
| Available quantity unchanged by retry/reprint?                | ☐ Yes ☐ **No → S1 Fail** |
| Pass / Fail / Blocked                                         |                          |
| Evidence                                                      |                          |
| Tester                                                        |                          |
| Date                                                          |                          |
| Defect ref                                                    |                          |
| Owner approval                                                |                          |

> If the tester says "it failed, I'll confirm again" — that is a **Fail (S2)**.
> The wording is the defect, not the tester.
>
> **Retry, Reprint, and label preview need no XP-236B.** The label job is queued
> by the database and previewed in the browser; the attempt is recorded as
> `browser_preview`, never as a real print. Bluetooth printing stays
> **Unsupported / Unverified** (Owner ruling, `PILOT-READINESS-DECISION.md` §2).

---

### UAT-07 — Approve & Send Invoice twice makes one order

**Workflow:** Invoicing → Official Order · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL` (needs Invoice Preparation)
**Sample data:** 3 Confirmed Claims for `UAT-C01`, same payment + fulfillment arrangement
**Device:** Windows desktop

**Steps**

1. Group the 3 claims into one Invoice Draft.
2. **Approve & Send.** Write down the order number and invoice number.
3. Tap **Approve & Send** again.

**Expected**

- **One** Official Order. **Same** order number and invoice number as step 2.
- No second stock deduction.

| Field                               | Fill in |
| ----------------------------------- | ------- |
| Order no. after step 2              |         |
| Order no. after step 3 (must match) |         |
| Actual result                       |         |
| Pass / Fail / Blocked               |         |
| Evidence                            |         |
| Tester                              |         |
| Date                                |         |
| Defect ref                          |         |
| Owner approval                      |         |

---

### UAT-08 — Copying the message is not sending it

**Workflow:** Customer message · **Severity if failed:** S2
**Accounts:** `UAT-STAFF-FULL`
**Sample data:** the Official Order from UAT-07
**Device:** Android phone

**Steps**

1. Prepare the customer message. 2. **Copy** it.
2. **Before** marking anything — check the order's message state and the 3-day hold.
3. Send it by hand (Messenger/SMS), then tap **Mark as Sent**.

**Expected**

- After step 2 the order does **not** say Sent. The hold has **not** started.
- The hold starts only at step 4.

| Field                     | Fill in |
| ------------------------- | ------- |
| State after Copy (step 3) |         |
| Hold start time (step 4)  |         |
| Pass / Fail / Blocked     |         |
| Evidence                  |         |
| Tester                    |         |
| Date                      |         |
| Defect ref                |         |
| Owner approval            |         |

---

### UAT-09 — Verified is not Paid in Full

**Workflow:** Payment evidence → verification · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL` (needs Payment Verification)
**Sample data:** the UAT-07 Official Order for `UAT-C01`, total **₱24,000.00**;
a **partial** payment of **₱10,000.00** (fake screenshot evidence)
**Device:** Android phone + gallery (payment screenshot)

**Steps**

1. Record evidence of the ₱10,000.00 payment.
2. Verify it.
3. **Read the order's payment state out loud.**

**Expected**

- Reads **Verified**, with an **Outstanding Balance of ₱14,000.00**.
- Does **not** read Paid in Full.

| Field                                          | Fill in |
| ---------------------------------------------- | ------- |
| Payment state shown                            |         |
| Outstanding balance shown (must be ₱14,000.00) |         |
| **Tester's own words**                         |         |
| Pass / Fail / Blocked                          |         |
| Evidence                                       |         |
| Tester                                         |         |
| Date                                           |         |
| Defect ref                                     |         |
| Owner approval                                 |         |

---

### UAT-10 — The six Owner approvals cannot be delegated

**Workflow:** Owner Approval Center · **Severity if failed:** S1
**Accounts:** `UAT-ADMIN` (requester) + `UAT-OWNER` (decider)
**Sample data:** see the per-action data in `UAT-SETUP` §3.6
**Device:** Windows desktop (Owner) + phone (Admin)

**Run all six.** Tick each row.

| #   | Action                            | Admin **cannot** execute | Record unchanged before decision | Executes **once** on approval | 2nd approve tap does nothing |
| --- | --------------------------------- | ------------------------ | -------------------------------- | ----------------------------- | ---------------------------- |
| 1   | Official Order cancellation       | ☐                        | ☐                                | ☐                             | ☐                            |
| 2   | Layaway forfeiture                | ☐                        | ☐                                | ☐                             | ☐                            |
| 3   | Price override                    | ☐                        | ☐                                | ☐                             | ☐                            |
| 4   | Exceptional release               | ☐                        | ☐                                | ☐                             | ☐                            |
| 5   | Live Batch reopen                 | ☐                        | ☐                                | ☐                             | ☐                            |
| 6   | Verified wrong-payment correction | ☐                        | ☐                                | ☐                             | ☐                            |

**Expected:** every box ticked. A **request is not an execution** — nothing may
change until the Owner decides.

| Field                                 | Fill in |
| ------------------------------------- | ------- |
| Actual result (note any unticked box) |         |
| Pass / Fail / Blocked                 |         |
| Evidence                              |         |
| Tester(s)                             |         |
| Date                                  |         |
| Defect ref                            |         |
| Owner approval                        |         |

---

### UAT-11 — Stock returns only when someone decides it does

**Workflow:** Returned-to-Stock Review · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL` + reviewer with Miner Allocation Review
**Sample data:** one **Confirmed** Claim on `UAT-U02` (unique, has a 2nd miner)
**Device:** Windows desktop

**Steps**

1. Withdraw the confirmed claim (with a reason).
2. **Immediately** check `UAT-U02`'s availability.
3. Approve the Returned-to-Stock review.
4. Check availability again.

**Expected**

- Step 2: **NOT available** — held, awaiting review.
- Step 4: available.
- At **no point** is it auto-given to the 2nd miner or the waitlist.

| Field                                   | Fill in                  |
| --------------------------------------- | ------------------------ |
| Availability at step 2 (must be held)   |                          |
| Availability at step 4                  |                          |
| Did the 2nd miner get it automatically? | ☐ No ☐ **Yes → S1 Fail** |
| Pass / Fail / Blocked                   |                          |
| Evidence                                |                          |
| Tester                                  |                          |
| Date                                    |                          |
| Defect ref                              |                          |
| Owner approval                          |                          |

---

### UAT-12 — ⭐ The whole day, with nothing switched on

**Workflow:** Manual fallback end-to-end · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-FULL`
**Sample data:** fresh customer `UAT-C06`, item `UAT-M02`
**Device:** Android phone + Windows desktop + **a real printer of any kind**
(paper, not the XP-236B) + **no** Pancake, **no** direct send

**This is the most important scenario in the pack.** It is how V1 actually
launches. Everything in Phase 10 (printer, Pancake, direct send) is an
optimisation of this path, and all of it ships switched off.

**Steps** — run one complete sale, start to finish:

1. Capture the claim → 2. Confirm Claim & Print Label →
2. Preview the label in the browser → 4. Print it manually →
3. Build the invoice → 6. Copy the message → 7. Send it by hand →
4. Mark as Sent → 9. Record + verify payment → 10. Prepare fulfillment →
5. Release → 12. Dispatch.

**Expected**

- **Every step completes.** Nothing is blocked for want of an integration.
- Nothing on screen claims an unvalidated capability worked.

| Step                  | Completed? | Notes |
| --------------------- | ---------- | ----- |
| 1 Capture             | ☐          |       |
| 2 Confirm & label job | ☐          |       |
| 3 Browser preview     | ☐          |       |
| 4 Manual print        | ☐          |       |
| 5 Invoice             | ☐          |       |
| 6 Copy message        | ☐          |       |
| 7 Send by hand        | ☐          |       |
| 8 Mark as Sent        | ☐          |       |
| 9 Verify payment      | ☐          |       |
| 10 Prepare            | ☐          |       |
| 11 Release            | ☐          |       |
| 12 Dispatch           | ☐          |       |

| Field                                   | Fill in |
| --------------------------------------- | ------- |
| Actual result                           |         |
| **Total time for one sale**             |         |
| Pass / Fail / Blocked                   |         |
| Evidence                                |         |
| Tester                                  |         |
| Date                                    |         |
| Defect ref                              |         |
| **Owner approval (required for pilot)** |         |

---

### UAT-13 — Migration keeps history as history

**Workflow:** Existing Record Entry / Migration · **Severity if failed:** S1 / S2
**Accounts:** `UAT-OWNER` (or `UAT-ADMIN` with Existing Record Entry)
**Sample data:** `UAT-MIG-BATCH-01` — 3 fake past orders with **old dates and old prices**
**Device:** Windows desktop

**Steps**

1. Import the 3 past orders.
2. Compare each value against the source sheet.
3. Open the **live** claim queue.

**Expected**

- Old values and old dates preserved — **not** rewritten to today's.
- Source and imported-by recorded.
- **No fake claims** appear in the live queue.

| Field                                  | Fill in               |
| -------------------------------------- | --------------------- |
| Values preserved?                      |                       |
| Any migrated record in the live queue? | ☐ No ☐ **Yes → Fail** |
| Pass / Fail / Blocked                  |                       |
| Evidence                               |                       |
| Tester                                 |                       |
| Date                                   |                       |
| Defect ref                             |                       |
| Owner approval                         |                       |

---

### UAT-14 — Seeing is not exporting

**Workflow:** Search + Export permission · **Severity if failed:** S1
**Accounts:** `UAT-STAFF-NOPERM` (**no** Export Data/Reports)
**Sample data:** any customer in scope
**Device:** Android phone

**Steps**

1. Search for a customer the tester can legitimately see.
2. Try to export the results / a report.

**Expected**

- Search returns **only in-scope** records.
- Export is **refused** — seeing a record does not mean you may take it out.

| Field                             | Fill in                  |
| --------------------------------- | ------------------------ |
| Actual result                     |                          |
| Any out-of-scope records visible? | ☐ No ☐ **Yes → S1 Fail** |
| Pass / Fail / Blocked             |                          |
| Evidence                          |                          |
| Tester                            |                          |
| Date                              |                          |
| Defect ref                        |                          |
| Owner approval                    |                          |

---

## 2. Summary

| Scenario                       | Pass | Fail | Blocked | Severity if failed | Owner initials |
| ------------------------------ | ---- | ---- | ------- | ------------------ | -------------- |
| UAT-01 Account deactivation    | ☐    | ☐    | ☐       | S1                 |                |
| UAT-02 Admin ≠ authority       | ☐    | ☐    | ☐       | S1                 |                |
| UAT-03 Live capture pace       | ☐    | ☐    | ☐       | S1/S2              |                |
| UAT-04 Double-tap              | ☐    | ☐    | ☐       | S1                 |                |
| UAT-05 Two staff, one claim    | ☐    | ☐    | ☐       | S1                 |                |
| UAT-06 Confirmed not printed   | ☐    | ☐    | ☐       | S2                 |                |
| UAT-07 Send twice → one order  | ☐    | ☐    | ☐       | S1                 |                |
| UAT-08 Copy ≠ Sent             | ☐    | ☐    | ☐       | S2                 |                |
| UAT-09 Verified ≠ Paid in Full | ☐    | ☐    | ☐       | S1                 |                |
| UAT-10 Six Owner approvals     | ☐    | ☐    | ☐       | S1                 |                |
| UAT-11 Returned-to-Stock       | ☐    | ☐    | ☐       | S1                 |                |
| **UAT-12 Manual fallback** ⭐  | ☐    | ☐    | ☐       | S1                 |                |
| UAT-13 Migration               | ☐    | ☐    | ☐       | S1/S2              |                |
| UAT-14 Export scope            | ☐    | ☐    | ☐       | S1                 |                |

**Totals:** Pass \_\_\_ / Fail \_\_\_ / Blocked \_\_\_ of 14

---

## 3. Defect log

| Ref  | Scenario | What happened | Severity | Fixed? | Re-tested (date) | Owner accepts? |
| ---- | -------- | ------------- | -------- | ------ | ---------------- | -------------- |
| D-01 |          |               |          | ☐      |                  | ☐              |
| D-02 |          |               |          | ☐      |                  | ☐              |
| D-03 |          |               |          | ☐      |                  | ☐              |
| D-04 |          |               |          | ☐      |                  | ☐              |
| D-05 |          |               |          | ☐      |                  | ☐              |

---

## 4. UAT exit criteria (§34.6)

UAT passes only when **all** of these are true:

- [ ] Every one of the 14 scenarios has a recorded actual result and evidence
- [ ] **No S1 defect remains open**
- [ ] Every S2 is fixed, or the Owner has accepted a written workaround
- [ ] **UAT-12 passed without qualification** — this is the launch path
- [ ] Testers confirm **no scenario drove them to a workaround**

Passing UAT does **not** make the system Production Ready. A controlled pilot and
a successful backup/restore drill are also required — see
`docs/PILOT-READINESS-DECISION.md`.

**UAT complete — Owner signature:** \_\_\_\_\_\_\_\_\_\_ **Date:** \_\_\_\_\_\_\_\_\_\_
