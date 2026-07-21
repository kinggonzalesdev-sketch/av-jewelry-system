-- ============================================================================
-- Item custody & location (migration 20260717100000).
-- ----------------------------------------------------------------------------
-- Custody is a property of the item: who holds it (A.V. Jewelry / financer) and
-- where. Updatable only by the existing inventory_items_update policy
-- (inventory_monitoring / item_withdrawal / live_batch_operation). The check
-- constraint and the RLS gate are what matter; both are asserted with a real JWT.
-- ============================================================================
begin;
select plan(10);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('cf000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'cust-monitor@test.local', 'authenticated', 'authenticated'),
  ('cf000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-000000000000',
   'cust-noperm@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('cf100000-0000-0000-0000-0000000000d1', 'cf000000-0000-0000-0000-0000000000d1',
   'Custody Monitor', 'staff', true),
  ('cf100000-0000-0000-0000-0000000000d2', 'cf000000-0000-0000-0000-0000000000d2',
   'Custody NoPerm', 'staff', true);

insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('cf100000-0000-0000-0000-0000000000d1', 'inventory_monitoring');

insert into public.inventory_items
  (id, item_code, item_name, is_unique_item, quantity_total, grams_per_piece, total_price_per_piece)
values ('c1000000-0000-0000-0000-0000000000d1', 'CUST-01', 'Custody Ring', true, 1, 5.000, 10000.00);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- 1-3. The columns exist.
-- ============================================================================
select has_column('public', 'inventory_items', 'custody_holder', 'custody_holder column exists');
select has_column('public', 'inventory_items', 'storage_location', 'storage_location column exists');
select has_column('public', 'inventory_items', 'custody_handler_id', 'custody_handler_id column exists');

-- ============================================================================
-- 4. Default is av_jewelry (a not-yet-set item is assumed on-hand).
-- ============================================================================
select is(
  (select custody_holder from public.inventory_items
   where id = 'c1000000-0000-0000-0000-0000000000d1'),
  'av_jewelry',
  'custody_holder defaults to av_jewelry'
);

-- ============================================================================
-- 5. UPDATE privilege is granted to authenticated (the policy is reachable).
-- ============================================================================
select ok(
  has_table_privilege('authenticated', 'public.inventory_items', 'update'),
  'inventory_items: UPDATE granted to authenticated — the custody policy is reachable'
);

-- ============================================================================
-- 6. A staff member WITH inventory_monitoring can set custody.
-- ============================================================================
select pg_temp.act_as('cf000000-0000-0000-0000-0000000000d1');
update public.inventory_items
  set custody_holder = 'financer', storage_location = 'Financer vault A'
  where id = 'c1000000-0000-0000-0000-0000000000d1';
reset role;

select is(
  (select custody_holder from public.inventory_items
   where id = 'c1000000-0000-0000-0000-0000000000d1'),
  'financer',
  'inventory_monitoring can move an item to financer custody'
);
select is(
  (select storage_location from public.inventory_items
   where id = 'c1000000-0000-0000-0000-0000000000d1'),
  'Financer vault A',
  'inventory_monitoring can set the storage location'
);

-- ============================================================================
-- 7. A staff member WITHOUT the permission changes nothing (RLS: 0 rows).
-- ============================================================================
select pg_temp.act_as('cf000000-0000-0000-0000-0000000000d2');
update public.inventory_items
  set custody_holder = 'av_jewelry'
  where id = 'c1000000-0000-0000-0000-0000000000d1';
reset role;

select is(
  (select custody_holder from public.inventory_items
   where id = 'c1000000-0000-0000-0000-0000000000d1'),
  'financer',
  'a staff member without inventory_monitoring cannot change custody (RLS refuses)'
);

-- ============================================================================
-- 8. The check constraint rejects an invalid custody holder.
-- ============================================================================
select pg_temp.act_as('cf000000-0000-0000-0000-0000000000d1');
select throws_ok(
  $$update public.inventory_items set custody_holder = 'pawnshop'
    where id = 'c1000000-0000-0000-0000-0000000000d1'$$,
  '23514',
  null,
  'custody_holder rejects any value outside {av_jewelry, financer}'
);
reset role;

-- ============================================================================
-- 9. anon cannot update.
-- ============================================================================
set local role anon;
select is(
  has_table_privilege('anon', 'public.inventory_items', 'update'),
  false,
  'anon holds no update on inventory_items'
);
reset role;

select * from finish();
rollback;
