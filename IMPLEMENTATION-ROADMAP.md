# A.V. Jewelry Operations System (MineFlow) — Implementation Roadmap & Phased Coding Plan

> **Derived from:** `Development-Bible.md` — Sections 1–36, *COMPLETE AND AUDITED* (master tip `3857627`).
> **Status of this document:** Planning artifact / working aid. **No code has been written.** This is a build plan, not the spec — the Bible remains the single source of truth (§33.2).
> **Scope:** Version 1 (V1) — internal staff operations system, mobile-first, single business / single primary Facebook Page, **no customer login**.
> **Rule:** This roadmap sequences *how* to build the approved rules; it must not redefine them. Any conflict is resolved in favour of the Bible.

---

## 0. How to read this plan

- **Phases are ordered by dependency, not by screen.** The data-integrity spine and authorization come before any feature that writes business records.
- Each phase lists: **Objective · Bible refs · Deliverables · Depends on · Invariants to enforce · Exit gate · Open items to resolve first · Blocking level.**
- **Invariants** are the non-negotiable behaviours from the Bible that the code must guarantee. They are repeated per phase on purpose — they are the whole point of the system.
- **Open items** reference the consolidated register (§36.16). An item marked *blocks this phase* must be answered by the decision owner **before** that phase's affected code is written — not silently defaulted (§33.2).
- Conditional/hardware features (printer, Pancake/Meta, native capture) are **parallel and gated**; they **never block V1 launch** because manual fallback exists (§35 R10–R11, §36 principles 1–4).

---

## 1. Non-negotiable engineering invariants (apply to every phase)

These come straight from the audited Bible and must hold in all code:

1. **Authorization is server-side / at the trusted data boundary. UI visibility is never authorization.** (§29.3, §30.3 r1–2, §33 r3–4)
2. **Assignment ≠ permission; role title ≠ authority; visibility ≠ action authority; no permission silently includes another.** (§5, §11)
3. **Inventory reserves exactly once at Confirmed Claim; Official Order commits the reservation with no second deduction; payment/fulfillment deduct nothing further.** (§19, §20.3, §22.3, §28.9)
4. **Available stock returns only via approved manual Returned-to-Stock Review. No automatic 2nd-Miner transfer, waitlist allocation, or stock return.** (§19, §22.5, §22.15)
5. **Critical writes are idempotent and atomic.** One Confirm → one Confirmed Claim + one reservation; one Approve & Send Invoice → one Official Order + one order number + one invoice number; retries never duplicate. (§28.14, §29.7–29.9)
6. **Confirm Claim & Print Label creates a Confirmed Claim + label job only — no invoice, no order. Approve & Send Invoice is the sole normal Official Order creation point.** (§6, §15, §22)
7. **A label job ≠ a physical print; a sent message ≠ delivered/read; verified ≠ Paid in Full.** (§24, §22.10, §16)
8. **The six Owner-approval actions are non-delegable in V1** (official-order cancellation, forfeiture, price override, exceptional release, Live Batch reopen, verified wrong-payment correction); an Owner Approval Request never itself performs the action; execution re-validates state. (§5.13, §22.14, §29.8)
9. **Every material action is attributable; attribution survives reassignment/rename/deactivation; audit is append-only; notes never change records.** (§31)
10. **Failures never silently duplicate or destroy; failures preserve anchor records (claim, order, label job); no auto cancel/forfeit/release/return as a recovery shortcut; manual fallback always remains.** (§32)
11. **External integrations (Pancake/Meta) and printer connections are optional adapters that cannot bypass the lifecycle or grant authority; V1 works fully without them.** (§14, §27, §29.14–29.15)
12. **Secrets never committed; test/prod data separated; no customer authentication; every feature traces to an approved requirement.** (§30, §33)

---

## 2. Stack & environments (intended; validate versions)

