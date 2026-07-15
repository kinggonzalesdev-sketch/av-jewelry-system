-- ============================================================================
-- Phase 1 — Customers, Live Batches, Inventory Items
-- Status vocabulary from Bible §22.4 (Live Batch) and §22.5 (Inventory).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Customers. No customer login exists — a customer is a RECORD, never an account.
-- ----------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(trim(display_name)) between 1 and 160),
  contact_number text,
  notes text,

  is_active boolean not null default true,

  -- Migration provenance (Bible §22.16): imported records preserve their source.
  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict
);

comment on table public.customers is
  'Customer records (Bible §14). Customers never authenticate — there is no customer login. No automatic merge (Bible §22.16).';

create trigger customers_updated_at before update on public.customers
  for each row execute function app_private.set_updated_at();

alter table public.customers enable row level security;
alter table public.customers force row level security;
revoke all on public.customers from anon, authenticated;

-- Customer aliases / Facebook names.
create table public.customer_aliases (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  alias text not null check (length(trim(alias)) between 1 and 160),
  alias_kind text not null default 'facebook_name'
    check (alias_kind in ('facebook_name', 'nickname', 'other')),
  created_at timestamptz not null default now(),

  constraint customer_aliases_unique unique (customer_id, alias, alias_kind)
);

comment on table public.customer_aliases is
  'Alternate names a customer is known by, including Facebook names (Bible §14).';

create index customer_aliases_alias_idx on public.customer_aliases (lower(alias));

alter table public.customer_aliases enable row level security;
alter table public.customer_aliases force row level security;
revoke all on public.customer_aliases from anon, authenticated;

-- Possible duplicate customer references.
-- Bible: NO AUTOMATIC CUSTOMER MERGE. This table only RECORDS a suspicion for
-- staff review; it performs no merge and changes no customer record.
create table public.customer_duplicate_references (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  possible_duplicate_customer_id uuid not null references public.customers (id) on delete restrict,

  status text not null default 'open' check (status in ('open', 'reviewed_distinct', 'reviewed_duplicate')),
  reviewed_by uuid references public.staff_profiles (id) on delete restrict,
  reviewed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),

  -- A record cannot be its own duplicate.
  constraint customer_duplicate_not_self check (customer_id <> possible_duplicate_customer_id),
  -- Order-independent uniqueness: (A,B) and (B,A) are the same suspicion.
  constraint customer_duplicate_unique_pair unique (customer_id, possible_duplicate_customer_id)
);

comment on table public.customer_duplicate_references is
  'Possible-duplicate SUSPICIONS for staff review. Recording a suspicion performs NO merge — automatic customer merge is prohibited.';

alter table public.customer_duplicate_references enable row level security;
alter table public.customer_duplicate_references force row level security;
revoke all on public.customer_duplicate_references from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Live Batches — status model from Bible §22.4.
-- 'paused' and 'reopened' are marked *(candidate)* in the Bible; they are
-- included because §22.4 names them explicitly.
-- ----------------------------------------------------------------------------
create table public.live_batches (
  id uuid primary key default gen_random_uuid(),
  batch_reference text not null unique
    default app_private.next_reference('LB', 'app_private.batch_reference_seq'),

  title text not null check (length(trim(title)) between 1 and 160),
  scope_id uuid references public.scopes (id) on delete restrict,

  status text not null default 'draft' check (status in (
    'draft',
    'active',
    'paused',
    'live_ended',
    'closed',
    'reopened'
  )),

  opened_at timestamptz,
  ended_at timestamptz,
  closed_at timestamptz,

  -- Reopen is a non-delegable Owner approval (Bible §5.13, §22.4).
  reopened_approval_request_id uuid,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict
);

comment on table public.live_batches is
  'Live selling batches (Bible §12, §22.4). Closing a batch never auto-confirms claims, invoices, creates orders, or changes inventory (Bible §12.57).';

create index live_batches_status_idx on public.live_batches (status, created_at desc);

create trigger live_batches_updated_at before update on public.live_batches
  for each row execute function app_private.set_updated_at();

