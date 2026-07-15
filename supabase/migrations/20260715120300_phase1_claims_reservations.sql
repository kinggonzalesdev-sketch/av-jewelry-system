-- ============================================================================
-- Phase 1 — Claims, Miner Positions, Inventory Reservations, Waitlist
-- ----------------------------------------------------------------------------
-- THIS IS THE INTEGRITY SPINE. The invariants encoded here are the reason the
-- system exists (Bible §19, §22.3, §22.5, §22.6):
--
--   * Pending Claim      -> NO reservation
--   * Confirmed Claim    -> EXACTLY ONE provisional reservation
--   * Invoice Draft      -> reservation continues, NO second deduction
--   * Official Order     -> reservation committed, NO second deduction
--   * Payment/fulfilment -> NEVER deduct inventory
--   * Return to available-> ONLY via approved Returned-to-Stock Review
--   * Unique items       -> 1st and 2nd Miner ONLY, no 3rd, no auto-promotion
--   * Multi-stock        -> confirmed quantity NEVER exceeds available quantity
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Claims. Status vocabulary is Bible §22.6, verbatim.
-- "For Invoice" and "Needs Review" are READINESS CONDITIONS/queues, not
-- statuses (Bible §22.6, §15.3) — they are deliberately absent here.
-- ----------------------------------------------------------------------------
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  claim_reference text not null unique
    default app_private.next_reference('CLM', 'app_private.claim_reference_seq'),

  live_batch_id uuid references public.live_batches (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,

  status text not null default 'pending_claim' check (status in (
    'pending_claim',
    'in_review',
    'confirmed_claim',
    'withdrawn_pre_confirm',
    'withdrawn_confirmed',
    'rejected'
  )),

  quantity integer not null default 1 check (quantity >= 1),

  -- Captured during a Live, entered post-live, or imported (Bible §12, §22.16).
  intake_kind text not null default 'live_capture'
    check (intake_kind in ('live_capture', 'post_live_manual', 'migrated')),

  confirmed_at timestamptz,
  confirmed_by uuid references public.staff_profiles (id) on delete restrict,

  -- Withdrawal/rejection require a reason (Bible §22.6).
  status_reason text,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  -- A confirmed claim must record who confirmed it and when (Bible §31).
  constraint claims_confirmed_attribution_ck check (
    status <> 'confirmed_claim' or (confirmed_at is not null)
  ),
  -- Withdrawal and rejection always carry a reason (Bible §22.6).
  constraint claims_status_reason_ck check (
    status not in ('withdrawn_pre_confirm', 'withdrawn_confirmed', 'rejected')
    or (status_reason is not null and length(trim(status_reason)) > 0)
  )
);

comment on table public.claims is
  'Claims (Bible §12, §22.6). A Pending Claim holds NO reservation. Claims are never deleted — withdrawal is a controlled, audited status change.';

create index claims_status_idx on public.claims (status, created_at desc);
create index claims_item_idx on public.claims (inventory_item_id);
create index claims_customer_idx on public.claims (customer_id);
create index claims_batch_idx on public.claims (live_batch_id);

create trigger claims_updated_at before update on public.claims
  for each row execute function app_private.set_updated_at();

alter table public.claims enable row level security;
alter table public.claims force row level security;
revoke all on public.claims from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Miner positions (Bible §4.9-A, §19.7, §22.6)
-- ----------------------------------------------------------------------------
-- ONLY 1st and 2nd Miner exist. There is NO 3rd Miner, and NO automatic
-- promotion from 2nd to 1st. §2.6-2.8 of the Bible describe a 3-miner model but
-- are EXPLICITLY SUPERSEDED by §4 (see Bible line ~311); §4.9-A governs.
-- ----------------------------------------------------------------------------
create table public.miner_positions (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  claim_id uuid not null references public.claims (id) on delete restrict,

  -- Hard ceiling: no 3rd Miner can ever be represented.
  position smallint not null check (position in (1, 2)),

  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.staff_profiles (id) on delete restrict,

  -- A manual switch is recorded, never automatic (Bible §22.6).
  switched_from_claim_id uuid references public.claims (id) on delete restrict,
  switch_reason text,

  constraint miner_positions_unique_slot unique (inventory_item_id, position),
  constraint miner_positions_unique_claim unique (claim_id)
);

