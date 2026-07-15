# Pilot-Readiness Decision Sheet

**One page for the Owner.** Fill it in after UAT and the backup/restore drill.
It ends in one of three answers.

> **Nothing in this document is pre-filled with a result.** No session has run
> UAT, the pilot, or a restore. Every result box below is blank because it is
> genuinely unknown — and a system whose entire purpose is refusing to pretend
> should not begin its launch with a guessed checkbox.

|                        |                                           |
| ---------------------- | ----------------------------------------- |
| **Decision date**      | \_\_\_\_\_\_\_\_\_\_                      |
| **Decided by**         | \_\_\_\_\_\_\_\_\_\_                      |
| **Build under review** | `phase-11-testing-security-uat @ adf11bf` |

---

## 1. What is already proven (no action needed)

Verified automatically on this build. Independent of UAT.

|                                          | Result                           |
| ---------------------------------------- | -------------------------------- |
| Format · lint · typecheck                | **pass**                         |
| Unit + integration tests                 | **463 pass** (18 files)          |
| Database tests                           | **370 pass** (16 files)          |
| Migration chain on a clean database      | **21 apply cleanly**             |
| Production build                         | **pass**                         |
| Security review sweep                    | **pass** — 1 finding (S3), fixed |
| No duplicate order / no double deduction | **proven** by executed tests     |
| Owner-only approvals non-delegable       | **proven**                       |
| Audit append-only (3 layers)             | **proven**                       |

**This does not make the system ready.** It means the rules hold. Whether real
staff can work with it is what UAT answers — a green test suite has never once
told anyone whether the software is usable.

---

## 2. ✅ Printer decision — SETTLED by the Owner (2026-07-16)

**Question was:** does §34.6's "printer basics" require a physical XP-236B print
for pilot? The approved documents genuinely conflicted — §34.6 lists "real-device
and printer basics" under Pilot Ready, while §35 r10–11 and §36 principles 1–6
say conditional capabilities never block V1 launch because manual fallback
exists. It was escalated rather than defaulted (§33.2).

### Owner ruling

| For UAT and controlled pilot                                            | Before Production Ready                                                                                           |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Manual / browser print fallback is ACCEPTABLE.**                      | **A physical XP-236B test is REQUIRED.**                                                                          |
| A physical XP-236B print is **not required to begin UAT**.              | Must use **actual 40 × 30 mm labels**.                                                                            |
| Bluetooth printing is labelled **Unsupported / Unverified** throughout. | Must verify: alignment · readability · reconnect behaviour · retry · duplicate prevention · mobile compatibility. |
| **No claim is made that the printer integration works.**                | Recorded as a passing validation at `/admin/capabilities` — only after a real print.                              |
| Retry, Reprint, label preview, and manual print stay **testable**.      |                                                                                                                   |

**This resolves §34.6's "printer basics" for pilot as: the printer _path_ behaves
correctly and degrades to manual — not that the XP-236B physically prints.**
Production Ready keeps the stricter bar.

**Decided by:** Owner · **Date:** 2026-07-16 · **Recorded by:** Phase 11 session

> The Phase 10 capability gate enforces this ruling in the database, not by
> convention: `printer_xp236b_bluetooth` cannot be switched on without a recorded
> **passing** real-device validation. So the pilot proceeding on manual fallback
> is not a promise anyone has to keep — it is the only state the system permits
> until a real print happens.

### 2.1 Required XP-236B test before Production Ready

Run this **only with real hardware and real 40 × 30 mm labels**. It is a Phase 10
validation activity, not a UAT scenario.

| #   | Check                    | Expected                                                                                      | Result        |
| --- | ------------------------ | --------------------------------------------------------------------------------------------- | ------------- |
| 1   | **Alignment**            | Content sits within the 40 × 30 mm label; nothing clipped at any edge                         | ☐ Pass ☐ Fail |
| 2   | **Readability**          | Customer name, item, quantity, price legible at arm's length; barcode/QR scans if present     | ☐ Pass ☐ Fail |
| 3   | **Reconnect behaviour**  | Power-cycle the printer mid-session, reconnect → next print succeeds; no queued job lost      | ☐ Pass ☐ Fail |
| 4   | **Retry**                | Fail a print (printer off) → **Retry** → prints. **No new claim, no new reservation.**        | ☐ Pass ☐ Fail |
| 5   | **Duplicate prevention** | Print the same job twice → **two sheets of paper, one label job, one claim, one reservation** | ☐ Pass ☐ Fail |
| 6   | **Mobile compatibility** | Pairs and prints from the **Android phone** actually used on live nights                      | ☐ Pass ☐ Fail |
| 7   | **Honest evidence**      | Validation recorded at `/admin/capabilities` names the device, s/n, OS, and what was printed  | ☐ Pass ☐ Fail |

