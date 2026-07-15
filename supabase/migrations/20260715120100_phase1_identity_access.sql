-- ============================================================================
-- Phase 1 — Identity & Access structures
-- ----------------------------------------------------------------------------
-- STRUCTURE ONLY. Phase 1 creates the tables, constraints, and the approved
-- catalogs (roles, permissions). It does NOT implement enforcement — server-side
-- authorization helpers and permission-aware RLS policies are Phase 2.
--
-- Bible: role title is not authority; assignment is not permission; UI visibility
-- is not authorization. Nothing here grants anything by itself.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Roles (Bible §5). Exactly three approved roles.
-- ----------------------------------------------------------------------------
create table public.roles (
  key text primary key check (key in ('owner', 'selected_admin', 'staff')),
  label text not null,
  description text not null
);

comment on table public.roles is
  'Approved role catalog (Bible §5). Role title is NOT authority — a role grants no permission by itself; permissions are granted per account.';

alter table public.roles enable row level security;
alter table public.roles force row level security;
revoke all on public.roles from anon, authenticated;

insert into public.roles (key, label, description) values
  ('owner', 'Owner', 'Highest authority. Non-delegable approvals rest here.'),
  ('selected_admin', 'Selected Admin', 'Elevated staff. Maximum two accounts (Bible §5.4). Does NOT automatically receive every permission.'),
  ('staff', 'Staff', 'Ordinary staff. May hold operational permissions without being Selected Admin.');

-- ----------------------------------------------------------------------------
-- Permission catalog (Bible §5.13 — the reconciled approved set).
-- ----------------------------------------------------------------------------
create table public.permissions (
  key text primary key,
  label text not null,
  description text not null,
  -- Marks the permission as one that merely REQUESTS a high-risk action.
  -- Requesting is not executing (Bible §22.14).
  is_request_only boolean not null default false
);

comment on table public.permissions is
  'Approved granular permission catalog (Bible §5.13). No permission silently grants another.';

alter table public.permissions enable row level security;
alter table public.permissions force row level security;
revoke all on public.permissions from anon, authenticated;

insert into public.permissions (key, label, description) values
  ('claim_capture',            'Claim Capture',                    'Capture claims during or after a Live.'),
  ('claim_review',             'Claim Review',                     'Review, correct, or withdraw claims.'),
  ('confirm_claim_print_label','Confirm Claim & Print Label',      'Confirm a claim; reserves quantity exactly once and queues a label job.'),
  ('invoice_preparation',      'Invoice Preparation',              'Build invoice drafts and perform Approve & Send Invoice.'),
  ('payment_verification',     'Payment Verification',             'Verify recorded payment evidence. Recording is not verifying.'),
  ('layaway_monitoring',       'Layaway Monitoring',               'Monitor layaway arrangements and installments.'),
  ('fulfillment_preparation',  'Fulfillment Preparation',          'Prepare orders for shipping or pickup. Preparation is not release.'),
  ('fulfillment_release',      'Fulfillment Release',              'Perform normal release. Exceptional release remains Owner-approved.'),
  ('existing_record_entry',    'Existing Record Entry / Migration','Enter or import historical records.'),
  ('live_batch_operation',     'Live Batch Operation',             'Create, start, pause, and end Live Batches.'),
  ('live_batch_closure',       'Live Batch Closure',               'Close a Live Batch. Reopen requires Owner approval.'),
  ('current_flex_item_control','Current Flex Item Control',        'Set, switch, or clear the Current Flex Item.'),
  ('item_withdrawal',          'Item Withdrawal',                  'Withdraw an item from a Live Batch.'),
  ('post_live_item_entry',     'Post-Live Item Entry',             'Enter items after a Live has ended.'),
  ('message_preparation',      'Message Preparation',              'Prepare customer messages.'),
  ('message_sending',          'Message Sending',                  'Send, or attest manual sending of, customer messages.'),
  ('retry_reprint_label',      'Retry / Reprint Label',            'Retry or reprint a label. Never creates another claim or reservation.'),
  ('void_cancel_label_job',    'Void / Cancel Label Job',          'Void or cancel a label job.'),
  ('export_data_reports',      'Export Data / Reports',            'Export data and reports.'),
  ('payment_correction',       'Payment Correction',               'Correct payment records. Verified wrong-payment-to-order correction requires Owner approval.'),
  ('inventory_monitoring',     'Inventory Monitoring',             'Review inventory and decide Returned-to-Stock Review outcomes.'),
  ('miner_allocation_review',  'Miner-Allocation Review',          'Review miner allocation. No automatic promotion or transfer.');

