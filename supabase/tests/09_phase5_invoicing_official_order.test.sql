-- ============================================================================
-- Phase 5 — Invoicing & Official Order (Bible §15, §6.7-6.8, §22.8-22.9)
-- ============================================================================
begin;
select plan(23);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('55555555-5555-5555-5555-555555555555', '00000000-0000-0000-0000-000000000000',
        'phase5-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000051', '55555555-5555-5555-5555-555555555555',
        'Phase5 Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000051', 'Phase5 Customer A'),
       ('cccccccc-0000-0000-0000-000000000052', 'Phase5 Customer B');

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total,
                                    total_price_per_piece)
values ('11111111-0000-0000-0000-000000000051', 'P5-A', 'Ring A', true, 1, 10000.00),
       ('11111111-0000-0000-0000-000000000052', 'P5-B', 'Ring B', true, 1, 20000.00),
       ('11111111-0000-0000-0000-000000000053', 'P5-C', 'Ring C', true, 1, 30000.00),
       ('11111111-0000-0000-0000-000000000054', 'P5-D', 'Ring D', true, 1, 40000.00);

-- Claims are born pending, then confirmed (Phase 3 invariant, Owner-approved).
insert into public.claims (id, inventory_item_id, customer_id, status, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dddddddd-0000-0000-0000-000000000051', '11111111-0000-0000-0000-000000000051',
        'cccccccc-0000-0000-0000-000000000051', 'pending_claim', 1, 'full_payment', 'shipping'),
       ('dddddddd-0000-0000-0000-000000000052', '11111111-0000-0000-0000-000000000052',
        'cccccccc-0000-0000-0000-000000000051', 'pending_claim', 1, 'full_payment', 'shipping'),
       -- Different customer.
       ('dddddddd-0000-0000-0000-000000000053', '11111111-0000-0000-0000-000000000053',
        'cccccccc-0000-0000-0000-000000000052', 'pending_claim', 1, 'full_payment', 'shipping'),
       -- Same customer, DIFFERENT payment arrangement.
       ('dddddddd-0000-0000-0000-000000000054', '11111111-0000-0000-0000-000000000054',
        'cccccccc-0000-0000-0000-000000000051', 'pending_claim', 1, 'layaway', 'shipping');

update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id in ('dddddddd-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000052',
             'dddddddd-0000-0000-0000-000000000053', 'dddddddd-0000-0000-0000-000000000054');

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state)
values ('11111111-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000051', 1, 'provisional'),
       ('11111111-0000-0000-0000-000000000052', 'dddddddd-0000-0000-0000-000000000052', 1, 'provisional'),
       ('11111111-0000-0000-0000-000000000053', 'dddddddd-0000-0000-0000-000000000053', 1, 'provisional'),
       ('11111111-0000-0000-0000-000000000054', 'dddddddd-0000-0000-0000-000000000054', 1, 'provisional');

insert into public.invoice_drafts (id, customer_id, status, payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000051', 'cccccccc-0000-0000-0000-000000000051',
        'draft', 'full_payment', 'shipping');

-- ============================================================================
-- RULE: grouping — same customer + payment + fulfillment arrangement (§11.17)
-- ============================================================================
select lives_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000051')$$,
  'A matching Confirmed Claim may be grouped into the draft'
);

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000053')$$,
  '23514',
  null,
  'A different customer cannot be grouped into the same draft'
);

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000054')$$,
  '23514',
  null,
  'A different payment arrangement cannot be grouped into the same draft'
);

-- ============================================================================
-- RULE: a claim cannot sit in two ACTIVE drafts (§22.8)
-- ============================================================================
insert into public.invoice_drafts (id, customer_id, status, payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000052', 'cccccccc-0000-0000-0000-000000000051',
        'draft', 'full_payment', 'shipping');

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000052', 'dddddddd-0000-0000-0000-000000000051')$$,
  '23505',
  null,
  'One claim cannot belong to two active Invoice Drafts'
);

-- ============================================================================
-- RULE: only a Confirmed Claim, holding a reservation, may be grouped
-- ============================================================================
insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000053', 'Phase5 Customer C');
insert into public.inventory_items (id, item_code, is_unique_item, quantity_total)
values ('11111111-0000-0000-0000-000000000055', 'P5-E', true, 1);
insert into public.claims (id, inventory_item_id, customer_id, status, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dddddddd-0000-0000-0000-000000000055', '11111111-0000-0000-0000-000000000055',
        'cccccccc-0000-0000-0000-000000000053', 'pending_claim', 1, 'full_payment', 'shipping');
insert into public.invoice_drafts (id, customer_id, status, payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000053', 'cccccccc-0000-0000-0000-000000000053',
        'draft', 'full_payment', 'shipping');

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000053', 'dddddddd-0000-0000-0000-000000000055')$$,
  '23514',
  null,
  'A Pending Claim cannot be added to an Invoice Draft'
);

-- Confirmed but WITHOUT a reservation: must still be refused.
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000055';

select throws_ok(
  $$insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
    values ('ffffffff-0000-0000-0000-000000000053', 'dddddddd-0000-0000-0000-000000000055')$$,
  '23514',
  null,
  'A claim holding no reservation cannot be invoiced'
);

-- ============================================================================
-- RULE: creating a draft does NOT deduct inventory again (§22.3)
-- ============================================================================
select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000051'),
  1,
  'Adding a claim to a draft creates no second reservation'
);

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000051'),
  0,
  'Drafting does not deduct inventory a second time'
);

