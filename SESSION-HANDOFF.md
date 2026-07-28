# A.V. Jewelry Operations System (MineFlow) — Session Handoff

**Updated:** 2026-07-16 · **Phases 3–11 (code) complete. Nothing in flight.**

**Repository:** `C:\Users\KING\Desktop\A.V. JEWELRY SYSTEM`
**Current phase:** Phase 11 (Testing, Security, UAT) — **code complete and
committed. Pilot/production remain Owner-blocked.**
**Current branch:** `phase-11-testing-security-uat`
**Current HEAD:** `adf11bf`
**master:** `42115fa0973d18df6f9d34d1290de57b4736d9e9` — **untouched**

> ⚠️ Never access or modify `C:\Users\KING\Desktop\OWN SYSTEM`.

## 1. Git state

| Branch | Commit | Meaning |
|---|---|---|
| `master` | `42115fa` | **Untouched.** Phases 0–2 merged. |
| `ui-prototype-preview` | `220621e` | Untouched, unmerged. |
| `ui-owner-approved-preview` | `1efd330` | Owner-approved UI, frozen. |
| `phase-3-live-claim-intake` | `d5e0fa5` | Complete. |
| `phase-4-confirm-claim-print-label` | `9e27cde` | Complete. |
| `phase-5-invoicing-official-order` | `ef2f3dd` | Complete. |
| `phase-6-payment-layaway` | `56c4bcc` | Complete (backend). |
| `phase-6-payment-layaway-ui` | `9583235` | Complete (UI). |
| `phase-7-fulfillment-owner-approvals` | `08a294b` | Complete. |
| `phase-8-inventory-rts-customers-migration` | `d8afb21` | Complete. |
| `phase-9-dashboard-search-reports-audit` | `05134a6` | Complete. |
| `phase-10-capability-gating` | `abe9f5a` | Complete. |
| `phase-11-testing-security-uat` | **`adf11bf`** | **Current HEAD.** All checks pass. |

Each branch is cut from the previous phase's HEAD, **not** master (master has no
approved UI). **Nothing merged. Nothing pushed.**

**Working tree:** clean of real diffs. 16 files show as modified in `git status`
with **zero content diff** — pre-existing `core.autocrlf` line-ending artifacts.
Ignore them; do not commit them.

**Untracked, deliberately uncommitted:** `.claude/`, `SECTION-11-REVIEW.md`,
`SECTION-12-REVIEW.md`, `SESSION-HANDOFF.md` (this file — not tracked, so it is
left uncommitted).

## 2. Latest check results (at `adf11bf`)

| Check | Result |
|---|---|
| format | **pass** |
| lint | **pass** |
| typecheck | **pass** |
| unit + integration tests | **463 passed (18 files)** |
| database tests | **370 passed (16 files)** |
| production build | **pass** |
| migration chain | **21 migrations apply cleanly to a fresh database** |

Database tests need Docker: `npx supabase db reset && npx supabase db test`.

**Local preview/server: NOT running.** No dev server is listening on 3000–3009.
Start with `npx next dev` if needed; none is required to run the checks above.

## 3. Completed work

- **Phase 3** Live Batch lifecycle, Current Flex Item, claim capture (4 source
  markers), Post-Live Item Entry. Route: `/live`.
- **Phase 4** Claim Review, Confirm Claim & Print Label (atomic), label jobs,
  retry/reprint/void. Route: `/claims`.
- **Phase 5** Invoice drafts, grouping rules, Approve & Send (atomic), bulk
  steps, invoice messages. Route: `/orders/invoice`.
- **Phase 6** Payment money rules + verification separation + layaway; full UI.
  Route: `/orders/payments`.
- **Phase 7** Fulfillment preparation/release/dispatch + Owner Approval Center.
  Route: `/orders/fulfillment`.
- **Phase 8** Inventory monitoring, Returned-to-Stock Review, duplicate review,
  migration batches. Route: `/orders/inventory`.
