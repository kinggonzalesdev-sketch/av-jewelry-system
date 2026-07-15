-- ============================================================================
-- Phase 7 — Fulfillment & Owner Approval Center (Bible §18, §5.13, §22.13-22.14)
-- ============================================================================
begin;
select plan(18);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('77777777-7777-7777-7777-777777777777', '00000000-0000-0000-0000-000000000000',
        'phase7-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000071', '77777777-7777-7777-7777-777777777777',
        'Phase7 Fixture Staff', 'staff');

-- Deciding an Owner Approval Request is non-delegable (Bible §5.13): a Phase 2
-- guard refuses any decider who is not the Owner. The fixture therefore needs a
-- real Owner — that refusal is the rule working, not an obstacle.
insert into auth.users (id, instance_id, email, aud, role)
values ('77777777-0000-0000-0000-0000000000ff', '00000000-0000-0000-0000-000000000000',
        'phase7-owner@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-0000000000ff', '77777777-0000-0000-0000-0000000000ff',
        'Phase7 Fixture Owner', 'owner');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000071', 'Phase7 Customer');

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total,
                                    total_price_per_piece)
values ('11111111-0000-0000-0000-000000000071', 'P7-A', 'Ring 18K', true, 1, 5000.00);

insert into public.claims (id, inventory_item_id, customer_id, status, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dddddddd-0000-0000-0000-000000000071', '11111111-0000-0000-0000-000000000071',
        'cccccccc-0000-0000-0000-000000000071', 'pending_claim', 1, 'full_payment', 'shipping');
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000071';

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state, committed_at)
values ('11111111-0000-0000-0000-000000000071', 'dddddddd-0000-0000-0000-000000000071',
        1, 'committed', now());

insert into public.invoice_drafts (id, customer_id, status, sent_at,
                                   payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000071', 'cccccccc-0000-0000-0000-000000000071',
        'sent', now(), 'full_payment', 'shipping');

insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000071', 'ffffffff-0000-0000-0000-000000000071',
        'cccccccc-0000-0000-0000-000000000071', 'invoiced');

insert into public.official_order_claims (official_order_id, claim_id)
values ('7fffffff-0000-0000-0000-000000000071', 'dddddddd-0000-0000-0000-000000000071');

insert into public.fulfillment_records (id, official_order_id, status, method)
values ('afffffff-0000-0000-0000-000000000071', '7fffffff-0000-0000-0000-000000000071',
        'for_preparation', 'shipping');

-- ============================================================================
-- RULE: verified payment before release (Bible §18)
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'Release is refused with no verified payment — evidence alone is not payment'
);

-- Submitted-but-unverified must not open the door either.
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000071', '7fffffff-0000-0000-0000-000000000071',
        5000.00, 'submitted_unverified', 'bank_transfer', 'BT-P7-1', 'BDO', now());

select throws_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'An unverified payment does not permit release'
);

-- ============================================================================
-- RULE: shipping needs the PHP 1,000 deposit floor or full payment (Bible §4)
-- ============================================================================
select is(
  app_private.shipping_deposit_floor(),
  1000.00::numeric,
  'The approved shipping deposit floor is PHP 1,000'
);

-- Verify only PHP 500 — below the floor and below the payable total.
update public.payments set amount = 500.00 where id = '4bcdef01-0000-0000-0000-000000000071';
update public.payments set status = 'verified' where id = '4bcdef01-0000-0000-0000-000000000071';
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000071', 'verified', 500.00,
        'aaaaaaaa-0000-0000-0000-000000000071');

select throws_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'Shipping below the PHP 1,000 deposit floor is refused'
);

-- Raise the verified deposit to exactly the floor.
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000072', '7fffffff-0000-0000-0000-000000000071',
        500.00, 'verified', 'bank_transfer', 'BT-P7-2', 'BDO', now());
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000072', 'verified', 500.00,
        'aaaaaaaa-0000-0000-0000-000000000071');

select is(
  app_private.verified_net_payments('7fffffff-0000-0000-0000-000000000071'),
  1000.00::numeric,
  'The verified deposit now meets the floor exactly'
);

select lives_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  'Normal release succeeds at the deposit floor — it is permission-based, not Owner-only'
);

-- ============================================================================
-- RULE: release is attributed (Bible §31)
-- ============================================================================
update public.fulfillment_records set status = 'for_preparation', released_at = null,
       released_by = null
where id = 'afffffff-0000-0000-0000-000000000071';

select throws_ok(
  $$update public.fulfillment_records set status = 'approved_for_release'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'A release must record who released it and when'
);

-- ============================================================================
-- RULE: no auto dispatch, no auto complete (Bible §18)
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records set status = 'dispatched'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'A fulfillment cannot be dispatched before it is released'
);

select throws_ok(
  $$update public.fulfillment_records set status = 'completed'
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'A fulfillment cannot complete without being dispatched or picked up'
);

update public.fulfillment_records
set status = 'approved_for_release', released_at = now(),
    released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
where id = 'afffffff-0000-0000-0000-000000000071';

select lives_ok(
  $$update public.fulfillment_records set status = 'dispatched', dispatched_at = now()
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  'A released fulfillment may be dispatched'
);

