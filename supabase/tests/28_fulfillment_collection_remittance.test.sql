-- ============================================================================
-- #3 deeper — COD collection & remittance constraints (migration 20260721110000).
-- ----------------------------------------------------------------------------
-- The database is the authority: money is only collected on a COD order, a
-- collection carries who + amount + channel together, remittance never precedes
-- collection, and a collected-but-not-remitted amount surfaces in the report.
-- CHECK constraints fire regardless of role, so the fixture is built directly.
-- ============================================================================
begin;
select plan(9);

-- ---- Fixtures: the shallow order chain a fulfillment record needs ----------
insert into public.customers (id, display_name)
values ('dd000000-0000-0000-0000-0000000000c1', 'Collect Customer');

insert into public.invoice_drafts (id, customer_id)
values ('dd100000-0000-0000-0000-0000000000c1', 'dd000000-0000-0000-0000-0000000000c1');

insert into public.official_orders (id, invoice_draft_id, customer_id)
values ('dd200000-0000-0000-0000-0000000000c1',
        'dd100000-0000-0000-0000-0000000000c1',
        'dd000000-0000-0000-0000-0000000000c1');

insert into auth.users (id, instance_id, email, aud, role)
values ('dd000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000',
        'collector@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active)
values ('dd300000-0000-0000-0000-0000000000c1',
        'dd000000-0000-0000-0000-0000000000a1', 'Collector', 'staff', true);

insert into public.fulfillment_records (id, official_order_id, status, is_cod)
values ('dd400000-0000-0000-0000-0000000000c1',
        'dd200000-0000-0000-0000-0000000000c1', 'dispatched', false);

-- ============================================================================
-- 1. The constraints exist.
-- ============================================================================
select ok(
  (select count(*) >= 6 from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   where t.relname = 'fulfillment_records'
     and c.conname in (
       'fulfillment_collection_channel_ck',
       'fulfillment_collected_pairing_ck',
       'fulfillment_collected_amount_ck',
       'fulfillment_collected_requires_cod_ck',
       'fulfillment_collected_requires_channel_ck',
       'fulfillment_remitted_pairing_ck',
       'fulfillment_remitted_after_collected_ck'
     )),
  'the collection/remittance CHECK constraints exist'
);

-- ============================================================================
-- 2. Collection is refused on a NON-COD order.
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records
      set collected_at = now(), collected_by = 'dd300000-0000-0000-0000-0000000000c1',
          collected_amount = 1500, collection_channel = 'rider'
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  '23514',
  null,
  'collection is refused on a non-COD order'
);

-- Make it COD for the rest.
update public.fulfillment_records set is_cod = true
  where id = 'dd400000-0000-0000-0000-0000000000c1';

-- ============================================================================
-- 3. An unknown channel is refused.
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records set collection_channel = 'grab'
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  '23514',
  null,
  'an unknown collection channel is refused'
);

-- ============================================================================
-- 4. Remittance is refused before collection.
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records
      set remitted_at = now(), remitted_by = 'dd300000-0000-0000-0000-0000000000c1'
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  '23514',
  null,
  'remittance is refused before collection'
);

-- ============================================================================
-- 5. Collection without a channel is refused.
-- ============================================================================
select throws_ok(
  $$update public.fulfillment_records
      set collected_at = now(), collected_by = 'dd300000-0000-0000-0000-0000000000c1',
          collected_amount = 1500
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  '23514',
  null,
  'collection without a channel is refused'
);

-- ============================================================================
-- 6. A complete, valid collection is accepted.
-- ============================================================================
select lives_ok(
  $$update public.fulfillment_records
      set collected_at = now(), collected_by = 'dd300000-0000-0000-0000-0000000000c1',
          collected_amount = 1500, collection_channel = 'rider'
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  'a complete, valid collection is accepted'
);

-- ============================================================================
-- 7. The collected amount now shows in collected_unremitted (as a string).
-- ============================================================================
select is(
  (public.report_money_in_transit()) ->> 'collected_unremitted',
  '1500.00',
  'a collected-but-not-remitted amount surfaces in the report'
);

-- ============================================================================
-- 8. Remittance is now accepted (collection exists).
-- ============================================================================
select lives_ok(
  $$update public.fulfillment_records
      set remitted_at = now(), remitted_by = 'dd300000-0000-0000-0000-0000000000c1'
    where id = 'dd400000-0000-0000-0000-0000000000c1'$$,
  'remittance is accepted once the money has been collected'
);

-- ============================================================================
-- 9. Once remitted, it leaves collected_unremitted.
-- ============================================================================
select is(
  (public.report_money_in_transit()) ->> 'collected_unremitted',
  '0',
  'a remitted amount is no longer counted as collected-unremitted'
);

select * from finish();
rollback;
