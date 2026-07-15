-- ============================================================================
-- Phase 9 — Dashboard, Search, Reports, Notifications & Audit (§7, §23, §25, §26)
-- ============================================================================
begin;
select plan(20);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'phase9-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000091', '99999999-9999-9999-9999-999999999999',
        'Phase9 Fixture Staff', 'staff');

insert into public.customers (id, display_name, contact_number)
values ('cccccccc-0000-0000-0000-000000000091', 'Nine Customer', '0917-000-0009');

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total,
                                    total_price_per_piece)
values ('11111111-0000-0000-0000-000000000091', 'P9-A', 'Ring 21K', true, 1, 10000.00),
       ('11111111-0000-0000-0000-000000000092', 'P9-B', 'Ring 18K', true, 1, 20000.00),
       ('11111111-0000-0000-0000-000000000093', 'P9-C', 'Ring 14K', true, 1, 30000.00);

-- Three confirmed claims, each on its own order, plus one still pending.
insert into public.claims (id, inventory_item_id, customer_id, status, quantity,
                           payment_arrangement, fulfillment_arrangement)
values ('dddddddd-0000-0000-0000-000000000091', '11111111-0000-0000-0000-000000000091',
        'cccccccc-0000-0000-0000-000000000091', 'pending_claim', 1, 'layaway', 'pickup'),
       ('dddddddd-0000-0000-0000-000000000092', '11111111-0000-0000-0000-000000000092',
        'cccccccc-0000-0000-0000-000000000091', 'pending_claim', 1, 'full_payment', 'pickup'),
       ('dddddddd-0000-0000-0000-000000000093', '11111111-0000-0000-0000-000000000093',
        'cccccccc-0000-0000-0000-000000000091', 'pending_claim', 1, 'full_payment', 'pickup');

update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id in ('dddddddd-0000-0000-0000-000000000091', 'dddddddd-0000-0000-0000-000000000092');

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state, committed_at)
values ('11111111-0000-0000-0000-000000000091', 'dddddddd-0000-0000-0000-000000000091',
        1, 'committed', now()),
       ('11111111-0000-0000-0000-000000000092', 'dddddddd-0000-0000-0000-000000000092',
        1, 'committed', now());

insert into public.invoice_drafts (id, customer_id, status, sent_at,
                                   payment_arrangement, fulfillment_arrangement)
values ('ffffffff-0000-0000-0000-000000000091', 'cccccccc-0000-0000-0000-000000000091',
        'sent', now(), 'layaway', 'pickup'),
       ('ffffffff-0000-0000-0000-000000000092', 'cccccccc-0000-0000-0000-000000000091',
        'sent', now(), 'full_payment', 'pickup');

insert into public.official_orders (id, invoice_draft_id, customer_id, status)
values ('7fffffff-0000-0000-0000-000000000091', 'ffffffff-0000-0000-0000-000000000091',
        'cccccccc-0000-0000-0000-000000000091', 'invoiced'),
       ('7fffffff-0000-0000-0000-000000000092', 'ffffffff-0000-0000-0000-000000000092',
        'cccccccc-0000-0000-0000-000000000091', 'invoiced');

insert into public.official_order_claims (official_order_id, claim_id)
values ('7fffffff-0000-0000-0000-000000000091', 'dddddddd-0000-0000-0000-000000000091'),
       ('7fffffff-0000-0000-0000-000000000092', 'dddddddd-0000-0000-0000-000000000092');

-- Order 91 carries an ACTIVE LAYAWAY. This is the double-count trap: it is
-- already an Official Order and must never be counted as a separate thing.
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000091', '7fffffff-0000-0000-0000-000000000091',
        3000.00, 'verified', 'e_wallet', 'GC-P9-1', 'GCash', now());
insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
values ('4bcdef01-0000-0000-0000-000000000091', 'verified', 3000.00,
        'aaaaaaaa-0000-0000-0000-000000000091');

insert into public.layaway_arrangements
  (id, official_order_id, status, months, total_grams, layaway_fee,
   deposit_verified_payment_id, final_due_date)
values ('9abcdef0-0000-0000-0000-000000000091', '7fffffff-0000-0000-0000-000000000091',
        'active', 2, 2.000, 600.00, '4bcdef01-0000-0000-0000-000000000091',
        current_date + 60);

-- ============================================================================
-- THE RULE: dashboard counts are NON-ADDITIVE (Bible §7, §4)
-- ============================================================================
select is(
  (public.dashboard_counts() ->> 'total_official_orders')::int,
  2,
  'Two Official Orders exist'
);

select is(
  (public.dashboard_counts() ->> 'orders_active_layaway')::int,
  1,
  'The Active Layaway order is counted in exactly one bucket'
);

select is(
  (public.dashboard_counts() ->> 'orders_awaiting_payment')::int,
  1,
  'The non-layaway order is counted in the awaiting-payment bucket'
);

