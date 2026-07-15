-- ============================================================================
-- Phase 2 — Owner-only authority, device limits, aal1/aal2, MFA readiness
-- ============================================================================
begin;
select plan(29);

insert into auth.users (id, instance_id, email, aud, role) values
  ('b0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'o2@t.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'sa2@t.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'st2@t.local', 'authenticated', 'authenticated'),
  ('b0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'st3@t.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key) values
  ('60000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Owner Two', 'owner'),
  ('60000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'Admin Two', 'selected_admin'),
  ('60000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000003', 'Staff Two', 'staff'),
  ('60000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000004', 'Staff Three', 'staff');

-- Give the Selected Admin and Staff broad operational grants. This is the point:
-- even a heavily-granted account must not gain Owner authority.
insert into public.staff_permission_grants (staff_profile_id, permission_key)
select '60000000-0000-0000-0000-000000000002', key from public.permissions;
insert into public.staff_permission_grants (staff_profile_id, permission_key) values
  ('60000000-0000-0000-0000-000000000003', 'initiate_high_risk_action');

create or replace function pg_temp.act_as(p_uid text, p_aal text default 'aal1')
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', p_aal)::text, true);
end $$;

-- ============================================================================
-- Owner Approval Request: creation does not execute; only Owner may decide
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-000000000003');

select lives_ok(
  $$insert into public.owner_approval_requests
      (id, action_kind, entity_type, entity_id, reason, requested_by)
    values ('70000000-0000-0000-0000-000000000001', 'official_order_cancellation',
            'official_order', gen_random_uuid(), 'customer asked', '60000000-0000-0000-0000-000000000003')$$,
  'Staff with initiate_high_risk_action may CREATE an Owner Approval Request');

select is(
  (select status from public.owner_approval_requests where id = '70000000-0000-0000-0000-000000000001'),
  'pending_owner_approval',
  'Creating a request executes nothing: it starts Pending Owner Approval');

-- A requester cannot forge attribution to someone else.
select throws_ok(
  $$insert into public.owner_approval_requests
      (action_kind, entity_type, entity_id, reason, requested_by)
    values ('price_override', 'claim', gen_random_uuid(), 'x', '60000000-0000-0000-0000-000000000001')$$,
  '42501', null,
  'A requester cannot attribute a request to another staff member');

-- Staff cannot decide, even holding initiate_high_risk_action.
select lives_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = '60000000-0000-0000-0000-000000000003'
    where id = '70000000-0000-0000-0000-000000000001'$$,
  'A Staff decision attempt raises nothing (no policy row matches)');

select is(
  (select status from public.owner_approval_requests where id = '70000000-0000-0000-0000-000000000001'),
  'pending_owner_approval',
  'Staff CANNOT decide an Owner Approval Request: the record is unchanged');
reset role;

-- ============================================================================
-- Selected Admin holds EVERY permission — and still cannot decide.
-- This is the sharpest test of "no permission confers Owner authority".
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');

select is(app_private.has_permission('initiate_high_risk_action'), true,
  'The Selected Admin holds every granted permission, including initiate_high_risk_action');
select is(app_private.can_decide_owner_only_action(), false,
  'A fully-granted Selected Admin still has NO Owner-only authority');

select lives_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = '60000000-0000-0000-0000-000000000002'
    where id = '70000000-0000-0000-0000-000000000001'$$,
  'A Selected Admin decision attempt raises nothing');

select is(
  (select status from public.owner_approval_requests where id = '70000000-0000-0000-0000-000000000001'),
  'pending_owner_approval',
  'Selected Admin CANNOT decide: the six Owner approvals are non-delegable');
reset role;

-- ============================================================================
-- The Owner CAN decide — and self-action is recorded
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001');

select is(app_private.can_decide_owner_only_action(), true, 'The Owner holds Owner-only authority');

select lives_ok(
  $$update public.owner_approval_requests
    set status = 'approved', decided_at = now(), decided_by = '60000000-0000-0000-0000-000000000001'
    where id = '70000000-0000-0000-0000-000000000001'$$,
  'The Owner may decide an Owner Approval Request');

select is(
  (select status from public.owner_approval_requests where id = '70000000-0000-0000-0000-000000000001'),
  'approved',
  'The Owner decision took effect');

-- Owner self-action: the Owner may request AND decide, and both are attributed.
select lives_ok(
  $$insert into public.owner_approval_requests
      (id, action_kind, entity_type, entity_id, reason, requested_by)
    values ('70000000-0000-0000-0000-000000000002', 'live_batch_reopen',
            'live_batch', gen_random_uuid(), 'owner self action', '60000000-0000-0000-0000-000000000001')$$,
  'The Owner may raise their own request (self-action permitted)');

update public.owner_approval_requests
set status = 'approved', decided_at = now(), decided_by = '60000000-0000-0000-0000-000000000001'
where id = '70000000-0000-0000-0000-000000000002';

select is(
  (select requested_by = decided_by from public.owner_approval_requests
   where id = '70000000-0000-0000-0000-000000000002'),
  true,
  'Owner self-action records the Owner as BOTH requester and decider (audited, not hidden)');
reset role;

-- ============================================================================
-- Only the Owner may promote to Selected Admin (Bible §5.4)
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-000000000002');

