-- ============================================================================
-- Phase 1 — Customer Messages, Payments, Layaway, Fulfillment
-- Status vocabulary: Bible §22.10 (Message), §22.11 (Payment),
-- §22.12 (Layaway), §22.13 (Fulfillment).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Customer messages (Bible §22.10)
-- Manual fallback ALWAYS remains available. Delivered/Read are
-- integration-dependent and To be confirmed — no Pancake/Meta status is invented.
-- ----------------------------------------------------------------------------
create table public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  official_order_id uuid references public.official_orders (id) on delete restrict,

  status text not null default 'message_draft' check (status in (
    'message_draft',
    'ready_to_copy_or_send',
    'manually_sent',
    'direct_send_pending',
    'direct_send_failed'
    -- 'delivered' and 'read' are deliberately ABSENT: Bible §22.10/§22.19 mark
    -- them integration-dependent and To be confirmed. Adding them now would
    -- invent a status and imply a delivery guarantee we cannot make.
  )),

  body text not null,

  -- Staff attestation: "Manually Sent" does not prove delivery (Bible §22.10).
  manually_sent_at timestamptz,
  manually_sent_by uuid references public.staff_profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  constraint customer_messages_manual_attestation_ck check (
    status <> 'manually_sent' or (manually_sent_at is not null and manually_sent_by is not null)
  )
);

comment on table public.customer_messages is
  'Customer messages (Bible §22.10). Manually Sent is a staff attestation, not proof of delivery. Delivered/Read are omitted — integration-dependent and To be confirmed. A send failure never creates a second Official Order.';

create index customer_messages_order_idx on public.customer_messages (official_order_id);

create trigger customer_messages_updated_at before update on public.customer_messages
  for each row execute function app_private.set_updated_at();

alter table public.customer_messages enable row level security;
alter table public.customer_messages force row level security;
revoke all on public.customer_messages from anon, authenticated;

-- Message send attempts. A retry is an ATTEMPT — it never creates another order.
create table public.message_send_attempts (
  id uuid primary key default gen_random_uuid(),
  customer_message_id uuid not null references public.customer_messages (id) on delete restrict,

  attempt_number integer not null check (attempt_number >= 1),
  channel text not null check (channel in ('manual', 'direct_integration')),
  outcome text not null check (outcome in ('sent', 'failed')),
  failure_reason text,

  attempted_at timestamptz not null default now(),
  attempted_by uuid references public.staff_profiles (id) on delete restrict,

  constraint message_send_attempts_unique unique (customer_message_id, attempt_number),
  constraint message_send_attempts_failure_ck check (
    outcome <> 'failed' or failure_reason is not null
  )
);

comment on table public.message_send_attempts is
  'Message send attempt history (Bible §12.69). A retry records an attempt and never creates a second Official Order.';

alter table public.message_send_attempts enable row level security;
alter table public.message_send_attempts force row level security;
revoke all on public.message_send_attempts from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Payments (Bible §22.11)
-- Recording is NOT verifying. Verified is NOT Paid in Full.
-- ----------------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  official_order_id uuid not null references public.official_orders (id) on delete restrict,

  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),

  -- Payment methods are an open item (Roadmap Phase 6): the accepted list is
  -- To be confirmed by the client, so no CHECK list is invented here.
  method_note text,

  status text not null default 'submitted_unverified' check (status in (
    'submitted_unverified',
    'verified',
    'rejected'
  )),

  recorded_at timestamptz not null default now(),
  recorded_by uuid references public.staff_profiles (id) on delete restrict,

  -- Reassignment between orders is never silent (Bible §16.12).
  reassigned_from_order_id uuid references public.official_orders (id) on delete restrict,
  reassignment_approval_request_id uuid,
  reassignment_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A reassignment must be explicit, reasoned, and Owner-approved: verified
  -- wrong-payment-to-order correction is a non-delegable Owner action (§5.13).
  constraint payments_reassignment_ck check (
    reassigned_from_order_id is null or (
      reassignment_reason is not null
      and reassignment_approval_request_id is not null
    )
  )
);

comment on table public.payments is
  'Payment records (Bible §22.11). Recording is not verifying; Verified is NOT Paid in Full (Paid in Full remains To be confirmed). Payments are never silently moved between orders (Bible §16.12).';

create index payments_order_idx on public.payments (official_order_id, status);

create trigger payments_updated_at before update on public.payments
  for each row execute function app_private.set_updated_at();

alter table public.payments enable row level security;
alter table public.payments force row level security;
revoke all on public.payments from anon, authenticated;

-- Payment evidence — SEPARATE from verification (Bible §22.11).
create table public.payment_evidence (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,

  -- Private storage path (ADR §13). Never a public URL. Distinct from item photos.
  storage_path text not null unique check (length(trim(storage_path)) between 1 and 400),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  note text,

  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.staff_profiles (id) on delete restrict
);

comment on table public.payment_evidence is
  'Payment evidence metadata. Evidence is SEPARATE from verification — attaching evidence verifies nothing (Bible §22.11).';

alter table public.payment_evidence enable row level security;
alter table public.payment_evidence force row level security;
revoke all on public.payment_evidence from anon, authenticated;

-- Payment verification — a distinct, attributed act.
create table public.payment_verifications (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id) on delete restrict,

  outcome text not null check (outcome in ('verified', 'rejected')),
  verified_amount numeric(14, 2) check (verified_amount is null or verified_amount > 0),
  note text,

  verified_at timestamptz not null default now(),
  verified_by uuid not null references public.staff_profiles (id) on delete restrict,

  -- IDEMPOTENCY: one verification decision per payment. A duplicate
  -- "Verify Payment" cannot create a second verified record (Bible §29.7-29.9).
  constraint payment_verifications_one_per_payment unique (payment_id)
);