- **Stack (§33.3):** Next.js · TypeScript · Tailwind CSS · shadcn/ui · Supabase (DB, auth, storage) · Vercel · GitHub. Mobile-first.
- **Environments (§35):** Local → Development → Staging/internal test → Controlled pilot → Production → Post-launch monitoring, with **strict data separation** (§35 r2).
- **Not final (To be confirmed):** exact package versions, repo/folder structure, CI config, RLS/secrets implementation, Supabase/Vercel plans/regions (§33.24, §35.18). These are resolved inside Phase 0.
- **Subscriptions (§35.14):** free tiers for development; Supabase Pro before real customer/order/payment data; Vercel paid plan before production use; Pancake only after validation; **prices verified fresh at purchase time**.

---

## 3. Phase overview

| Phase | Focus | Primary Bible refs | Readiness contribution (§34.6) |
|---|---|---|---|
| **0** | Foundations, environments, CI, decision gate | 33, 35 | Development Ready |
| **1** | Data model & integrity spine (reservation + idempotency) | 28, 19, 22 | Development Ready |
| **2** | Auth, roles, permissions, authorization boundary | 5, 30, 29 | Internal Test Ready |
| **3** | Live selling & claim intake (Pending Claims) | 12, 13 | Internal Test Ready |
| **4** | Claim Review, confirmation, reservation, print queue | 6, 12, 13, 22, 24 | Internal Test Ready |
| **5** | Invoicing, customer message, Official Order | 15, 6, 22 | Internal Test Ready |
| **6** | Payment & layaway | 16, 17 | Internal Test Ready |
| **7** | Fulfillment & Owner Approval Center | 18, 5.13, 22 | Internal Test Ready |
| **8** | Inventory ops, Returned-to-Stock, customers, migration | 19, 10, 6.20 | Internal Test Ready |
| **9** | Dashboard, search, reports, notifications, audit surfacing | 7, 23, 25, 26, 31 | Internal Test Ready |
| **10** | Hardware/integration validation (parallel, gated) | 27, 14, 13 | (feature-gated, non-blocking) |
| **11** | Testing, security, UAT, pilot, production | 34, 30, 32, 35, 36 | Pilot Ready → Production Ready |

---

## 4. Detailed phases

### Phase 0 — Foundations, Environments & Decision Gate
- **Objective:** Establish a clean, secure, testable baseline and clear the "blocks V1 build" decisions before feature code.
- **Bible refs:** §33 (standards), §35 (environments/subscriptions), §36.16 (register).
- **Deliverables:** repo + branch strategy + commit standards; TypeScript/lint/format/type-check gates; Tailwind/shadcn base; env-var + secrets scaffolding (no secrets committed); Supabase/Vercel projects per environment with **data separation**; base mobile-first app shell (5 bottom-nav placeholders per §8.2); **feature-flag mechanism** for conditional capabilities; **requirements-traceability convention** (each PR cites a Bible section).
- **Depends on:** nothing.
- **Invariants:** #12 (secrets, env separation, traceability).
- **Exit gate:** builds green; static checks pass; environments isolated; **V1-build decisions confirmed** (see §5 below); no customer-auth surface exists.
- **Open items to resolve first:** repo structure, CI config, RLS/secrets approach (§33.24) — *developer decisions*; final domain/plans can wait until pre-production.
- **Blocking level:** blocks all later phases (baseline).

