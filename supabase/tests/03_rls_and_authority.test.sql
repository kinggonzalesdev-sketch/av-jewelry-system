-- ============================================================================
-- RLS posture, Owner-only authority, audit append-only, miner ceiling
-- Bible §5.4, §5.13, §22.6, §22.14, §31; ADR §7/§8
-- ============================================================================
begin;
select plan(31);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('33333333-3333-3333-3333-333333333331', '00000000-0000-0000-0000-000000000000', 'owner@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333332', '00000000-0000-0000-0000-000000000000', 'admin1@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333333', '00000000-0000-0000-0000-000000000000', 'admin2@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333334', '00000000-0000-0000-0000-000000000000', 'admin3@test.local', 'authenticated', 'authenticated'),
  ('33333333-3333-3333-3333-333333333335', '00000000-0000-0000-0000-000000000000', 'staff@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key) values
  ('aaaaaaaa-1111-0000-0000-000000000001', '33333333-3333-3333-3333-333333333331', 'Test Owner', 'owner'),
  ('aaaaaaaa-1111-0000-0000-000000000005', '33333333-3333-3333-3333-333333333335', 'Test Staff', 'staff');

-- ============================================================================
-- RLS: enabled and FORCED on every business table (Phase 1 deny-by-default)
-- ============================================================================
select is(
  (select count(*)::int from pg_tables t
   where t.schemaname = 'public' and t.rowsecurity = false),
  0,
  'RLS is enabled on every table in the public schema'
);

select is(
  (select count(*)::int
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relforcerowsecurity = false),
  0,
  'RLS is FORCED on every table (the table owner cannot bypass it either)'
);

-- Phase 2 replaced the deny-by-default posture with permission-aware policies.
-- The guarantee is no longer "no policies" but "no WILDCARD policies".
select ok(
  (select count(*) from pg_policies where schemaname = 'public') > 0,
  'Phase 2 defines permission-aware policies'
);

-- No policy may be an unconditional allow. A `using (true)` or `with check (true)`
-- would hand every authenticated caller the whole table.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and (btrim(coalesce(qual, '')) = 'true' or btrim(coalesce(with_check, '')) = 'true')),
  0,
  'No wildcard policy exists: nothing is granted unconditionally'
);

-- No policy may be granted to anon or to PUBLIC.
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public'
     and (roles::text[] && array['anon', 'public'])),
  0,
  'No policy grants anything to anon or PUBLIC'
);

-- ============================================================================
-- RLS: prove unauthorized access actually FAILS (not merely "is configured")
-- ============================================================================
-- Defense in depth: privileges are REVOKED from anon/authenticated, so access is
-- refused at the privilege layer (42501) BEFORE RLS is even consulted. RLS
-- remains enabled and forced underneath as the last line of defence.
set local role anon;
select throws_ok(
  $$select count(*) from public.customers$$, '42501', null, 'anon cannot read customers');
select throws_ok(
  $$select count(*) from public.claims$$, '42501', null, 'anon cannot read claims');
select throws_ok(
  $$select count(*) from public.official_orders$$, '42501', null, 'anon cannot read official orders');
select throws_ok(
  $$select count(*) from public.payments$$, '42501', null, 'anon cannot read payments');
select throws_ok(
  $$select count(*) from public.staff_profiles$$, '42501', null, 'anon cannot read staff profiles');
select throws_ok(
  $$select count(*) from public.audit_events$$, '42501', null, 'anon cannot read audit events');

select throws_ok(
  $$insert into public.customers (display_name) values ('anon injected')$$,
  '42501',
  null,
  'anon cannot write a customer'
);
reset role;

-- A caller holding the `authenticated` role but NO staff profile (no JWT sub
-- matching a staff row) is authenticated but not authorized. Phase 2 grants table
-- privileges so RLS can be consulted, so these now return ZERO ROWS rather than
-- raising — the data is filtered by policy, which is the intended behaviour.
set local role authenticated;
select is(
  (select count(*)::int from public.customers),
  0,
  'a merely-authenticated non-staff user reads no business data (authentication is not authorization)'
);
select is(
  (select count(*)::int from public.inventory_items), 0, 'authenticated non-staff reads no inventory');

select throws_ok(
  $$insert into public.claims (inventory_item_id, customer_id)
    values (gen_random_uuid(), gen_random_uuid())$$,
  '42501',
  null,
  'a merely-authenticated user cannot write a claim'
);

-- Self-promotion matches no row under the Owner-only policy, so it changes
-- nothing. Silent no-op is the correct outcome: no record was altered.
select lives_ok(
  $$update public.staff_profiles set role_key = 'owner'$$,
  'a self-promotion attempt raises nothing'
);
select is(
  (select count(*)::int from public.staff_profiles where role_key = 'owner'),
  0,
  'a merely-authenticated user cannot self-promote to Owner: no row was changed'
);
reset role;

-- ============================================================================
-- RULE: maximum two Selected Admin accounts (Bible §5.4)
-- ============================================================================
insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-1111-0000-0000-000000000002', '33333333-3333-3333-3333-333333333332', 'Admin One', 'selected_admin');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key)
values ('aaaaaaaa-1111-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333', 'Admin Two', 'selected_admin');

select is(
  (select count(*)::int from public.staff_profiles where role_key = 'selected_admin' and is_active),
  2,
  'Two Selected Admin accounts are permitted'
);

