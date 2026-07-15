# A.V. Jewelry Operations System (MineFlow)

Internal staff operations system for A.V. Jewelry.

> ## ⚠️ NOT PRODUCTION-READY
>
> **This application is a Phase 0 foundation. It must not be deployed to production
> or used to run real business operations.**
>
> There is **no data model, no permission system, no business workflow, and no
> enforced MFA**. What exists is a scaffold, a sign-in shell, and placeholder screens.
> A screen that renders is not a workflow that works.

---

## Project purpose

A.V. Jewelry Operations System (internal codename **MineFlow**) is a **mobile-first,
internal-only** application for live-selling jewelry operations: live batches, claim
intake and review, inventory reservation, invoicing, official orders, payment and
layaway, fulfillment, and Owner approvals.

It is **staff-only**. There is **no customer login** and **no public registration**.

### Source of truth

| Document                            | Role                                                               |
| ----------------------------------- | ------------------------------------------------------------------ |
| `Development-Bible.md`              | **Authoritative business specification** (Sections 1–36, approved) |
| `IMPLEMENTATION-ROADMAP.md`         | Phased build plan (Phases 0–11)                                    |
| `PHASE-0-ARCHITECTURE-DECISIONS.md` | Phase 0 technical decisions (ADR)                                  |

**No implementation may silently redefine an approved business rule.** If code and
the Bible disagree, the Bible governs and the code is corrected (Bible §33.2).

These documents are **not modified by implementation work** and are excluded from
formatting so tooling cannot alter them.

---

## Current phase

**Phase 0 — Foundations, Environments & Decision Gate.** This is the application
foundation only. Phase 1 has not begun.

---

## Exact package versions

Installed and verified at build time. **These are pins, not floors** (ADR §17).

| Package               | Version           |
| --------------------- | ----------------- |
| next                  | 16.2.10           |
| react                 | 19.2.7            |
| react-dom             | 19.2.7            |
| typescript            | **5.9.3 (exact)** |
| eslint                | 10.7.0            |
| eslint-config-next    | 16.2.10           |
| typescript-eslint     | 8.64.0            |
| @supabase/ssr         | 0.12.3            |
| @supabase/supabase-js | 2.110.5           |
| tailwindcss           | 4.3.2             |
| vitest                | 4.1.10            |
| zod                   | 4.4.3             |
| prettier              | 3.9.5             |

Runtime: **Node 24.x**, **npm 11.x**.

### Why TypeScript is pinned to exactly 5.9.3

`@typescript-eslint` 8.64 supports `typescript >=4.8.4 <6.1.0`. **TypeScript 6.x or
the native 7.x compiler would break the ESLint type-check gate.** The pin is exact
(`"typescript": "5.9.3"`, plus an `overrides` entry) so no transitive dependency can
quietly upgrade it. **Do not widen this to a range.** No beta, RC, canary, or
nightly packages are used.

### Known compatibility limitations

1. **`eslint-plugin-react` does not officially support ESLint 10.** `eslint-config-next@16.2.10`
   bundles `eslint-plugin-react@7.37.5`, whose peer range stops at `eslint ^9.7` — and no
   released version supports ESLint 10. Its version-`detect` path calls
   `context.getFilename()`, removed in ESLint 10, which crashes the entire lint run.
   **Resolved without weakening the gate** by pinning `settings.react.version` in
   `eslint.config.mjs`, which short-circuits detection before it reaches the removed API.
   All rules remain enabled. `npm install` still prints `ERESOLVE overriding peer dependency`
   warnings for these bundled plugins; lint passes cleanly. Revisit when the plugin
   declares ESLint 10 support.
2. **Next.js 16 removed `next lint` and the `eslint` config key**, so the production build
   **no longer runs ESLint**. Lint is therefore a **separate, mandatory gate** — do not
   assume a green build means lint passed. `npm run verify` runs both.
3. **`postcss` is overridden to `^8.5.19`.** `next@16.2.10` depends on `postcss@8.4.31`,
   which carries a moderate XSS advisory (GHSA-qx2v-qp2m-jg93). `npm audit fix --force`
   would "fix" this by downgrading Next to 9.3.3 — destroying the approved stack. The
   override stays within postcss 8.x and yields **0 vulnerabilities**.
4. **The `middleware` file convention is deprecated in Next 16** in favour of `proxy`;
   this project uses `src/proxy.ts`.

---

## Prerequisites

- **Node.js 24.x** and **npm 11.x**
- A **Supabase project for development** (separate from staging and production — ADR §10),
  or the Supabase CLI for local development