### Phase 1 — Data Model & Integrity Spine
- **Objective:** Implement the logical model and the invariants that everything else depends on — **before** any workflow UI.
- **Bible refs:** §28 (data model), §19/§22.3/§22.5 (inventory), §29 (contracts).
- **Deliverables (logical entities, names proposed per §28):** users/roles/permissions/assignments/shop-page; customers/aliases/duplicate-links; live batches/items/current-flex-history; **inventory items + reservation records + RTS records**; pending/confirmed claims/miner-positions/waitlist/evidence; label jobs/print attempts; invoice drafts/draft-claim links; official orders/order-claim links/invoice refs; customer messages/attempts; payments/evidence/verification; layaway/installments/financer; fulfillment/shipping/pickup; owner-approval requests; notifications/reminders; **audit logs**; migration/import/source markers; attachments. Supabase migrations (reviewed) + RLS scaffolding.
- **Depends on:** Phase 0.
- **Invariants:** #3, #4, #5, #9. Encode as constraints: **reserve-once-at-Confirmed-Claim**; **no second deduction at order**; **one claim ≤ one active draft**; **idempotency keys / business-unique constraints** for Confirm, Approve & Send Invoice, Verify Payment; **append-only audit**; **available stock changes only via approved RTS**.
- **Exit gate:** database-integrity tests (§34 stage 5) prove: no double deduction, one-reservation-per-confirm, one-order-per-send, no duplicate on retry, RTS-gated restoration.
- **Open items to resolve first:** reference-number formats, reservation-record design, snapshot depth, Paid-in-Full/Outstanding-Balance modeling (§28.27) — *developer, non-blocking to start but needed to finalize schema*.
- **Blocking level:** blocks Phases 3–9 (they write to this model).

### Phase 2 — Authentication, Roles & Permissions
- **Objective:** Enforce the reconciled authority model at the trusted boundary.
- **Bible refs:** §5.4/§5.6/§5.13 (roles/27 toggles/reconciled authorities), §30 (security), §29.3–29.4.
- **Deliverables:** internal-staff auth (no customer login); **Owner / Selected Admin (max 2) / Staff**; 27 granular permission toggles; shop/page scope; server-side permission checks on every sensitive action; session lifecycle + account activation/deactivation (deactivated users lose access, keep history); **Owner-only management of Selected Admin**; **six non-delegable Owner-approval gates**; Owner self-action (audited, dual-role).
- **Depends on:** Phase 1.
- **Invariants:** #1, #2, #8, #9, #12.
- **Exit gate:** permission/authorization tests (§34 stage 6) — every toggle and every Owner-only gate; unauthorized writes rejected server-side; UI-hidden ≠ secure verified.
- **Open items to resolve first (blocks this phase):** **auth method / MFA / password policy / session & concurrent limits / recovery / Owner emergency access** (§30.23) — *Owner/developer*; **RLS + secrets-management implementation** (§30.23) — *developer*. Max-two Selected Admins and claim-authority already resolved (`3857627`).
- **Blocking level:** blocks all feature phases (3–9) that gate on permissions.

### Phase 3 — Live Selling & Claim Intake
- **Objective:** Create Pending Claims from live and post-live intake.
- **Bible refs:** §12 (live workflow), §13 (capture methods).
- **Deliverables:** Live Batch lifecycle (**Live Batch Operation** / **Closure** / reopen=Owner approval); Current Flex Item (**Current Flex Item Control**); manual live entry + screenshot upload + iOS Share intake; **Manual Post-Live Entry** from Orders (Claim Capture; new item = **Post-Live Item Entry**); Pending Claim creation with source markers, evidence, attribution.
- **Depends on:** Phases 1–2.
- **Invariants:** capture creates a **Pending Claim only** — no reservation/confirm/print/invoice/order/auto-match (§12.3, §13.2); switching Current Flex affects future capture only; migration stays separate.
- **Exit gate:** E2E happy/failure + duplicate-submit + concurrent capture tests (§34 stages 7–8) show no duplicate Pending Claims; no OCR/auto-read.
- **Open items to resolve first:** exact Live-Batch/source-marker/manual-entry fields (§12.74) — *client, before pilot* (can start with proposed set).
- **Blocking level:** blocks Phase 4.

