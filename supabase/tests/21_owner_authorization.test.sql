-- ============================================================================
-- Owner authorization rule (Bible §5, §5.13) — proved as real JWTs.
-- ----------------------------------------------------------------------------
-- Owner-approved change: the Owner is the main administrator and holds EVERY
-- permission by an explicit owner-level rule (app_private.has_permission returns
-- true for the Owner with no grant row). All other roles hold only their grants;
-- role title is not authority for Selected Admin or Staff. The six non-delegable
-- approvals are still Owner-only and are NOT widened by this rule.
--
-- Fixtures mirror the four UAT roles: Owner, Staff-Full, Staff-Limited, NoPerm.
-- ============================================================================
begin;
select plan(16);

insert into auth.users (id, instance_id, email, aud, role) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'uat-owner@x.local',   'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'uat-full@x.local',    'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'uat-limited@x.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'uat-noperm@x.local',  'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('51000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'UAT Owner',        'owner', true),
  ('51000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'UAT Staff Full',   'staff', true),
  ('51000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'UAT Staff Limited','staff', true),
  ('51000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'UAT Staff NoPerm', 'staff', true);

-- Owner gets NO grants — the rule, not grants, must be what confers access.
insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('51000000-0000-0000-0000-000000000002', 'claim_capture'),
  ('51000000-0000-0000-0000-000000000002', 'payment_verification'),
  ('51000000-0000-0000-0000-000000000002', 'fulfillment_preparation'),
  ('51000000-0000-0000-0000-000000000003', 'claim_capture');

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ---- OWNER: complete access + owner-only authority ------------------------
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001');
select is(app_private.is_owner(), true, 'Owner is Owner');
select is(app_private.has_permission('claim_capture'), true,
  'Owner holds claim_capture with NO grant (owner-level rule)');
select is(app_private.has_permission('payment_verification'), true,
  'Owner holds payment_verification');
select is(app_private.has_permission('fulfillment_release'), true,
  'Owner holds fulfillment_release');
select is(app_private.has_permission('export_data_reports'), true,
  'Owner holds export_data_reports');
select is(app_private.can_decide_owner_only_action(), true,
  'Owner may decide the six non-delegable Owner approvals');
reset role;

-- ---- STAFF-FULL: operational access, but NOT owner-only administration ----
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');
select is(app_private.is_owner(), false, 'Staff Full is not Owner');
select is(app_private.has_permission('payment_verification'), true,
  'Staff Full holds its granted payment_verification');
select is(app_private.has_permission('fulfillment_preparation'), true,
  'Staff Full holds its granted fulfillment_preparation');
select is(app_private.has_permission('export_data_reports'), false,
  'Staff Full does NOT hold ungranted permissions — role title is not authority');
select is(app_private.can_decide_owner_only_action(), false,
  'Staff Full CANNOT decide owner-only actions (owner-only is non-delegable)');
reset role;

-- ---- STAFF-LIMITED: only its single grant ---------------------------------
select pg_temp.act_as('b0000000-0000-0000-0000-000000000003');
select is(app_private.has_permission('claim_capture'), true,
  'Staff Limited holds claim_capture');
select is(app_private.has_permission('confirm_claim_print_label'), false,
  'Staff Limited holds nothing beyond its single grant');
reset role;

-- ---- NO-PERM: nothing at all ----------------------------------------------
select pg_temp.act_as('b0000000-0000-0000-0000-000000000004');
select is(app_private.has_permission('claim_capture'), false,
  'NoPerm holds no permission');
select is(app_private.is_owner(), false, 'NoPerm is not Owner');
select is(app_private.can_decide_owner_only_action(), false,
  'NoPerm cannot decide owner-only actions');
reset role;

select * from finish();
rollback;
