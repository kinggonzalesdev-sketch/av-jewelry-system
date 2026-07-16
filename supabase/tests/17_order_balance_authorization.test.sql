-- ============================================================================
-- Order balance, read as a REAL Staff caller (Bible §16; approved decisions §1-§4)
-- ----------------------------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The production UI rendered every Official Order as ₱0.00 while the database
-- held the real figure. order_balance() is SECURITY INVOKER, so it reads
-- official_order_charges AS THE CALLER — and Staff had no SELECT privilege on
-- that table, because Phase 2's `grant ... on all tables` ran four migrations
-- before Phase 6 created it. The RPC threw 42501 for every Staff caller and the
-- reader turned the error into a confident zero.
--
-- 370 database tests passed throughout. Every one of them called the money
-- functions as `postgres`, which has every privilege, so the one thing that was
-- broken was the one thing never tested: the actual caller.
--
-- So every assertion below runs as an impersonated Staff JWT, exactly as
-- PostgREST would. `postgres` is used only to establish the expected value —
-- never to assert the outcome.
-- ============================================================================
begin;
select plan(15);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('b9000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000000',
   'bal-staff@test.local', 'authenticated', 'authenticated'),
  ('b9000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000',
   'bal-nogrants@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('b9100000-0000-0000-0000-0000000000b1', 'b9000000-0000-0000-0000-0000000000b1',
   'Balance Staff', 'staff', true),
  ('b9100000-0000-0000-0000-0000000000b2', 'b9000000-0000-0000-0000-0000000000b2',
   'Balance NoGrants', 'staff', true);

insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('b9100000-0000-0000-0000-0000000000b1', 'claim_capture'),
  ('b9100000-0000-0000-0000-0000000000b1', 'confirm_claim_print_label'),
  ('b9100000-0000-0000-0000-0000000000b1', 'invoice_preparation'),
  ('b9100000-0000-0000-0000-0000000000b1', 'payment_verification');

insert into public.customers (id, display_name)
values ('c9000000-0000-0000-0000-0000000000b1', 'Balance Customer');

insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, grams_per_piece,
   total_price_per_piece)
values ('19000000-0000-0000-0000-0000000000b1', 'BAL-M01', 'Balance Bangle', false,
        10, 5.000, 6000.00);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- Build one real order: claim -> confirm -> draft -> Approve & Send, all as the
-- Staff member, through the real atomic functions.
select pg_temp.act_as('b9000000-0000-0000-0000-0000000000b1');

insert into public.claims (id, inventory_item_id, customer_id, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('d9000000-0000-0000-0000-0000000000b1', '19000000-0000-0000-0000-0000000000b1',
        'c9000000-0000-0000-0000-0000000000b1', 1, 'full_payment', 'shipping');

select public.confirm_claim_and_print('d9000000-0000-0000-0000-0000000000b1');

insert into public.invoice_drafts (id, customer_id, status, payment_arrangement,
                                   fulfillment_arrangement)
values ('f9000000-0000-0000-0000-0000000000b1', 'c9000000-0000-0000-0000-0000000000b1',
        'draft', 'full_payment', 'shipping');

insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
values ('f9000000-0000-0000-0000-0000000000b1', 'd9000000-0000-0000-0000-0000000000b1');

select public.approve_and_send_invoice('f9000000-0000-0000-0000-0000000000b1')
  ->> 'official_order_id' as order_id \gset

reset role;

-- ============================================================================
-- THE DEFECT: the privilege that made the whole read fail
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.official_order_charges', 'select'),
  'authenticated can SELECT official_order_charges — order_balance() reads it as the caller'
);

select is(
  has_table_privilege('authenticated', 'public.official_order_charges', 'delete'),
  false,
  'DELETE stays revoked — charges are corrected, never deleted'
);

select is(
  has_table_privilege('anon', 'public.official_order_charges', 'select'),
  false,
  'anon still holds nothing on official_order_charges'
);

-- The privilege is the gate; the policy is still the control.
select ok(
  (select relrowsecurity and relforcerowsecurity
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'official_order_charges'),
  'RLS is still ENABLED and FORCED on official_order_charges — the grant restored the gate, not the control'
);

select ok(
  (select count(*) > 0 from pg_policies
   where schemaname = 'public' and tablename = 'official_order_charges'
     and cmd = 'SELECT' and qual like '%is_active_staff%'),
  'Reading a charge still demands an ACTIVE staff account'
);

-- ============================================================================
-- The read itself: postgres and Staff must agree
-- ============================================================================
select is(
  (select public.order_balance(:'order_id') ->> 'total_amount_payable'),
  '6000.00',
  'postgres reads the real payable amount'
);

select pg_temp.act_as('b9000000-0000-0000-0000-0000000000b1');

-- This is the assertion that was missing. It fails outright without the grant:
-- "permission denied for table official_order_charges".
select lives_ok(
  format($$select public.order_balance(%L)$$, :'order_id'),
  'A Staff caller can execute order_balance() at all'
);

select is(
  (select public.order_balance(:'order_id') ->> 'total_amount_payable'),
  '6000.00',
  'Staff reads the SAME payable amount as postgres — never a zero'
);

select isnt(
  (select public.order_balance(:'order_id') ->> 'outstanding_balance'),
  '0.00',
  'An unpaid order does NOT read as ₱0.00 outstanding to a Staff caller'
);

select is(
  (select public.order_balance(:'order_id') ->> 'outstanding_balance'),
  '6000.00',
  'Outstanding Balance = payable − verified (approved §2)'
);

select is(
  (select public.order_balance(:'order_id') ->> 'verified_net_payments'),
  '0',
  'No payment is verified yet, so verified net payments is zero'
);

select is(
  (select public.order_balance(:'order_id') ->> 'paid_in_full'),
  'false',
  'An unpaid order is not Paid in Full'
);
reset role;

-- ============================================================================
-- Money rules through the Staff-visible reader (approved decisions §1-§4)
-- ============================================================================
select pg_temp.act_as('b9000000-0000-0000-0000-0000000000b1');

-- PARTIAL: only the VERIFIED amount moves the balance.
insert into public.payments (id, official_order_id, amount, payment_method,
                             reference_number, provider, transacted_at, status)
values ('a9000000-0000-0000-0000-0000000000b1', :'order_id', 2000.00, 'bank_transfer',
        'BAL-REF-1', 'Test Bank', now(), 'submitted_unverified');

-- Recorded but UNVERIFIED: it must count toward nothing.
select is(
  (select public.order_balance(:'order_id') ->> 'outstanding_balance'),
  '6000.00',
  'Recorded-but-unverified evidence moves NO balance — recording is not verifying'
);

-- Verify ₱2,000 of the ₱6,000 order.
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('a9000000-0000-0000-0000-0000000000b1', 'verified', 2000.00,
        'b9100000-0000-0000-0000-0000000000b1');
update public.payments set status = 'verified'
where id = 'a9000000-0000-0000-0000-0000000000b1';

select is(
  (select public.order_balance(:'order_id') ->> 'outstanding_balance'),
  '4000.00',
  'PARTIAL: a verified ₱2,000 leaves ₱4,000 outstanding (approved §2, §4)'
);

select is(
  (select public.order_balance(:'order_id') ->> 'paid_in_full'),
  'false',
  'PARTIAL: verified is NOT Paid in Full while a balance remains (approved §1)'
);
reset role;

select * from finish();
rollback;