### Phase 4 — Claim Review, Confirmation, Reservation & Print Queue
- **Objective:** Turn Pending Claims into Confirmed Claims (the reservation point) and manage label jobs.
- **Bible refs:** §6.4, §12, §13, §22.6, §24.
- **Deliverables:** Claim Review (customer/item/miner/quantity correction); **Pending-Claim withdrawal** (Claim Review, reason; no reservation ⇒ no RTS); **Confirmed-Claim withdrawal** (Claim Review + reason + full audit; reservation → RTS; no auto-available/2nd-miner/waitlist; in-draft→draft correction; order-exists→cancellation); **manual 1st→2nd miner switch** (reservation transfers, no second deduction, item not briefly available, prohibited after order); **Confirm Claim & Print Label** (Confirmed Claim + **reservation/decrement** + label job → For Invoice); **Print Queue** (label jobs, retry/reprint, void — **Void/Cancel Label Job** stronger); unique 1st/2nd (no 3rd), multi-stock + waitlist.
- **Depends on:** Phases 1–3.
- **Invariants:** #3, #4, #5, #6, #7, #10. **Reserve once at Confirm; retry/reprint never duplicate claim or reservation; label job ≠ physical print; failed print preserves claim + job.**
- **Exit gate:** concurrency test — two staff confirming one claim → one reservation; reprint → no new claim/reservation; withdrawal routes correctly (pre-confirm no RTS, confirmed→RTS).
- **Open items to resolve first:** exact 2nd-Miner priority window (§6.22/§19.7) — *client, before pilot*; label fields/reprint-reason (§24.17) — *before pilot*.
- **Blocking level:** blocks Phase 5.

### Phase 5 — Invoicing, Customer Message & Official Order
- **Objective:** Group confirmed claims and create the Official Order — the commit point.
- **Bible refs:** §15, §6.7–6.8, §22.8–22.9.
- **Deliverables:** For Invoice readiness; Invoice Draft grouping (same customer + payment + fulfillment arrangement; one claim ≤ one active draft); draft correction/removal; grouped totals; **customer-message preparation** (**Message Preparation**: prepare/preview/copy) with before/after official-reference boundary; **Approve & Send Invoice** (**one** Official Order + order number + invoice number + shared 3-day hold; reservation → committed, **no second deduction**); manual-send + **Mark as Sent** (**Message Sending**).
- **Depends on:** Phases 1–4.
- **Invariants:** #5, #6, #7. **Idempotent, atomic order creation; retry → same order; no false official references pre-send; Copy ≠ Sent.**
- **Exit gate:** repeated Approve & Send Invoice → one order (idempotency test §34 stage 8); grouped claims counted once; hold starts on successful send only.
- **Open items to resolve first:** invoice/order number formats (§28.27), message template + channels (§15.34/§26) — *client/developer, before pilot*.
- **Blocking level:** blocks Phases 6–7.

### Phase 6 — Payment & Layaway
- **Objective:** Evidence, verification, layaway monitoring.
- **Bible refs:** §16, §17.
- **Deliverables:** payment evidence recording vs **Payment Verification**; Payment Submitted/Unverified → Verified (≠ Paid in Full); **Payment Correction** (unverified by authorized user; **verified → Owner approval**); layaway (20% DP verified → Active; ≤3 months; fee ₱150×grams×months; ≤10-day grace; forfeiture-eligible → **Owner-approved forfeiture**); financer tracking; installment recording (≠ verification).
- **Depends on:** Phases 1–2, 5.
- **Invariants:** #7, #8, #9, #10. **Verification never auto-releases/forfeits/cancels or deducts inventory; no duplicate verified payment; no silent reassignment.**
- **Exit gate:** payment-verification retry → no duplicate; wrong-order correction traceable + Owner-gated when verified.
- **Open items to resolve first (blocks this phase):** **accepted payment methods; partial/over/underpayment behaviour; Paid-in-Full & Outstanding-Balance definitions; layaway fee application point/rounding** (§16.23, §17.28) — *client, before pilot*. Refund/reversal deferred (post-V1).
- **Blocking level:** blocks pilot for payment/layaway paths.

