-- ============================================================================
-- Phase 3 — Live Selling & Claim Intake invariants (Bible §12, §13)
-- ============================================================================
begin;
select plan(18);

-- ---- Fixtures (test-only; rolled back at commit) ---------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000',
        'phase3-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000031', '33333333-3333-3333-3333-333333333333',
        'Phase3 Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000031', 'Phase3 Customer One'),
       ('cccccccc-0000-0000-0000-000000000032', 'Phase3 Customer Two');

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total)
values ('11111111-0000-0000-0000-000000000031', 'P3-UNIQUE-1', 'Ring 18K', true, 1),
       ('11111111-0000-0000-0000-000000000032', 'P3-FLEX-1', 'Bracelet 21K', true, 1);

insert into public.live_batches (id, title, status)
values ('bbbbbbbb-0000-0000-0000-000000000031', 'Phase3 Fixture Live', 'active');

insert into public.live_batch_items (id, live_batch_id, inventory_item_id, is_current_flex_item)
values ('eeeeeeee-0000-0000-0000-000000000031', 'bbbbbbbb-0000-0000-0000-000000000031',
        '11111111-0000-0000-0000-000000000031', true),
       ('eeeeeeee-0000-0000-0000-000000000032', 'bbbbbbbb-0000-0000-0000-000000000031',
        '11111111-0000-0000-0000-000000000032', false);

