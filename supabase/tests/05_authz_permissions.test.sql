-- ============================================================================
-- Phase 2 — Permission-aware authorization, proved as real users
-- ----------------------------------------------------------------------------
-- These tests impersonate real JWTs (role=authenticated + a sub claim) so RLS
-- evaluates exactly as it would in production. Nothing here uses the service
-- role to shortcut a check.
-- ============================================================================
begin;
select plan(33);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'owner@t.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'admin@t.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'staff@t.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'inactive@t.local', 'authenticated', 'authenticated'),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'nogrants@t.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('50000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'The Owner', 'owner', true),
  ('50000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'An Admin', 'selected_admin', true),
  ('50000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000003', 'A Staff', 'staff', true),
  ('50000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000005', 'No Grants', 'staff', true);

-- Deactivated account, created active then deactivated (the constraint requires it).
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active)
values ('50000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Inactive Staff', 'staff', true);
update public.staff_profiles set is_active = false, deactivated_at = now()
where id = '50000000-0000-0000-0000-000000000004';

-- Grants. Note the Owner is given NO grants on purpose: this proves that the
-- Owner ROLE does not silently confer operational permissions.
insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('50000000-0000-0000-0000-000000000003', 'claim_capture'),
  ('50000000-0000-0000-0000-000000000002', 'claim_review'),
  ('50000000-0000-0000-0000-000000000004', 'claim_capture');  -- inactive but granted

insert into public.customers (id, display_name) values
  ('c0000000-0000-0000-0000-000000000001', 'Existing Customer');

-- A real item and a real CONFIRMED claim. These matter: with random UUIDs the
-- Phase 1 reservation trigger would raise a foreign-key error BEFORE RLS was
-- consulted, and the test would pass for the wrong reason. With valid fixtures
-- the trigger is satisfied, so RLS is provably what denies the write.
insert into public.inventory_items (id, item_code, is_unique_item, quantity_total)
values ('10000000-0000-0000-0000-000000000001', 'AUTHZ-ITEM', true, 1);

insert into public.claims (id, inventory_item_id, customer_id, status, confirmed_at)
values ('d0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-000000000001', 'confirmed_claim', now());

-- Helper: impersonate a user exactly as PostgREST does.
create or replace function pg_temp.act_as(p_uid text, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

create or replace function pg_temp.act_as_anon()
returns void language plpgsql as $$
begin
  execute 'set local role anon';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ============================================================================
-- Anonymous access fails
-- ============================================================================
select pg_temp.act_as_anon();
select throws_ok($$select count(*) from public.customers$$, '42501', null,
  'anon cannot read customers');
select throws_ok($$insert into public.customers (display_name) values ('x')$$, '42501', null,
  'anon cannot write customers');
select throws_ok($$select count(*) from public.claims$$, '42501', null,
  'anon cannot read claims');
reset role;

-- ============================================================================
-- ROLE TITLE ALONE GRANTS NOTHING
-- The Owner holds no permission grants. Owner is the highest authority, yet must
-- still hold an explicit grant to perform an operational action (Bible §5.13).
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000001');

select is(app_private.is_owner(), true, 'Owner is recognised as Owner');
select is(app_private.current_staff_role(), 'owner', 'Owner role title reads back');
select is(app_private.has_permission('claim_capture'), false,
  'Owner role alone confers NO claim_capture permission (role title is not authority)');

select throws_ok(
  $$insert into public.claims (inventory_item_id, customer_id)
    values (gen_random_uuid(), 'c0000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'Owner without an explicit grant cannot capture a claim');
reset role;

-- ============================================================================
-- Selected Admin does not automatically receive every permission
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');

select is(app_private.current_staff_role(), 'selected_admin', 'Selected Admin role reads back');
select is(app_private.has_permission('claim_review'), true,
  'Selected Admin holds the claim_review grant it was actually given');
select is(app_private.has_permission('payment_verification'), false,
  'Selected Admin does NOT automatically receive every permission');
select is(app_private.is_owner(), false, 'Selected Admin is not Owner');
reset role;

-- ============================================================================
-- A grant permits ONLY the named action; no permission grants another
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');

select is(app_private.has_permission('claim_capture'), true, 'Staff holds claim_capture');
select is(app_private.has_permission('claim_review'), false,
  'claim_capture does not silently grant claim_review');
select is(app_private.has_permission('confirm_claim_print_label'), false,
  'claim_capture does not silently grant confirm_claim_print_label');

select lives_ok(
  $$insert into public.customers (display_name) values ('Captured Customer')$$,
  'claim_capture permits creating a customer');

-- Reservation requires Confirm Claim & Print Label, which this account lacks.
-- The fixtures are valid, so the Phase 1 trigger is satisfied and RLS is what
-- refuses — proving the permission boundary, not a foreign-key accident.
select throws_ok(
  $$insert into public.inventory_reservations (inventory_item_id, claim_id, quantity)
    values ('10000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', 1)$$,
  '42501', null,
  'claim_capture cannot create an inventory reservation (needs confirm_claim_print_label)');

select is(
  (select count(*)::int from public.inventory_reservations),
  0,
  'The refused reservation left no partial record'
);
reset role;

-- ============================================================================
-- An account with NO grants can read but cannot write
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000005');

select is(app_private.is_active_staff(), true, 'Un-granted staff is still active staff');
select ok(
  (select count(*) from public.customers) >= 1,
  'Active staff with no grants may still READ customers');
select throws_ok(
  $$insert into public.customers (display_name) values ('should fail')$$,
  '42501', null,
  'Active staff with no grants cannot WRITE (authentication is not authorization)');
reset role;

-- ============================================================================
-- INACTIVE STAFF ARE DENIED — even though they still hold a grant
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000004');

select is(app_private.is_active_staff(), false, 'Deactivated account is not active staff');
select is(app_private.has_permission('claim_capture'), false,
  'A deactivated account holds NOTHING despite a surviving grant row');

select throws_ok(
  $$insert into public.customers (display_name) values ('inactive write')$$,
  '42501', null,
  'Deactivated staff cannot write');
select is(
  (select count(*)::int from public.customers),
  0,
  'Deactivated staff reads nothing (loses future access)');
reset role;

-- Attribution survives: the grant row and profile still exist.
select is(
  (select count(*)::int from public.staff_permission_grants
   where staff_profile_id = '50000000-0000-0000-0000-000000000004'),
  1,
  'A deactivated account keeps its history: the grant row is retained, not deleted');

-- ============================================================================
-- Permission REVOCATION removes access immediately
-- ============================================================================
delete from public.staff_permission_grants
where staff_profile_id = '50000000-0000-0000-0000-000000000003'
  and permission_key = 'claim_capture';

select pg_temp.act_as('a0000000-0000-0000-0000-000000000003');
select is(app_private.has_permission('claim_capture'), false,
  'Revoking a grant removes the permission');
select throws_ok(
  $$insert into public.customers (display_name) values ('after revoke')$$,
  '42501', null,
  'Access is denied immediately after revocation');
reset role;

-- ============================================================================
-- auth.uid() drives actor attribution — a caller cannot forge an audit actor
-- ============================================================================
select pg_temp.act_as('a0000000-0000-0000-0000-000000000002');

select is(
  app_private.current_staff_id(),
  '50000000-0000-0000-0000-000000000002'::uuid,
  'current_staff_id() derives from auth.uid(), not from any caller-supplied value');

select throws_ok(
  $$insert into public.audit_events (actor_auth_uid, actor_label, action, entity_type)
    values ('a0000000-0000-0000-0000-000000000001', 'The Owner', 'forged.action', 'claim')$$,
  '42501', null,
  'A caller cannot write an audit event attributed to someone else');

select lives_ok(
  $$insert into public.audit_events (actor_auth_uid, actor_label, action, entity_type)
    values ('a0000000-0000-0000-0000-000000000002', 'An Admin', 'real.action', 'claim')$$,
  'A caller may write an audit event attributed to themselves');

-- Audit remains append-only even for a permitted writer. There is no UPDATE
-- policy, so RLS matches no row and the statement is a silent no-op — the row is
-- never reached, so the Phase 1 append-only trigger does not even need to fire.
-- Either way nothing is mutated, which is what matters.
select lives_ok(
  $$update public.audit_events set action = 'tampered' where action = 'real.action'$$,
  'An update attempt on audit_events raises nothing (no policy matches)');

select is(
  (select count(*)::int from public.audit_events where action = 'tampered'),
  0,
  'Audit events cannot be updated by an authenticated caller: attribution is intact'
);
select is(
  (select count(*)::int from public.audit_events where action = 'real.action'),
  1,
  'The original audit event is unchanged'
);
reset role;

select * from finish();
rollback;
