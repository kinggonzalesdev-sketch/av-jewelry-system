# Phase 11 — Staff UAT Preparation & Test Scenarios

**Bible refs:** §34.2 r19 (Staff UAT required), §34.3 stage 17, §34.4
(per-test-area attributes), §34.5 (critical workflows) · **Roadmap:** Phase 11

**Status: PREPARED, NOT RUN.** §34.9 leaves UAT participants to the Owner, and
UAT means _real staff running real scenarios_ — a session cannot perform it, and
recording it as passed would be a fabrication of the exact kind §34.2 r1 warns
about. These scenarios are the artifact the Owner needs to run it.

> ## 👉 To actually run UAT, use the execution pack
>
> **This document is the _rationale_** — why each scenario exists and what
> failing it means. It is the reference, not the worksheet.
>
> | Do this                                      | Document                                  |
> | -------------------------------------------- | ----------------------------------------- |
> | **1. Set up** accounts, sample data, devices | `docs/UAT-SETUP-ACCOUNTS-DATA-DEVICES.md` |
> | **2. Run the tests** and record results      | `docs/UAT-EXECUTION-CHECKLIST.md`         |
> | **3. Prove the backup restores**             | `docs/BACKUP-RESTORE-DRILL.md`            |
> | **4. Decide** whether to pilot               | `docs/PILOT-READINESS-DECISION.md`        |
>
> The 14 scenarios are the same in both places. The execution checklist carries
> the fill-in fields, exact data, and devices; this document explains what each
> one is defending and why it was written that way.

---

## 1. How to use this document

Each scenario carries the §34.4 attributes: **objective · role · steps ·
expected · failure · severity**. They are written for a staff member to follow
on a phone, not for an engineer.

**Environment:** a Development or Staging Supabase project with test data only.
**Never production.** §30.3 r16 and §34.2 r17: test data must not contaminate
production.

**Recording a result:** write what you _saw_, not what you expected. "The screen
said X" is evidence. "It worked" is not (§34.2 r1).

**Participants (Owner to fill in before UAT):**

| Role                   | Person | Account |
| ---------------------- | ------ | ------- |
| Owner                  | _TBC_  | _TBC_   |
| Selected Admin (max 2) | _TBC_  | _TBC_   |
| Staff                  | _TBC_  | _TBC_   |

---

## 2. What UAT must confirm that automated tests cannot

The automated suite proves the rules hold. It cannot prove the system is
**usable by the people who must use it under live-selling pressure**. UAT exists
for the second question. Focus attention there:

- Can a claim be captured fast enough while a live is running?
- Is a refusal message understandable to the person who hit it, or does it send
  them to try again in a way that makes things worse?
- Does the operator understand what "confirmed but not printed" means?
- Does anyone feel the need to work around the system? **Record it.** A
  workaround discovered in UAT is a design finding, not a training problem.

---

## 3. Scenarios

### UAT-01 — Account access and deactivation (§5.11, §30.3 r17)

|               |                                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective** | An individual account works; a deactivated one stops working; history survives.                                                          |
| **Role**      | Owner + one Staff                                                                                                                        |
| **Steps**     | 1. Staff signs in, captures a claim. 2. Owner deactivates the Staff account. 3. Staff attempts any action. 4. Owner opens the audit log. |
| **Expected**  | Step 3 is refused. Step 4 still shows the Staff member's name against the claim from step 1.                                             |
| **Failure**   | Staff can still act after deactivation (**S1**), or their name has vanished from history (**S1** — §31).                                 |

### UAT-02 — Role title is not authority (§5.13, §30.2)

|               |                                                                                               |
| ------------- | --------------------------------------------------------------------------------------------- |
| **Objective** | A Selected Admin cannot do what they were not explicitly granted.                             |
| **Role**      | Owner + Selected Admin                                                                        |
| **Steps**     | 1. Owner grants the Admin _only_ Claim Review. 2. Admin attempts Confirm Claim & Print Label. |
| **Expected**  | Refused. The message names the missing permission.                                            |
| **Failure**   | Permitted (**S1**). Refused with a message the Admin cannot act on (**S3**).                  |

### UAT-03 — Live capture under pressure (§12, §13)

