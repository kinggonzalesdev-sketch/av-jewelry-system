-- ============================================================================
-- Official Order idempotency, invoice-draft rules, retry safety
-- Bible §22.8, §22.9, §15.16, §29.7-29.9
-- ============================================================================
begin;
select plan(14);

insert into auth.users (id, instance_id, email, aud, role)
values ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000000',
        'fixture-order@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
        'Fixture Order Staff', 'staff');
insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-00000000000a', 'Order Customer');
insert into public.inventory_items (id, item_code, is_unique_item, quantity_total)
values ('11111111-0000-0000-0000-00000000000a', 'ORD-ITEM-1', true, 1);
insert into public.claims (id, inventory_item_id, customer_id, status, confirmed_at)
values ('dddddddd-0000-0000-0000-00000000000a', '11111111-0000-0000-0000-00000000000a',
        'cccccccc-0000-0000-0000-00000000000a', 'confirmed_claim', now());
insert into public.invoice_drafts (id, customer_id, status)
values ('ffffffff-0000-0000-0000-00000000000a', 'cccccccc-0000-0000-0000-00000000000a', 'in_review'),
       ('ffffffff-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000a', 'draft');

-- ============================================================================
-- RULE: one claim cannot belong to more than one ACTIVE Invoice Draft (§22.8)
-- ============================================================================
insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
values ('ffffffff-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000a')$$,
  '23505',
  null,
  'A claim cannot sit in two active Invoice Drafts at once'
);

-- Only a Confirmed Claim may enter a draft.
insert into public.claims (id, inventory_item_id, customer_id, status)
values ('dddddddd-0000-0000-0000-00000000000b', '11111111-0000-0000-0000-00000000000a',
        'cccccccc-0000-0000-0000-00000000000a', 'pending_claim');

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000b')$$,
  '23514',
  null,
  'A Pending Claim cannot be added to an Invoice Draft'
);

-- Dissolving a draft frees the claim to return to For-Invoice readiness.
update public.invoice_drafts
set status = 'dissolved', dissolved_at = now(), dissolved_reason = 'test'
where id = 'ffffffff-0000-0000-0000-00000000000a';

select is(
  (select is_active from public.invoice_draft_claims
   where invoice_draft_id = 'ffffffff-0000-0000-0000-00000000000a'),
  false,
  'Dissolving a draft deactivates its claim links'
);

select lives_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000a')$$,
  'After dissolution the claim may join a different draft'
);

-- ============================================================================
-- RULE: one successful send -> exactly ONE Official Order + one order number
--       + one invoice number; a retry creates no second order (§22.8, §22.9)
-- ============================================================================
insert into public.official_orders (id, invoice_draft_id, customer_id)
values ('99999999-0000-0000-0000-00000000000a', 'ffffffff-0000-0000-0000-00000000000b',
        'cccccccc-0000-0000-0000-00000000000a');

select isnt(
  (select order_number from public.official_orders where id = '99999999-0000-0000-0000-00000000000a'),
  null,
  'Official Order receives exactly one order number'
);

select isnt(
  (select invoice_number from public.official_orders where id = '99999999-0000-0000-0000-00000000000a'),
  null,
  'Official Order receives exactly one invoice number'
);

select isnt(
  (select order_number from public.official_orders where id = '99999999-0000-0000-0000-00000000000a'),
  (select invoice_number from public.official_orders where id = '99999999-0000-0000-0000-00000000000a'),
  'Order number and invoice number are separate business references'
);

-- THE idempotency proof: retrying the send cannot create a second order.
select throws_ok(
  $$insert into public.official_orders (invoice_draft_id, customer_id)
    values ('ffffffff-0000-0000-0000-00000000000b', 'cccccccc-0000-0000-0000-00000000000a')$$,
  '23505',
  null,
  'A retried Approve & Send Invoice cannot create a second Official Order'
);

select is(
  (select count(*)::int from public.official_orders
   where invoice_draft_id = 'ffffffff-0000-0000-0000-00000000000b'),
  1,
  'Exactly one Official Order exists for the draft after a retry'
);

-- A claim can never belong to two Official Orders.
insert into public.official_order_claims (official_order_id, claim_id)
values ('99999999-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-00000000000a');

insert into public.invoice_drafts (id, customer_id, status)
values ('ffffffff-0000-0000-0000-00000000000c', 'cccccccc-0000-0000-0000-00000000000a', 'draft');
insert into public.official_orders (id, invoice_draft_id, customer_id)
values ('99999999-0000-0000-0000-00000000000b', 'ffffffff-0000-0000-0000-00000000000c',
        'cccccccc-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.official_order_claims (official_order_id, claim_id)
    values ('99999999-0000-0000-0000-00000000000b', 'dddddddd-0000-0000-0000-00000000000a')$$,
  '23505',
  null,
  'A claim cannot belong to two Official Orders (never sold twice)'
);

-- ============================================================================
-- RULE: cancellation requires an Owner approval reference (§22.9)
-- ============================================================================
select throws_ok(
  $$update public.official_orders
    set status = 'cancelled', cancelled_at = now(), cancelled_reason = 'test'
    where id = '99999999-0000-0000-0000-00000000000a'$$,
  '23514',
  null,
  'An Official Order cannot be cancelled without an Owner approval reference'
);

-- ============================================================================
-- RULE: idempotency ledger blocks duplicate critical operations (§29.7-29.9)
-- ============================================================================
insert into public.idempotency_records (scope, idempotency_key, result_type, result_id, state)
values ('official_order.create', 'ffffffff-0000-0000-0000-00000000000b', 'official_order',
        '99999999-0000-0000-0000-00000000000a', 'succeeded');

select throws_ok(
  $$insert into public.idempotency_records (scope, idempotency_key)
    values ('official_order.create', 'ffffffff-0000-0000-0000-00000000000b')$$,
  '23505',
  null,
  'The idempotency ledger rejects a duplicate (scope, key)'
);

-- ============================================================================
-- RULE: one label job per claim; a reprint never creates another job/claim (§22.7)
-- ============================================================================
insert into public.label_jobs (id, claim_id)
values ('bbbbbbbb-0000-0000-0000-00000000000a', 'dddddddd-0000-0000-0000-00000000000a');

select throws_ok(
  $$insert into public.label_jobs (claim_id)
    values ('dddddddd-0000-0000-0000-00000000000a')$$,
  '23505',
  null,
  'A reprint cannot create a second label job for the same claim'
);

-- A failed attempt must carry a reason (the constraint enforces this).
insert into public.print_attempts (label_job_id, attempt_number, outcome, failure_reason)
values ('bbbbbbbb-0000-0000-0000-00000000000a', 1, 'failed', 'printer offline');
insert into public.print_attempts (label_job_id, attempt_number, outcome)
values ('bbbbbbbb-0000-0000-0000-00000000000a', 2, 'printed');

select is(
  (select count(*)::int from public.claims where inventory_item_id = '11111111-0000-0000-0000-00000000000a'),
  2,
  'Print retries created no additional claim'
);

select * from finish();
rollback;
