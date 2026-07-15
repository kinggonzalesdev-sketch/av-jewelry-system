# Phase 11 — Test Plan, Security Review & Open-Item Classification

**Bible refs:** §34 (testing), §30 (security), §31 (audit), §32 (recovery), §35
(deployment), §36 (release criteria) · **Roadmap:** Phase 11
**Branch:** `phase-11-testing-security-uat`, cut from
`phase-10-capability-gating @ abe9f5a`

This document is the Phase 11 deliverable that the roadmap calls "the full §34
stage sweep". It records what was tested, what was found, what is deliberately
provisional, and what is genuinely blocked on the Owner.

> **This document does not resolve any To-be-confirmed item.** Where §34.9 or
> §35.18 leaves something open, it is listed below as **provisional** with the
> proposed default and the reason, per §33.2 (no silent defaults).

---

## 1. Open-item classification (the roadmap's precondition)

The roadmap requires Phase 11's open items to be resolved "before
pilot/production" — **not** before the testing and security work. That
distinction is what let this phase proceed. Items are classified three ways.

### 1.1 Blocking — Owner-only, genuinely cannot proceed

None of these are code problems. No amount of engineering resolves them.

| Item                                             | Register   | Why it blocks                            | Owner |
| ------------------------------------------------ | ---------- | ---------------------------------------- | ----- |
| Staff UAT participants                           | §34.9      | Real staff must run real scenarios (r19) | Owner |
| Pilot duration & transaction volume              | §34.9      | Bounds a real operation (r20)            | Owner |
| Final sign-off authority                         | §34.9      | Someone must be accountable for the gate | Owner |
| Domain, plans, backup, monitoring, support owner | §35.18     | Production infrastructure decisions      | Owner |
| External penetration testing                     | §34.9      | Scope + budget + vendor                  | Owner |
| Backup/restore verification                      | §34.6      | Needs the real Supabase project          | Owner |
| Controlled pilot execution (stage 18)            | §34.3      | Real selling, real customers             | Owner |
| Production cutover + smoke test (stage 20)       | §34.3, §35 | No production environment exists         | Owner |

**Consequence:** `Production Ready` **cannot** be declared by this or any
session. §34.6 blocks it while the pilot is incomplete and backup/restore is
untested. Both are true. See §4.

### 1.2 Provisional — proceeded with a documented default

Recorded here rather than silently settled. Each is cheap for the Owner to
overturn.

| Item                              | Provisional default                                  | Reason                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test tools / automation framework | **Vitest** (unit/integration) + **pgTAP** (database) | Already chosen and in use since Phase 0; Phase 11 adds no new tool. Changing it is an Owner call, not a Phase 11 side-effect.                         |
| Browser E2E tool                  | **Deferred, not chosen**                             | Picking Playwright here would resolve an open §34.9 item silently. E2E lifecycle coverage runs at the trusted boundary instead (see §2, stage 7).     |
| Coverage threshold                | **No numeric gate**                                  | §34.9 leaves it open. A number chosen by a session would be arbitrary and would then govern releases. Invariant coverage is asserted by name instead. |
| Defect severity definitions       | **Proposed in §3**                                   | Needed to talk about findings at all; proposed, not imposed.                                                                                          |
| Release-blocking thresholds       | **§34.6 verbatim**                                   | The Bible already states the blocking conditions; no new threshold invented.                                                                          |
| Performance targets               | **None set**                                         | §34.9 open; stage 15 deferred (see §1.3).                                                                                                             |
| Security-test scope               | **Code/data boundary only**                          | Defined in §2 stage 9. Excludes pen-testing (§1.1) and infrastructure (§35.18).                                                                       |
| Test-device matrix                | **None**                                             | Depends on hardware that does not exist here (§1.3).                                                                                                  |

### 1.3 Deferred — blocked on hardware/vendor/environment, non-blocking for V1

Unchanged from Phase 10; restated so they are not mistaken for gaps.

| Stage | Item                                        | Blocker                                 |
| ----- | ------------------------------------------- | --------------------------------------- |
| 12    | Printer & label testing (XP-236B, 40×30 mm) | Physical device + protocol/SDK (§27.18) |
| 13    | Mobile-device testing (Android/iOS)         | Real devices (§13.29)                   |
| 14    | Pancake/Meta validation                     | API access + credentials (§14.28)       |
| 15    | Performance testing under load              | Needs staging environment (§35)         |

