-- ============================================================================
-- Phase 1 — Label Jobs, Invoice Drafts, Official Orders
-- Status vocabulary: Bible §22.7 (Print Job), §22.8 (Invoice Draft),
-- §22.9 (Official Order).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Label jobs (Bible §22.7, §24)
-- Physical print success is SEPARATE from the Confirmed Claim: the claim exists
-- regardless of print outcome, and a reprint never creates another claim or
-- reservation.
-- ----------------------------------------------------------------------------
create table public.label_jobs (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.claims (id) on delete restrict,

  status text not null default 'pending_print' check (status in (
    'pending_print',
    'printed',
    'failed_print',
    'reprint_requested',
    'voided'
  )),

  voided_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  -- One label job per claim. Reprints are ATTEMPTS on this job, not new jobs —
  -- this is what makes "print retry does not create another claim or
  -- reservation" structurally true rather than a matter of discipline.
  constraint label_jobs_one_per_claim unique (claim_id),
  constraint label_jobs_voided_ck check (
    status <> 'voided' or (voided_reason is not null and length(trim(voided_reason)) > 0)
  )
);

comment on table public.label_jobs is
  'Label jobs (Bible §22.7). One per claim: a reprint is a new ATTEMPT, never a new job, claim, or reservation.';

create trigger label_jobs_updated_at before update on public.label_jobs
  for each row execute function app_private.set_updated_at();

alter table public.label_jobs enable row level security;
alter table public.label_jobs force row level security;
revoke all on public.label_jobs from anon, authenticated;

-- Print attempts: an append-oriented history of physical print outcomes.
create table public.print_attempts (
  id uuid primary key default gen_random_uuid(),
  label_job_id uuid not null references public.label_jobs (id) on delete restrict,

  attempt_number integer not null check (attempt_number >= 1),
  outcome text not null check (outcome in ('printed', 'failed')),
  failure_reason text,

  attempted_at timestamptz not null default now(),
  attempted_by uuid references public.staff_profiles (id) on delete restrict,

  constraint print_attempts_unique_number unique (label_job_id, attempt_number),
  constraint print_attempts_failure_ck check (
    outcome <> 'failed' or failure_reason is not null
  )
);

comment on table public.print_attempts is
  'Physical print attempt history (Bible §22.7). Printer integration is unverified (Bible §27) — manual fallback always remains.';

alter table public.print_attempts enable row level security;
alter table public.print_attempts force row level security;
revoke all on public.print_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Invoice Drafts (Bible §22.8)
-- An Invoice Draft is NOT an Official Order.
-- ----------------------------------------------------------------------------
create table public.invoice_drafts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,

  status text not null default 'draft' check (status in (
    'draft',
    'in_review',
    'sent',
    'dissolved'
  )),

  sent_at timestamptz,
  dissolved_at timestamptz,
  dissolved_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  constraint invoice_drafts_sent_ck check (status <> 'sent' or sent_at is not null),
  constraint invoice_drafts_dissolved_ck check (
    status <> 'dissolved' or (dissolved_at is not null and dissolved_reason is not null)
  )
);

comment on table public.invoice_drafts is
  'Invoice Drafts (Bible §22.8). A draft is NOT an Official Order. On Sent, exactly one Official Order + one order number + one invoice number are created.';

create index invoice_drafts_customer_idx on public.invoice_drafts (customer_id, status);

create trigger invoice_drafts_updated_at before update on public.invoice_drafts
  for each row execute function app_private.set_updated_at();

alter table public.invoice_drafts enable row level security;
alter table public.invoice_drafts force row level security;
revoke all on public.invoice_drafts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Invoice Draft <-> Claim links.
-- RULE (Bible §22.8): one claim cannot belong to more than one ACTIVE draft.
--
-- "Active" depends on the PARENT draft's status, which a partial unique index
-- cannot read. So `is_active` is a maintained mirror of that status, kept in
-- step by trigger, and the partial unique index enforces the rule on it.
-- ----------------------------------------------------------------------------
create table public.invoice_draft_claims (
  id uuid primary key default gen_random_uuid(),
  invoice_draft_id uuid not null references public.invoice_drafts (id) on delete restrict,
  claim_id uuid not null references public.claims (id) on delete restrict,

  -- Mirrors "parent draft is in an active state (draft | in_review)".
  -- Maintained by trigger; never set by hand.
  is_active boolean not null default true,

  added_at timestamptz not null default now(),
  added_by uuid references public.staff_profiles (id) on delete restrict,
  removed_at timestamptz,
  removed_reason text,

  constraint invoice_draft_claims_unique_pair unique (invoice_draft_id, claim_id)
);

comment on table public.invoice_draft_claims is
  'Claims grouped into an Invoice Draft (Bible §22.8). The partial unique index below enforces: one claim may sit in at most ONE active draft.';

-- THE constraint: a claim may appear in at most one ACTIVE draft.
create unique index invoice_draft_claims_one_active_draft_per_claim
  on public.invoice_draft_claims (claim_id)
  where is_active;

create index invoice_draft_claims_draft_idx on public.invoice_draft_claims (invoice_draft_id);

