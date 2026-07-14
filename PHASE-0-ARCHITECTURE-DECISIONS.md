# Phase 0 — Architecture & Decision Record (V1)

> **Project:** A.V. Jewelry Operations System (internal codename **MineFlow**).
> **Derived from:** `Development-Bible.md` (Sections 1–36, *COMPLETE AND AUDITED*, master tip `a37483b`) and `IMPLEMENTATION-ROADMAP.md` (Phases 0–11).
> **Status of this document:** Architecture Decision Record (ADR) for **Phase 0** only. **No code, SQL, package configuration, or scaffolding is included or has been performed.**
> **Rule:** These decisions describe *how* V1 will be built. They must not redefine any approved business rule. Any conflict is resolved in favour of the Development Bible (§33.2).

---

## 1. Purpose

This record captures the **client-approved Phase 0 architecture decisions** that establish a secure, testable, and traceable baseline before any feature code (Roadmap Phase 0 → exit into Phase 1). It fixes the foundational choices — authentication, MFA, sessions, authorization/RLS, secrets, environments, Owner-approval mechanism, migrations, Git control, and file storage — while explicitly preserving the Bible's non-negotiable invariants and keeping unresolved technical details **To be confirmed**.

## 2. Source-of-truth hierarchy

1. **`Development-Bible.md` (Sections 1–36, APPROVED)** — the single source of truth for business rules and system behavior (§33.2).
2. **`IMPLEMENTATION-ROADMAP.md`** — the phased build plan derived from the Bible.
3. **This ADR (`PHASE-0-ARCHITECTURE-DECISIONS.md`)** — Phase 0 technical decisions that implement (never redefine) the above.
4. **Implementation code, migrations, tests (future)** — must trace to an approved requirement.

If any lower layer appears to contradict a higher layer, the higher layer governs and the lower layer is corrected.

## 3. Approved Phase 0 decisions (summary)

The client approved: (1) Supabase Auth with staff email/password, no self-registration, no customer login; (2) MFA required for Owner before production, recommended for Selected Admin, optional for Staff initially; (3) Supabase-supported session lifecycle with revocation and preserved history; (4) defense-in-depth authorization (RLS + server-side checks + granular permissions + shop/page scope + Owner-only execution checks); (5) strict secrets handling; (6) four logical environments with data separation; (7) in-system Owner Approval workflow incl. audited Owner self-action; (8) version-controlled migrations; (9) `master` as stable branch with feature branches/controlled commits; (10) Supabase Storage private-by-default. Details follow; unresolved specifics are listed in §17.

## 4. Authentication model

- **Intended service:** **Supabase Auth** (subject to validation).
- **Method:** **staff email + password**.
- **No public self-registration; no customer login** (§5.10, §30.4, Invariant: no customer auth).
- Staff accounts are **created / invited / activated through an authorized internal administration process** (Owner-controlled account lifecycle, §5.3, §30.5).
- The **exact account-invitation UI may be finalized during implementation** (To be confirmed).
- **Individual accounts only; no shared logins** (§5.11).

## 5. MFA model

- **MFA is required for the Owner account before production launch.**
- **MFA is strongly recommended for Selected Admin accounts** (max two, §5.4).
- **MFA for ordinary Staff may remain optional in initial V1** unless later security testing requires it (§34 security testing).
- **MFA method (client-approved): Supabase Auth TOTP (authenticator-app).** **No SMS or WhatsApp MFA in Phase 0.** Owner MFA is required before production; Selected Admin MFA is strongly recommended and reviewed before production; Staff MFA optional in V1. Actual TOTP enrollment/enforcement is implemented in the account/permission phase — Phase 0 records the method and implementation hook, and **does not claim MFA enforcement is complete**. **Recovery and lost-device handling remain To be confirmed before pilot.**

## 6. Session model