|               |                                                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective** | Capture keeps up with a real live, and creates Pending Claims only.                                                                                      |
| **Role**      | Staff                                                                                                                                                    |
| **Steps**     | 1. Open a Live Batch, set a Current Flex Item. 2. Capture 10 claims as fast as comfortable. 3. Switch Current Flex, capture 2 more. 4. Review the queue. |
| **Expected**  | 12 Pending Claims, correct customers. No reservations. No stock moved. The Flex switch affected only claims after it.                                    |
| **Failure**   | Any claim confirmed or reserved by capture (**S1**). Capture too slow to keep up (**S2** — record the actual pace).                                      |

### UAT-04 — The double-tap (§34.2 r4; the reason this scenario exists)

|               |                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective** | A nervous double-tap on Confirm does not reserve twice.                                                                               |
| **Role**      | Staff                                                                                                                                 |
| **Steps**     | 1. Open a Pending Claim. 2. Tap **Confirm Claim & Print Label** twice, fast. 3. Check the item's available quantity and the claim.    |
| **Expected**  | One Confirmed Claim, one reservation, one label job. Stock down by the claimed quantity **once**.                                     |
| **Failure**   | Two reservations or a double deduction (**S1**).                                                                                      |
| **Note**      | The database proves this in `15_phase11_e2e_lifecycle.test.sql`. UAT exists to confirm the _UI_ does not find a new way to ask twice. |

### UAT-05 — Two staff, one claim (§34.2 r5)

|               |                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Objective** | Concurrent confirmation yields one reservation.                                                                          |
| **Role**      | Two Staff, two phones, same claim                                                                                        |
| **Steps**     | Both tap Confirm at the same moment on the same claim.                                                                   |
| **Expected**  | One reservation. The second operator is told it is already confirmed — not shown an error implying they broke something. |
| **Failure**   | Two reservations (**S1**). A message that sends the loser to retry (**S3**).                                             |

### UAT-06 — Confirmed but not printed (§24, §7)

|               |                                                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Objective** | The operator understands that the claim stands when paper fails.                                                     |
| **Role**      | Staff                                                                                                                |
| **Steps**     | 1. Confirm a claim with no printer available. 2. Read the message. 3. Say aloud what you think happened.             |
| **Expected**  | "Claim confirmed — label printing failed." The operator says the claim is fine and the label needs reprinting.       |
| **Failure**   | The operator believes confirmation failed and confirms again (**S2** — the message is the defect, not the operator). |

### UAT-07 — Approve & Send Invoice, twice (§15, §22.9, §34.2 r9)

|               |                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Objective** | A retried send does not create a second Official Order.                                                                |
| **Role**      | Staff with Invoice Preparation                                                                                         |
| **Steps**     | 1. Group 2–3 confirmed claims for one customer. 2. Approve & Send. Note the order number. 3. Tap Approve & Send again. |
| **Expected**  | One Official Order. **Same** order and invoice number. No second deduction.                                            |
| **Failure**   | A second order or a new number (**S1**).                                                                               |

### UAT-08 — Copy ≠ Sent (§15.34, §22.10, §26)

|               |                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Objective** | The system never claims a message was sent when it was copied.                                                                |
| **Role**      | Staff                                                                                                                         |
| **Steps**     | 1. Prepare the customer message. 2. Copy it. 3. Check the order **before** marking sent. 4. Send manually, then Mark as Sent. |
| **Expected**  | After step 2 the order does **not** read Sent. The 3-day hold starts only at step 4.                                          |
| **Failure**   | Copy marks it sent or starts the hold (**S2**).                                                                               |

### UAT-09 — Verified is not Paid in Full (§16)

|               |                                                                                                             |
| ------------- | ----------------------------------------------------------------------------------------------------------- |
| **Objective** | The separation survives contact with a real operator.                                                       |
| **Role**      | Staff with Payment Verification                                                                             |
| **Steps**     | 1. Record evidence of a partial payment. 2. Verify it. 3. Read the order's payment state aloud.             |
| **Expected**  | Verified, with an outstanding balance. Not Paid in Full.                                                    |
| **Failure**   | Verification marks it Paid in Full (**S1**). The operator reads it as fully paid (**S2** — wording defect). |

### UAT-10 — The six Owner approvals (§5.13, §30.9)