-- Request-only: creating an Owner Approval Request does NOT execute the action
-- (Bible §22.14). Inserted separately so the flag is explicit and reviewable.
insert into public.permissions (key, label, description, is_request_only) values
  ('initiate_high_risk_action', 'Initiate High-Risk Action',
   'Create an Owner Approval Request. Creating a request does NOT execute the action (Bible §22.14).', true);

-- ----------------------------------------------------------------------------
-- Shop / page scopes (Bible §11.6)
-- ----------------------------------------------------------------------------
create table public.scopes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (length(key) between 1 and 60),
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.scopes is 'Shop/page scope catalog (Bible §11.6). No scopes are seeded — real shops/pages are operational data.';

create trigger scopes_updated_at before update on public.scopes
  for each row execute function app_private.set_updated_at();

alter table public.scopes enable row level security;
alter table public.scopes force row level security;
revoke all on public.scopes from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Staff profiles — linked to Supabase Auth users.
-- ----------------------------------------------------------------------------
create table public.staff_profiles (
  id uuid primary key default gen_random_uuid(),
  -- One profile per auth user. ON DELETE RESTRICT: a staff member with history
  -- must not be deletable, because that would erase attribution (Bible §31).
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,

  full_name text not null check (length(trim(full_name)) between 1 and 120),
  role_key text not null references public.roles (key) on update cascade,

  -- Deactivation, not deletion. Bible §30.6: disabled accounts lose FUTURE
  -- access; historical attribution remains.
  is_active boolean not null default true,
  deactivated_at timestamptz,
  deactivated_reason text,

  -- MFA readiness (Bible §5 / ADR §5). Recorded, NOT enforced in Phase 1.
  mfa_enrolled boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint staff_profiles_deactivation_ck check (
    (is_active = true and deactivated_at is null)
    or (is_active = false and deactivated_at is not null)
  )
);

comment on table public.staff_profiles is
  'Internal staff accounts linked to Supabase Auth (Bible §5). No customer login exists. Accounts are deactivated, never deleted — attribution must survive (Bible §31).';

create index staff_profiles_role_idx on public.staff_profiles (role_key) where is_active;

create trigger staff_profiles_updated_at before update on public.staff_profiles
  for each row execute function app_private.set_updated_at();

alter table public.staff_profiles enable row level security;
alter table public.staff_profiles force row level security;
revoke all on public.staff_profiles from anon, authenticated;

-- Maximum two Selected Admin accounts (Bible §5.4).
-- A partial unique index cannot express "at most two", so this is enforced by a
-- trigger that locks the table to stay correct under concurrency.
create or replace function app_private.enforce_selected_admin_limit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.role_key <> 'selected_admin' or new.is_active = false then
    return new;
  end if;

  -- Serialize concurrent promotions; without this, two simultaneous inserts
  -- could each see one existing admin and both succeed, yielding three.
  lock table public.staff_profiles in exclusive mode;

  select count(*) into v_count
  from public.staff_profiles
  where role_key = 'selected_admin'
    and is_active = true
    and id <> new.id;

  if v_count >= 2 then
    raise exception 'A maximum of two active Selected Admin accounts is permitted (Bible §5.4)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger staff_profiles_selected_admin_limit
  before insert or update of role_key, is_active on public.staff_profiles
  for each row execute function app_private.enforce_selected_admin_limit();