- Git

---

## Installation

```bash
npm install
```

---

## Environment variables

```bash
cp .env.example .env.local
```

Then fill in your **development** values. `.env.local` is git-ignored and **must never
be committed**.

| Variable                        | Scope           | Required | Notes                                                      |
| ------------------------------- | --------------- | -------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | **Public**      | Yes      | Inlined into the browser bundle                            |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Public**      | Yes      | Safe to expose; protected by RLS, not secrecy              |
| `SUPABASE_SERVICE_ROLE_KEY`     | **Server-only** | **No**   | ⚠️ Bypasses RLS entirely. Optional by design — leave blank |

Validation lives in `src/lib/env.ts` and **fails fast and safely**: a missing or
malformed variable throws an error naming the variable and **never echoing its value**,
so a bad secret cannot leak into logs (Bible §31 r12).

### Rules

- **Never commit real credentials.** Secrets live in `.env.local` locally and in the
  deployment platform's environment variables when hosted (ADR §11).
- **Never prefix a privileged key with `NEXT_PUBLIC_`** — that publishes it to every visitor.
- **Development, staging, pilot, and production use separate credentials and separate
  Supabase projects.** Never point local development at production.

---

## Local development

```bash
npm run dev          # start the dev server (http://localhost:3000)
```

| Command                           | Purpose                                              |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev`                     | Development server                                   |
| `npm run build`                   | Production build                                     |
| `npm start`                       | Serve the production build                           |
| `npm run lint`                    | ESLint (**separate gate — the build does not lint**) |
| `npm run typecheck`               | TypeScript, no emit                                  |
| `npm test`                        | Run tests once                                       |
| `npm run test:watch`              | Tests in watch mode                                  |
| `npm run format` / `format:check` | Prettier                                             |
| **`npm run verify`**              | **format:check → lint → typecheck → test → build**   |

Run **`npm run verify`** before every commit.

### Supabase local development

`supabase/config.toml` holds the local configuration. It reflects the approved
decisions: **`enable_signup = false`** (no self-registration), anonymous sign-ins
disabled, **TOTP MFA enabled and phone/SMS MFA disabled** (ADR §4, §5).

**No Supabase project is linked, and the CLI is not pinned as a project dependency** —
exact migration tooling remains _To be confirmed_ (ADR §17). To use it, install the
Supabase CLI and run `supabase start`, then copy the printed local URL and anon key
into `.env.local`. **Local keys are not production credentials.**

Migrations live in `supabase/migrations/` and are **empty by design** — the business
schema is Phase 1.

---

## Project structure

```
src/
  app/
    (auth)/sign-in/          Public sign-in route + form
    (app)/                   PROTECTED group — requires a session
      layout.tsx             Auth boundary (force-dynamic)
      dashboard/             Placeholder + loading state
      live/ claims/ orders/ more/    Placeholders (Bible §8.2 nav)
      not-authorized/        Not-authorized state
    error.tsx                Generic error boundary
    not-found.tsx
  components/
    ui/                      shadcn/ui-compatible primitives
    shell/                   App shell, header, bottom/side nav
    states/                  Placeholder, empty, loading, not-authorized
  lib/
    env.ts                   Environment validation (public vs privileged)
    supabase/
      client.ts              Browser client (anon key only)
      server.ts              Server client, acts as the signed-in user (RLS applies)
      admin.ts               ⚠️ PRIVILEGED, server-only — bypasses RLS. No callers.
      proxy.ts               Session refresh + unauthenticated redirect
    auth/
      session.ts             Verified session lookup (getUser, never getSession)
      actions.ts             Sign-in / sign-out server actions
      mfa.ts                 TOTP MFA hook — BOUNDARY ONLY, not enforced
    authz/guard.ts           requireUser() — authentication only
    validation/auth.ts       Zod schemas (sign-in only)
  modules/                   Future domain modules — empty by design
  proxy.ts                   Next 16 proxy (was `middleware`)
supabase/
  config.toml                Local dev config
  migrations/                Empty by design — schema is Phase 1
tests/
  unit/                      Active foundation tests
  integration/ e2e/          Reserved (Phase 1+ / Phase 11)
