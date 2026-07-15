-- ============================================================================
-- Phase 8 — Inventory Ops, Returned-to-Stock, Customers & Migration (§19, §10)
-- ============================================================================
begin;
select plan(20);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role)
values ('88888888-8888-8888-8888-888888888888', '00000000-0000-0000-0000-000000000000',
        'phase8-staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-0000-0000-0000-000000000081', '88888888-8888-8888-8888-888888888888',
        'Phase8 Fixture Staff', 'staff');

insert into public.customers (id, display_name)
values ('cccccccc-0000-0000-0000-000000000081', 'Phase8 Customer'),
       ('cccccccc-0000-0000-0000-000000000082', 'Phase 8 Customer');  -- possible dupe

insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total)
values ('11111111-0000-0000-0000-000000000081', 'P8-A', 'Ring 21K', true, 1),
       ('11111111-0000-0000-0000-000000000082', 'P8-B', 'Ring 18K', true, 1);

-- ============================================================================
-- RULE: stock returns ONLY via an approved RTS review (Bible §19, §22.3)
-- ============================================================================
update public.inventory_items set availability_status = 'held_unavailable'
where id = '11111111-0000-0000-0000-000000000081';

select throws_ok(
  $$update public.inventory_items set availability_status = 'available'
      where id = '11111111-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'An item cannot be flipped back to available without an approved review'
);

select throws_ok(
  $$update public.inventory_items set availability_status = 'returned_to_available'
      where id = '11111111-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'returned_to_available is equally gated — no back door'
);

insert into public.returned_to_stock_reviews
  (id, inventory_item_id, trigger_kind, status, quantity)
values ('5f5f5f5f-0000-0000-0000-000000000081', '11111111-0000-0000-0000-000000000081',
        'order_cancelled', 'in_review', 1);

-- An in-review record still returns nothing: eligibility is not approval.
select throws_ok(
  $$update public.inventory_items set availability_status = 'available'
      where id = '11111111-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'A review that is still in_review returns nothing — eligibility is not approval'
);

-- ============================================================================
-- RULE: a decided review is attributed and records the freed-unit outcome
-- ============================================================================
select throws_ok(
  $$update public.returned_to_stock_reviews set status = 'approved_return'
      where id = '5f5f5f5f-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'A decided review must record who reviewed it and when'
);

select throws_ok(
  $$update public.returned_to_stock_reviews
      set status = 'approved_return', reviewed_at = now(),
          reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000081'
      where id = '5f5f5f5f-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'A decided review must record what happened to the freed unit'
);

select lives_ok(
  $$update public.returned_to_stock_reviews
      set status = 'approved_return', reviewed_at = now(),
          reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000081',
          freed_unit_outcome = 'returned_to_available'
      where id = '5f5f5f5f-0000-0000-0000-000000000081'$$,
  'An attributed review recording the freed-unit outcome may approve the return'
);

select lives_ok(
  $$update public.inventory_items set availability_status = 'available'
      where id = '11111111-0000-0000-0000-000000000081'$$,
  'An approved review permits the return to available'
);

-- ============================================================================
-- RULE: a decision is final; a rejected review holds the unit
-- ============================================================================
select throws_ok(
  $$update public.returned_to_stock_reviews set status = 'rejected_held'
      where id = '5f5f5f5f-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'A decided review cannot be re-decided'
);

insert into public.returned_to_stock_reviews
  (id, inventory_item_id, trigger_kind, status, quantity)
values ('5f5f5f5f-0000-0000-0000-000000000082', '11111111-0000-0000-0000-000000000082',
        'claim_rejected', 'in_review', 1);

select throws_ok(
  $$update public.returned_to_stock_reviews
      set status = 'rejected_held', reviewed_at = now(),
          reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000081',
          freed_unit_outcome = 'returned_to_available'
      where id = '5f5f5f5f-0000-0000-0000-000000000082'$$,
  '23514',
  null,
  'A rejected review cannot claim the unit returned to available'
);