Per §35 r10–11 and §36 principles 1–6, these are **non-blocking for V1 launch**:
the manual fallback is real and works today. The capability gate built in
Phase 10 keeps every one of them switched off until a passing real-device
validation is recorded, and the database refuses to enable them otherwise.

---

## 2. The §34.3 stage sweep — what actually ran

| #   | Stage                               | Status                    | Where                                                                                |
| --- | ----------------------------------- | ------------------------- | ------------------------------------------------------------------------------------ |
| 1   | Bible-consistency                   | **pass**                  | This document; §5 records the one inconsistency found.                               |
| 2   | Static checks (types, lint, format) | **pass**                  | `npm run verify`                                                                     |
| 3   | Unit testing                        | **pass**                  | `tests/unit/`                                                                        |
| 4   | Integration testing                 | **pass**                  | `tests/integration/phase11-authorization-boundary.test.ts` — **new**                 |
| 5   | Database integrity                  | **pass**                  | `supabase/tests/01`–`02`                                                             |
| 6   | Permission & authorization          | **pass**                  | `supabase/tests/05`, `16`                                                            |
| 7   | End-to-end workflow                 | **pass**                  | `supabase/tests/15_phase11_e2e_lifecycle.test.sql` — **new**                         |
| 8   | Concurrency & duplicate-submission  | **pass**                  | `supabase/tests/15` (double-submit), `01`, `02`                                      |
| 9   | Security testing                    | **pass, 1 finding fixed** | `supabase/tests/16_phase11_security_review.test.sql` — **new**; §5                   |
| 10  | Error & recovery                    | **partial**               | Refusal paths asserted throughout; backup/restore is Owner-blocked (§1.1)            |
| 11  | File/photo/upload                   | **partial**               | Type/size validation tested; Storage upload wiring never built (Phase 3, documented) |
| 12  | Printer & label                     | **deferred**              | §1.3                                                                                 |
| 13  | Mobile-device                       | **deferred**              | §1.3                                                                                 |
| 14  | Pancake/Meta                        | **deferred**              | §1.3                                                                                 |
| 15  | Performance                         | **deferred**              | §1.3                                                                                 |
| 16  | Migration testing                   | **pass**                  | 21 migrations apply cleanly to a fresh database; `supabase/tests/04`, `12`           |
| 17  | Staff UAT                           | **prepared, not run**     | `docs/PHASE-11-UAT-SCENARIOS.md` — **new**; execution is Owner-blocked               |
| 18  | Controlled pilot                    | **blocked**               | §1.1                                                                                 |
| 19  | Regression                          | **pass**                  | Full suite green: 463 unit/integration + 370 database                                |
| 20  | Production smoke                    | **blocked**               | §1.1 — no production environment                                                     |

### Why stage 7 runs in SQL rather than a browser

The roadmap's Phase 4 and Phase 5 exit gates are _"two staff confirming one
claim → one reservation"_ and _"repeated Approve & Send Invoice → one order"_.
Those rules live in Postgres functions, not in the UI — per the standing
convention that **rules live in SQL, not TypeScript**. Testing them through a
browser would test the browser. `15_phase11_e2e_lifecycle.test.sql` executes the
real functions as a real JWT-bearing user, through the real permission checks,
from Pending Claim to Official Order.

A browser E2E suite would still add value for the _UI_ path, and is the natural
first task once §34.9's test-tool item is answered. It is not a substitute for
the above.

---

## 3. Proposed defect severity (provisional — §34.9)

| Severity        | Definition                                                                                                                                   | Release effect                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| **S1 Critical** | Duplicate critical record, double inventory deduction, unauthorized write that mutates, audit loss or mutation, money computed wrong.        | Blocks everything. §34.6.     |
| **S2 Major**    | An approved rule is enforceable but not enforced on some path; a separation collapses (Copy=Sent, verified=Paid in Full, request=execution). | Blocks pilot.                 |
| **S3 Moderate** | Defence-in-depth erosion with another layer still holding; misleading refusal text.                                                          | Blocks production, not pilot. |
| **S4 Minor**    | Cosmetic, wording, non-blocking gap with a documented fallback.                                                                              | Does not block.               |

The §5 finding below is **S3** by this scale.

---

## 4. Readiness verdict (§34.6)

**Current: `Internal Test Ready`. Pilot Ready is NOT claimed.**