- **Phase 9** Dashboard (non-additive counts), search, reports, reminders,
  audit. Route: `/dashboard` — the last placeholder is gone.
- **Phase 10** Conditional capability gating (the feature-flag mechanism, a
  Phase 0 deliverable that had never been built). Route: `/admin/capabilities`.
- **Phase 11** §34.3 stage sweep: E2E lifecycle, security review, integration
  boundary, UAT preparation, production-readiness gate. **No route** — Phase 11
  adds tests, one migration, and docs. The approved UI is untouched.
  Read `docs/PHASE-11-TEST-PLAN.md` first; it classifies every open item.

## 4. Partially completed work

**None in flight.** Phase 11's code stages are complete and committed.

**Phase 11 is code-complete but NOT finished as a phase** — and that is by
design, not an omission. Its remaining stages (17 UAT, 18 pilot, 20 production
smoke) require real staff, real selling, and a real production project. See §6.

Deliberately not built (documented, not forgotten):

- **Phase 10 integrations** — XP-236B driver, Pancake adapter, Meta adapter,
  Android/iOS capture. **Blocked on physical hardware and vendor credentials**,
  not on code. See §6.
- Phase 6 UI: payment **recording** form and **correction** workflow not
  surfaced (verification, rejection, layaway, forfeiture-request are). Domain +
  schema exist and are tested.
- Phase 7 UI: preparation form not surfaced (release/dispatch/complete/approvals
  are); `prepareFulfillment` exists and is tested.
- Phase 4: claim withdrawal flows, 1st→2nd miner switch UI, Print Queue screen.
- Phase 3: screenshot/iOS-Share intake stores metadata only (no Storage upload
  wiring). No OCR by design.

## 5. Remaining work

**All coding phases (0–11) are done.** What remains is not code. The Owner-led
UAT package is prepared and ready to run, in this order:

| Step | Document | Status |
|---|---|---|
| 1. Set up accounts, synthetic data, devices | `docs/UAT-SETUP-ACCOUNTS-DATA-DEVICES.md` | ready, **uncommitted** |
| 2. Run the 14 scenarios, record results | `docs/UAT-EXECUTION-CHECKLIST.md` | ready, **uncommitted** |
| 3. Prove the backup restores (staging only) | `docs/BACKUP-RESTORE-DRILL.md` | ready, **uncommitted** |
| 4. Decide whether to pilot | `docs/PILOT-READINESS-DECISION.md` | ready, **uncommitted** |

`docs/PHASE-11-UAT-SCENARIOS.md` remains the **rationale** for the 14 scenarios;
the execution checklist is the worksheet. **All result fields are blank on
purpose** — nothing has been run, and no session may fill them in.

1. **Staff UAT** — 14 scenarios. **UAT-12 (manual fallback) is decisive** — it is
   the actual V1 launch path.
2. **Controlled pilot** — bounded real operation. Owner sets duration/volume.
3. **Production cutover** — after the Owner checklist in
   `docs/PHASE-11-PRODUCTION-READINESS.md` §3.

**One Owner decision now blocks scoring the pilot sheet:** does §34.6's "printer
basics" require a physical XP-236B print, or is manual fallback sufficient given
§35 r10–11? The approved documents genuinely conflict, so it was **not** settled
by a session. See `docs/PILOT-READINESS-DECISION.md` §2 (recommendation: manual
is sufficient — the printer stays gated off either way).

**Readiness: `Internal Test Ready`.** `Pilot Ready` is NOT claimed — real-device
testing and backup/restore cannot pass in this environment. Per §34.6,
**Production Ready cannot be declared by any session** while the pilot is
incomplete and backup/restore is untested. Both are true. Do not let a future
session claim otherwise; the gate is quoted verbatim in the readiness doc.

## 6. Known blockers