### Phase 7 — Fulfillment & Owner Approval Center
- **Objective:** Prepare/release fulfillment; centralize the six Owner approvals.
- **Bible refs:** §18, §5.13, §22.13–22.14.
- **Deliverables:** shipping/pickup preparation (**Shipping/Pickup Preparation**); **normal release** (permission-based, ≥₱1,000 deposit + approved COD where applicable); **exceptional release** (Owner-approved; request ≠ release); dispatch/pickup completion; **Owner Approval Center** (cancellation, forfeiture, price override, exceptional release, **Live Batch reopen**, **verified wrong-payment correction**) with state re-validation on execution.
- **Depends on:** Phases 1–2, 5–6.
- **Invariants:** #4, #8, #10. **Normal release ≠ Owner-only; request never executes; no auto dispatch/complete/release/stock-return; approval re-validates.**
- **Exit gate:** Owner-approval retry → executes once; exceptional-release request holds until decision; verified before release enforced.
- **Open items to resolve first:** shipping/pickup fields, courier list, exact COD rules, failed-delivery/unclaimed-pickup workflow (§18.25) — *client, before pilot/production*.
- **Blocking level:** blocks pilot for fulfillment paths.

### Phase 8 — Inventory Ops, Returned-to-Stock, Customers & Migration
- **Objective:** Manual inventory review, customer management, historical migration.
- **Bible refs:** §19, §10, §6.20, §8.10.
- **Deliverables:** Inventory monitoring (available vs remaining per §20.3); **Returned-to-Stock Review** (manual approve→available, reject→held; unique→2nd miner, multi→waitlist as review; forfeited excluded from auto-return); customers + aliases + **possible-duplicate review** (no auto-merge); **Existing Record Entry / Migration** (Owner or authorized Selected Admin; preserve historical values; no fake claims; separate from live intake).
- **Depends on:** Phases 1–2, 4–7.
- **Invariants:** #4, #9. **No automatic transfer/allocation/return; migration preserves source + imported-by; no auto-merge.**
- **Exit gate:** migration-testing (§34 stage 16) — recoverable batches, no partial silent facts; RTS restores only on approval.
- **Open items to resolve first:** RTS outcome authority, freed-unit/waitlist selection authority, unsold-item & forfeited-item disposition (§19.26) — *client, before production*; duplicate-merge mechanics deferred.
- **Blocking level:** blocks production for stock-return/migration paths.

### Phase 9 — Dashboard, Search, Reports, Notifications & Audit Surfacing
- **Objective:** Operational hub and cross-cutting read/notify surfaces.
- **Bible refs:** §7, §23, §25, §26, §31.
- **Deliverables:** Dashboard queues + compact counts (non-additive) + alerts + permission-gated quick actions + manual refresh; global search/filter (permission-scoped; no auto-merge/reassign); basic reports + **Export Data / Reports** permission; notifications/reminders baseline (staff-triggered; Day 1/2/3; layaway due/grace) with **manual-send delivery**; audit visibility (append-only, role-scoped, no secrets).
- **Depends on:** Phases 1–8 (reads their records).
- **Invariants:** #1, #7, #9, #11. **Report visibility ≠ action authority; Sent ≠ Delivered/Read; notifications change no records; export limited to visible records.**
- **Exit gate:** counting rules verified non-additive; search results permission-scoped; audit export gated by Export permission.
- **Open items to resolve first:** dashboard KPIs, export formats, date basis, source categories, audit taxonomy/retention (§25.16/§31.30) — *client/developer, before production, non-blocking to start*.
- **Blocking level:** blocks production polish; core queues needed for pilot.