select lives_ok(
  $$update public.returned_to_stock_reviews
      set status = 'rejected_held', reviewed_at = now(),
          reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000081',
          freed_unit_outcome = 'held_unavailable'
      where id = '5f5f5f5f-0000-0000-0000-000000000082'$$,
  'A rejected review holds the unit'
);

-- ============================================================================
-- RULE: an approved review is a REVIEW, not an allocation (Bible §19)
-- ============================================================================
select is(
  (select count(*)::int from public.miner_positions
    where inventory_item_id = '11111111-0000-0000-0000-000000000081'),
  0,
  'Approving a return promotes no 2nd miner automatically'
);

select is(
  (select count(*)::int from public.waitlist_entries
    where inventory_item_id = '11111111-0000-0000-0000-000000000081'),
  0,
  'Approving a return allocates nothing from the waitlist automatically'
);

-- ============================================================================
-- RULE: no automatic customer merge (Bible §22.15)
-- ============================================================================
insert into public.customer_duplicate_references
  (id, customer_id, possible_duplicate_customer_id, status)
values ('d0000000-0000-0000-0000-000000000081', 'cccccccc-0000-0000-0000-000000000081',
        'cccccccc-0000-0000-0000-000000000082', 'open');

select throws_ok(
  $$update public.customer_duplicate_references set status = 'reviewed_duplicate'
      where id = 'd0000000-0000-0000-0000-000000000081'$$,
  '23514',
  null,
  'A duplicate review must record who reviewed it and when'
);

select lives_ok(
  $$update public.customer_duplicate_references
      set status = 'reviewed_duplicate', reviewed_at = now(),
          reviewed_by = 'aaaaaaaa-0000-0000-0000-000000000081'
      where id = 'd0000000-0000-0000-0000-000000000081'$$,
  'A duplicate may be judged a duplicate by an attributed reviewer'
);

-- Concluding "duplicate" must merge NOTHING.
select is(
  (select count(*)::int from public.customers
    where id in ('cccccccc-0000-0000-0000-000000000081', 'cccccccc-0000-0000-0000-000000000082')),
  2,
  'Judging two customers duplicates merges nothing — both records still stand'
);

-- ============================================================================
-- RULE: migration preserves its source (Bible §22.16)
-- ============================================================================
select throws_ok(
  $$insert into public.customers (display_name, source_kind)
    values ('Fake Migrated', 'migrated')$$,
  '23514',
  null,
  'A migrated record without its batch is rejected'
);

insert into public.migration_batches (id, label, source_description, status, imported_by)
values ('b0000000-0000-0000-0000-000000000081', 'Phase8 Batch', 'Legacy notebook',
        'in_progress', 'aaaaaaaa-0000-0000-0000-000000000081');

select lives_ok(
  $$insert into public.customers (display_name, source_kind, migration_batch_id)
    values ('Real Migrated', 'migrated', 'b0000000-0000-0000-0000-000000000081')$$,
  'A migrated record carrying its batch is accepted'
);

select throws_ok(
  $$insert into public.customers (display_name, source_kind, migration_batch_id)
    values ('Native Pretender', 'native', 'b0000000-0000-0000-0000-000000000081')$$,
  '23514',
  null,
  'A native record cannot claim a migration batch'
);

-- ============================================================================
-- RULE: inventory monitoring derives availability (Bible §20.3)
-- ============================================================================
select is(
  (select available_quantity from public.inventory_monitor()
    where inventory_item_id = '11111111-0000-0000-0000-000000000081'),
  1,
  'Inventory monitoring derives available quantity from reservations'
);

select is(
  (select in_rts_review from public.inventory_monitor()
    where inventory_item_id = '11111111-0000-0000-0000-000000000082'),
  false,
  'A decided review no longer counts as in review'
);

select * from finish();
rollback;
