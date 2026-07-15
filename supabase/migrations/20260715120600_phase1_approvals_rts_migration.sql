-- ============================================================================
-- Phase 1 — Owner Approvals, Returned-to-Stock Review, Notifications, Migration
-- Status vocabulary: Bible §22.14 (Owner Approval), §22.15 (Returned-to-Stock),
-- §22.16 (Migration).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- OWNER APPROVAL REQUESTS (Bible §22.14, §5.13)
-- ----------------------------------------------------------------------------
-- The six non-delegable Owner-approved actions. This CHECK list is the whole
-- point: an action outside it cannot masquerade as Owner-approved, and an
-- action inside it cannot be executed without a row here.
--
-- Creating a request does NOT execute the action. Approval and execution are
-- separate events (Bible §22.14, §31 r5).
-- ----------------------------------------------------------------------------
create table public.owner_approval_requests (
  id uuid primary key default gen_random_uuid(),

  action_kind text not null check (action_kind in (
    'official_order_cancellation',
    'layaway_forfeiture',
    'price_override',
    'exceptional_fulfillment_release',
    'live_batch_reopen',
    'wrong_payment_to_order_correction'
  )),

  status text not null default 'pending_owner_approval' check (status in (
    'pending_owner_approval',
    'approved',
    'rejected'
  )),

  -- The affected record (Bible §9: preserve affected record, reason, evidence).
  entity_type text not null check (length(entity_type) between 1 and 80),
  entity_id uuid not null,

  reason text not null check (length(trim(reason)) > 0),
  evidence_note text,

  requested_at timestamptz not null default now(),
  requested_by uuid not null references public.staff_profiles (id) on delete restrict,

  -- Owner decision. Owner self-action is permitted but fully audited: the Owner
  -- may be both requester and decider, and both facts are recorded.
  decided_at timestamptz,
  decided_by uuid references public.staff_profiles (id) on delete restrict,
  decision_note text,

  -- EXECUTION IS SEPARATE FROM APPROVAL. An approved request that has not been
  -- executed has changed nothing (Bible §22.14).
  executed_at timestamptz,
  executed_by uuid references public.staff_profiles (id) on delete restrict,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint owner_approval_decided_ck check (
    status = 'pending_owner_approval'
    or (decided_at is not null and decided_by is not null)
  ),
  -- Execution may only follow approval. A rejected or pending request can never
  -- be executed.
  constraint owner_approval_execution_ck check (
    executed_at is null or status = 'approved'
  )
);

comment on table public.owner_approval_requests is
  'Owner Approval Requests for the six non-delegable actions (Bible §5.13, §22.14). Creating a request does NOT execute the action; approval and execution are separate, separately-attributed events.';

create index owner_approval_pending_idx on public.owner_approval_requests (status, requested_at);
create index owner_approval_entity_idx on public.owner_approval_requests (entity_type, entity_id);

create trigger owner_approval_updated_at before update on public.owner_approval_requests
  for each row execute function app_private.set_updated_at();

alter table public.owner_approval_requests enable row level security;
alter table public.owner_approval_requests force row level security;
revoke all on public.owner_approval_requests from anon, authenticated;

-- Only the Owner may decide. Enforced at the database so a mis-wired service
-- cannot approve on a Selected Admin's or Staff's authority.
-- Note: this checks the DECIDER'S ROLE. It is not a substitute for Phase 2's
-- server-side authorization — it is the last line of defence behind it.
create or replace function app_private.enforce_owner_only_decision()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_role text;
begin
  if new.decided_by is not null and (
       old.decided_by is null or new.decided_by <> old.decided_by
       or new.status <> old.status
     ) then
    select sp.role_key into v_role
    from public.staff_profiles sp
    where sp.id = new.decided_by;

    if v_role is distinct from 'owner' then
      raise exception
        'Only the Owner may decide an Owner Approval Request (decider role: %). These approvals are non-delegable (Bible §5.13).',
        coalesce(v_role, 'unknown')
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  return new;
end;
$$;

create trigger owner_approval_owner_only
  before update on public.owner_approval_requests
  for each row execute function app_private.enforce_owner_only_decision();

