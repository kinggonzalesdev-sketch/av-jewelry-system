-- ============================================================================
-- Phase 1 — Foundation: extensions, helpers, audit spine, idempotency
-- ----------------------------------------------------------------------------
-- Source of truth: Development-Bible.md (Sections 1-36, APPROVED).
-- Status vocabulary: Bible §22 (Status Transition Rules) — the ONLY authority.
-- No status is invented here. Values marked "To be confirmed" in §22.19 are
-- deliberately absent (Paid in Full, Outstanding Balance, Delivered/Read).
--
-- RLS posture (Phase 1): every business table enables RLS in the SAME migration
-- that creates it. Phase 1 adds NO permissive policies, so the default is DENY
-- for anon and authenticated alike. Permission-aware policies are Phase 2.
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists btree_gist with schema extensions;

-- ----------------------------------------------------------------------------
-- Private schema for helper functions. Never exposed via PostgREST.
-- ----------------------------------------------------------------------------
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function app_private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- Business-facing reference numbers (Bible: stable internal ids are separate
-- from business-facing reference numbers).
--
-- Internal identity is always a UUID primary key. Reference numbers are a
-- SEPARATE human-facing value and must never be used as a foreign key.
-- Sequences guarantee uniqueness without gaps mattering; a gap is harmless,
-- a duplicate is not.
-- ----------------------------------------------------------------------------
create sequence if not exists app_private.claim_reference_seq;
create sequence if not exists app_private.order_number_seq;
create sequence if not exists app_private.invoice_number_seq;
create sequence if not exists app_private.batch_reference_seq;

create or replace function app_private.next_reference(p_prefix text, p_seq regclass)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return p_prefix || '-' || to_char(now() at time zone 'utc', 'YYYY') || '-' ||
         lpad(nextval(p_seq)::text, 6, '0');
end;
$$;

-- ============================================================================
-- AUDIT EVENT FOUNDATION (Bible §31)
-- ----------------------------------------------------------------------------
-- Invariants encoded here:
--   * append-only: UPDATE and DELETE are blocked by trigger AND by revoked grants
--   * attribution survives deactivation/rename/reassignment: the actor is stored
--     as an immutable snapshot (actor_auth_uid + actor_label), NOT only as an FK.
--     An FK alone could be broken by a future delete; the snapshot cannot.
--   * a failed action is logged as a failure, never a false success
-- ============================================================================
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),

  -- Trusted actor identity. Captured from auth.uid() by the caller, never from
  -- client-supplied input. Nullable only for system/time-based events, which
  -- must set actor_kind = 'system'.
  actor_auth_uid uuid,
  actor_kind text not null default 'staff'
    check (actor_kind in ('staff', 'system', 'migration')),

  -- Immutable attribution snapshot. Bible §31: attribution survives rename,
  -- reassignment, and deactivation — so we store the label AT THE TIME of the
  -- event rather than joining to a mutable profile row.
  actor_label text,

  action text not null check (length(action) between 1 and 120),
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid,

  -- Outcome. Bible §31 r7: failed actions are logged as failures.
  outcome text not null default 'succeeded'
    check (outcome in ('succeeded', 'failed', 'denied')),

  reason text,
  -- Context payload. Must never contain secrets (Bible §31 r12).
  context jsonb not null default '{}'::jsonb,

  constraint audit_events_system_actor_ck check (
    (actor_kind = 'system' and actor_auth_uid is null)
    or (actor_kind <> 'system')
  )
);

comment on table public.audit_events is
  'Append-only audit spine (Bible §31). Attribution is an immutable snapshot; it survives deactivation and rename. UPDATE/DELETE are blocked.';

create index audit_events_entity_idx on public.audit_events (entity_type, entity_id, occurred_at desc);
create index audit_events_actor_idx on public.audit_events (actor_auth_uid, occurred_at desc);

-- Append-only enforcement. Bible §31: audit attribution cannot be erased.
create or replace function app_private.deny_audit_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only: % is not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function app_private.deny_audit_mutation();

create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function app_private.deny_audit_mutation();

alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
revoke all on public.audit_events from anon, authenticated;

-- ============================================================================
-- IDEMPOTENCY RECORDS
-- ----------------------------------------------------------------------------
-- Bible §29.7-29.9: critical writes are atomic, idempotent, and safely retryable.
-- A retry must never duplicate claims, reservations, orders, payments, messages,
-- releases, approvals, or stock returns.
--
-- Usage contract: a critical operation claims a key BEFORE acting. The unique
-- constraint makes a concurrent duplicate impossible — the second caller's
-- INSERT fails rather than performing the action twice. The stored result_id
-- lets a retry return the ORIGINAL outcome instead of creating a new one.
-- ============================================================================
create table public.idempotency_records (
  id uuid primary key default gen_random_uuid(),
  -- Scope + key together identify one logical operation, e.g.
  -- ('official_order.create', <invoice_draft_id>).
  scope text not null check (length(scope) between 1 and 80),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),

  -- The record produced by the first successful execution.
  result_type text,
  result_id uuid,

  state text not null default 'in_progress'
    check (state in ('in_progress', 'succeeded', 'failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid,

  constraint idempotency_records_unique_key unique (scope, idempotency_key)
);

comment on table public.idempotency_records is
  'Idempotency ledger (Bible §29.7-29.9). A retry re-uses the original result; the unique (scope, key) makes a duplicate critical write impossible.';

create trigger idempotency_records_updated_at
  before update on public.idempotency_records
  for each row execute function app_private.set_updated_at();

alter table public.idempotency_records enable row level security;
alter table public.idempotency_records force row level security;
revoke all on public.idempotency_records from anon, authenticated;
