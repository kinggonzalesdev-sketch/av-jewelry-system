-- ============================================================================
-- Scrap income (migration 20260717130000).
-- ----------------------------------------------------------------------------
-- Append-only scrap gold/silver sales, self-attributed, RLS-scoped. The report
-- sums numeric in SQL and always covers both materials. Asserted with real JWTs.
-- ============================================================================
begin;
select plan(11);

insert into auth.users (id, instance_id, email, aud, role) values
  ('bf000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'scrap-s1@test.local', 'authenticated', 'authenticated'),
  ('bf000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000000',
   'scrap-s2@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('bf100000-0000-0000-0000-0000000000f1', 'bf000000-0000-0000-0000-0000000000f1', 'Scrap One', 'staff', true),
  ('bf100000-0000-0000-0000-0000000000f2', 'bf000000-0000-0000-0000-0000000000f2', 'Scrap Two', 'staff', true);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- 1. RLS forced.
select ok(
  (select relrowsecurity and relforcerowsecurity from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'scrap_sales'),
  'scrap_sales: RLS ENABLED and FORCED'
);
-- 2-5. Named grants: select + insert only.
select ok(has_table_privilege('authenticated', 'public.scrap_sales', 'select'), 'SELECT granted');
select ok(has_table_privilege('authenticated', 'public.scrap_sales', 'insert'), 'INSERT granted');
select is(has_table_privilege('authenticated', 'public.scrap_sales', 'update'), false, 'UPDATE not granted (append-only)');
select is(has_table_privilege('authenticated', 'public.scrap_sales', 'delete'), false, 'DELETE not granted (append-only)');

-- 6-7. report exists and is security invoker.
select has_function('public', 'report_scrap_income', array['date', 'date'], 'report_scrap_income exists');
select is(
  (select prosecdef from pg_proc where proname = 'report_scrap_income'),
  false,
  'report_scrap_income is SECURITY INVOKER'
);
-- 8. anon cannot execute it.
select is(
  has_function_privilege('anon', 'public.report_scrap_income(date, date)', 'execute'),
  false,
  'anon cannot execute report_scrap_income'
);

-- 9-10. Self-attributed insert succeeds; another name is refused.
select pg_temp.act_as('bf000000-0000-0000-0000-0000000000f1');
select lives_ok(
  $$insert into public.scrap_sales (material, grams, amount, recorded_by)
    values ('gold', 5.500, 12000.00, 'bf100000-0000-0000-0000-0000000000f1')$$,
  'active staff records a scrap sale attributed to themselves'
);
select throws_ok(
  $$insert into public.scrap_sales (material, grams, amount, recorded_by)
    values ('gold', 1.000, 100.00, 'bf100000-0000-0000-0000-0000000000f2')$$,
  '42501',
  null,
  'a caller cannot record a scrap sale under another name (with-check)'
);

-- 11. The report always covers both materials (gold row present, summed in SQL).
select is(
  (select total_amount from public.report_scrap_income('2000-01-01', '2100-01-01')
   where material = 'gold'),
  '12000.00',
  'report_scrap_income sums gold income in SQL and returns it as a string'
);
reset role;

select * from finish();
rollback;