comment on table public.payment_verifications is
  'Payment verification decisions (Bible §22.11). UNIQUE(payment_id): one Verify Payment -> one verified record; a retry cannot duplicate it.';

alter table public.payment_verifications enable row level security;
alter table public.payment_verifications force row level security;
revoke all on public.payment_verifications from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Layaway (Bible §22.12)
-- An Active Layaway BELONGS TO an Official Order — it is not another order.
-- ----------------------------------------------------------------------------
create table public.layaway_arrangements (
  id uuid primary key default gen_random_uuid(),

  -- One layaway per order, and it is an ATTRIBUTE of that order, never a
  -- separate order (Bible §17, §22.12).
  official_order_id uuid not null references public.official_orders (id) on delete restrict,

  status text not null default 'active' check (status in (
    'active',
    'overdue',
    'grace_period',
    'forfeiture_eligible',
    'forfeited',
    'completed'
  )),

  -- 20% deposit gate (Bible §22.12: "Active Layaway | 20% DP verified").
  deposit_percent numeric(5, 2) not null default 20.00 check (deposit_percent > 0 and deposit_percent <= 100),
  deposit_verified_payment_id uuid references public.payments (id) on delete restrict,

  -- Grace period <= 10 days (Bible §22.12).
  grace_period_days smallint not null default 10 check (grace_period_days between 0 and 10),

  -- Forfeiture is a NON-DELEGABLE Owner approval (Bible §5.13, §22.12).
  forfeiture_approval_request_id uuid,
  forfeited_at timestamptz,
  forfeited_reason text,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint layaway_one_per_order unique (official_order_id),

  -- Forfeiture requires Owner approval + reason. No automatic forfeiture.
  constraint layaway_forfeited_ck check (
    status <> 'forfeited' or (
      forfeited_at is not null
      and forfeited_reason is not null
      and forfeiture_approval_request_id is not null
    )
  ),
  -- Active layaway requires a verified deposit, EXCEPT for migrated records,
  -- which enter at their actual historical status (Bible §22.16).
  constraint layaway_active_deposit_ck check (
    status <> 'active'
    or deposit_verified_payment_id is not null
    or source_kind = 'migrated'
  )
);

comment on table public.layaway_arrangements is
  'Layaway (Bible §22.12). Belongs to an Official Order — NOT an additional order. Non-cancellable after deposit; eligibility is not approval; no automatic forfeiture; a forfeited item is excluded from automatic stock return.';

create trigger layaway_updated_at before update on public.layaway_arrangements
  for each row execute function app_private.set_updated_at();

alter table public.layaway_arrangements enable row level security;
alter table public.layaway_arrangements force row level security;
revoke all on public.layaway_arrangements from anon, authenticated;

create table public.layaway_installments (
  id uuid primary key default gen_random_uuid(),
  layaway_arrangement_id uuid not null references public.layaway_arrangements (id) on delete restrict,

  installment_number integer not null check (installment_number >= 1),
  due_date date not null,
  amount_due numeric(14, 2) not null check (amount_due > 0),

  -- Links to the payment that settled this installment, once verified.
  payment_id uuid references public.payments (id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint layaway_installments_unique unique (layaway_arrangement_id, installment_number)
);

comment on table public.layaway_installments is
  'Layaway installment schedule (Bible §17). Fee application point and rounding remain To be confirmed (Roadmap Phase 6) and are not modelled.';

alter table public.layaway_installments enable row level security;
alter table public.layaway_installments force row level security;
revoke all on public.layaway_installments from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Fulfillment (Bible §22.13)
-- Preparation is NOT release. Exceptional release is Owner-approved.
-- Fulfillment NEVER deducts inventory.
-- ----------------------------------------------------------------------------
create table public.fulfillment_records (
  id uuid primary key default gen_random_uuid(),
  official_order_id uuid not null references public.official_orders (id) on delete restrict,

  status text not null default 'for_preparation' check (status in (
    'for_preparation',
    'for_shipping',
    'for_pickup',
    'approved_for_release',
    'exceptional_release_pending',
    'dispatched',
    'picked_up',
    'completed',
    'failed_delivery',
    'unclaimed_pickup',
    'held'
  )),

  method text check (method in ('shipping', 'pickup')),

  -- Exceptional release is a NON-DELEGABLE Owner approval (Bible §5.13, §22.13).
  -- The request alone does not release.
  exceptional_release_approval_request_id uuid,

  released_at timestamptz,
  released_by uuid references public.staff_profiles (id) on delete restrict,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fulfillment_one_per_order unique (official_order_id),

  -- An exceptional release cannot be approved without an Owner approval record.
  constraint fulfillment_exceptional_ck check (
    status <> 'exceptional_release_pending'
    or exceptional_release_approval_request_id is not null
  )
);

comment on table public.fulfillment_records is
  'Fulfillment (Bible §22.13). Preparation is not release; exceptional release is Owner-approved; no automatic dispatch, completion, or stock return. Fulfillment NEVER deducts inventory.';

create trigger fulfillment_updated_at before update on public.fulfillment_records
  for each row execute function app_private.set_updated_at();

alter table public.fulfillment_records enable row level security;
alter table public.fulfillment_records force row level security;
revoke all on public.fulfillment_records from anon, authenticated;
