-- ============================================================================
-- HR: Attendance & Payroll (migration 20260717120000).
-- ----------------------------------------------------------------------------
-- A staff member owns their own attendance and can hold at most ONE open
-- session; the Owner sees everyone. Payroll is derived, security-invoker,
-- RLS-scoped. All asserted with real JWTs.
-- ============================================================================
begin;
select plan(14);

-- ---- Fixtures --------------------------------------------------------------
insert into auth.users (id, instance_id, email, aud, role) values
  ('af000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'hr-owner@test.local', 'authenticated', 'authenticated'),
  ('af000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'hr-s1@test.local', 'authenticated', 'authenticated'),
  ('af000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-000000000000',
   'hr-s2@test.local', 'authenticated', 'authenticated');

insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('af100000-0000-0000-0000-0000000000f1', 'af000000-0000-0000-0000-0000000000f1', 'HR Owner', 'owner', true),
  ('af100000-0000-0000-0000-0000000000f2', 'af000000-0000-0000-0000-0000000000f2', 'HR Staff One', 'staff', true),
  ('af100000-0000-0000-0000-0000000000f3', 'af000000-0000-0000-0000-0000000000f3', 'HR Staff Two', 'staff', true);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- 1. hourly_rate lives on staff_profiles.
-- ============================================================================
select has_column('public', 'staff_profiles', 'hourly_rate', 'staff_profiles.hourly_rate exists');

-- ============================================================================
-- 2-6. attendance_records: RLS forced, named grants, no delete.
-- ============================================================================
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'attendance_records'),
  'attendance_records: RLS ENABLED and FORCED'
);
select ok(has_table_privilege('authenticated', 'public.attendance_records', 'select'), 'SELECT granted');
select ok(has_table_privilege('authenticated', 'public.attendance_records', 'insert'), 'INSERT granted');
select ok(has_table_privilege('authenticated', 'public.attendance_records', 'update'), 'UPDATE granted');
select is(has_table_privilege('authenticated', 'public.attendance_records', 'delete'), false,
  'DELETE stays revoked — attendance is never erased');

-- ============================================================================
-- 7. One open session per staff, enforced by a partial unique index.
-- ============================================================================
select ok(
  exists (select 1 from pg_indexes
          where schemaname = 'public'
            and indexname = 'attendance_one_open_session_per_staff'),
  'a partial unique index enforces at most one open session per staff'
);

-- ============================================================================
-- 8-10. report_payroll: exists, security invoker, anon denied.
-- ============================================================================
select has_function('public', 'report_payroll', array['date', 'date'], 'report_payroll exists');
select is(
  (select prosecdef from pg_proc where proname = 'report_payroll'),
  false,
  'report_payroll is SECURITY INVOKER — RLS scopes rows to self/Owner'
);
select is(
  has_function_privilege('anon', 'public.report_payroll(date, date)', 'execute'),
  false,
  'anon cannot execute report_payroll'
);

-- ============================================================================
-- 11-12. A staff member clocks in once; a second open session is refused.
-- ============================================================================
select pg_temp.act_as('af000000-0000-0000-0000-0000000000f2');
select lives_ok(
  $$insert into public.attendance_records (staff_profile_id)
    values ('af100000-0000-0000-0000-0000000000f2')$$,
  'a staff member can clock in for themselves'
);
select throws_ok(
  $$insert into public.attendance_records (staff_profile_id)
    values ('af100000-0000-0000-0000-0000000000f2')$$,
  '23505',
  null,
  'a second open session is refused — clock out first'
);
reset role;

-- ============================================================================
-- 13-14. RLS: another staff member sees nothing; the Owner sees it.
-- ============================================================================
select pg_temp.act_as('af000000-0000-0000-0000-0000000000f3');
select is(
  (select count(*)::int from public.attendance_records
   where staff_profile_id = 'af100000-0000-0000-0000-0000000000f2'),
  0,
  'a staff member cannot see another staff member''s attendance'
);
reset role;

select pg_temp.act_as('af000000-0000-0000-0000-0000000000f1');
select is(
  (select count(*)::int from public.attendance_records
   where staff_profile_id = 'af100000-0000-0000-0000-0000000000f2'),
  1,
  'the Owner sees every staff member''s attendance'
);
reset role;

select * from finish();
rollback;