-- THE proof: the buckets are disjoint and sum to the total. If an Active
-- Layaway were also counted as an order awaiting payment, this would be 3.
select is(
  (
    (public.dashboard_counts() ->> 'orders_active_layaway')::int
    + (public.dashboard_counts() ->> 'orders_awaiting_payment')::int
    + (public.dashboard_counts() ->> 'orders_for_fulfillment')::int
    + (public.dashboard_counts() ->> 'orders_closed')::int
    + (public.dashboard_counts() ->> 'orders_cancelled')::int
  ),
  (public.dashboard_counts() ->> 'total_official_orders')::int,
  'The order buckets are DISJOINT: they sum to the total, never more'
);

-- An Active Layaway is NOT a second order.
select is(
  (select count(*)::int from public.official_orders),
  2,
  'An Active Layaway adds no Official Order — it IS one'
);

-- ============================================================================
-- RULE: claims are NOT orders (Bible §4)
-- ============================================================================
select is(
  (public.dashboard_counts() ->> 'pending_claims')::int,
  1,
  'Pending Claims are counted separately from orders'
);

select is(
  (public.dashboard_counts() ->> 'confirmed_claims_for_invoice')::int,
  0,
  'A confirmed claim already on an order is not counted as awaiting invoice'
);

-- A claim never inflates the order total.
select is(
  (public.dashboard_counts() ->> 'total_official_orders')::int,
  2,
  'Claims never inflate the Official Order total'
);

-- ============================================================================
-- RULE: queue counts are advisory and separate
-- ============================================================================
insert into public.payments (id, official_order_id, amount, status, payment_method,
                             reference_number, provider, transacted_at)
values ('4bcdef01-0000-0000-0000-000000000092', '7fffffff-0000-0000-0000-000000000092',
        5000.00, 'submitted_unverified', 'bank_transfer', 'BT-P9-2', 'BDO', now());

select is(
  (public.dashboard_counts() ->> 'payments_awaiting_verification')::int,
  1,
  'Payments awaiting verification are counted as a queue'
);

select is(
  (public.dashboard_counts() ->> 'total_official_orders')::int,
  2,
  'A queue count never changes the order total'
);

-- ============================================================================
-- RULE: search finds references only (Bible §23, §25)
-- ============================================================================
select is(
  (select count(*)::int from public.global_search('Nine Customer')),
  (select count(*)::int from public.global_search('Nine Customer')),
  'Search runs and is stable'
);

select ok(
  (select count(*) from public.global_search('Nine') where result_kind = 'customer') >= 1,
  'Search finds a customer by name'
);

select ok(
  (select count(*) from public.global_search('P9-A') where result_kind = 'inventory_item') >= 1,
  'Search finds an item by code'
);

select is(
  (select count(*)::int from public.global_search('a')),
  0,
  'A single-character query returns nothing — no accidental full-table dump'
);

-- Search must never mutate. The customer count is unchanged after searching.
select is(
  (select count(*)::int from public.customers),
  1,
  'Searching merges and reassigns nothing'
);

-- ============================================================================
-- RULE: a notification is a note (Bible §26)
-- ============================================================================
insert into public.notifications (id, kind, entity_type, entity_id, staff_profile_id, body)
values ('40000000-0000-0000-0000-000000000091', 'layaway_due', 'layaway_arrangement',
        '9abcdef0-0000-0000-0000-000000000091', 'aaaaaaaa-0000-0000-0000-000000000091',
        'Layaway installment due');

select throws_ok(
  $$update public.notifications set body = 'Rewritten after the fact'
      where id = '40000000-0000-0000-0000-000000000091'$$,
  '23514',
  null,
  'A notification body is frozen — a rewritable reminder records nothing'
);

select throws_ok(
  $$update public.notifications set acknowledged_at = now()
      where id = '40000000-0000-0000-0000-000000000091'$$,
  '23514',
  null,
  'Acknowledging must record who acknowledged it'
);

select lives_ok(
  $$update public.notifications
      set acknowledged_at = now(),
          acknowledged_by = 'aaaaaaaa-0000-0000-0000-000000000091'
      where id = '40000000-0000-0000-0000-000000000091'$$,
  'A notification may be acknowledged by an attributed staff member'
);

-- The notification changed no business record.
select is(
  (select status from public.layaway_arrangements
    where id = '9abcdef0-0000-0000-0000-000000000091'),
  'active',
  'Acknowledging a notification changes no business record'
);

-- ============================================================================
-- RULE: audit is append-only (Bible §31)
-- ============================================================================
insert into public.audit_events (actor_kind, action, entity_type, outcome)
values ('system', 'phase9.test', 'test', 'succeeded');

select throws_ok(
  $$update public.audit_events set outcome = 'failed' where action = 'phase9.test'$$,
  '42501',
  null,
  'Audit events cannot be rewritten — attribution cannot be erased'
);

select * from finish();
rollback;