### Phase 10 — Hardware & Integration Validation (parallel, gated, non-blocking)
- **Objective:** Validate conditional capabilities on real hardware/vendors **without blocking V1**.
- **Bible refs:** §27 (printer), §14 (Pancake/Meta), §13 (Android/iOS capture), §26 (delivery/read).
- **Deliverables:** printer bridge for **Xprinter XP-236B, 40×30 mm** with real-device testing, print-success confirmation, duplicate-print safeguards; Android floating capture / iOS Share validation; Pancake/Meta adapter trial (intake-first Pending Claim; conditional direct send; Delivered/Read only if verified). All behind **feature flags**.
- **Depends on:** Phases 4 (print), 3 (capture), 5/6/9 (messaging); runs in parallel once those land.
- **Invariants:** #10, #11. **Manual fallback always available; adapters never bypass lifecycle or grant authority; retries never duplicate; failed send preserves order.**
- **Exit gate:** real-hardware/device/vendor tests pass (§34 stages 12–14) **before** any readiness is claimed; if not validated, feature stays flagged off — **launch proceeds on manual fallback**.
- **Open items to resolve first:** XP-236B protocol/SDK/pairing; Pancake API/features/access/plan; Android/iOS feasibility (§27.18/§14.28/§13.29) — *developer/vendor, before that feature's readiness only*.
- **Blocking level:** **non-blocking for V1 launch** (§35 r10–11, §36 principles 1–6).

### Phase 11 — Testing, Security, UAT, Pilot & Production
- **Objective:** Prove the system and launch safely.
- **Bible refs:** §34 (testing), §30 (security), §32 (recovery), §35 (deployment), §36 (release criteria).
- **Deliverables:** full §34 stage sweep (Bible-consistency → smoke) incl. concurrency/duplicate/stale/unauthorized variants; security testing (§30); error/recovery testing (§32); restorable-backup verification; **Staff UAT**; **controlled live-selling pilot**; production sign-off; post-deploy smoke test; monitoring/alerts baseline.
- **Depends on:** Phases 1–9 (10 as available).
- **Invariants:** all; especially **no production before readiness gates; no duplicate critical records; backups restorable; manual fallback keeps optional integrations from blocking launch.**
- **Exit gate → Production Ready:** NOT declared while critical tests fail, real-device testing incomplete, backup/restore untested, security blockers remain, core permissions fail, duplicate prevention fails, or pilot incomplete (§34.6, §35).
- **Open items to resolve first:** test tools/matrix/UAT participants/pilot params/sign-off authority (§34.9); domain/plans/backup/monitoring/support-owner (§35.18) — *Owner, before pilot/production*.
- **Blocking level:** the launch gate itself.

---

## 5. Decision gate — §36.16 open items mapped to phases

Resolve each item with its **decision owner** before the affected phase's code (no silent defaults, §33.2). Already resolved: max-two Selected Admins, per-account toggles as setup config, claim withdraw/switch authority (commit `3857627`).

| When needed | Items (register category) | Owner |
|---|---|---|
| **Before Phase 2** | auth method/MFA/password/session limits; RLS + secrets impl (I); Owner approval mechanism (B) | Owner / Developer |
| **Before Phase 5–6** | accepted payment methods; partial/over/underpayment; Paid-in-Full & Outstanding-Balance; layaway fee point/rounding; financer fields (A, C, D) | Client |
| **Before Phase 4** | exact 2nd-Miner priority window (E); label fields/reprint-reason (M) | Client / Developer |
| **Before Phase 7** | shipping/pickup fields, courier list, COD rules, failed-delivery/unclaimed-pickup (F) | Client |
| **Before Phase 8** | RTS outcome/freed-unit/waitlist authority; unsold-item & forfeited-item disposition (E, A, F) | Client |
| **Before Phase 9/production** | dashboard KPIs, export formats, date basis, source categories; audit taxonomy/retention; sales/revenue definition (H, J) | Client / Developer |
| **Before Phase 11 (pilot/production)** | test tools/matrix/UAT/pilot params/sign-off; domain/plans/backup/monitoring/support owner; error-recovery ops (P, Q, K) | Owner |
| **Before that feature's readiness (non-blocking to launch)** | printer protocol/SDK; Pancake API/access/plan; Android/iOS feasibility (M, N, O) | Developer / Vendor |
| **Deferred (post-V1)** | refund/reversal/accounting; duplicate-merge mechanics; multi-page/SaaS/portal/native (D, R) | Client |