-- Now that owner_approval_requests exists, wire the deferred references.
alter table public.live_batches
  add constraint live_batches_reopen_approval_fk
  foreign key (reopened_approval_request_id)
  references public.owner_approval_requests (id) on delete restrict;

alter table public.official_orders
  add constraint official_orders_cancellation_approval_fk
  foreign key (cancellation_approval_request_id)
  references public.owner_approval_requests (id) on delete restrict;

alter table public.payments
  add constraint payments_reassignment_approval_fk
  foreign key (reassignment_approval_request_id)
  references public.owner_approval_requests (id) on delete restrict;

alter table public.layaway_arrangements
  add constraint layaway_forfeiture_approval_fk
  foreign key (forfeiture_approval_request_id)
  references public.owner_approval_requests (id) on delete restrict;

alter table public.fulfillment_records
  add constraint fulfillment_exceptional_approval_fk
  foreign key (exceptional_release_approval_request_id)
  references public.owner_approval_requests (id) on delete restrict;

-- Price overrides. Recorded as their own trail so an override is never invisible.
create table public.price_overrides (
  id uuid primary key default gen_random_uuid(),
  approval_request_id uuid not null references public.owner_approval_requests (id) on delete restrict,

  claim_id uuid references public.claims (id) on delete restrict,
  official_order_id uuid references public.official_orders (id) on delete restrict,

  original_amount numeric(14, 2) not null check (original_amount >= 0),
  override_amount numeric(14, 2) not null check (override_amount >= 0),

  applied_at timestamptz,
  applied_by uuid references public.staff_profiles (id) on delete restrict,
  created_at timestamptz not null default now(),

  -- One override per approval: the approval authorises exactly one change.
  constraint price_overrides_one_per_approval unique (approval_request_id),
  -- An override must target exactly one record.
  constraint price_overrides_single_target_ck check (
    (claim_id is not null)::int + (official_order_id is not null)::int = 1
  )
);

comment on table public.price_overrides is
  'Price override trail. Price override is a non-delegable Owner approval (Bible §5.13); one approval authorises exactly one override.';

alter table public.price_overrides enable row level security;
alter table public.price_overrides force row level security;
revoke all on public.price_overrides from anon, authenticated;

-- ----------------------------------------------------------------------------
-- RETURNED-TO-STOCK REVIEW (Bible §22.15, §19.16)
-- ----------------------------------------------------------------------------
-- The ONLY route by which quantity becomes available again. Manual only; no
-- automatic transfer or allocation; a forfeited layaway item is excluded from
-- automatic return.
-- ----------------------------------------------------------------------------
create table public.returned_to_stock_reviews (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,

  -- The reservation being released, where one existed. A Pending Claim has no
  -- reservation, so a pre-confirm withdrawal never reaches this table.
  inventory_reservation_id uuid references public.inventory_reservations (id) on delete restrict,

  -- Why the quantity was freed (Bible §22.5, §22.15).
  trigger_kind text not null check (trigger_kind in (
    'withdrawal_confirmed',
    'order_cancelled',
    'order_expired',
    'claim_rejected',
    'layaway_forfeited_disposition'
  )),

  status text not null default 'in_review' check (status in (
    'in_review',
    'approved_return',
    'rejected_held'
  )),

  quantity integer not null check (quantity >= 1),

  reviewed_at timestamptz,
  reviewed_by uuid references public.staff_profiles (id) on delete restrict,
  review_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rts_reviewed_ck check (
    status = 'in_review' or (reviewed_at is not null and reviewed_by is not null)
  )
);

comment on table public.returned_to_stock_reviews is
  'Returned-to-Stock Review (Bible §22.15). The ONLY route back to available stock. Manual and attributed; no automatic return, transfer, or waitlist allocation.';

create index rts_status_idx on public.returned_to_stock_reviews (status, created_at);
create index rts_item_idx on public.returned_to_stock_reviews (inventory_item_id);

create trigger rts_updated_at before update on public.returned_to_stock_reviews
  for each row execute function app_private.set_updated_at();