**Phase 11's remaining stages are blocked on the Owner, not on code:** UAT
participants, pilot parameters, sign-off authority, domain/plans, backup +
**a real restore drill**, monitoring, support owner (§34.9, §35.18). Full
classification: `docs/PHASE-11-TEST-PLAN.md` §1.

**Phase 10 integrations are blocked on hardware/vendor access, not code:**

1. **Xprinter XP-236B** — physical device + protocol/SDK/pairing (§27.18).
2. **Pancake** — API access, plan, features, credentials (§14.28).
3. **Android/iOS** — devices for capture feasibility (§13.29).

The gate is already built and waiting: write the driver behind the
`printer_xp236b_bluetooth` flag, test it on the real device, record a passing
validation at `/admin/capabilities`, then the Owner enables it. The database
refuses to enable anything without a passing real-device validation.

**Non-blocking for V1** (roadmap §35 r10–11): launch proceeds on manual
fallback, which is real and works today — browser preview → print manually;
Copy Invoice Message → send → Mark as Sent; manual/screenshot capture.

**No known bugs.** All 463 unit/integration and 370 database tests pass.

**One S3 security finding was found and fixed in Phase 11** — see §8 below. It
is closed, but the lesson it carries is the most valuable thing this phase
produced. Read it before adding a phase.

## 7. Migrations created this project (21 total, all applying cleanly)

