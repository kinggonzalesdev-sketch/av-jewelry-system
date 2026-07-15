# UAT Setup — Test Accounts, Sample Data & Devices

**Do this once, before UAT day 1.** When this is done, every scenario in
`docs/UAT-EXECUTION-CHECKLIST.md` can be run without stopping to build data.

> ## ⚠️ Staging only
>
> Everything in this document is **synthetic** — invented people, invented
> jewellery, invented money. It goes into a **Staging/test Supabase project and
> nowhere else**.
>
> Bible §30.3 r16 and §34.2 r17: **test data must never contaminate production.**
> If any name here ever appears in the real system, something has gone wrong —
> which is exactly why every record is prefixed `UAT-` and every phone number is
> a `0999-000-00xx` fake.
>
> **No real customer. No real card number. No real payment screenshot.**

---

## 1. Test accounts (B)

Create these **in Staging only**. Do not create them in production.

| #   | Account label       | Role               | Permissions to grant                                                                                                                                                                                                                                                                                                            | Why it exists                                                                                                                         |
| --- | ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `UAT-OWNER`         | **Owner**          | _(none granted — deliberately)_                                                                                                                                                                                                                                                                                                 | Proves the Owner **role title alone grants nothing** operationally, and decides the six approvals.                                    |
| 2   | `UAT-ADMIN`         | **Selected Admin** | Claim Review · Existing Record Entry · Initiate High-Risk Action                                                                                                                                                                                                                                                                | The highest **non-Owner** authority. If anyone could slip past the Owner gate it would be them — so they are the one to test it with. |
| 3   | `UAT-STAFF-FULL`    | Staff              | Claim Capture · Confirm Claim & Print Label · Invoice Preparation · Message Preparation · Message Sending · Payment Verification · Fulfillment Preparation · Fulfillment Release · Layaway Monitoring · Inventory Monitoring · Miner Allocation Review · Live Batch Operation · Current Flex Item Control · Retry/Reprint Label | The everyday operator. Runs the main workflow.                                                                                        |
| 4   | `UAT-STAFF-2`       | Staff              | Claim Capture · Confirm Claim & Print Label                                                                                                                                                                                                                                                                                     | Second pair of hands for the concurrency test (UAT-05).                                                                               |
| 5   | `UAT-STAFF-LIMITED` | Staff              | Claim Capture **only**                                                                                                                                                                                                                                                                                                          | Proves **no permission silently includes another** — capture is not confirm.                                                          |
| 6   | `UAT-STAFF-NOPERM`  | Staff              | _(none)_                                                                                                                                                                                                                                                                                                                        | Proves a signed-in account with no grants can do nothing, and cannot export.                                                          |

**Owner grants nothing to `UAT-OWNER` on purpose.** That is not an oversight —
Bible §5.13: role title is not authority. If the Owner needs to perform an
operational action during UAT, grant it explicitly and note it on the checklist.

**Sign-in details** (Owner fills in; never commit these to the repository):

| Account             | Email | Password set? | Notes |
| ------------------- | ----- | ------------- | ----- |
| `UAT-OWNER`         |       | ☐             |       |
| `UAT-ADMIN`         |       | ☐             |       |
| `UAT-STAFF-FULL`    |       | ☐             |       |
| `UAT-STAFF-2`       |       | ☐             |       |
| `UAT-STAFF-LIMITED` |       | ☐             |       |
| `UAT-STAFF-NOPERM`  |       | ☐             |       |

> **Max two Selected Admins** is an approved rule. One is enough for UAT.

---

## 2. Sample data (C) — synthetic only

### 2.1 Customers