alter table public.returned_to_stock_reviews enable row level security;
alter table public.returned_to_stock_reviews force row level security;
revoke all on public.returned_to_stock_reviews from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Notifications / reminders (Bible §18.20)
-- V1 reminders are STAFF-TRIGGERED; the system records each attempt.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),

  kind text not null check (length(kind) between 1 and 80),
  entity_type text not null,
  entity_id uuid,

  -- Recipient is a STAFF member: there is no customer login, so the system
  -- never notifies a customer directly through an account.
  staff_profile_id uuid references public.staff_profiles (id) on delete restrict,

  body text not null,
  due_at timestamptz,

  acknowledged_at timestamptz,
  acknowledged_by uuid references public.staff_profiles (id) on delete restrict,

  created_at timestamptz not null default now()
);

comment on table public.notifications is
  'Staff-facing notifications/reminders (Bible §18.20). V1 reminders are staff-triggered; each attempt is recorded. Customers hold no account and are never notified via one.';

create index notifications_staff_idx on public.notifications (staff_profile_id, created_at desc);

alter table public.notifications enable row level security;
alter table public.notifications force row level security;
revoke all on public.notifications from anon, authenticated;

-- ----------------------------------------------------------------------------
-- MIGRATION / IMPORT BATCHES (Bible §22.16, §20)
-- ----------------------------------------------------------------------------
-- Migrated records preserve source data and import context; they enter at their
-- ACTUAL operational status and bypass Pending -> Confirm -> Invoice.
-- A claim-less migrated record must NOT create a fake claim.
-- ----------------------------------------------------------------------------
create table public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(trim(label)) between 1 and 160),

  source_description text not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'failed')),

  imported_at timestamptz not null default now(),
  imported_by uuid references public.staff_profiles (id) on delete restrict,

  record_count integer check (record_count is null or record_count >= 0),
  note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.migration_batches is
  'Migration/import batches (Bible §22.16). Source and import context are preserved; migrated records enter at their actual status and never fabricate claims.';

create trigger migration_batches_updated_at before update on public.migration_batches
  for each row execute function app_private.set_updated_at();

alter table public.migration_batches enable row level security;
alter table public.migration_batches force row level security;
revoke all on public.migration_batches from anon, authenticated;

-- Per-record source preservation: the original payload, kept verbatim.
create table public.migration_source_records (
  id uuid primary key default gen_random_uuid(),
  migration_batch_id uuid not null references public.migration_batches (id) on delete restrict,

  source_reference text,
  -- The original inbound data, preserved as-is (Bible §22.16: historical values
  -- and dates preserved; no retroactive rules).
  source_payload jsonb not null,

  target_type text,
  target_id uuid,

  created_at timestamptz not null default now()
);

comment on table public.migration_source_records is
  'Verbatim source payload per migrated record (Bible §22.16). Preserves imported facts so a migrated record can always be traced to its origin.';

create index migration_source_batch_idx on public.migration_source_records (migration_batch_id);
create index migration_source_target_idx on public.migration_source_records (target_type, target_id);

alter table public.migration_source_records enable row level security;
alter table public.migration_source_records force row level security;
revoke all on public.migration_source_records from anon, authenticated;

-- Wire the deferred migration_batch_id references now that the table exists.
alter table public.customers
  add constraint customers_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.live_batches
  add constraint live_batches_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.inventory_items
  add constraint inventory_items_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.claims
  add constraint claims_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.official_orders
  add constraint official_orders_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.layaway_arrangements
  add constraint layaway_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;
alter table public.fulfillment_records
  add constraint fulfillment_migration_batch_fk foreign key (migration_batch_id)
  references public.migration_batches (id) on delete restrict;

-- A record claiming to be migrated must name its batch; a native record must not.
alter table public.customers add constraint customers_source_batch_ck check (
  (source_kind = 'migrated') = (migration_batch_id is not null)
);
alter table public.claims add constraint claims_source_batch_ck check (
  (source_kind = 'migrated') = (migration_batch_id is not null)
);
alter table public.official_orders add constraint official_orders_source_batch_ck check (
  (source_kind = 'migrated') = (migration_batch_id is not null)
);
alter table public.inventory_items add constraint inventory_items_source_batch_ck check (
  (source_kind = 'migrated') = (migration_batch_id is not null)
);
