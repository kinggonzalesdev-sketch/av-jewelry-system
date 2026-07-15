# Database migrations

Version-controlled migration files, applied **in sequence** (ADR §12).

## Status: empty by design

**No migrations exist yet.** Phase 0 establishes the migration workflow only. The
business schema is Roadmap **Phase 1 — Data Model & Integrity Spine**, and creating
any business table here now would be out of scope and unapproved.

Specifically, Phase 0 creates **no** business tables, **no** final business RLS
policies, and **no** business seed data.

## Rules (ADR §12, Bible §35 r4–5)

- Every production schema change has a migration. **No undocumented manual production
  schema changes.**
- Migrations are applied in sequence and never edited after they have been applied to
  a shared environment — correct forward with a new migration.
- Risky migrations require **backup planning, rollback planning, and staging validation**
  before production.
- Migration files must preserve data-integrity and audit requirements (Bible §28, §31).
- Migrations, application code, and tests for a feature stay traceable together
  (Bible §33.16).

## When Phase 1 adds the schema

**Every business-data table must have RLS enabled** (ADR §7). RLS is the last line of
defense, not the only one: sensitive actions must additionally be authorized at the
trusted server boundary, re-validating permission, shop/page scope, record state, and
Owner approval at execution time.

## Naming

`<timestamp>_<description>.sql` — e.g. `20260101000000_create_customers.sql`.

## Tooling

Exact Supabase migration tooling and commands remain **To be confirmed** (ADR §17).
The Supabase CLI is not pinned as a project dependency in Phase 0, and no project is
linked. See `supabase/config.toml` for the local-development configuration.