**All seven must pass** before `printer_xp236b_bluetooth` is enabled. A partial
pass leaves it **off** — and the manual path, already proven in UAT-12, carries
the workflow exactly as it does today.

> Never record a passing validation for a device you did not physically print
> from. §34.2 r14 exists for precisely that temptation, and the gate is the only
> thing standing between "we think it prints" and "it prints".

---

## 3. Required UAT pass threshold

| Requirement                                                               | Met? |
| ------------------------------------------------------------------------- | ---- |
| All **14** scenarios have a recorded actual result and evidence           | ☐    |
| **Zero S1 defects open**                                                  | ☐    |
| Every **S2** either fixed, or an Owner-accepted written workaround exists | ☐    |
| **UAT-12 (manual fallback) passed without qualification**                 | ☐    |
| Testers confirm **no scenario drove them to a workaround**                | ☐    |

**Scores:** Pass \_\_\_ / Fail \_\_\_ / Blocked \_\_\_ of 14

> A **Blocked** scenario is not a pass. If UAT-05 was blocked because only one
> phone was available, the concurrency question is **unanswered** — and that is
> the exact question a live-selling night will ask.

---

## 4. Critical defects that block the pilot

Pilot is **blocked** if any of these is observed even once:

| #   | Blocking defect                                                       | Seen? |
| --- | --------------------------------------------------------------------- | ----- |
| 1   | A second Official Order from one Invoice Draft                        | ☐     |
| 2   | Stock deducted twice for one claim                                    | ☐     |
| 3   | Two reservations on one claim                                         | ☐     |
| 4   | An unauthorized action that **changed a record**                      | ☐     |
| 5   | A non-Owner executing any of the six Owner approvals                  | ☐     |
| 6   | An Owner approval executing **twice**                                 | ☐     |
| 7   | An approval **request** performing the action on creation             | ☐     |
| 8   | Stock returning to available **without** an approved RTS review       | ☐     |
| 9   | Automatic transfer to a 2nd miner or waitlist                         | ☐     |
| 10  | Verification marking an order **Paid in Full** when a balance remains | ☐     |
| 11  | Copy marking a message **Sent**, or starting the hold                 | ☐     |
| 12  | An audit entry changed, deleted, or missing an actor                  | ☐     |
| 13  | Test data reaching production                                         | ☐     |
| 14  | Any step of **UAT-12** blocked without an integration                 | ☐     |

**Any tick = Pilot Blocked.** These are not a wish list; each is an approved
invariant, and the database is built to refuse all fourteen. If one happens
anyway, something is wrong that this sheet cannot price.

---

## 5. Acceptable known limitations

These are **already known, documented, and do not block the pilot**. Confirm the
Owner accepts each as-is:

| Limitation                                                                    | Fallback that makes it acceptable                                                                                                  | Accept?                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| **XP-236B Bluetooth printing — Unsupported / Unverified**, switched off       | Browser preview → print manually (UAT-12). **Accepted for UAT/pilot by Owner ruling §2.** Required before Production Ready (§2.1). | ☑ **Accepted 2026-07-16** |
| Pancake / Meta not integrated                                                 | Copy Invoice Message → send by hand → Mark as Sent                                                                                 | ☐                         |
| No direct send; no Delivered/Read                                             | Manual send; **Sent ≠ Delivered** is stated honestly                                                                               | ☐                         |
| No Android floating capture / iOS Share                                       | Manual entry + screenshot upload                                                                                                   | ☐                         |
| Screenshot intake stores metadata only (no file upload wiring)                | Manual entry carries the claim                                                                                                     | ☐                         |
| Payment **recording** + **correction** forms not surfaced in the UI           | Domain + schema exist and are tested; correction of a verified payment is an Owner approval                                        | ☐                         |
| Fulfillment **preparation** form not surfaced                                 | Release / dispatch / complete / approvals are surfaced                                                                             | ☐                         |
| Claim withdrawal flows, 1st→2nd miner switch UI, Print Queue screen not built | Handled via Claim Review + RTS                                                                                                     | ☐                         |
| No OCR (by design)                                                            | Staff read and enter — deliberate, not a gap                                                                                       | ☐                         |
| No performance testing under load                                             | Pilot volume is bounded by §6                                                                                                      | ☐                         |

> If the Owner does **not** accept one of these, that is a **scope decision**, not
> a defect. It means more building before pilot — say so plainly rather than
> ticking the box.

---

## 6. Required results

### 6.1 Printer