Phase 3 `20260715140000` · Phase 4 `20260715150000` · Phase 5 `20260715160000` ·
Phase 6 `20260715170000` · Phase 7 `20260715180000` · Phase 8 `20260715190000` ·
Phase 9 `20260715200000` · Phase 10 `20260716100000` · Phase 11
`20260716200000` (plus Phase 0–2's pre-existing set).

## 8. The Phase 11 security finding (closed — read the lesson)

**S3: a blanket grant silently undid an earlier phase's deliberate revoke.**

Phase 1 made `audit_events` append-only with three defences and said so in a
comment: "blocked by trigger AND by revoked grants". Phase 2 then ran
`grant select, insert, update on all tables in schema public to authenticated`
— correct and deliberate for the ~40 business tables it targets, because RLS is
never consulted on a table the caller cannot touch at all. But `on all tables`
swept up `audit_events` and re-granted the UPDATE Phase 1 had revoked.

**Not exploitable** — RLS had no update policy and the trigger still refused, so
two defences held. Fixed anyway in `20260716200000`: the audit is the record
that proves what every other table did.

**How it hid for six phases:** `05_authz_permissions.test.sql` asserted the
weakened behaviour as correct — `lives_ok()` on a tamper UPDATE, with a comment
reasoning the trigger "does not even need to fire". Right about the outcome,
wrong about the cause. **The test locked the erosion in.** It now reads
`throws_ok(42501)`.

**The lessons, in order of importance:**

1. **A blanket `grant ... on all tables` is a cross-phase action** whose blast
   radius grows with every table a later phase adds. Grant to a **named table**.
2. **A test that rationalises a surprise can cement a defect.** When something
   passes for a reason you did not expect, find the cause before writing the
   comment that explains it away.
3. **Ask what a phase *widens*, not only what it adds.** Only a full-chain sweep
   asks "did a later phase weaken this?" — which is why §34.3 makes security its
   own stage rather than a by-product of the feature phases.
4. Prefer a **new migration** over editing a shipped one.

## 9. EXACT NEXT ACTION for a fresh session

**Nothing is in flight. All coding phases (0–11) are complete.** The next
actions are the Owner's, not a session's:

**(a) Run Staff UAT** — `docs/PHASE-11-UAT-SCENARIOS.md`, 14 scenarios, ready to
execute. Needs real staff (§34.9). **UAT-12 is decisive**: it walks the manual
fallback path, which is how V1 actually launches.

**(b) Work the Owner checklist** — `docs/PHASE-11-PRODUCTION-READINESS.md` §3.
The hard §34.6 blocker is **backup + a real restore drill**: a backup that has
never been restored is a hope, not a backup.

**(c) Review/merge the phase chain.** Every phase is a branch built on the
previous one; `phase-11-testing-security-uat @ adf11bf` contains the whole
chain. Merging is the Owner's call — **no session has merged or pushed.**

**(d) Finish a Phase 10 integration** — only once real hardware or vendor
credentials exist (§6).

**If a session is asked to "finish Phase 11": it cannot.** Stages 17/18/20 need
real staff, real selling, and a real production project. Preparing them is done.
Do not record them as passed — §34.2 r1 exists precisely to forbid that.

## 10. Owner-approved decisions — durable, do not re-derive

- **`docs/PHASE-6-APPROVED-DECISIONS.md`** — Paid in Full, Outstanding Balance,
  payment methods/evidence, partial/over/underpayment, layaway fee + rounding,
  activation/completion. Do not invent money rules outside it.

## 11. Precedents (Owner-approved — do not weaken)

- **Every claim is born Pending.** Fixtures insert Pending, then confirm.
- **Reserve exactly once at Confirm.** On a *unique* item the quantity guard
  fires before `UNIQUE(claim_id)`; prove one-reservation-per-claim on a
  *multi-stock* fixture.
- **Do not weaken** the quantity guard, `UNIQUE(claim_id)`, the pending-only
  trigger, the Phase 6 money guards, the Phase 7 release rules, the Phase 8
  return/merge guards, the Phase 10 capability gate, or the Phase 11 audit
  privilege layer (`20260716200000` — it was already eroded once; see §8).
- **Separations that must never collapse:** Copy ≠ Sent ≠ Delivered ≠ Read ·
  Recording ≠ verifying · Verified ≠ Paid in Full · Preparing ≠ releasing ≠
  dispatching · Requesting ≠ deciding ≠ executing · Eligibility ≠ approval ·
  Judging a duplicate ≠ merging · Recording evidence ≠ enabling a capability.
- **Counts are non-additive.** An Active Layaway IS an Official Order.
- **Money is `numeric` in SQL, a `string` in TS.** Never a JS float.
- **No hardware/integration is validated.** No card number, CVV, or PIN is ever
  stored.

## 12. Hard-won lessons (do not repeat)

- **`now()` is constant within a transaction.** Never guard "executes once" by
  comparing timestamps — a retry writes an identical value and slips through.
  Freeze the row instead (`enforce_approval_executes_once`).
- **Deciding an Owner approval is non-delegable**: a Phase 2 guard refuses any
  non-Owner decider. Fixtures need a real `role_key = 'owner'` profile.
- **The server-only boundary is real.** Client components import pure helpers
  from `src/lib/payments/format.ts`; importing a `server-only` module into a
  client component breaks the build.
- **Rules live in SQL, not TypeScript.** Surface the database's refusal verbatim
  rather than replacing a precise reason with a generic one.
- **Write files with the editor, not shell heredocs.** Escaping backticks and
  `\s` through `bash -c "node -e ..."` corrupted files twice, and once even
  executed a stray `git checkout -b`.
- Constraints that bit fixtures (all correct — fix the fixture, not the guard):
  committed reservations need `committed_at`; sent drafts need `sent_at`; an
  approved request needs `decided_at` + `decided_by`; an Owner approval
  reference is a real FK.

## 13. Architecture conventions

- Atomic multi-table writes → `security invoker` Postgres function, permission
  re-checked inside.
- Reuse `src/lib/authz/guard.ts`; audit via `src/lib/audit/log.ts` (denials and
  failures logged too).
- Revalidate from stored state; never trust the UI.
- **UI frozen.** `/preview` stays `NODE_ENV`-gated. Bottom nav is exactly five
  items — Invoice, Payments, Fulfillment, and Inventory are all sub-routes of
  Orders; `/admin/capabilities` is an admin surface, not operational UI.
- `app_private.provisional_fields` is the running register of unsettled rules.