-- ============================================================================
-- RULE: Approve & Send creates exactly ONE Official Order (§22.9)
-- ============================================================================
insert into public.invoice_draft_claims (invoice_draft_id, claim_id)
values ('ffffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000052');

insert into public.official_orders (id, invoice_draft_id, customer_id, status, hold_expires_at)
values ('7fffffff-0000-0000-0000-000000000051', 'ffffffff-0000-0000-0000-000000000051',
        'cccccccc-0000-0000-0000-000000000051', 'invoiced',
        now() + app_private.official_order_hold_interval());

select throws_ok(
  $$insert into public.official_orders (invoice_draft_id, customer_id, status)
    values ('ffffffff-0000-0000-0000-000000000051', 'cccccccc-0000-0000-0000-000000000051', 'invoiced')$$,
  '23505',
  null,
  'A retried Approve & Send cannot create a second Official Order for one draft'
);

select isnt(
  (select order_number from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051'),
  null,
  'The Official Order receives exactly one order number'
);

select isnt(
  (select invoice_number from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051'),
  null,
  'The Official Order receives exactly one invoice number'
);

select isnt(
  (select order_number from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051'),
  (select invoice_number from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051'),
  'The order number and the invoice number are separate references'
);

select ok(
  (select hold_expires_at from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051')
    > now() + interval '2 days',
  'One shared hold is created and runs about three days'
);

-- ============================================================================
-- RULE: a claim can never reach two Official Orders (§22.9)
-- ============================================================================
insert into public.official_order_claims (official_order_id, claim_id)
values ('7fffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000051'),
       ('7fffffff-0000-0000-0000-000000000051', 'dddddddd-0000-0000-0000-000000000052');

insert into public.invoice_drafts (id, customer_id, status, payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000054', 'cccccccc-0000-0000-0000-000000000051',
        'draft', 'full_payment', 'shipping');
insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000052', 'ffffffff-0000-0000-0000-000000000054',
        'cccccccc-0000-0000-0000-000000000051', 'invoiced');

select throws_ok(
  $$insert into public.official_order_claims (official_order_id, claim_id)
    values ('7fffffff-0000-0000-0000-000000000052', 'dddddddd-0000-0000-0000-000000000051')$$,
  '23505',
  null,
  'A claim can never belong to two Official Orders'
);

-- ============================================================================
-- RULE: provisional -> committed exactly once, no second deduction (§22.3)
-- ============================================================================
update public.inventory_reservations set state = 'committed', committed_at = now()
where claim_id = 'dddddddd-0000-0000-0000-000000000051';

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000051'),
  0,
  'Committing a reservation does not deduct inventory a second time'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000051'),
  1,
  'Committing does not create a second reservation'
);

select throws_ok(
  $$update public.inventory_reservations set quantity = 2
      where claim_id = 'dddddddd-0000-0000-0000-000000000051'$$,
  '23514',
  null,
  'A committed reservation cannot change quantity — that would be a second deduction'
);

select throws_ok(
  $$update public.inventory_reservations set state = 'provisional'
      where claim_id = 'dddddddd-0000-0000-0000-000000000051'$$,
  '23514',
  null,
  'A committed reservation cannot silently revert to provisional'
);

-- ============================================================================
-- RULE: Copy != Sent != Delivered (§15, §26)
-- ============================================================================
insert into public.customer_messages (id, customer_id, official_order_id, status, body)
values ('6fffffff-0000-0000-0000-000000000051', 'cccccccc-0000-0000-0000-000000000051',
        '7fffffff-0000-0000-0000-000000000051', 'ready_to_copy_or_send', 'Invoice body');

select throws_ok(
  $$update public.customer_messages set status = 'manually_sent'
      where id = '6fffffff-0000-0000-0000-000000000051'$$,
  '23514',
  null,
  'Marking a message sent requires an attributed attestation — copying is not sending'
);

select lives_ok(
  $$update public.customer_messages
      set status = 'manually_sent', manually_sent_at = now(),
          manually_sent_by = 'aaaaaaaa-0000-0000-0000-000000000051'
      where id = '6fffffff-0000-0000-0000-000000000051'$$,
  'Mark as Sent records who attested and when'
);

-- A retried send must not create another Official Order.
insert into public.message_send_attempts (customer_message_id, attempt_number, channel, outcome, failure_reason)
values ('6fffffff-0000-0000-0000-000000000051', 1, 'manual', 'failed', 'Facebook unreachable');
insert into public.message_send_attempts (customer_message_id, attempt_number, channel, outcome)
values ('6fffffff-0000-0000-0000-000000000051', 2, 'manual', 'sent');

select is(
  (select count(*)::int from public.official_orders
    where invoice_draft_id = 'ffffffff-0000-0000-0000-000000000051'),
  1,
  'Retrying message sending never creates another Official Order'
);

-- ============================================================================
-- RULE: no automatic cancellation when the hold expires (§15.16)
-- ============================================================================
update public.official_orders set hold_expires_at = now() - interval '1 day'
where id = '7fffffff-0000-0000-0000-000000000051';

select is(
  (select status from public.official_orders where id = '7fffffff-0000-0000-0000-000000000051'),
  'invoiced',
  'An expired hold does not automatically cancel the Official Order'
);

select is(
  (select state from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000051'),
  'committed',
  'An expired hold does not automatically return stock'
);

select * from finish();
rollback;