| Code      | Display name              | Fake contact  | Used by                    |
| --------- | ------------------------- | ------------- | -------------------------- |
| `UAT-C01` | Test Customer Ana Cruz    | 0999-000-0001 | UAT-03, 04, 07, 08, 09, 11 |
| `UAT-C02` | Test Customer Ben Santos  | 0999-000-0002 | Exact payment · 2nd miner  |
| `UAT-C03` | Test Customer Cara Reyes  | 0999-000-0003 | Overpayment                |
| `UAT-C04` | Test Customer Dino Lim    | 0999-000-0004 | Layaway (healthy)          |
| `UAT-C05` | Test Customer Elle Tan    | 0999-000-0005 | Layaway (overdue)          |
| `UAT-C06` | Test Customer Fay Ocampo  | 0999-000-0006 | UAT-12 manual fallback     |
| `UAT-C07` | Test Customer Gil Navarro | 0999-000-0007 | Cancellation               |

### 2.2 Inventory items

| Code      | Name                  | Type            | Qty   | Grams/pc | Price/pc   | Used by                          |
| --------- | --------------------- | --------------- | ----- | -------- | ---------- | -------------------------------- |
| `UAT-U01` | Test Ring Solitaire   | **Unique**      | 1     | 5.000    | ₱10,000.00 | UAT-03, 07                       |
| `UAT-U02` | Test Necklace Rope    | **Unique**      | 1     | 8.000    | ₱20,000.00 | 1st/2nd miner · **RTS (UAT-11)** |
| `UAT-M01` | Test Bangle Classic   | **Multi-stock** | **5** | 12.500   | ₱8,000.00  | UAT-04, 05, 07                   |
| `UAT-M02` | Test Earrings Pair    | **Multi-stock** | **3** | 3.000    | ₱6,000.00  | Waitlist · UAT-07, 12            |
| `UAT-L01` | Test Layaway Chain    | Unique          | 1     | 5.000    | ₱25,000.00 | Layaway (healthy)                |
| `UAT-L02` | Test Layaway Bracelet | Unique          | 1     | 6.000    | ₱30,000.00 | Layaway (overdue)                |

> **`UAT-M01` has 5 units on purpose.** UAT-04 consumes 2 and UAT-07 consumes 1,
> leaving 2 spare. Multi-stock also matters for a subtler reason: on a _unique_
> item the quantity guard fires before the one-reservation-per-claim rule, so a
> "reserved exactly once" test on a unique item can pass for the wrong reason.
> UAT-04 and UAT-05 must use `UAT-M01`.

### 2.3 First and second miners

| Item      | 1st miner | 2nd miner | Note                                                                                                                   |
| --------- | --------- | --------- | ---------------------------------------------------------------------------------------------------------------------- |
| `UAT-U02` | `UAT-C01` | `UAT-C02` | Unique item: **1st and 2nd only — never a 3rd.** Used by UAT-11 to prove the 2nd miner gets **nothing automatically**. |

### 2.4 Claims to pre-create

All claims are born **Pending**. Do not insert an already-confirmed claim.

| Ref          | Customer  | Item      | Qty   | State to leave it in         | Used by                 |
| ------------ | --------- | --------- | ----- | ---------------------------- | ----------------------- |
| `UAT-CLM-01` | `UAT-C01` | `UAT-M01` | **2** | **Pending**                  | UAT-04 (double-tap)     |
| `UAT-CLM-02` | `UAT-C01` | `UAT-M01` | 1     | **Pending**                  | UAT-05 (two staff)      |
| `UAT-CLM-03` | `UAT-C01` | `UAT-U01` | 1     | **Confirmed**                | UAT-07 grouping         |
| `UAT-CLM-04` | `UAT-C01` | `UAT-M01` | 1     | **Confirmed**                | UAT-07 grouping         |
| `UAT-CLM-05` | `UAT-C01` | `UAT-M02` | 1     | **Confirmed**                | UAT-07 grouping         |
| `UAT-CLM-06` | `UAT-C01` | `UAT-U02` | 1     | **Confirmed**                | UAT-11 (withdraw → RTS) |
| `UAT-CLM-07` | `UAT-C06` | `UAT-M02` | 1     | _(none — tester creates it)_ | UAT-12                  |