-- ----------------------------------------------------------------------------
-- Per-account permission grants. Assignment is not permission: a grant is an
-- explicit row, never implied by role.
-- ----------------------------------------------------------------------------
create table public.staff_permission_grants (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.staff_profiles (id) on delete restrict,
  permission_key text not null references public.permissions (key) on update cascade,

  granted_at timestamptz not null default now(),
  granted_by uuid references public.staff_profiles (id) on delete restrict,

  constraint staff_permission_grants_unique unique (staff_profile_id, permission_key)
);

comment on table public.staff_permission_grants is
  'Explicit per-account permission grants (Bible §5.6/§5.13). No permission silently grants another; role implies nothing.';

create index staff_permission_grants_profile_idx on public.staff_permission_grants (staff_profile_id);

alter table public.staff_permission_grants enable row level security;
alter table public.staff_permission_grants force row level security;
revoke all on public.staff_permission_grants from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Staff scope assignments
-- ----------------------------------------------------------------------------
create table public.staff_scope_assignments (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.staff_profiles (id) on delete restrict,
  scope_id uuid not null references public.scopes (id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid references public.staff_profiles (id) on delete restrict,

  constraint staff_scope_assignments_unique unique (staff_profile_id, scope_id)
);

comment on table public.staff_scope_assignments is
  'Shop/page scope assignments (Bible §11.6). Assignment is not permission — scope narrows access, it never grants it.';

alter table public.staff_scope_assignments enable row level security;
alter table public.staff_scope_assignments force row level security;
revoke all on public.staff_scope_assignments from anon, authenticated;

-- ----------------------------------------------------------------------------
-- Trusted device / session registry foundation.
-- ----------------------------------------------------------------------------
-- ADR: target concurrent-device limits are Owner 2 / Selected Admin 2 / Staff 1.
-- ⚠️ Phase 1 provides the REGISTRY STRUCTURE ONLY. Runtime enforcement is NOT
-- implemented and is NOT claimed: Supabase issues sessions, and binding those to
-- this registry requires Phase 2 work. The max_devices column records the target
-- so Phase 2 has an explicit contract to enforce against.
-- ----------------------------------------------------------------------------
create table public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.staff_profiles (id) on delete restrict,

  device_label text not null check (length(trim(device_label)) between 1 and 120),
  -- Opaque client-supplied identifier. Never a credential.
  device_fingerprint text not null,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),

  -- Revocation, not deletion: history of a revoked device must survive
  -- (Bible §31; ADR: historical attribution remains after session revocation).
  revoked_at timestamptz,
  revoked_reason text,

  constraint trusted_devices_unique unique (staff_profile_id, device_fingerprint)
);

comment on table public.trusted_devices is
  'Trusted-device registry FOUNDATION. Structure only — runtime concurrent-session limits are NOT enforced in Phase 1 and must not be claimed as enforced.';

create index trusted_devices_active_idx on public.trusted_devices (staff_profile_id) where revoked_at is null;

alter table public.trusted_devices enable row level security;
alter table public.trusted_devices force row level security;
revoke all on public.trusted_devices from anon, authenticated;

-- Records the approved target limit per role so Phase 2 enforces an explicit,
-- reviewed contract rather than a re-invented number.
create table public.role_device_limits (
  role_key text primary key references public.roles (key) on update cascade,
  max_active_devices smallint not null check (max_active_devices between 1 and 10),
  enforcement_implemented boolean not null default false
);

comment on table public.role_device_limits is
  'Approved concurrent-device targets. enforcement_implemented is FALSE in Phase 1 — the limits are recorded, not enforced.';

alter table public.role_device_limits enable row level security;
alter table public.role_device_limits force row level security;
revoke all on public.role_device_limits from anon, authenticated;

insert into public.role_device_limits (role_key, max_active_devices, enforcement_implemented) values
  ('owner', 2, false),
  ('selected_admin', 2, false),
  ('staff', 1, false);