-- ============================================================================
-- RULE: Capture creates a PENDING CLAIM only (Bible §12.3, §13.2)
-- ============================================================================
select lives_ok(
  $$insert into public.claims
      (id, live_batch_id, live_batch_item_id, inventory_item_id, customer_id,
       status, intake_kind, capture_method, idempotency_key)
    values ('dddddddd-0000-0000-0000-000000000031',
            'bbbbbbbb-0000-0000-0000-000000000031', 'eeeeeeee-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'live_capture', 'manual_live', 'idem-key-capture-0001')$$,
  'A live capture may create a Pending Claim'
);

select throws_ok(
  $$insert into public.claims
      (live_batch_id, inventory_item_id, customer_id, status, intake_kind, capture_method, idempotency_key)
    values ('bbbbbbbb-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000032', 'cccccccc-0000-0000-0000-000000000031',
            'confirmed_claim', 'live_capture', 'manual_live', 'idem-key-confirm-0001')$$,
  '23514',
  null,
  'Capture cannot insert a claim as confirmed — confirmation is a separate action'
);

-- A Pending Claim holds NO reservation. This is the whole point of the phase.
select is(
  (select count(*)::int from public.inventory_reservations
    where claim_id = 'dddddddd-0000-0000-0000-000000000031'),
  0,
  'A captured Pending Claim creates NO inventory reservation'
);

select is(
  (select availability_status from public.inventory_items
    where id = '11111111-0000-0000-0000-000000000031'),
  'available',
  'Capture does not change item availability'
);

-- ============================================================================
-- RULE: duplicate submit does not create a second Pending Claim (§34 stage 8)
-- ============================================================================
select throws_ok(
  $$insert into public.claims
      (live_batch_id, inventory_item_id, customer_id, status, intake_kind, capture_method, idempotency_key)
    values ('bbbbbbbb-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'live_capture', 'manual_live', 'idem-key-capture-0001')$$,
  '23505',
  null,
  'A retried submit with the same idempotency key cannot create a second claim'
);

select is(
  (select count(*)::int from public.claims where idempotency_key = 'idem-key-capture-0001'),
  1,
  'Exactly one claim exists for the reused idempotency key'
);

-- Two staff capturing the same item for DIFFERENT customers is NOT a duplicate:
-- that is a 1st and 2nd miner, and it is allowed (§19.7).
select lives_ok(
  $$insert into public.claims
      (live_batch_id, inventory_item_id, customer_id, status, intake_kind, capture_method, idempotency_key)
    values ('bbbbbbbb-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000032',
            'pending_claim', 'live_capture', 'manual_live', 'idem-key-capture-0002')$$,
  'A second customer may claim the same item — that is a 2nd miner, not a duplicate'
);

-- Null idempotency keys must not collide with each other.
select lives_ok(
  $$insert into public.claims
      (live_batch_id, inventory_item_id, customer_id, status, intake_kind, capture_method)
    values ('bbbbbbbb-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000032', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'live_capture', 'manual_live')$$,
  'A claim without an idempotency key is permitted and does not collide'
);

-- ============================================================================
-- RULE: source markers must agree with intake kind (§13.2)
-- ============================================================================
select throws_ok(
  $$insert into public.claims
      (live_batch_id, inventory_item_id, customer_id, status, intake_kind, capture_method)
    values ('bbbbbbbb-0000-0000-0000-000000000031',
            '11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'live_capture', 'post_live_manual')$$,
  '23514',
  null,
  'A live capture cannot carry the post-live source marker'
);

select throws_ok(
  $$insert into public.claims
      (inventory_item_id, customer_id, status, intake_kind, capture_method)
    values ('11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'live_capture', 'manual_live')$$,
  '23514',
  null,
  'A live capture without a Live Batch is rejected'
);

select lives_ok(
  $$insert into public.claims
      (inventory_item_id, customer_id, status, intake_kind, capture_method, idempotency_key)
    values ('11111111-0000-0000-0000-000000000032', 'cccccccc-0000-0000-0000-000000000032',
            'pending_claim', 'post_live_manual', 'post_live_manual', 'idem-key-postlive-01')$$,
  'Manual Post-Live Entry creates a Pending Claim without a Live Batch'
);

-- Migration stays separate from capture (§12.3).
select throws_ok(
  $$insert into public.claims
      (inventory_item_id, customer_id, status, intake_kind, capture_method, source_kind)
    values ('11111111-0000-0000-0000-000000000031', 'cccccccc-0000-0000-0000-000000000031',
            'pending_claim', 'post_live_manual', 'post_live_manual', 'migrated')$$,
  '23514',
  null,
  'A migrated record cannot wear a capture source marker'
);

-- ============================================================================
-- RULE: switching the Current Flex Item affects FUTURE capture only (§12)
-- ============================================================================
select is(
  (select captured_against_flex_item from public.claims
    where id = 'dddddddd-0000-0000-0000-000000000031'),
  false,
  'captured_against_flex_item defaults false and is set explicitly at capture'
);

update public.claims set captured_against_flex_item = true
  where id = 'dddddddd-0000-0000-0000-000000000031';

-- Switch the flex pointer to the OTHER item.
update public.live_batch_items set is_current_flex_item = false
  where id = 'eeeeeeee-0000-0000-0000-000000000031';
update public.live_batch_items set is_current_flex_item = true
  where id = 'eeeeeeee-0000-0000-0000-000000000032';

select is(
  (select live_batch_item_id from public.claims
    where id = 'dddddddd-0000-0000-0000-000000000031'),
  'eeeeeeee-0000-0000-0000-000000000031'::uuid,
  'An existing claim still points at the item that was current when it was captured'
);

select is(
  (select captured_against_flex_item from public.claims
    where id = 'dddddddd-0000-0000-0000-000000000031'),
  true,
  'Switching the Current Flex Item does not rewrite an existing claim''s attribution'
);

-- At most ONE Current Flex Item per batch (Phase 1 partial unique index).
select throws_ok(
  $$update public.live_batch_items set is_current_flex_item = true
      where id = 'eeeeeeee-0000-0000-0000-000000000031'$$,
  '23505',
  null,
  'A Live Batch cannot have two Current Flex Items'
);

-- ============================================================================
-- RULE: evidence is stored, never interpreted (§13.2)
-- ============================================================================
select lives_ok(
  $$insert into public.claim_evidence (claim_id, evidence_kind, storage_path, content_type)
    values ('dddddddd-0000-0000-0000-000000000031', 'screenshot',
            'private/claims/p3-fixture-screenshot.jpg', 'image/jpeg')$$,
  'A screenshot may be attached to a claim as evidence'
);

select throws_ok(
  $$insert into public.claim_evidence (claim_id, evidence_kind)
    values ('dddddddd-0000-0000-0000-000000000031', 'screenshot')$$,
  '23514',
  null,
  'A screenshot attachment without a stored object is rejected'
);

select * from finish();
rollback;
