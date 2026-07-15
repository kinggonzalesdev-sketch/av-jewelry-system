-- ============================================================================
-- Phase 4 — Confirmation, reservation, and label jobs (Bible §22.3, §22.6, §24)
-- ============================================================================
begin;
select plan(21);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('44444444-4444-4444-4444-444444444444', '00000000-0000-0000-0000-000000000000',
        'phase4-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000041', '44444444-4444-4444-4444-444444444444',
        'Phase4 Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000041', 'Phase4 Customer');

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total,
                                    grams_per_piece, total_price_per_piece)
values ('11111111-0000-0000-0000-000000000041', 'P4-UNIQUE', 'Ring 21K', true, 1, 5.500, 12000.00),
       ('11111111-0000-0000-0000-000000000042', 'P4-MULTI', 'Chain 18K', false, 3, 2.000, 4000.00);

-- Claims are BORN PENDING (Phase 3 invariant, Owner-approved).
insert into public.claims (id, inventory_item_id, customer_id, status, quantity)
values ('dddddddd-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000041',
        'cccccccc-0000-0000-0000-000000000041', 'pending_claim', 1),
       ('dddddddd-0000-0000-0000-000000000042', '11111111-0000-0000-0000-000000000042',
        'cccccccc-0000-0000-0000-000000000041', 'pending_claim', 2);

-- ============================================================================
-- RULE: a Pending Claim holds NO reservation (Bible §22.3)
-- ============================================================================
select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000041'),
  0,
  'A Pending Claim holds no reservation before confirmation'
);

select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000041', 'dddddddd-0000-0000-0000-000000000041', 1)$$,
  '23514',
  null,
  'A reservation cannot be created for a claim that is still pending'
);

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000041'),
  1,
  'Available quantity is unaffected while the claim is pending'
);

-- ============================================================================
-- RULE: confirmation reserves EXACTLY ONCE and deducts availability once
-- ============================================================================
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000041';

insert into public.inventory_reservations (id, inventory_item_id, claim_id, quantity, state)
values ('99999999-0000-0000-0000-000000000041', '11111111-0000-0000-0000-000000000041',
        'dddddddd-0000-0000-0000-000000000041', 1, 'provisional');

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000041'),
  0,
  'Available inventory decreases exactly once at confirmation'
);

-- On a UNIQUE item the quantity guard fires first, before UNIQUE(claim_id) is
-- ever reached. That is correct and is itself the protection: there is no
-- spare quantity to double-reserve. Reserve-exactly-once is proven separately
-- on the multi-stock item below, where spare quantity exists and so the guard
-- cannot mask which constraint actually blocks the duplicate.
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000041', 'dddddddd-0000-0000-0000-000000000041', 1)$$,
  '23514',
  null,
  'A second reservation on a fully-reserved unique item is refused'
);

-- ============================================================================
-- RULE: one label job per claim — a reprint is an ATTEMPT, never a new job
-- ============================================================================
insert into public.label_jobs (id, claim_id, status, customer_display_name, item_code,
                               item_name, grams_per_piece, quantity, total_price, label_size)
values ('88888888-0000-0000-0000-000000000041', 'dddddddd-0000-0000-0000-000000000041',
        'pending_print', 'Phase4 Customer', 'P4-UNIQUE', 'Ring 21K', 5.500, 1, 12000.00, '40x30mm');

select throws_ok(
  $$insert into public.label_jobs (claim_id, status)
    values ('dddddddd-0000-0000-0000-000000000041', 'pending_print')$$,
  '23505',
  null,
  'A claim cannot have two label jobs — a reprint is an attempt on the same job'
);

select is(
  (select label_size from public.label_jobs where id = '88888888-0000-0000-0000-000000000041'),
  '40x30mm',
  'The approved 40x30mm label size is the default'
);

-- ============================================================================
-- RULE: print attempts are numbered; retry/reprint create no business records
-- ============================================================================
insert into public.print_attempts (label_job_id, attempt_number, outcome, failure_reason, transport)
values ('88888888-0000-0000-0000-000000000041', 1, 'failed', 'Printer disconnected', 'mock');

