-- ============================================================================
-- Inventory safe delete & archive (Inventory Safe-Delete spec §1–§9).
--
-- Proves, through the REAL guarded functions under real staff JWTs:
--   * archive is soft, reversible, permission-gated, and removes the item from
--     Active Inventory + availability (never oversell);
--   * archive is blocked for sold/completed items and for in-flight links;
--   * restore returns the item to its prior status and is duplicate-code guarded;
--   * permanent delete is Owner-only, needs the item archived AND dependency-free.
-- ============================================================================
begin;
select plan(25);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('a9000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'arch-owner@test.local', 'authenticated', 'authenticated'),
  ('a9000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'arch-mon@test.local', 'authenticated', 'authenticated'),
  ('a9000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000',
   'arch-noperm@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('a9100000-0000-0000-0000-0000000000f1', 'a9000000-0000-0000-0000-0000000000f1',
   'Arch Owner', 'owner', true),
  ('a9100000-0000-0000-0000-0000000000f2', 'a9000000-0000-0000-0000-0000000000f2',
   'Arch Monitor', 'staff', true),
  ('a9100000-0000-0000-0000-0000000000f3', 'a9000000-0000-0000-0000-0000000000f3',
   'Arch NoPerm', 'staff', true);

-- The monitor staff holds inventory_monitoring, and nothing else.
insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('a9100000-0000-0000-0000-0000000000f2', 'inventory_monitoring');

insert into public.customers (id, display_name) values
  ('a9200000-0000-0000-0000-0000000000f1', 'Archive Customer');

insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, availability_status) values
  ('a9300000-0000-0000-0000-0000000000f1', 'ARCH-01', 'Plain Ring', true, 1, 'available'),
  ('a9300000-0000-0000-0000-0000000000f2', 'ARCH-02', 'Sold Ring', true, 1, 'sold_released'),
  ('a9300000-0000-0000-0000-0000000000f3', 'ARCH-03', 'Reserved Ring', true, 1, 'available'),
  ('a9300000-0000-0000-0000-0000000000f4', 'ARCH-04', 'Claimed Ring', true, 1, 'available');

-- Reserved item: an in-review Returned-to-Stock review → an in-flight link
-- (is_active), which the dependency reader flags and archive refuses.
insert into public.returned_to_stock_reviews
  (id, inventory_item_id, trigger_kind, status, quantity) values
  ('a9500000-0000-0000-0000-0000000000f3', 'a9300000-0000-0000-0000-0000000000f3',
   'order_cancelled', 'in_review', 1);

-- Claimed item: a bare claim (no order) → dependency, but NOT in-flight.
insert into public.claims (id, inventory_item_id, customer_id, status, quantity) values
  ('a9400000-0000-0000-0000-0000000000f4', 'a9300000-0000-0000-0000-0000000000f4',
   'a9200000-0000-0000-0000-0000000000f1', 'pending_claim', 1);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

create or replace function pg_temp.as_postgres()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ============================================================================
-- A. Schema
-- ============================================================================
select has_column('public', 'inventory_items', 'is_archived',
  'inventory_items gained an is_archived soft-delete flag');
select has_column('public', 'inventory_items', 'archive_reason_code',
  'inventory_items gained an archive_reason_code');

-- Flipping is_archived on without the who/when/why is refused by the constraint.
select throws_ok(
  $$update public.inventory_items set is_archived = true
      where id = 'a9300000-0000-0000-0000-0000000000f1'$$,
  '23514', null,
  'is_archived cannot be set true without archived_at / by / reason'
);

-- ============================================================================
-- B. Archive — permission gate + happy path
-- ============================================================================
select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f3');  -- noperm
select throws_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f1',
      'incorrectly_encoded', null)$$,
  'P0001', null,
  'A staff member without inventory_monitoring cannot archive'
);

select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f2');  -- monitor
select lives_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f1',
      'incorrectly_encoded', null)$$,
  'A monitor archives an incorrectly-encoded item'
);

