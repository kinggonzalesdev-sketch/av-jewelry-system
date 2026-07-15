-- ============================================================================
-- Reservation integrity — the core inventory invariants (Bible §22.3, §19)
-- ============================================================================
begin;
select plan(16);

-- ---- Fixtures (test-only; rolled back at commit) ---------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000000',
        'fixture-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000001', 'Fixture Customer'),
       ('cccccccc-0000-0000-0000-000000000002', 'Fixture Customer Two');

-- A unique (quantity-one) item and a multi-stock item (quantity 3).
insert into public.inventory_items (id, item_code, is_unique_item, quantity_total)
values ('11111111-0000-0000-0000-000000000001', 'UNIQUE-1', true, 1),
       ('11111111-0000-0000-0000-000000000002', 'MULTI-3', false, 3);

insert into public.claims (id, inventory_item_id, customer_id, status, quantity)
values ('dddddddd-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'cccccccc-0000-0000-0000-000000000001', 'pending_claim', 1);

-- ============================================================================
-- RULE: A Pending Claim creates NO reservation (Bible §22.3, §22.6)
-- ============================================================================
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 1)$$,
  '23514',
  null,
  'A Pending Claim cannot hold an inventory reservation'
);

select is(
  (select count(*)::int from public.inventory_reservations),
  0,
  'No reservation exists while the claim is Pending'
);

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000001'),
  1,
  'Pending Claim does not reduce available quantity'
);

-- ============================================================================
-- RULE: Confirmed Claim creates EXACTLY ONE provisional reservation
-- ============================================================================
update public.claims
set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000001';

insert into public.inventory_reservations (id, inventory_item_id, claim_id, quantity)
values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
        'dddddddd-0000-0000-0000-000000000001', 1);

select is(
  (select state from public.inventory_reservations where claim_id = 'dddddddd-0000-0000-0000-000000000001'),
  'provisional',
  'Confirmed Claim reserves provisionally'
);

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000001'),
  0,
  'Confirmed Claim reduces available quantity exactly once'
);

-- Reserve-exactly-once: a retry cannot create a second reservation for the same
-- claim. Proven on the MULTI-stock item, where spare quantity exists — so the
-- quantity guard cannot mask the result and UNIQUE(claim_id) is demonstrably
-- what blocks the duplicate.
-- Born pending, then confirmed. Phase 3 forbids inserting an already-confirmed
-- claim (capture creates a Pending Claim only, §12.3/§13.2), so the fixture
-- takes the same two steps the real workflow does.
insert into public.claims (id, inventory_item_id, customer_id, status, quantity)
values ('dddddddd-0000-0000-0000-0000000000f1', '11111111-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000001', 'pending_claim', 1);
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-0000000000f1';

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
values ('11111111-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-0000000000f1', 1);

select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-0000000000f1', 1)$$,
  '23505',
  null,
  'A retry cannot create a second reservation for the same claim (reserve exactly once)'
);

-- Clean up so the multi-stock arithmetic below starts from a known state.
delete from public.inventory_reservations where claim_id = 'dddddddd-0000-0000-0000-0000000000f1';
delete from public.claims where id = 'dddddddd-0000-0000-0000-0000000000f1';

-- ============================================================================
-- RULE: Official Order commits WITHOUT a second deduction (Bible §22.3)
-- ============================================================================
update public.inventory_reservations
set state = 'committed', committed_at = now()
where id = 'eeeeeeee-0000-0000-0000-000000000001';

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000001'),
  0,
  'Committing does not deduct again: availability is unchanged at 0'
);

select is(
  (select sum(quantity)::int from public.inventory_reservations
   where inventory_item_id = '11111111-0000-0000-0000-000000000001'),
  1,
  'Total reserved quantity remains 1 after commit (no second deduction)'
);

-- Changing quantity at commit time would BE a second deduction.
select throws_ok(
  $$update public.inventory_reservations
    set quantity = 2
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'Reservation cannot exceed available quantity via update'
);

-- A committed reservation cannot silently revert.
select throws_ok(
  $$update public.inventory_reservations set state = 'provisional'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'A committed reservation cannot revert to provisional'
);

-- ============================================================================
-- RULE: Released reservation cannot be reinstated (return only via approved RTS)
-- ============================================================================
update public.inventory_reservations
set state = 'released', released_at = now(), released_reason = 'test release'
where id = 'eeeeeeee-0000-0000-0000-000000000001';

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000001'),
  1,
  'Releasing a reservation frees the quantity in the derived calculation'
);

select throws_ok(
  $$update public.inventory_reservations set state = 'provisional'
    where id = 'eeeeeeee-0000-0000-0000-000000000001'$$,
  '23514',
  null,
  'A released reservation cannot be reinstated outside Returned-to-Stock Review'
);

-- ============================================================================
-- RULE: Multi-stock confirmation cannot exceed available quantity (§19.8)
-- ============================================================================
-- Born pending, then confirmed (Phase 3: capture creates a Pending Claim only).
insert into public.claims (id, inventory_item_id, customer_id, status, quantity)
values ('dddddddd-0000-0000-0000-000000000010', '11111111-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000001', 'pending_claim', 2),
       ('dddddddd-0000-0000-0000-000000000011', '11111111-0000-0000-0000-000000000002',
        'cccccccc-0000-0000-0000-000000000002', 'pending_claim', 2);
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id in ('dddddddd-0000-0000-0000-000000000010', 'dddddddd-0000-0000-0000-000000000011');

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
values ('11111111-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000010', 2);

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000002'),
  1,
  'Multi-stock: 3 total - 2 reserved = 1 available'
);

-- The second claim wants 2 but only 1 remains: it must be refused, not oversold.
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000011', 2)$$,
  '23514',
  null,
  'Confirmed quantity can never exceed available quantity (excess belongs on the waitlist)'
);

select is(
  app_private.available_quantity('11111111-0000-0000-0000-000000000002'),
  1,
  'A refused over-reservation leaves no partial record: availability unchanged'
);

-- ============================================================================
-- RULE: reservation item must match the claim's item
-- ============================================================================
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000011', 1)$$,
  '23514',
  null,
  'A reservation cannot point at a different item than its claim'
);

select * from finish();
rollback;