|               |                                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Objective** | Non-delegable means non-delegable; a request is not an execution.                                                                                                                                                                                                        |
| **Role**      | Selected Admin + Owner                                                                                                                                                                                                                                                   |
| **Steps**     | For **each** of: order cancellation, forfeiture, price override, exceptional release, Live Batch reopen, verified wrong-payment correction — 1. Admin requests it. 2. Check the record before the Owner decides. 3. Owner approves. 4. Owner taps approve a second time. |
| **Expected**  | Admin cannot execute. Step 2: nothing changed. Step 3: executes once. Step 4: does not execute again.                                                                                                                                                                    |
| **Failure**   | Any non-Owner execution (**S1**). A request that executes on creation (**S1**). Double execution (**S1**).                                                                                                                                                               |

### UAT-11 — Returned-to-Stock is a decision (§19, §22.5)

|               |                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Objective** | Nothing returns to stock automatically.                                                                      |
| **Role**      | Staff + authorized reviewer                                                                                  |
| **Steps**     | 1. Withdraw a confirmed claim. 2. Check availability immediately. 3. Approve the RTS review. 4. Check again. |
| **Expected**  | Step 2: **not** available — it is held, awaiting review. Step 4: available.                                  |
| **Failure**   | Stock returns automatically at step 2 (**S1**). Auto-allocation to a 2nd miner or the waitlist (**S1**).     |

### UAT-12 — Manual fallback is the real workflow (§34.2 r13, §35 r10–11)

|               |                                                                                                                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Objective** | With every conditional capability off — which is how V1 launches — the day's work completes end to end.                                                                                                                                   |
| **Role**      | Staff                                                                                                                                                                                                                                     |
| **Steps**     | Run one complete sale with no printer, no Pancake, no direct send: capture → confirm → browser-preview the label → print manually → invoice → copy message → send by hand → Mark as Sent → verify payment → prepare → release → dispatch. |
| **Expected**  | Completes. Nothing is blocked. Nothing claims an unvalidated capability worked.                                                                                                                                                           |
| **Failure**   | Any step blocked without an integration (**S1** — this is the launch path).                                                                                                                                                               |
| **Note**      | The single most important scenario here. §36 principles 1–6: V1 launches on this path. Everything in Phase 10 is an optimisation of it.                                                                                                   |

### UAT-13 — Migration preserves history (§6.20, §10)

|               |                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Objective** | Historical import keeps historical values and stays separate from live intake.                               |
| **Role**      | Owner or authorized Selected Admin                                                                           |
| **Steps**     | 1. Import a small batch of past orders. 2. Compare values against the source. 3. Check the live claim queue. |
| **Expected**  | Values preserved. Source and imported-by recorded. **No** fake claims in the live queue.                     |
| **Failure**   | Migrated records appear as live claims (**S2**). Values rewritten to today's (**S1**).                       |

### UAT-14 — Search and export scope (§23, §25, §30.3 r11)

|               |                                                                                           |
| ------------- | ----------------------------------------------------------------------------------------- |
| **Objective** | Visibility is not authority, and export is a separate permission.                         |
| **Role**      | Staff **without** Export Data/Reports                                                     |
| **Steps**     | 1. Search for a customer visible in scope. 2. Attempt an export.                          |
| **Expected**  | Search returns only in-scope records. Export refused.                                     |
| **Failure**   | Out-of-scope records returned (**S1**). Export permitted without the permission (**S1**). |

---

## 4. Exit criteria for UAT (§34.6)

UAT passes when:

1. Every scenario above has a recorded result with evidence.
2. **No S1 remains open.** §34.6: critical failures block readiness.
3. Every S2 is either fixed or has an Owner-accepted, documented workaround.
4. **UAT-12 passes without qualification** — the manual fallback is the launch
   path.
5. Participants confirm no scenario drove them to a workaround.

UAT does **not** pass because the automated suite is green. That is a different
question, already answered in `docs/PHASE-11-TEST-PLAN.md`.

---

## 5. After UAT

UAT completion does not make the system Production Ready. §34.6 additionally
requires a successful controlled pilot (stage 18) and untested backup/restore
remains a hard blocker. See `docs/PHASE-11-PRODUCTION-READINESS.md`.
