-- ============================================================================
-- Money-in-Transit aggregation (migration 20260717110000).
-- ----------------------------------------------------------------------------
-- A read-only, RLS-scoped, security-invoker function that sums money IN SQL and
-- returns it as strings (never a JS float). Anon holds nothing; authenticated
-- may call it; on empty data every bucket is a "0" string.
-- ============================================================================
begin;
select plan(8);

insert into auth.users (id, instance_id, email, aud, role) values
  ('ef000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000000',
   'mit-staff@test.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('ef100000-0000-0000-0000-0000000000f1', 'ef000000-0000-0000-0000-0000000000f1',
   'MIT Staff', 'staff', true);

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute format('set local role authenticated');
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

-- ============================================================================
-- 1-2. The function exists and is SECURITY INVOKER (RLS scopes the caller).
-- ============================================================================
select has_function('public', 'report_money_in_transit', 'report_money_in_transit exists');
select is(
  (select prosecdef from pg_proc where proname = 'report_money_in_transit'),
  false,
  'report_money_in_transit is SECURITY INVOKER — RLS scopes what the caller may read'
);

-- ============================================================================
-- 3-4. anon holds nothing; authenticated may execute.
-- ============================================================================
select is(
  has_function_privilege('anon', 'public.report_money_in_transit()', 'execute'),
  false,
  'anon cannot execute report_money_in_transit'
);
select ok(
  has_function_privilege('authenticated', 'public.report_money_in_transit()', 'execute'),
  'authenticated can execute report_money_in_transit'
);

-- ============================================================================
-- 5-8. As active staff on empty data: every bucket is the string "0".
-- ============================================================================
select pg_temp.act_as('ef000000-0000-0000-0000-0000000000f1');

select is(
  jsonb_typeof((public.report_money_in_transit()) -> 'awaiting_verification'),
  'string',
  'money is returned as a STRING, never a JSON number (no float)'
);
select is(
  (public.report_money_in_transit()) ->> 'awaiting_verification',
  '0',
  'awaiting_verification is 0 with no unverified payments'
);
select is(
  (public.report_money_in_transit()) ->> 'customer_pending',
  '0',
  'customer_pending is 0 with no awaiting-payment orders'
);
select is(
  (public.report_money_in_transit()) ->> 'in_transit_to_collect',
  '0',
  'in_transit_to_collect is 0 with no dispatched COD orders'
);
reset role;

select * from finish();
rollback;