comment on table public.miner_positions is
  'Miner allocation (Bible §4.9-A). ONLY 1st and 2nd Miner — the CHECK makes a 3rd Miner unrepresentable. There is no automatic promotion; a switch is a manual, audited correction.';

alter table public.miner_positions enable row level security;
alter table public.miner_positions force row level security;
revoke all on public.miner_positions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- INVENTORY RESERVATIONS — the exactly-once boundary.
-- ----------------------------------------------------------------------------
create table public.inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,

  -- EXACTLY ONE reservation per Confirmed Claim. This UNIQUE constraint is the
  -- structural guarantee behind "reserve exactly once" — a retry that tries to
  -- reserve the same claim twice fails at the database, not at the application.
  claim_id uuid not null references public.claims (id) on delete restrict,

  quantity integer not null check (quantity >= 1),

  -- Lifecycle (Bible §22.3): provisional at Confirmed Claim -> committed at
  -- Official Order (NO second deduction) -> released only via approved review.
  state text not null default 'provisional' check (state in (
    'provisional',
    'committed',
    'released'
  )),

  reserved_at timestamptz not null default now(),
  committed_at timestamptz,
  released_at timestamptz,
  released_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint inventory_reservations_one_per_claim unique (claim_id),
  constraint inventory_reservations_committed_ck check (
    state <> 'committed' or committed_at is not null
  ),
  constraint inventory_reservations_released_ck check (
    state <> 'released' or (released_at is not null and released_reason is not null)
  )
);

comment on table public.inventory_reservations is
  'Inventory reservations (Bible §22.3). UNIQUE(claim_id) enforces reserve-exactly-once. provisional -> committed is a STATE CHANGE, never a second deduction.';

create index inventory_reservations_item_active_idx
  on public.inventory_reservations (inventory_item_id)
  where state in ('provisional', 'committed');

create trigger inventory_reservations_updated_at before update on public.inventory_reservations
  for each row execute function app_private.set_updated_at();