alter table public.invoice_draft_claims enable row level security;
alter table public.invoice_draft_claims force row level security;
revoke all on public.invoice_draft_claims from anon, authenticated;

-- Only a Confirmed Claim may be added to a draft.
create or replace function app_private.enforce_draft_claim_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  select c.status into v_status from public.claims c where c.id = new.claim_id;

  if v_status is distinct from 'confirmed_claim' then
    raise exception
      'Only a Confirmed Claim may be added to an Invoice Draft (claim status: %)',
      coalesce(v_status, 'missing')
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger invoice_draft_claims_enforce_rules
  before insert on public.invoice_draft_claims
  for each row when (new.is_active) execute function app_private.enforce_draft_claim_rules();

-- Keep is_active in step with the parent draft's status.
-- A dissolved or sent draft no longer holds the claim "actively", which frees
-- the claim to return to For-Invoice readiness (Bible §22.6, §22.8).
create or replace function app_private.sync_draft_claim_active()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status in ('dissolved', 'sent') and old.status not in ('dissolved', 'sent') then
    update public.invoice_draft_claims
    set is_active = false,
        removed_at = coalesce(removed_at, now()),
        removed_reason = coalesce(removed_reason, 'Parent draft ' || new.status)
    where invoice_draft_id = new.id and is_active;
  end if;

  return new;
end;
$$;

create trigger invoice_drafts_sync_claim_active
  after update of status on public.invoice_drafts
  for each row execute function app_private.sync_draft_claim_active();

-- ----------------------------------------------------------------------------
-- OFFICIAL ORDERS (Bible §22.9) — the idempotency boundary.
-- ----------------------------------------------------------------------------
-- One successful Approve & Send Invoice creates EXACTLY ONE Official Order,
-- ONE order number, and ONE invoice number. A retry must never create a second.
--
-- Statuses omitted on purpose: "Paid in Full" and "Outstanding Balance" remain
-- To be confirmed (Bible §22.9, §22.19) and are NOT invented here.
-- ----------------------------------------------------------------------------
create table public.official_orders (
  id uuid primary key default gen_random_uuid(),

  -- Business-facing references, separate from the internal UUID and from each
  -- other. Both unique: a duplicate number is a business-visible failure.
  order_number text not null unique
    default app_private.next_reference('ORD', 'app_private.order_number_seq'),
  invoice_number text not null unique
    default app_private.next_reference('INV', 'app_private.invoice_number_seq'),

  -- IDEMPOTENCY: one Official Order per Invoice Draft, enforced by the database.
  -- A retried send cannot create a second order — the INSERT fails instead.
  invoice_draft_id uuid not null references public.invoice_drafts (id) on delete restrict,

  customer_id uuid not null references public.customers (id) on delete restrict,

  status text not null default 'invoiced' check (status in (
    'invoiced',
    'awaiting_required_payment',
    'required_payment_verified',
    'for_preparation',
    'for_shipping_or_pickup',
    'approved_for_release',
    'exceptional_release_pending',
    'dispatched_or_picked_up',
    'completed',
    'cancelled',
    'expired_overdue'
  )),

  -- Shared 3-day hold created at send (Bible §15.16, §4.11).
  hold_expires_at timestamptz,

  -- Cancellation is a NON-DELEGABLE Owner approval (Bible §5.13, §22.9).
  cancellation_approval_request_id uuid,
  cancelled_at timestamptz,
  cancelled_reason text,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  -- THE idempotency constraint.
  constraint official_orders_one_per_draft unique (invoice_draft_id),

  -- Cancellation must carry an Owner approval reference and a reason.
  constraint official_orders_cancelled_ck check (
    status <> 'cancelled' or (
      cancelled_at is not null
      and cancelled_reason is not null
      and cancellation_approval_request_id is not null
    )
  )
);

comment on table public.official_orders is
  'Official Orders (Bible §22.9). UNIQUE(invoice_draft_id) makes a retried send incapable of creating a second order. Paid in Full / Outstanding Balance are NOT modelled — they remain To be confirmed (Bible §22.19).';

create index official_orders_customer_idx on public.official_orders (customer_id, status);
create index official_orders_status_idx on public.official_orders (status);

create trigger official_orders_updated_at before update on public.official_orders
  for each row execute function app_private.set_updated_at();

alter table public.official_orders enable row level security;
alter table public.official_orders force row level security;
revoke all on public.official_orders from anon, authenticated;

-- Official Order <-> Claim links.
create table public.official_order_claims (
  id uuid primary key default gen_random_uuid(),
  official_order_id uuid not null references public.official_orders (id) on delete restrict,
  claim_id uuid not null references public.claims (id) on delete restrict,

  added_at timestamptz not null default now(),

  -- A claim belongs to at most ONE Official Order.
  constraint official_order_claims_unique_claim unique (claim_id),
  constraint official_order_claims_unique_pair unique (official_order_id, claim_id)
);

comment on table public.official_order_claims is
  'Claims committed to an Official Order. UNIQUE(claim_id): a claim can never be sold twice.';

alter table public.official_order_claims enable row level security;
alter table public.official_order_claims force row level security;
revoke all on public.official_order_claims from anon, authenticated;