`Pilot Ready` requires "security, recovery, real-device and printer basics, and
migration pass; manual fallback verified". Security and migration pass. **Real-
device and printer basics cannot pass** — the hardware does not exist here
(§1.3) — and **backup/restore is untested** because it needs the Owner's real
project.

`Production Ready` additionally requires completed UAT and a successful
controlled pilot. Neither has occurred. §34.6 states Production Ready must not
be declared while the pilot is incomplete or backup/restore is untested. Both
conditions hold, so **no session can declare it** — this one included.

This is the honest ceiling for Phase 11 as code. The rest is the Owner's.

---

## 5. Security review finding (stage 9)

**S3 — Audit privilege layer eroded by a cross-phase blanket grant. Fixed.**

**What:** Phase 1 made `audit_events` append-only with three independent
defences and said so explicitly:

> `-- append-only: UPDATE and DELETE are blocked by trigger AND by revoked grants`
> `revoke all on public.audit_events from anon, authenticated;`

Phase 2 then had to grant table privileges back, because RLS is never consulted
on a table the caller cannot touch at all:

> `grant select, insert, update on all tables in schema public to authenticated;`
> `revoke delete on all tables in schema public from authenticated;`

That grant is correct and deliberate for the ~40 business tables it targets. But
`on all tables` swept up `audit_events` and re-granted the UPDATE that Phase 1
had deliberately revoked. DELETE survived; the next line revokes it globally.
UPDATE did not.

**Impact — stated in full, because the fix is one line and the temptation is to
oversell it:** **not exploitable.** Two defences still held. `audit_events` has
exactly two policies (`audit_read` for select, `audit_insert_self_attributed`
for insert) and no update policy, so RLS refused every UPDATE; the
`audit_events_no_update` trigger refused as well. What was lost was the third
layer and the accuracy of Phase 1's comment.

**Why it was fixed anyway:** the audit is the record that proves what every
other table did. It is the one table where "two of three layers still hold" is
not a reason to leave the third broken.

**How it survived six phases:** `supabase/tests/05_authz_permissions.test.sql`
asserted the weakened behaviour as correct:

> `select lives_ok($$update public.audit_events set action = 'tampered' ...$$,`
> `  'An update attempt on audit_events raises nothing (no policy matches)');`

with a comment reasoning that the trigger "does not even need to fire". That
reading was right about the outcome and wrong about the cause — the statement
reached RLS at all only because the privilege had been re-granted. The test then
locked the erosion in as expected behaviour. A silent success for a tamper
attempt is also exactly what §30.3 r18 forbids.

**Fix:** `supabase/migrations/20260716200000_phase11_audit_privilege_hardening.sql`
re-revokes UPDATE on `audit_events` alone, leaving Phase 2's blanket grant
untouched (the other tables need it, and rewriting a shipped migration is the
more dangerous change). Nothing legitimate regresses: no policy permits UPDATE,
no trigger updates the table, and `src/lib/audit/log.ts` only inserts.

Test 05's assertion was corrected to `throws_ok(... '42501' ...)` — the guarantee
is **strengthened**: nothing was ever mutable, and the attempt is now refused
loudly instead of reporting success against zero rows.

**Locked by:** `16_phase11_security_review.test.sql` asserts the posture at all
three layers, so the next `on all tables` grant fails a test instead of quietly
eroding the audit again.

### Lesson for future phases

A blanket `grant ... on all tables in schema public` is a cross-phase action
whose blast radius grows every time a later phase adds a table. It undid an
earlier phase's deliberate revoke without anything failing. This is the reason
§34.3 lists security as a stage of its own rather than a by-product of the
feature phases: only a full-chain sweep asks _"did a later phase weaken this?"_

---

## 6. What Phase 11 added

```
supabase/migrations/20260716200000_phase11_audit_privilege_hardening.sql
supabase/tests/15_phase11_e2e_lifecycle.test.sql          (35 assertions)
supabase/tests/16_phase11_security_review.test.sql        (22 assertions)
supabase/tests/05_authz_permissions.test.sql              (corrected: 1 assertion)
tests/integration/phase11-authorization-boundary.test.ts  (27 assertions)
vitest.config.ts                                          (integration enabled)
docs/PHASE-11-TEST-PLAN.md
docs/PHASE-11-UAT-SCENARIOS.md
docs/PHASE-11-PRODUCTION-READINESS.md
```

No UI file was touched. The approved UI is unchanged.