alter table public.inventory_reservations enable row level security;
alter table public.inventory_reservations force row level security;
revoke all on public.inventory_reservations from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Derived availability. NOT a stored counter, by design: a counter can drift
-- out of step with reality, and drift here means selling the same item twice.
-- ----------------------------------------------------------------------------
create or replace function app_private.available_quantity(p_item_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select i.quantity_total - coalesce((
    select sum(r.quantity)
    from public.inventory_reservations r
    where r.inventory_item_id = p_item_id
      and r.state in ('provisional', 'committed')
  ), 0)
  from public.inventory_items i
  where i.id = p_item_id;
$$;

comment on function app_private.available_quantity(uuid) is
  'Available = total - (provisional + committed). Derived, never stored.';

-- ----------------------------------------------------------------------------
-- Reservation guard. Enforces, at the database, the rules that matter most.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_reservation_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_claim_status text;
  v_total integer;
  v_reserved integer;
begin
  -- Serialize concurrent reservations for THIS item. Without this lock two
  -- concurrent confirmations could each read the same availability and both
  -- succeed, over-reserving the item. FOR UPDATE makes the second wait.
  select i.quantity_total into v_total
  from public.inventory_items i
  where i.id = new.inventory_item_id
  for update;

  if v_total is null then
    raise exception 'Inventory item % does not exist', new.inventory_item_id
      using errcode = 'foreign_key_violation';
  end if;

  -- RULE: a reservation may exist ONLY for a Confirmed Claim.
  -- A Pending Claim holds no reservation (Bible §22.3, §22.6).
  select c.status into v_claim_status
  from public.claims c
  where c.id = new.claim_id;

  if v_claim_status is distinct from 'confirmed_claim' then
    raise exception
      'Only a Confirmed Claim may hold an inventory reservation (claim status: %). A Pending Claim reserves nothing (Bible §22.3).',
      coalesce(v_claim_status, 'missing')
      using errcode = 'check_violation';
  end if;

  -- RULE: the claim's item and the reservation's item must agree.
  if not exists (
    select 1 from public.claims c
    where c.id = new.claim_id and c.inventory_item_id = new.inventory_item_id
  ) then
    raise exception 'Reservation item does not match the claim''s item'
      using errcode = 'check_violation';
  end if;

  -- RULE: confirmed quantity must never exceed available quantity (Bible §19.8).
  select coalesce(sum(r.quantity), 0) into v_reserved
  from public.inventory_reservations r
  where r.inventory_item_id = new.inventory_item_id
    and r.state in ('provisional', 'committed')
    and r.id <> new.id;

  if v_reserved + new.quantity > v_total then
    raise exception
      'Reservation would exceed available quantity for item % (total %, already reserved %, requested %). Excess belongs on the waitlist (Bible §19.8, §19.9).',
      new.inventory_item_id, v_total, v_reserved, new.quantity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger inventory_reservations_enforce_rules
  before insert or update of quantity, state, claim_id, inventory_item_id
  on public.inventory_reservations
  for each row
  when (new.state in ('provisional', 'committed'))
  execute function app_private.enforce_reservation_rules();

-- ----------------------------------------------------------------------------
-- No second deduction (Bible §22.3, §22.5).
-- provisional -> committed is a state transition. It must not change quantity,
-- because changing quantity at commit time WOULD BE a second deduction.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_no_second_deduction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.state = 'provisional' and new.state = 'committed' then
    if new.quantity <> old.quantity then
      raise exception
        'Committing a reservation must not change its quantity: that would be a second inventory deduction (Bible §22.3).'
        using errcode = 'check_violation';
    end if;
  end if;

  -- A released reservation is terminal; it cannot silently return to holding stock.
  -- Available stock returns ONLY through approved Returned-to-Stock Review.
  if old.state = 'released' and new.state <> 'released' then
    raise exception
      'A released reservation cannot be reinstated. Availability returns only via approved Returned-to-Stock Review (Bible §22.3).'
      using errcode = 'check_violation';
  end if;

  -- Committed must not silently revert to provisional.
  if old.state = 'committed' and new.state = 'provisional' then
    raise exception 'A committed reservation cannot revert to provisional'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger inventory_reservations_no_second_deduction
  before update on public.inventory_reservations
  for each row execute function app_private.enforce_no_second_deduction();

-- ----------------------------------------------------------------------------
-- Waitlist / excess (Bible §19.9, §22.3)
-- ----------------------------------------------------------------------------
-- Excess claims remain waitlist/excess. There is NO automatic allocation from
-- the waitlist — promotion is always a reviewed, manual action.
-- ----------------------------------------------------------------------------
create table public.waitlist_entries (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,
  claim_id uuid not null references public.claims (id) on delete restrict,
  customer_id uuid not null references public.customers (id) on delete restrict,

  requested_quantity integer not null check (requested_quantity >= 1),
  position integer check (position is null or position >= 1),

  status text not null default 'waitlisted'
    check (status in ('waitlisted', 'excess', 'resolved_manually', 'closed')),

  -- Resolution is manual and attributed; never automatic.
  resolved_at timestamptz,
  resolved_by uuid references public.staff_profiles (id) on delete restrict,
  resolution_note text,

  created_at timestamptz not null default now(),

  constraint waitlist_entries_unique_claim unique (claim_id)
);

comment on table public.waitlist_entries is
  'Waitlist/excess entries (Bible §19.9). NO automatic allocation — a waitlisted claim is never promoted automatically; resolution is a manual, attributed action.';

create index waitlist_entries_item_idx on public.waitlist_entries (inventory_item_id, position);

alter table public.waitlist_entries enable row level security;
alter table public.waitlist_entries force row level security;
revoke all on public.waitlist_entries from anon, authenticated;