---

## 6. Milestones & readiness alignment

| Milestone | Phases done | §34 readiness | §35 environment | §36 phase |
|---|---|---|---|---|
| **M1 — Spine & Auth** | 0–2 | Internal Test Ready (core) | Development | V1 Core Build |
| **M2 — Claim → Order path** | 3–5 | Internal Test Ready | Development/Staging | V1 Core Build |
| **M3 — Money & fulfilment** | 6–7 | Internal Test Ready | Staging | V1 Core Build |
| **M4 — Ops & cross-cutting** | 8–9 | Internal Test Ready | Staging | Internal QA |
| **M5 — Hardware/integration** | 10 (as validated) | feature-gated | Staging | Hardware/Integration Validation |
| **M6 — UAT & Pilot** | 11 (UAT+pilot) | Pilot Ready | Controlled pilot | Staff UAT → Controlled Pilot |
| **M7 — Production** | 11 (sign-off) | Production Ready | Production | V1 Production |

---

## 7. Testing woven through (not a final phase only)

- Every phase ships with **happy-path + failure-path** tests and the relevant concurrency/duplicate/stale/unauthorized variants (§34 r2–6).
- Continuous: static checks, unit, integration, DB-integrity, permission/authorization (§34 stages 2–6).
- **Definition of Done per feature (§33.21):** traces to a Bible section · server-side authz · idempotent critical writes · preserves inventory model + audit attribution · handles failure paths · tests+review+lint+types · leaks no secrets · not merged prototype code.
- Real-hardware/device/vendor tests are **mandatory before any printer/mobile/integration readiness claim** (§34 r14–16).

---

## 8. Risk register (build-time)

| Risk | Mitigation |
|---|---|
| Double inventory deduction / lost reservation | Enforce reserve-once + no-second-deduction as DB constraints in Phase 1; test first (§34 stage 5). |
| Duplicate Official Orders on retry | Idempotency keys + atomic creation in Phase 1/5; idempotency test gate. |
| UI-only authorization slipping in | Server-side checks mandatory; Phase 2 exit gate proves UI-hidden ≠ secure. |
| Unvalidated printer/Pancake assumed working | Keep behind flags (Phase 10); manual fallback; readiness only after real tests. |
| Client decisions defaulted silently | Decision gate (§5 above) blocks affected phases until answered. |
| Prototype code leaking into production | `ui-prototype-preview` stays unmerged; DoD forbids unreviewed prototype merge (§33.20). |
| Scope creep to multi-tenant/SaaS/customer portal | Excluded from V1 (§36.8); future-only. |

---

## 9. Explicitly deferred / out of V1 scope

- Customer login/portal, multi-tenant SaaS (FlowDesk), native app-store apps, advanced analytics, accounting/revenue-recognition, automation beyond approved controls (§36.8–36.9).
- Conditional (validation-gated, non-blocking): printer printing, Android floating capture, iOS Share, Pancake/Meta, direct send, Delivered/Read, offline sync, PWA install, advanced notifications, automated exports (§36.7).

---

## 10. Status & next step

- **No code, scaffolding, package installs, or launch configuration have been created.** This document is the plan only.
- **Recommended first action (not yet taken):** confirm the **Phase 0/2 decision-gate items** (auth method + RLS/secrets approach; Owner approval mechanism), then scaffold Phase 0.
- This file is a **working aid** and is currently **uncommitted** (like `SESSION-HANDOFF.md`); it is **not** part of the approved documentation line and does **not** modify `Development-Bible.md`. Commit only on request.

*End of Implementation Roadmap. Source of truth remains Development-Bible.md (Sections 1–36, COMPLETE AND AUDITED).*