### 2.5 Invoice → Official Order → payments

**UAT-07 order** (built during the test, from `UAT-CLM-03/04/05`):

| Line | Item                     | Qty | Amount         |
| ---- | ------------------------ | --- | -------------- |
| 1    | `UAT-U01`                | 1   | ₱10,000.00     |
| 2    | `UAT-M01`                | 1   | ₱8,000.00      |
| 3    | `UAT-M02`                | 1   | ₱6,000.00      |
|      | **Total Amount Payable** |     | **₱24,000.00** |

**Payment cases** — all three are separate orders so they cannot interfere:

| Case                 | Customer  | Order total | Pay        | Verified? | Expected result                                                                                                                      |
| -------------------- | --------- | ----------- | ---------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Partial** (UAT-09) | `UAT-C01` | ₱24,000.00  | ₱10,000.00 | Yes       | **Verified**, Outstanding **₱14,000.00**. **Not** Paid in Full.                                                                      |
| **Exact**            | `UAT-C02` | ₱6,000.00   | ₱6,000.00  | Yes       | Outstanding **₱0.00** → Paid in Full.                                                                                                |
| **Overpayment**      | `UAT-C03` | ₱8,000.00   | ₱10,000.00 | Yes       | Outstanding **₱0.00** (never negative) + **Overpayment Credit ₱2,000.00**, **flagged for review**. No auto-refund, no auto-transfer. |

**Payment evidence** — use a **fake** screenshot. Approved methods need: amount ·
date/time · provider · reference number · proof image. **Never record a real card
number, CVV, or PIN** — the system must never hold them.

### 2.6 Layaway

Fee rule (approved): **₱150 × total layaway grams × months**, rounded half-up at
the **end**. Required down payment: **20% of the Layaway Amount Payable, fee
included.**

**Healthy layaway — `UAT-C04` / `UAT-L01`:**

|                                 |                                                  |
| ------------------------------- | ------------------------------------------------ |
| Item value                      | ₱25,000.00                                       |
| Grams                           | 5.000 · **Months** 3                             |
| Layaway fee                     | 150 × 5.000 × 3 = **₱2,250.00**                  |
| **Layaway Amount Payable**      | **₱27,250.00**                                   |
| **Required down payment (20%)** | **₱5,450.00**                                    |
| Set up as                       | DP of ₱5,450.00 **verified** → status **Active** |

**Overdue layaway — `UAT-C05` / `UAT-L02`:**

|                                 |                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------- |
| Item value                      | ₱30,000.00                                                                                     |
| Grams                           | 6.000 · **Months** 3                                                                           |
| Layaway fee                     | 150 × 6.000 × 3 = **₱2,700.00**                                                                |
| **Layaway Amount Payable**      | **₱32,700.00**                                                                                 |
| **Required down payment (20%)** | **₱6,540.00**                                                                                  |
| Set up as                       | DP verified → Active, then **backdate** the final due date to **more than 10 days ago**        |
| Expected                        | **Forfeiture Eligible** — and **nothing forfeits automatically**. It waits for Owner approval. |

> **Backdating is a staging-only setup step.** Grace is 10 calendar days after
> the final due date, adds no extra month and no extra fee.

### 2.7 Fulfillment