```

---

## Authentication shell behaviour

- **Staff email + password only**, via Supabase Auth (ADR §4).
- **No public self-registration. No customer login.** There is no sign-up route, no
  sign-up action, and `enable_signup = false` in the Supabase config.
- **No accounts are seeded.** No Owner, Selected Admin, or Staff account is created —
  sign-in requires an account provisioned out-of-band in your own dev Supabase project.
  Account administration is **Phase 2**.
- Unauthenticated access to a protected route redirects to `/sign-in`; an authenticated
  user landing on `/sign-in` is redirected to `/dashboard`.
- Sign-out clears the session **server-side**.
- Sign-in errors are deliberately generic, so an unauthenticated caller cannot
  enumerate valid staff accounts.
- Sessions are verified with `auth.getUser()` — never `getSession()`, which trusts the
  cookie without verifying it.

### MFA — NOT ENFORCED

**Approved method: Supabase Auth TOTP (authenticator app)** (ADR §5). SMS, WhatsApp,
and email MFA are **not approved** and are disabled in config.

**Phase 0 provides the documented implementation hook only** (`src/lib/auth/mfa.ts`).
**MFA is not enforced, and Phase 0 does not claim otherwise.** Enrollment and
enforcement are **Phase 2**. Owner MFA is required before production launch; Selected
Admin MFA is strongly recommended and reviewed before production; Staff MFA is optional
in V1. **Recovery and lost-device handling remain _To be confirmed_ before pilot.**

---

## Security notes

- **Authorization is enforced at the trusted server/data boundary — never in the UI.**
  UI visibility is not authorization; assignment is not permission; role title is not
  authority (Bible §5, §11, §30.3 r2).
- **`src/lib/supabase/admin.ts` bypasses Row Level Security entirely.** It is isolated,
  marked `server-only` (a Client Component importing it **fails the build**), blocked
  from components by ESLint, and **has no callers**. Using it does not authorize an
  action: permission, scope, record state, and Owner approval must still be revalidated
  server-side at execution time.
- **The proxy/edge check is not the security control** — it is UX plus defense in depth.
  Protected layouts re-verify the session server-side on every request.
- **Every future business table must have RLS enabled** (ADR §7).
- **Secrets are never committed.** `.env*` is git-ignored except `.env.example`, which
  contains placeholders only.
- **Prototype code is not production code** (`ui-prototype-preview` stays unmerged);
  ESLint blocks importing it.

---

## Currently implemented (Phase 0)

- Next.js + React + TypeScript scaffold on the approved pinned stack
- Strict TypeScript, ESLint, Prettier, and Vitest gates
- Environment validation with a public/privileged split
- Supabase browser, server, and isolated privileged client boundaries
- Sign-in page, sign-in/sign-out actions, verified session lookup
- Protected route boundary with unauthenticated redirect
- Mobile-first app shell: header, five-item bottom nav (Bible §8.2), side rail
- Placeholder Dashboard + Live / Claims / Orders / More placeholders
- Loading, empty, not-authorized, and error-boundary states
- Foundation tests (64) and repository security guards
- Empty, version-controlled migrations directory

## Explicitly NOT implemented

**No business workflow exists.** None of the following is built, and no placeholder
screen should be read as implying otherwise:

Customers · Live Batch · jewelry items · Current Flex Item · Pending Claims · Claim
Review · Confirmed Claims · inventory reservation · Print Queue · Invoice Draft ·
Official Orders · customer-message workflow · payments · layaway · shipping/pickup ·
Owner Approval Center · Returned-to-Stock Review · reporting · migration/import ·
Pancake · Meta · printer · Android capture · iOS Share · production schema ·
production deployment.

Also absent: **roles and granular permissions**, **RLS policies**, **business tables**,
**MFA enforcement**, **account administration**, and **Global Search** (the header entry
is deliberately disabled and labelled).

**No fake operational data is displayed anywhere** — no revenue, customer counts,
orders, claims, sales, inventory, or metrics. No data model exists, so any figure shown
would be fabricated.

---

## Next phase

**Phase 1 — Data Model & Integrity Spine.** It must carry these invariants into the
schema:

- **Inventory reserves exactly once at Confirmed Claim; Official Order does not deduct
  again.**
- **Critical writes are atomic, idempotent, and safely retryable** — a retry must never
  duplicate claims, reservations, orders, payments, messages, releases, approvals, or
  stock returns.
- **The six Owner-approved actions are non-delegable**; creating an approval request
  does not execute the action.
- **Audit attribution cannot be erased**; unauthorized actions change no record.
- **Every business table has RLS enabled.**

Phase 2 then delivers authentication hardening, roles, permissions, and **MFA
enforcement**.

Before Phase 1 begins, the **Phase 0 decision-gate items in ADR §17** that block it must
be confirmed by their owners — including the RLS/secrets implementation approach and the
exact Supabase migration tooling.