- **Trusted devices may maintain normal authenticated sessions.**
- **Session creation, refresh, expiration, and revocation use supported Supabase Auth behavior** (no custom session protocol invented).
- **Disabled/deactivated accounts lose future access**; **historical attribution remains** after deactivation (§30.6, §31 r3, Invariant #9).
- **Lost/stolen device response supports session/account revocation** (§30.15).
- **Exact idle timeout, maximum session duration, and concurrent-session limits remain configurable and To be confirmed before production** (§30.23).

## 7. Authorization & RLS strategy (defense in depth)

Authorization is enforced in layers, none of which may be bypassed:

1. **Supabase Row Level Security (RLS) at the data layer** — records are scoped so a query cannot return or mutate data outside the user's permission and shop/page scope.
2. **Trusted server-side authorization checks for sensitive actions** — every sensitive write re-checks the exact Section 5 permission before executing (§29.3, §30.3 r1).
3. **Granular per-account permissions** from the approved Bible (the §5.6 / §5.13 toggle set).
4. **Shop/page scope** where applicable (§11.6).
5. **Owner-only approval checks at execution time** for the six non-delegable actions.

**Rules (enforced):**
- **UI visibility is not authorization; assignment is not permission; role title is not authority** (§5, §11, §30.3 r2).
- **No sensitive write may rely solely on client-side checks** (§33 r3–4).
- **Creating an Owner Approval Request does not execute the protected action** (§22.14).
- **Approval execution re-validates current record state and Owner authority** (§29.8).
- **Exact RLS policies and SQL belong to the implementation phase** (To be confirmed) — none are written here.

## 8. Permission enforcement layers (mapping)

| Layer | Enforces | Bible ref |
|---|---|---|
| RLS (data) | record visibility + row-level scope; last line of defense | §28, §30 |
| Server action / API boundary | exact permission per action; idempotency; state re-validation | §29 |
| Owner-only gate (execution) | the six non-delegable approvals; no delegation | §5.13, §22.14 |
| Shop/page scope | applicable-scope restriction | §11.6 |
| UI (convenience only) | hides/disables — **never the security control** | §7.3, §30.3 r2 |

**No permission silently includes another; unauthorized attempts change no record** (§5.13, §11.45).

## 9. Owner Approval mechanism

- **In-system Owner Approval workflow is the normal V1 mechanism.**
- For each **non-delegable Owner-approved action** (official-order cancellation, layaway forfeiture, price override, exceptional fulfillment release, Live Batch reopen, verified wrong-payment-to-order correction — §5.13 item 12):
  - **create an Owner Approval Request** preserving **requester, reason, evidence, affected record, and time**;
  - **Owner approves or rejects in the system**;
  - **execution validates approval and current record state** (§29.8);
  - **approval and execution remain separate audit events where applicable** (§31 r5).
- **Owner self-action:** the Owner **may initiate, approve, and execute directly**; **no artificial second person is required in V1**; the system still **records the Owner as requester / decision-maker / executor** as applicable (§5.13 item 11, §31 r4).
- **A verbal or external conversation may be noted as supporting context but must not replace the required system audit record.**

## 10. Environment model

Four logical environments:

| Environment | Purpose | Data | Notes |
|---|---|---|---|
| **Local development** | build/dev | dev data only | `.env.local`; free tiers |
| **Staging / internal test** | integration/QA | isolated | **separate Supabase project from production** |
| **Controlled pilot** | bounded real operation | pilot data | infra choice TBC (see §17) |
| **Production** | live operation | production data | least-privilege access |

**Rules:** development/test data stays **separate** from production; **staging uses a separate Supabase project**; **production access follows least privilege**; **unsupported integrations remain disabled**; **manual fallback remains available** (§35 r2, r6, r10–11).
**Whether pilot uses staging infrastructure or a restricted production environment remains To be confirmed before pilot deployment.**

## 11. Secrets handling

- **Local secrets in `.env.local`; secrets are never committed** (§30.15, §33 r14).
- **Hosted environments use deployment-platform environment variables.**
- **Separate credentials and projects for development/staging vs production.**
- **Pancake, Meta, printer, Supabase service-role, and future integration credentials are stored only in approved secret storage.**
- **Browser-exposed keys are limited to keys designed for public client use**; **service-role/privileged credentials are never exposed to the browser.**
- **Exact secrets-management product/implementation remains To be confirmed** (§30.23).

## 12. Database migration strategy

- **Version-controlled migration files**, applied **in sequence**.
- **Every production schema change has a migration**; **no undocumented manual production schema changes.**
- **Risky migrations require backup, rollback planning, and staging validation** (§35 r4–5).
- **Migration files preserve data integrity and audit requirements** (§28, §31).
- **Exact Supabase migration tooling and commands are validated during Phase 0 implementation setup** (To be confirmed) — none are run here.

## 13. File-storage strategy

- **Supabase Storage is the intended V1 storage** (subject to validation).
- **Customer, item, evidence, payment, fulfillment, and migration files are private by default** (§30.11).
- **Access is permission- and record-scoped**; **public unauthenticated file URLs are not the default.**
- **Item photo vs claim/message evidence remain distinguished** (§12.42); **no OCR/auto-read** (§13).
- **Exact bucket layout, size/type limits, retention, image processing, and signed-URL duration remain To be confirmed** (§28.22, §13.29).

## 14. Git / change-control strategy

- **`master` remains the approved stable branch** unless the roadmap later defines a different protected model.
- **Feature implementation occurs in dedicated branches or controlled commits** per the final Git workflow.
- **One logical implementation milestone → reviewable commits.**
- **No direct production deployment merely because code is committed** (§35 r1).
- **Migrations, application code, and tests for a feature remain traceable together** (§33.16).
- **Exact branch-protection and CI settings remain To be confirmed** (§33.24).

## 15. Audit & observability foundation

- **Audit is append-only; every material action is attributable; attribution survives reassignment/rename/deactivation** (§31).
- **Approval and execution are separate events where the workflow separates them; failed actions are logged as failures, never false successes; notes are not substitutes for audit events** (§31 r5–8).
- **Audit records never expose secrets; audit visibility grants no action authority; audit export requires Export Data / Reports** (§31 r12–14).
- **Monitoring/alerting is acknowledged as a boundary** — provider, retention, taxonomy, and time-zone standard remain **To be confirmed** (§31.30, §32.16).

## 16. Error / idempotency foundation

- **Critical writes are idempotent and atomic** (§29.7–29.9): one Confirm → one Confirmed Claim + one reservation; one Approve & Send Invoice → one Official Order + one order number + one invoice number; one Verify Payment → one verified record; retries never duplicate.
- **Inventory reserves exactly once at Confirmed Claim; Official Order commits with no second deduction; available stock returns only via approved manual Returned-to-Stock Review** (§19, §22.3).
- **Failures preserve anchor records (claim, order, label job); no auto cancel/forfeit/release/return as recovery shortcut; stale updates never overwrite newer state; manual fallback always remains** (§32).
- **Exact retry limits, timeouts, error codes, recovery-queue names, and offline-sync behavior remain To be confirmed** (§32.22).

## 17. Decisions still To be confirmed (Phase 0 residual)

> **Build-ready confirmed pins (client-approved, for the fresh-session Phase 0 build):** the implementation standardizes on a **stable, toolchain-compatible** stack — **Next `16.2.10` · React / react-dom `19.2.7` · TypeScript `5.9.3` · ESLint `10.x` · @typescript-eslint `8.64.0` · eslint-config-next `16.2.10`** (Node `24.x`, npm `11.x`). **TypeScript is pinned to `5.9.3` (not the default-latest `7.0.2`)** because the current `@typescript-eslint` supports only `typescript >=4.8.4 <6.1.0`; TS 7 (native compiler) would break the ESLint type gate. No RC/canary/beta versions. Exact patch levels are re-verified at install time; MFA method is now **Supabase Auth TOTP** (§5).

- ~~exact MFA method~~ **RESOLVED: Supabase Auth TOTP (authenticator-app)**; recovery/lost-device handling still To be confirmed before pilot
- idle timeout / max session duration / concurrent-session limits
- exact RLS policies and SQL (implementation phase)
- secrets-management product/implementation
- whether pilot runs on staging infra or a restricted production environment
- exact Supabase migration tooling/commands
- branch-protection and CI settings
- storage bucket layout, size/type limits, retention, image processing, signed-URL duration
- monitoring/alerting provider, audit retention/taxonomy, time-zone standard
- Supabase/Vercel plans and regions; final domain (§35.18)

*(These are recorded, not resolved. None is defaulted silently; each is owned by the Owner/developer as noted in the roadmap decision gate.)*

## 18. Phase 0 implementation checklist (to execute in the setup step — not yet done)

1. Confirm the §17 items owned by Owner/developer needed to start (MFA capability, RLS/secrets approach).
2. Initialize repo conventions: TypeScript config, lint/format/type-check gates, commit standards, branch strategy.
3. Establish base mobile-first app shell (5 bottom-nav placeholders, §8.2) — **no feature logic**.
4. Create separate Supabase projects for development and staging; keep production project separate and least-privilege.
5. Wire environment variables and `.env.local` (no secrets committed); confirm public vs privileged key separation.
6. Stand up the version-controlled migration workflow (tooling validated) — **no schema applied to production**.
7. Establish the feature-flag mechanism for conditional capabilities (printer, Pancake/Meta, native capture), default off.
8. Establish the requirements-traceability convention (each PR cites a Bible section).
9. Configure private-by-default storage buckets (layout TBC) — **no public URLs**.
10. Set up the testing harness for static/unit/integration checks (tools TBC).

## 19. Exit criteria before Phase 1

- Baseline builds green; static/lint/type checks pass.
- Development and staging environments exist with **separate Supabase projects** and **isolated data**.
- Secrets handled correctly (`.env.local` local; platform env vars hosted; **nothing committed**; privileged keys never browser-exposed).
- Authentication baseline in place (Supabase Auth email/password; **no self-registration; no customer login**); Owner MFA path identified for pre-production.
- Migration workflow operational and version-controlled.
- Feature-flag + traceability conventions active.
- **§17 Phase 0/Phase 2 decision-gate items required to begin Phase 1/2 confirmed.**
- No production data present; no unsupported integration enabled.

## 20. Prohibited shortcuts

- Relying on **UI hiding/disabling** as security (§30.3 r2).
- Any **sensitive write authorized only client-side** (§33 r3).
- **Committing secrets** or exposing **service-role/privileged keys** to the browser.
- **Public-by-default** file URLs.
- **Undocumented manual production schema changes** (bypassing migrations).
- **Skipping idempotency/atomicity** on critical writes; **deducting inventory** outside the reserve-once-at-Confirmed-Claim model; **a second deduction** at Official Order.
- **Executing a protected action without an Owner Approval Request/decision** (or without re-validating state).
- **Erasing audit attribution**; treating **notes** as state changes.
- Introducing **customer login**.
- Enabling **printer/Pancake/Meta** as if validated, or removing **manual fallback**.
- **Merging the prototype** (`ui-prototype-preview`) as production code.
- Any change that **silently redefines the Development Bible**.

---

## Non-negotiable implementation invariants (carried forward)

Inventory reserves **exactly once at Confirmed Claim**; **Official Order does not deduct again**; **all critical writes are idempotent**; the **six Owner approvals are non-delegable**; **no customer login**; **manual claim and message fallback remain available**; **Pancake/Meta/printer remain optional and unverified**; **audit attribution cannot be erased**; **unauthorized actions change no record**; **secrets are never committed**; **test and production data remain separate**; **no implementation may silently redefine the Development Bible.**

*End of Phase 0 Architecture & Decision Record. Source of truth remains Development-Bible.md (Sections 1–36, COMPLETE AND AUDITED).*