| Ref          | Order                      | Arrangement  | Leave it at     | Used by                                 |
| ------------ | -------------------------- | ------------ | --------------- | --------------------------------------- |
| `UAT-FUL-01` | UAT-07 order               | **Shipping** | For Preparation | UAT-12 (prepare → release → dispatch)   |
| `UAT-FUL-02` | `UAT-C02` exact-paid order | **Pickup**   | For Preparation | Exceptional release request (UAT-10 #4) |

### 2.8 Cancellation

| Ref          | Order                                     | Set up as                                             | Used by   |
| ------------ | ----------------------------------------- | ----------------------------------------------------- | --------- |
| `UAT-CAN-01` | `UAT-C07`, one `UAT-M02` claim → invoiced | A live Official Order to request cancellation against | UAT-10 #1 |

Cancellation is a **non-delegable Owner approval**. It needs a reason and an
Owner approval reference. It cannot be done by `UAT-ADMIN`.

### 2.9 Returned-to-Stock Review

| Ref          | Item                       | Set up as                                                      | Used by |
| ------------ | -------------------------- | -------------------------------------------------------------- | ------- |
| `UAT-RTS-01` | `UAT-U02` via `UAT-CLM-06` | Confirmed claim, reservation held, 2nd miner `UAT-C02` waiting | UAT-11  |

Expected: withdrawal → **held, not available** → review approved → available.
Never auto-returned, never auto-given to the 2nd miner.

### 2.10 Migration batch

`UAT-MIG-BATCH-01` — a small sheet of **3 fake past orders**, each with an **old
date and an old price** that differ from today's:

| Ref          | Customer                 | Item text  | Historical date | Historical amount |
| ------------ | ------------------------ | ---------- | --------------- | ----------------- |
| `UAT-MIG-01` | Test Customer Hana Dizon | Old ring   | 2025-03-14      | ₱7,500.00         |
| `UAT-MIG-02` | Test Customer Iggy Perez | Old bangle | 2025-06-02      | ₱12,000.00        |
| `UAT-MIG-03` | Test Customer Jo Ramos   | Old chain  | 2025-09-21      | ₱18,250.00        |

Expected: old values preserved, source + imported-by recorded, and **no fake
claims in the live queue**.

### 2.11 Reset between rounds

Stock is consumed as scenarios run. **Before a fresh UAT round, reset the
Staging database and reload this dataset.** Do not "fix up" a half-used dataset
by hand — you will spend the round debugging your data instead of the system.

---

## 3. Device matrix (D)

### 3.1 Devices

| #   | Device                                 | Needed for                                                  | Who supplies | Ready? |
| --- | -------------------------------------- | ----------------------------------------------------------- | ------------ | ------ |
| 1   | **Windows desktop**                    | Owner approvals, invoicing, migration, reports              | Owner        | ☐      |
| 2   | **Android phone**                      | Live capture, confirm, payments — **the real daily device** | Staff        | ☐      |
| 3   | **Second phone** (Android or iPhone)   | UAT-05 concurrency                                          | Staff        | ☐      |
| 4   | **iPhone**                             | iOS check: capture + Share intake                           | Staff        | ☐      |
| 5   | **Any ordinary printer** (A4/receipt)  | UAT-12 manual label printing                                | Owner        | ☐      |
| 6   | **Xprinter XP-236B** + 40×30 mm labels | Phase 10 printer validation — **see §3.4**                  | Owner        | ☐      |

### 3.2 Browsers

| Browser         | Device          | Ready? |
| --------------- | --------------- | ------ |
| Chrome (latest) | Windows desktop | ☐      |
| Edge (latest)   | Windows desktop | ☐      |
| Chrome (latest) | Android         | ☐      |
| Safari (latest) | iPhone          | ☐      |

### 3.3 Conditions to test — **all manual**

| Condition                  | How                                                        | Expected                                                                                                  | Manual?       |
| -------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------- |
| **Camera / gallery**       | Attach a payment screenshot from the gallery; take a photo | Accepted, attached to the right record. Item photo ≠ payment evidence. **No OCR — nothing is auto-read.** | ✋ **Manual** |
| **Weak internet**          | Throttle to slow 3G, or walk to a dead spot mid-action     | Either it completes or it fails **cleanly**. **Never a duplicate claim, order, or payment.**              | ✋ **Manual** |
| **Interrupted internet**   | Turn Wi-Fi/data **off** mid-Confirm and mid-Approve & Send | Nothing half-written. On reconnect, retrying **does not** create a second record.                         | ✋ **Manual** |
| **Screen lock mid-action** | Lock the phone during Confirm, unlock, resume              | No duplicate. State is honest.                                                                            | ✋ **Manual** |

> The interrupted-internet tests matter more than they look. A dropped
> connection mid-Confirm is the single most likely way a real live-selling night
> produces a duplicate. The database is built to refuse it. **Try to break it.**

### 3.4 ✋ Printer — read this before testing

> ### 🔴 Bluetooth printing: **UNSUPPORTED / UNVERIFIED**
>
> The Xprinter XP-236B has **never been tested against real hardware**. Nothing
> in this system claims the printer integration works, and the capability ships
> **switched OFF**. The database refuses to enable it without a recorded
> **passing** real-device validation.
>
> **Do not tell staff the printer works.** It is not known to work.

**Owner ruling (2026-07-16)** — recorded in `docs/PILOT-READINESS-DECISION.md` §2:

|                            | For UAT & controlled pilot        | Before Production Ready                     |
| -------------------------- | --------------------------------- | ------------------------------------------- |
| **Manual / browser print** | **Acceptable — this is the path** | Still the fallback                          |
| **Physical XP-236B print** | **Not required to begin UAT**     | **REQUIRED**, with actual 40 × 30 mm labels |

| Test                                                            | Manual?                           | Blocks UAT / pilot?                                |
| --------------------------------------------------------------- | --------------------------------- | -------------------------------------------------- |
| **UAT-12 manual printing** (browser preview → ordinary printer) | ✋ Manual                         | **YES — this is the launch path**                  |
| **Retry / Reprint / label preview**                             | ✋ Manual                         | **YES — testable today, no XP-236B needed**        |
| **XP-236B Bluetooth pairing + 40 × 30 mm print**                | ✋ **Manual, real hardware only** | **No for UAT/pilot · YES before Production Ready** |

**Retry, Reprint, label preview, and manual print are all testable right now**
without any Bluetooth hardware. A label job is queued by the database and
previewed in the browser; the transport is recorded as `browser_preview`, never
as a real print. That separation is deliberate: a mock result can never
masquerade as paper.

Per §35 r10–11 and §36 principles 1–6, **V1 launches on manual fallback**. The
printer is an optimisation, not a dependency. If the XP-236B is never tested, or
fails, the capability stays off and **launch proceeds** — designed behaviour, not
a workaround.

**Before Production Ready** the XP-236B must pass all seven checks in
`docs/PILOT-READINESS-DECISION.md` §2.1: alignment · readability · reconnect ·
retry · duplicate prevention · mobile compatibility · honest evidence. Record the
result at `/admin/capabilities`. A "passed" entry with no real device behind it
is the one lie the whole gate exists to prevent (§34.2 r14).

### 3.5 Not testable in UAT

| Item                                 | Why                          | Where it belongs     |
| ------------------------------------ | ---------------------------- | -------------------- |
| Pancake / Meta integration           | No API access or credentials | Phase 10, gated off  |
| Direct send · Delivered/Read         | Depends on Pancake/Meta      | Phase 10, gated off  |
| Android floating capture · iOS Share | Native capture never built   | Phase 10, documented |
| Performance under real load          | Needs a load-test setup      | Deferred (§34.9)     |

None of these block V1. All fall back to manual, which UAT-12 tests.

---

## 4. Setup sign-off

|                                        |                      |
| -------------------------------------- | -------------------- |
| Accounts created (6)                   | ☐                    |
| Sample data loaded                     | ☐                    |
| Devices ready                          | ☐                    |
| Staging confirmed — **not production** | ☐                    |
| Evidence folder created                | ☐                    |
| **Setup completed by**                 | \_\_\_\_\_\_\_\_\_\_ |
| **Date**                               | \_\_\_\_\_\_\_\_\_\_ |