insert into public.print_attempts (label_job_id, attempt_number, outcome, transport)
values ('88888888-0000-0000-0000-000000000041', 2, 'printed', 'browser_preview');

select throws_ok(
  $$insert into public.print_attempts (label_job_id, attempt_number, outcome, transport)
    values ('88888888-0000-0000-0000-000000000041', 2, 'printed', 'mock')$$,
  '23505',
  null,
  'Attempt numbers are unique per label job'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000041'),
  1,
  'Retrying and reprinting never create a second reservation'
);

select is(
  (select count(*)::int from public.claims
    where id = 'dddddddd-0000-0000-0000-000000000041'),
  1,
  'Retrying and reprinting never create another claim'
);

-- A reprint must explain itself (§24.17 — required as the safer default).
select throws_ok(
  $$insert into public.print_attempts (label_job_id, attempt_number, outcome, is_reprint, transport)
    values ('88888888-0000-0000-0000-000000000041', 3, 'printed', true, 'mock')$$,
  '23514',
  null,
  'A reprint without a reason is rejected'
);

select lives_ok(
  $$insert into public.print_attempts (label_job_id, attempt_number, outcome, is_reprint, reason, transport)
    values ('88888888-0000-0000-0000-000000000041', 3, 'printed', true, 'Label smudged', 'mock')$$,
  'A reprint with a reason is recorded as a new attempt'
);

-- A mock result must never be able to pass as a real device print.
select throws_ok(
  $$insert into public.print_attempts (label_job_id, attempt_number, outcome, transport)
    values ('88888888-0000-0000-0000-000000000041', 4, 'printed', 'telepathy')$$,
  '23514',
  null,
  'Only known transports can be recorded'
);

-- ============================================================================
-- RULE: Void/Cancel Label Job cancels paper only (Bible §24)
-- ============================================================================
select throws_ok(
  $$update public.label_jobs set status = 'voided'
      where id = '88888888-0000-0000-0000-000000000041'$$,
  '23514',
  null,
  'Voiding a label job requires a reason'
);

select lives_ok(
  $$update public.label_jobs set status = 'voided', voided_reason = 'Wrong price printed'
      where id = '88888888-0000-0000-0000-000000000041'$$,
  'A label job may be voided with a reason'
);

select is(
  (select status from public.claims where id = 'dddddddd-0000-0000-0000-000000000041'),
  'confirmed_claim',
  'Voiding a label job does not cancel the claim'
);

select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000041' and state = 'provisional'),
  1,
  'Voiding a label job does not release the reservation'
);

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000041'),
  0,
  'Voiding a label job does not return stock to available'
);

-- ============================================================================
-- RULE: multi-stock confirmation cannot exceed available quantity (§19.8)
-- ============================================================================
update public.claims set status = 'confirmed_claim', confirmed_at = now()
where id = 'dddddddd-0000-0000-0000-000000000042';

insert into public.inventory_reservations (inventory_item_id, claim_id, quantity, state)
values ('11111111-0000-0000-0000-000000000042', 'dddddddd-0000-0000-0000-000000000042', 2, 'provisional');

select is(
  public.available_quantity_for('11111111-0000-0000-0000-000000000042'),
  1,
  'Multi-stock availability reflects exactly the reserved quantity'
);

-- Reserve-exactly-once, proven where the quantity guard CANNOT mask it: one
-- spare unit remains, so the only thing that can block this is UNIQUE(claim_id).
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('11111111-0000-0000-0000-000000000042', 'dddddddd-0000-0000-0000-000000000042', 1)$$,
  '23505',
  null,
  'A claim cannot hold two active reservations even when stock remains (reserve exactly once)'
);

-- ============================================================================
-- RULE: no 3rd Miner ever (Bible §19.7)
-- ============================================================================
select throws_ok(
  $$insert into public.miner_positions (inventory_item_id, claim_id, position)
    values ('11111111-0000-0000-0000-000000000041', 'dddddddd-0000-0000-0000-000000000042', 3)$$,
  '23514',
  null,
  'A 3rd Miner cannot be represented at all'
);

select * from finish();
rollback;