select pg_temp.as_postgres();
select is(
  app_private.available_quantity('a9300000-0000-0000-0000-0000000000f1'), 0,
  'An archived item is never available (available_quantity = 0)'
);
select is(
  (select count(*)::int from public.inventory_monitor()
     where inventory_item_id = 'a9300000-0000-0000-0000-0000000000f1'), 0,
  'An archived item is excluded from Active Inventory (inventory_monitor)'
);
select is(
  (select is_archived from public.inventory_items
     where id = 'a9300000-0000-0000-0000-0000000000f1'), true,
  'The item row is marked archived'
);
select is(
  (select archived_by from public.inventory_items
     where id = 'a9300000-0000-0000-0000-0000000000f1'),
  'a9100000-0000-0000-0000-0000000000f2'::uuid,
  'Archive attributes the acting monitor as archived_by'
);

-- ============================================================================
-- C. Archive guards
-- ============================================================================
select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f2');  -- monitor

select throws_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f2',
      'incorrectly_encoded', null)$$,
  'P0001', null,
  'A sold/released item cannot be archived as an encoding error'
);
select throws_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f3',
      'incorrectly_encoded', null)$$,
  'P0001', null,
  'An item with an active reservation cannot be archived (in-flight)'
);
select throws_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f4',
      'other', '   ')$$,
  'P0001', null,
  'Reason "other" requires a written explanation'
);
select throws_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f1',
      'incorrectly_encoded', null)$$,
  'P0001', null,
  'An already-archived item cannot be archived again'
);

-- ============================================================================
-- D. Restore
-- ============================================================================
select lives_ok(
  $$select public.restore_inventory_item('a9300000-0000-0000-0000-0000000000f1')$$,
  'A monitor restores the archived item'
);

select pg_temp.as_postgres();
select is(
  (select is_archived from public.inventory_items
     where id = 'a9300000-0000-0000-0000-0000000000f1'), false,
  'The restored item is no longer archived'
);
select is(
  app_private.available_quantity('a9300000-0000-0000-0000-0000000000f1'), 1,
  'The restored item returns to its prior available status'
);

-- Duplicate-code guard: archive again, then a NEW active item takes its code.
select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f2');
select lives_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f1',
      'duplicate_entry', null)$$,
  'Re-archive the item to test the duplicate-code restore guard'
);
select pg_temp.as_postgres();
insert into public.inventory_items (id, item_code, item_name, is_unique_item, quantity_total)
values ('a9300000-0000-0000-0000-0000000000f9', 'ARCH-01', 'Reused code', true, 1);

select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f2');
select throws_ok(
  $$select public.restore_inventory_item('a9300000-0000-0000-0000-0000000000f1')$$,
  'P0001', null,
  'Restore is blocked when another active item now uses the same code'
);

-- ============================================================================
-- E. Dependencies + permanent delete
-- ============================================================================
select is(
  (select count(*)::int
     from public.inventory_item_dependencies('a9300000-0000-0000-0000-0000000000f4')),
  1,
  'The claimed item reports its business dependency'
);

-- Archive the claimed item (a bare claim is not in-flight, so archive is allowed).
select lives_ok(
  $$select public.archive_inventory_item('a9300000-0000-0000-0000-0000000000f4',
      'wrong_excel_import', null)$$,
  'An item with only a bare claim can still be archived (reversible)'
);

-- Permanent delete: Owner-only.
select throws_ok(
  $$select public.permanently_delete_inventory_item('a9300000-0000-0000-0000-0000000000f1')$$,
  'P0001', null,
  'A non-Owner cannot permanently delete, even with inventory_monitoring'
);

select pg_temp.act_as('a9000000-0000-0000-0000-0000000000f1');  -- owner
select throws_ok(
  $$select public.permanently_delete_inventory_item('a9300000-0000-0000-0000-0000000000f3')$$,
  'P0001', null,
  'A not-yet-archived item cannot be permanently deleted (archive first)'
);
select throws_ok(
  $$select public.permanently_delete_inventory_item('a9300000-0000-0000-0000-0000000000f4')$$,
  'P0001', null,
  'An archived item WITH a dependency cannot be permanently deleted'
);
select lives_ok(
  $$select public.permanently_delete_inventory_item('a9300000-0000-0000-0000-0000000000f1')$$,
  'The Owner permanently deletes an archived, dependency-free item'
);

select pg_temp.as_postgres();
select is(
  (select count(*)::int from public.inventory_items
     where id = 'a9300000-0000-0000-0000-0000000000f1'), 0,
  'The permanently-deleted row is gone'
);

select * from finish();
rollback;