select throws_ok(
  $$insert into public.staff_profiles (auth_user_id, full_name, role_key)
    values ('33333333-3333-3333-3333-333333333334', 'Admin Three', 'selected_admin')$$,
  '23514',
  null,
  'A THIRD Selected Admin is rejected (Bible §5.4)'
);

-- Promoting an existing staff member beyond the cap is equally rejected.
select throws_ok(
  $$update public.staff_profiles set role_key = 'selected_admin'
    where id = 'aaaaaaaa-1111-0000-0000-000000000005'$$,
  '23514',
  null,
  'Promoting a third account to Selected Admin is rejected'
);

-- Deactivating one frees a slot: the cap counts ACTIVE admins.
update public.staff_profiles
set is_active = false, deactivated_at = now()
where id = 'aaaaaaaa-1111-0000-0000-000000000003';

select lives_ok(
  $$update public.staff_profiles set role_key = 'selected_admin'
    where id = 'aaaaaaaa-1111-0000-0000-000000000005'$$,
  'A slot freed by deactivation allows another Selected Admin'
);

-- Deactivation preserves the record: attribution survives (Bible §31).
select is(
  (select count(*)::int from public.staff_profiles where id = 'aaaaaaaa-1111-0000-0000-000000000003'),
  1,
  'A deactivated account is retained, never deleted: attribution survives'
);

-- ============================================================================
-- RULE: only the Owner may decide an Owner Approval Request (§5.13, §22.14)
-- ============================================================================
insert into public.owner_approval_requests
  (id, action_kind, entity_type, entity_id, reason, requested_by)
values ('77777777-0000-0000-0000-000000000001', 'official_order_cancellation',
        'official_order', gen_random_uuid(), 'test reason', 'aaaaaaaa-1111-0000-0000-000000000005');

select is(
  (select status from public.owner_approval_requests where id = '77777777-0000-0000-0000-000000000001'),
  'pending_owner_approval',
  'A new request starts Pending Owner Approval and executes nothing'
);

-- A Selected Admin cannot approve: these approvals are non-delegable.
select throws_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = 'aaaaaaaa-1111-0000-0000-000000000002'
    where id = '77777777-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'A Selected Admin cannot decide an Owner Approval Request (non-delegable)'
);

-- Staff cannot approve either — role title is not authority.
select throws_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = 'aaaaaaaa-1111-0000-0000-000000000005'
    where id = '77777777-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'Staff cannot decide an Owner Approval Request'
);

-- The Owner can.
select lives_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = 'aaaaaaaa-1111-0000-0000-000000000001'
    where id = '77777777-0000-0000-0000-000000000001'$$,
  'The Owner may decide an Owner Approval Request'
);

-- Execution cannot precede approval.
insert into public.owner_approval_requests
  (id, action_kind, entity_type, entity_id, reason, requested_by)
values ('77777777-0000-0000-0000-000000000002', 'layaway_forfeiture',
        'layaway', gen_random_uuid(), 'test', 'aaaaaaaa-1111-0000-0000-000000000005');

select throws_ok(
  $$update public.owner_approval_requests
    set executed_at = now(), executed_by = 'aaaaaaaa-1111-0000-0000-000000000001'
    where id = '77777777-0000-0000-0000-000000000002'$$,
  '23514',
  null,
  'A pending request cannot be executed: approval and execution are separate'
);

-- ============================================================================
-- RULE: audit events are append-only (Bible §31)
-- ============================================================================
insert into public.audit_events (id, actor_auth_uid, actor_label, action, entity_type, entity_id)
values ('88888888-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333331',
        'Test Owner', 'test.action', 'claim', gen_random_uuid());

select throws_ok(
  $$update public.audit_events set action = 'tampered'
    where id = '88888888-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'Audit events cannot be updated'
);

select throws_ok(
  $$delete from public.audit_events where id = '88888888-0000-0000-0000-000000000001'$$,
  '42501',
  null,
  'Audit events cannot be deleted: attribution cannot be erased'
);

-- ============================================================================
-- RULE: only 1st and 2nd Miner; no 3rd (Bible §4.9-A)
-- ============================================================================
insert into public.customers (id, display_name) values ('cccccccc-1111-0000-0000-000000000001', 'Miner Cust');
insert into public.inventory_items (id, item_code, is_unique_item, quantity_total)
values ('11111111-1111-0000-0000-000000000001', 'MINER-ITEM', true, 1);
insert into public.claims (id, inventory_item_id, customer_id) values
  ('dddddddd-1111-0000-0000-000000000001', '11111111-1111-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001'),
  ('dddddddd-1111-0000-0000-000000000002', '11111111-1111-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001'),
  ('dddddddd-1111-0000-0000-000000000003', '11111111-1111-0000-0000-000000000001', 'cccccccc-1111-0000-0000-000000000001');

insert into public.miner_positions (inventory_item_id, claim_id, position) values
  ('11111111-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000001', 1),
  ('11111111-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000002', 2);

select throws_ok(
  $$insert into public.miner_positions (inventory_item_id, claim_id, position)
    values ('11111111-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000003', 3)$$,
  '23514',
  null,
  'A 3rd Miner is unrepresentable (Bible §4.9-A)'
);

select throws_ok(
  $$insert into public.miner_positions (inventory_item_id, claim_id, position)
    values ('11111111-1111-0000-0000-000000000001', 'dddddddd-1111-0000-0000-000000000003', 1)$$,
  '23505',
  null,
  'The 1st Miner slot cannot be occupied twice'
);

select * from finish();
rollback;