select lives_ok(
  $$update public.fulfillment_records set status = 'completed', completed_at = now()
      where id = 'afffffff-0000-0000-0000-000000000071'$$,
  'A dispatched fulfillment may be completed'
);

-- ============================================================================
-- RULE: COD must be approved (Bible §4)
-- ============================================================================
insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000072', 'Phase7 COD Customer');
insert into public.invoice_drafts (id, customer_id, status, sent_at,
                                   payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000072', 'cccccccc-0000-0000-0000-000000000072',
        'sent', now(), 'full_payment', 'shipping');
insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000072', 'ffffffff-0000-0000-0000-000000000072',
        'cccccccc-0000-0000-0000-000000000072', 'invoiced');
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000073', '7fffffff-0000-0000-0000-000000000072',
        1500.00, 'verified', 'bank_transfer', 'BT-P7-3', 'BDO', now());
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000073', 'verified', 1500.00,
        'aaaaaaaa-0000-0000-0000-000000000071');
insert into public.fulfillment_records (id, official_order_id, status, method, is_cod)
values ('afffffff-0000-0000-0000-000000000072', '7fffffff-0000-0000-0000-000000000072',
        'for_preparation', 'shipping', true);

select throws_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000072'$$,
  '23514',
  null,
  'An unapproved COD shipment cannot be released'
);

select lives_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071',
          cod_approved_at = now(), cod_approved_by = 'aaaaaaaa-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000072'$$,
  'An approved COD shipment may be released'
);

-- ============================================================================
-- RULE: a REQUEST is not a RELEASE (Bible §22.14)
-- ============================================================================
insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000073', 'Phase7 Exceptional Customer');
insert into public.invoice_drafts (id, customer_id, status, sent_at,
                                   payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000073', 'cccccccc-0000-0000-0000-000000000073',
        'sent', now(), 'full_payment', 'shipping');
insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000073', 'ffffffff-0000-0000-0000-000000000073',
        'cccccccc-0000-0000-0000-000000000073', 'invoiced');
insert into public.fulfillment_records (id, official_order_id, status, method)
values ('afffffff-0000-0000-0000-000000000073', '7fffffff-0000-0000-0000-000000000073',
        'for_preparation', 'shipping');

-- A PENDING request. Nothing is paid on this order at all.
insert into public.owner_approval_requests
  (id, action_kind, status, entity_type, entity_id, reason, requested_by)
values ('0a11e5ed-0000-0000-0000-000000000071', 'exceptional_fulfillment_release',
        'pending_owner_approval', 'official_order', '7fffffff-0000-0000-0000-000000000073',
        'Customer is a long-standing buyer', 'aaaaaaaa-0000-0000-0000-000000000071');

select throws_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071',
          exceptional_release_approval_request_id = '0a11e5ed-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000073'$$,
  '42501',
  null,
  'A PENDING exceptional-release request releases nothing — a request is not a release'
);

-- Owner approves it.
update public.owner_approval_requests
set status = 'approved', decided_at = now(),
    decided_by = 'aaaaaaaa-0000-0000-0000-0000000000ff'
where id = '0a11e5ed-0000-0000-0000-000000000071';

select lives_ok(
  $$update public.fulfillment_records
      set status = 'approved_for_release', released_at = now(),
          released_by = 'aaaaaaaa-0000-0000-0000-000000000071',
          exceptional_release_approval_request_id = '0a11e5ed-0000-0000-0000-000000000071'
      where id = 'afffffff-0000-0000-0000-000000000073'$$,
  'An APPROVED exceptional release permits release despite no verified payment'
);

-- ============================================================================
-- RULE: an approval executes exactly ONCE, and a decision is final (§22.14)
-- ============================================================================
update public.owner_approval_requests
set executed_at = now(), executed_by = 'aaaaaaaa-0000-0000-0000-0000000000ff'
where id = '0a11e5ed-0000-0000-0000-000000000071';

select throws_ok(
  $$update public.owner_approval_requests
      set executed_at = now(), executed_by = 'aaaaaaaa-0000-0000-0000-0000000000ff'
      where id = '0a11e5ed-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'A retried execute cannot run an approved action twice'
);

select throws_ok(
  $$update public.owner_approval_requests set status = 'rejected'
      where id = '0a11e5ed-0000-0000-0000-000000000071'$$,
  '23514',
  null,
  'A decided request cannot be re-decided'
);

-- Phase 1 already guarantees execution only follows approval.
insert into public.owner_approval_requests
  (id, action_kind, status, entity_type, entity_id, reason, requested_by)
values ('0a11e5ed-0000-0000-0000-000000000072', 'official_order_cancellation',
        'pending_owner_approval', 'official_order', '7fffffff-0000-0000-0000-000000000071',
        'Customer changed their mind', 'aaaaaaaa-0000-0000-0000-000000000071');

select throws_ok(
  $$update public.owner_approval_requests
      set executed_at = now(), executed_by = 'aaaaaaaa-0000-0000-0000-0000000000ff'
      where id = '0a11e5ed-0000-0000-0000-000000000072'$$,
  '23514',
  null,
  'A pending request cannot be executed'
);

select * from finish();
rollback;
