-- ============================================================================
-- Fulfillment record lifecycle: born at the commit point, exactly once
-- (Bible §18, §22.9; Owner decision 2026-07-16)
-- ----------------------------------------------------------------------------
-- Nothing ever created a fulfillment_records row. The queue was permanently
-- "Nothing to fulfill", and prepareFulfillment() UPDATEd by official_order_id,
-- matched zero rows, and returned NO ERROR — so Prepare reported success and did
-- nothing.
--
-- Every assertion runs as a real Staff JWT through the real atomic function.
-- ============================================================================
begin;
select plan(27);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('bc000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'ful-staff@test.local', 'authenticated', 'authenticated'),
  ('bc000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'ful-noperm@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('bc100000-0000-0000-0000-0000000000e1', 'bc000000-0000-0000-0000-0000000000e1',
   'Fulfil Staff', 'staff', true),
  ('bc100000-0000-0000-0000-0000000000e2', 'bc000000-0000-0000-0000-0000000000e2',
   'Fulfil NoPerm', 'staff', true);

insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('bc100000-0000-0000-0000-0000000000e1', 'claim_capture'),
  ('bc100000-0000-0000-0000-0000000000e1', 'confirm_claim_print_label'),
  ('bc100000-0000-0000-0000-0000000000e1', 'invoice_preparation'),
  ('bc100000-0000-0000-0000-0000000000e1', 'fulfillment_preparation'),
  -- The no-perm staff member can capture, and nothing else. Capture is not
  -- preparation; no permission silently includes another (§5.13).
  ('bc100000-0000-0000-0000-0000000000e2', 'claim_capture');

insert into public.customers (id, display_name)
values ('cc000000-0000-0000-0000-0000000000e1', 'Fulfil Customer');

insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, grams_per_piece,
   total_price_per_piece)
values ('1c000000-0000-0000-0000-0000000000e1', 'F-M01', 'Fulfil Bangle', false,
        10, 5.000, 24000.00);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- THE CONSTRAINT that makes "exactly one" enforceable
-- ============================================================================
select ok(
  (select count(*) = 1 from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   where t.relname = 'fulfillment_records'
     and c.conname = 'fulfillment_one_per_order'
     and c.contype = 'u'),
  'fulfillment_one_per_order UNIQUE(official_order_id) exists — at most one record per order, enforced by the database'
);

-- ============================================================================
-- 1. Approve & Send creates ONE order and ONE fulfillment record, atomically
-- ============================================================================
select pg_temp.act_as('bc000000-0000-0000-0000-0000000000e1');

insert into public.claims (id, inventory_item_id, customer_id, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dc000000-0000-0000-0000-0000000000e1', '1c000000-0000-0000-0000-0000000000e1',
        'cc000000-0000-0000-0000-0000000000e1', 1, 'full_payment', 'shipping');

select public.confirm_claim_and_print('dc000000-0000-0000-0000-0000000000e1');

insert into public.invoice_drafts (id, customer_id, status, payment_arrangement,
                                   fulfillment_arrangement)
values ('fc000000-0000-0000-0000-0000000000e1', 'cc000000-0000-0000-0000-0000000000e1',
        'draft', 'full_payment', 'shipping');
insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
values ('fc000000-0000-0000-0000-0000000000e1', 'dc000000-0000-0000-0000-0000000000e1');

-- Before the commit point there is no order and no fulfillment tracking.
select is(
  (select count(*)::int from public.fulfillment_records),
  0,
  'An Invoice Draft creates NO fulfillment record — a draft is not official'
);

select public.approve_and_send_invoice('fc000000-0000-0000-0000-0000000000e1')
  ->> 'official_order_id' as oid \gset

select is(
  (select count(*)::int from public.official_orders),
  1,
  'Approve & Send created exactly ONE Official Order'
);

select is(
  (select count(*)::int from public.fulfillment_records),
  1,
  'Approve & Send created exactly ONE fulfillment record — tracking begins at the commit point'
);

select is(
  (select count(*)::int from public.fulfillment_records where official_order_id = :'oid'),
  1,
  'The record belongs to the order that was just created'
);

-- ============================================================================
-- 3. Initial state means TRACKING EXISTS, and nothing more
-- ============================================================================
select is(
  (select status from public.fulfillment_records where official_order_id = :'oid'),
  'for_preparation',
  'The initial status is for_preparation — the queue, not a claim of progress'
);

select is(
  (select method from public.fulfillment_records where official_order_id = :'oid'),
  null,
  'No method is chosen at creation — shipping vs pickup is decided at Prepare'
);

select is(
  (select courier from public.fulfillment_records where official_order_id = :'oid'),
  null,
  'No courier is fabricated at creation'
);

select is(
  (select tracking_number from public.fulfillment_records where official_order_id = :'oid'),
  null,
  'No tracking number is fabricated at creation'
);

select is(
  (select released_at from public.fulfillment_records where official_order_id = :'oid'),
  null,
  'Creating the record releases NOTHING'
);

select is(
  (select prepared_at from public.fulfillment_records where official_order_id = :'oid'),
  null,
  'Creating the record prepares NOTHING'
);

select ok(
  (select status not in ('approved_for_release', 'dispatched', 'picked_up', 'completed')
   from public.fulfillment_records where official_order_id = :'oid'),
  'The new record is NOT released, dispatched, picked up, or completed'
);

-- ============================================================================
-- 2. Idempotency — a repeated Approve & Send creates no second record
-- ============================================================================
select is(
  (select public.approve_and_send_invoice('fc000000-0000-0000-0000-0000000000e1')
     ->> 'deduplicated'),
  'true',
  'A repeated Approve & Send reports itself as deduplicated'
);

select is(
  (select count(*)::int from public.fulfillment_records),
  1,
  'A repeated Approve & Send created NO second fulfillment record'
);

select is(
  (select count(*)::int from public.official_orders),
  1,
  'A repeated Approve & Send still yields exactly ONE Official Order'
);

-- The unique constraint is the backstop beneath the dedup path.
select throws_ok(
  format($$insert into public.fulfillment_records (official_order_id, status)
           values (%L, 'for_preparation')$$, :'oid'),
  '23505',
  null,
  'A second fulfillment record for the same order is refused by the database, not by the UI'
);
reset role;

-- ============================================================================
-- THE INVARIANT: every Official Order has exactly one record
-- ============================================================================
select is(
  (select count(*)::int from public.official_orders o
   where not exists (select 1 from public.fulfillment_records f
                     where f.official_order_id = o.id)),
  0,
  'No Official Order exists without fulfillment tracking'
);

-- ============================================================================
-- 5. Backfill — idempotent, and it fabricates nothing
-- ----------------------------------------------------------------------------
-- Simulates a historical order: one that predates the record being part of the
-- transaction.
-- ============================================================================
delete from public.fulfillment_records where official_order_id = :'oid';

select is(
  (select count(*)::int from public.official_orders o
   where not exists (select 1 from public.fulfillment_records f
                     where f.official_order_id = o.id)),
  1,
  'The simulated historical order has no fulfillment record'
);

-- The backfill statement from migration 20260716230000, verbatim.
insert into public.fulfillment_records (official_order_id, status)
select o.id, 'for_preparation'
from public.official_orders o
where not exists (
  select 1 from public.fulfillment_records f where f.official_order_id = o.id
);

select is(
  (select count(*)::int from public.fulfillment_records where official_order_id = :'oid'),
  1,
  'The backfill created exactly one record for the historical order'
);

select ok(
  (select status = 'for_preparation' and method is null and courier is null
          and tracking_number is null and released_at is null
   from public.fulfillment_records where official_order_id = :'oid'),
  'The backfilled record fabricates no courier, tracking, or release — an unknown history stays unknown'
);

-- Re-running is a no-op.
insert into public.fulfillment_records (official_order_id, status)
select o.id, 'for_preparation'
from public.official_orders o
where not exists (
  select 1 from public.fulfillment_records f where f.official_order_id = o.id
);

select is(
  (select count(*)::int from public.fulfillment_records),
  1,
  'Re-running the backfill is a no-op — it is idempotent by construction'
);

-- ============================================================================
-- 10. Preparation is permission-gated
-- ============================================================================
select pg_temp.act_as('bc000000-0000-0000-0000-0000000000e2');
select is(
  app_private.has_permission('fulfillment_preparation'),
  false,
  'A staff member with only claim_capture cannot prepare fulfillment — capture is not preparation'
);

-- The SECURITY DEFINER helper re-checks authority itself. Being able to CALL a
-- definer is not being authorized to use it.
select throws_ok(
  format($$select app_private.create_fulfillment_tracking(%L)$$, :'oid'),
  '42501',
  null,
  'create_fulfillment_tracking() refuses a caller without invoice_preparation — the definer re-checks, it does not trust reachability'
);
reset role;

-- ============================================================================
-- The SECURITY DEFINER helper is narrow and cannot be hijacked
-- ============================================================================
select ok(
  (select p.prosecdef from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'create_fulfillment_tracking'),
  'create_fulfillment_tracking() is SECURITY DEFINER — the commit point creates tracking under invoice_preparation, not fulfillment_preparation'
);

select ok(
  (select exists (
     select 1 from unnest(coalesce(p.proconfig, array[]::text[])) cfg
     where cfg like 'search\_path=%')
   from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'create_fulfillment_tracking'),
  'create_fulfillment_tracking() pins search_path — a definer without one is the classic hijack vector'
);

select is(
  has_function_privilege('anon', 'app_private.create_fulfillment_tracking(uuid)', 'execute'),
  false,
  'anon cannot execute create_fulfillment_tracking()'
);

-- The fulfillment_insert policy is UNCHANGED: user-initiated inserts still
-- require fulfillment_preparation or existing_record_entry. The helper did not
-- widen it.
select ok(
  (select count(*) = 1 from pg_policies
   where schemaname = 'public' and tablename = 'fulfillment_records'
     and cmd = 'INSERT'
     and with_check like '%fulfillment_preparation%'
     and with_check like '%existing_record_entry%'
     and with_check not like '%invoice_preparation%'),
  'The fulfillment_insert policy is untouched — invoice_preparation was NOT silently folded into fulfillment authority'
);

select * from finish();
rollback;