|                                                                                       | Result                             |
| ------------------------------------------------------------------------------------- | ---------------------------------- |
| **UAT-12 manual printing** (required under **both** options A and B)                  | ☐ Pass ☐ Fail ☐ Blocked            |
| **XP-236B physical print** (required only if the Owner chose **B** in §2)             | ☐ Pass ☐ Fail ☐ **N/A — Option A** |
| If XP-236B was tested, is a **passing** validation recorded at `/admin/capabilities`? | ☐ Yes ☐ No ☐ N/A                   |

> Never record a passing validation for a device you did not physically print
> from. The gate exists to stop exactly that (§34.2 r14).

### 6.2 Backup / restore — **hard §34.6 blocker**

|                                                                     | Result                      |
| ------------------------------------------------------------------- | --------------------------- |
| Drill run (`docs/BACKUP-RESTORE-DRILL.md`)                          | ☐ Yes ☐ No                  |
| Row counts all matched                                              | ☐                           |
| Workflow checks passed — **including the sequence-collision check** | ☐                           |
| Auth / permissions survived unchanged                               | ☐                           |
| Audit survived and is still append-only                             | ☐                           |
| Recovery time recorded                                              | \_\_\_\_\_\_ min            |
| **Overall**                                                         | ☐ **Pass** ☐ Fail ☐ Blocked |

**Not run = Fail** for the purposes of this sheet. §34.6 does not offer a middle
option.

### 6.3 Security

|                                                                                                                               | Result                                        |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Automated security review sweep                                                                                               | **pass** (already verified on this build)     |
| UAT-01, 02, 10, 14 (the authority scenarios) all passed                                                                       | ☐                                             |
| No unauthorized action changed a record during UAT                                                                            | ☐                                             |
| §30.23 security items answered (session timeout, concurrent sessions, login-attempt limits, recovery, Owner emergency access) | ☐                                             |
| External penetration testing                                                                                                  | ☐ In scope ☐ **Out of scope (Owner accepts)** |

---

## 7. Pilot parameters (Owner sets before starting)

|                                                            |                                               |
| ---------------------------------------------------------- | --------------------------------------------- |
| Duration                                                   | \_\_\_\_\_\_ (e.g. 1 live night, then review) |
| Max transaction volume                                     | \_\_\_\_\_\_ orders                           |
| Which staff                                                | \_\_\_\_\_\_\_\_\_\_                          |
| Which live batch                                           | \_\_\_\_\_\_\_\_\_\_                          |
| **Rollback plan if it goes wrong mid-live**                | \_\_\_\_\_\_\_\_\_\_                          |
| Who decides to stop                                        | \_\_\_\_\_\_\_\_\_\_                          |
| Backup verified restorable **before** the first real order | ☐                                             |

> **Decide the rollback plan before you need it.** Mid-live, with customers
> waiting, is the worst possible moment to invent one.

---

## 8. Final recommendation

Tick **one**.

### ☐ Not Ready

One or more of: S1 open · UAT incomplete · UAT-12 failed · backup/restore failed
or not run.
**Action:** fix, then re-test. Do not pilot.

### ☐ Ready for Controlled Pilot

All of: 14 scenarios recorded · zero S1 · S2s fixed or accepted · **UAT-12
passed** · **backup/restore passed** · security scenarios passed · §5
limitations accepted · §7 parameters set.
**Action:** run the bounded pilot in §7. **Production Ready is still not
claimed** — §34.6 requires a _successful_ pilot first.

### ☐ Pilot Blocked

Blocked by something outside the software: hardware absent, plan not purchased,
staff unavailable, Owner decisions in §2 or §7 unanswered.
**Action:** name the blocker and its owner. Do not re-run UAT hoping it clears.

**Blocker:** \_\_\_\_\_\_\_\_\_\_ **Owner:** \_\_\_\_\_\_\_\_\_\_ **Review on:** \_\_\_\_\_\_\_\_\_\_

---

## 9. Sign-off

| Role                                 | Name | Signature | Date |
| ------------------------------------ | ---- | --------- | ---- |
| UAT lead                             |      |           |      |
| **Owner / final sign-off authority** |      |           |      |

> §34.9 leaves **final sign-off authority** open. Whoever signs the Owner row is
> answering that question by signing. If that is not settled, settle it before
> the pilot rather than during it.

---

## 10. After a successful pilot

Production Ready still requires (§34.6, §35.18): domain · Supabase Pro **before**
real customer data · Vercel paid plan · monitoring and alerts · named support
owner · incident-response contacts · confirmed environment separation · a
post-deploy smoke test.

Checklist: `docs/PHASE-11-PRODUCTION-READINESS.md` §3.

**No session can declare Production Ready.** §34.6 blocks it while the pilot is
incomplete or backup/restore is untested. Only the Owner, after both are done,
signs that off.