-- A Selected Admin cannot even SEE another staff member's profile: the read
-- policy matches only their own row. That is deliberate — an ordinary account
-- must not be able to enumerate the staff roster.
select is(
  (select count(*)::int from public.staff_profiles
   where id = '60000000-0000-0000-0000-000000000003'),
  0,
  'A Selected Admin cannot read another staff profile (no roster enumeration)');

select lives_ok(
  $$update public.staff_profiles set role_key = 'selected_admin'
    where id = '60000000-0000-0000-0000-000000000003'$$,
  'A Selected Admin promotion attempt by a non-Owner raises nothing');
reset role;

-- Verify the true state from a privileged vantage point: the promotion must not
-- have happened. Checking this as the Selected Admin would be meaningless, since
-- they cannot see the row at all.
select is(
  (select role_key from public.staff_profiles where id = '60000000-0000-0000-0000-000000000003'),
  'staff',
  'A Selected Admin CANNOT promote another account: role is unchanged');

-- ============================================================================
-- Device limits — enforced atomically at the registry
-- ============================================================================
-- Staff limit is 1.
insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint)
values ('60000000-0000-0000-0000-000000000003', 'Phone', 'fp-staff-1');

select throws_ok(
  $$insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint)
    values ('60000000-0000-0000-0000-000000000003', 'Tablet', 'fp-staff-2')$$,
  '23514', null,
  'Staff may register only ONE active device (limit enforced)');

-- Revoking frees the slot; the revoked row is retained.
update public.trusted_devices
set revoked_at = now(), revoked_reason = 'replaced'
where device_fingerprint = 'fp-staff-1';

select lives_ok(
  $$insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint)
    values ('60000000-0000-0000-0000-000000000003', 'Tablet', 'fp-staff-2')$$,
  'Revoking a device frees the slot');

select is(
  (select count(*)::int from public.trusted_devices
   where staff_profile_id = '60000000-0000-0000-0000-000000000003'),
  2,
  'The revoked device row is RETAINED: session history survives revocation');

-- Owner limit is 2.
insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint) values
  ('60000000-0000-0000-0000-000000000001', 'Laptop', 'fp-owner-1'),
  ('60000000-0000-0000-0000-000000000001', 'Phone', 'fp-owner-2');

select throws_ok(
  $$insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint)
    values ('60000000-0000-0000-0000-000000000001', 'Third', 'fp-owner-3')$$,
  '23514', null,
  'Owner may register at most TWO active devices');

-- Deactivation revokes devices: a disabled account loses future access.
update public.staff_profiles set is_active = false, deactivated_at = now()
where id = '60000000-0000-0000-0000-000000000004';

insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint, revoked_at, revoked_reason)
values ('60000000-0000-0000-0000-000000000004', 'Old', 'fp-inactive-1', now(), 'pre-revoked');

update public.staff_profiles set is_active = true, deactivated_at = null
where id = '60000000-0000-0000-0000-000000000004';
insert into public.trusted_devices (staff_profile_id, device_label, device_fingerprint)
values ('60000000-0000-0000-0000-000000000004', 'Active', 'fp-inactive-2');

update public.staff_profiles set is_active = false, deactivated_at = now()
where id = '60000000-0000-0000-0000-000000000004';

select is(
  (select count(*)::int from public.trusted_devices
   where staff_profile_id = '60000000-0000-0000-0000-000000000004' and revoked_at is null),
  0,
  'Deactivating an account revokes all its active devices');

-- ============================================================================
-- aal1 vs aal2 (MFA)
-- ============================================================================
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001', 'aal1');
select is(app_private.current_auth_aal(), 'aal1', 'A password-only session reports aal1');
reset role;

select pg_temp.act_as('b0000000-0000-0000-0000-000000000001', 'aal2');
select is(app_private.current_auth_aal(), 'aal2', 'A TOTP-verified session reports aal2');
reset role;

-- Fails closed: no aal claim is treated as aal1, never as aal2.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub','b0000000-0000-0000-0000-000000000001','role','authenticated')::text, true);
select is(app_private.current_auth_aal(), 'aal1',
  'A missing aal claim defaults to aal1 (fails closed, never assumes MFA)');
reset role;

-- ============================================================================
-- Owner MFA readiness (pilot/production gate)
-- ============================================================================
select is(app_private.owner_mfa_ready(), false,
  'Owner MFA readiness is FALSE while no Owner has enrolled TOTP');

update public.staff_profiles set mfa_enrolled = true where role_key = 'owner' and is_active;

select is(app_private.owner_mfa_ready(), true,
  'Owner MFA readiness becomes TRUE once every active Owner has enrolled');

-- Readiness is a state report, not an enforcement gate: development is not
-- locked behind MFA (an Owner could not enroll if it were).
select pg_temp.act_as('b0000000-0000-0000-0000-000000000001', 'aal1');
select is(app_private.can_decide_owner_only_action(), true,
  'Owner authority is not blocked at aal1 in development (MFA is required before pilot, not now)');
reset role;

-- ============================================================================
-- Device limits are NOT claimed as fully enforced
-- ============================================================================
select is(
  (select bool_or(enforcement_implemented) from public.role_device_limits),
  false,
  'enforcement_implemented remains FALSE: provider-level session enforcement is not implemented');

select * from finish();
rollback;