alter table public.live_batches enable row level security;
alter table public.live_batches force row level security;
revoke all on public.live_batches from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Inventory items — availability status from Bible §22.5.
-- ----------------------------------------------------------------------------
create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  item_code text not null check (length(trim(item_code)) between 1 and 80),

  grams_per_piece numeric(12, 3) check (grams_per_piece is null or grams_per_piece > 0),
  total_price_per_piece numeric(14, 2) check (total_price_per_piece is null or total_price_per_piece >= 0),

  -- Unique (quantity-one) vs multi-stock. Bible §19.7/§19.8.
  is_unique_item boolean not null default true,

  -- Total physical quantity held. Availability is DERIVED from reservations,
  -- never stored as a mutable counter — a stored counter can drift, and drift
  -- here would mean double-selling. See app_private.available_quantity().
  quantity_total integer not null default 1 check (quantity_total >= 0),

  availability_status text not null default 'available' check (availability_status in (
    'available',
    'provisionally_reserved',
    'committed',
    'sold_released',
    'in_returned_to_stock_review',
    'returned_to_available',
    'held_unavailable'
  )),

  live_batch_id uuid references public.live_batches (id) on delete restrict,

  source_kind text not null default 'native' check (source_kind in ('native', 'migrated')),
  migration_batch_id uuid,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.staff_profiles (id) on delete restrict,

  -- A unique item is quantity-one by definition (Bible §19.7).
  constraint inventory_items_unique_qty_ck check (
    (is_unique_item = false) or (quantity_total = 1)
  )
);

comment on table public.inventory_items is
  'Inventory items (Bible §19, §22.5). Available quantity is DERIVED from reservations, never a stored counter — a drifting counter would mean double-selling.';

create index inventory_items_code_idx on public.inventory_items (lower(item_code));
create index inventory_items_batch_idx on public.inventory_items (live_batch_id);
create index inventory_items_availability_idx on public.inventory_items (availability_status);

create trigger inventory_items_updated_at before update on public.inventory_items
  for each row execute function app_private.set_updated_at();

alter table public.inventory_items enable row level security;
alter table public.inventory_items force row level security;
revoke all on public.inventory_items from anon, authenticated;

-- Live Batch items: which items were presented in which batch, and the
-- Current Flex Item pointer (Bible §12).
create table public.live_batch_items (
  id uuid primary key default gen_random_uuid(),
  live_batch_id uuid not null references public.live_batches (id) on delete restrict,
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,

  is_current_flex_item boolean not null default false,
  withdrawn_at timestamptz,
  withdrawn_reason text,

  added_at timestamptz not null default now(),
  added_by uuid references public.staff_profiles (id) on delete restrict,

  constraint live_batch_items_unique unique (live_batch_id, inventory_item_id)
);

comment on table public.live_batch_items is
  'Items presented in a Live Batch, including the Current Flex Item pointer (Bible §12).';

-- At most ONE Current Flex Item per batch.
create unique index live_batch_items_one_flex_per_batch
  on public.live_batch_items (live_batch_id)
  where is_current_flex_item;

alter table public.live_batch_items enable row level security;
alter table public.live_batch_items force row level security;
revoke all on public.live_batch_items from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Item photos & attachment metadata.
-- Bible §12.42: item photos and claim/message evidence stay distinguished.
-- Storage objects are private by default (ADR §13); only METADATA lives here.
-- ----------------------------------------------------------------------------
create table public.item_photos (
  id uuid primary key default gen_random_uuid(),
  inventory_item_id uuid not null references public.inventory_items (id) on delete restrict,

  -- Path within a private Supabase Storage bucket. Never a public URL (ADR §13).
  storage_path text not null check (length(trim(storage_path)) between 1 and 400),
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),

  is_primary boolean not null default false,

  uploaded_at timestamptz not null default now(),
  uploaded_by uuid references public.staff_profiles (id) on delete restrict,

  constraint item_photos_unique_path unique (storage_path)
);

comment on table public.item_photos is
  'Item photo METADATA (Bible §12.42). Distinct from claim/message evidence. Files live in a private bucket; no public URL is the default (ADR §13).';

create unique index item_photos_one_primary_per_item
  on public.item_photos (inventory_item_id)
  where is_primary;

alter table public.item_photos enable row level security;
alter table public.item_photos force row level security;
revoke all on public.item_photos from anon, authenticated;
