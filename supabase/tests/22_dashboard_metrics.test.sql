-- ============================================================================
-- Dashboard business totals — broad VIEW visibility + honest zeros (§7, §25).
-- ----------------------------------------------------------------------------
-- Owner-approved: any ACTIVE staff may VIEW on-screen totals (no export
-- permission needed); only export/download stays gated. Proved as a real JWT
-- for a plain staff account with NO grants.
-- ============================================================================
begin;
select plan(6);

insert into auth.users (id, instance_id, email, aud, role) values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000',
   'dm-staff@x.local', 'authenticated', 'authenticated');
insert into public.staff_profiles (id, auth_user_id, full_name, role_key, is_active) values
  ('52000000-0000-0000-0000-000000000001', 'e0000000-0000-0000-0000-000000000001',
   'DM Staff', 'staff', true);
-- No grants at all: a plain staff without export_data_reports.

create or replace function pg_temp.act_as(p_uid text)
returns void language plpgsql as $$
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_uid, 'role', 'authenticated', 'aal', 'aal1')::text, true);
end $$;

select pg_temp.act_as('e0000000-0000-0000-0000-000000000001');

-- Broad VIEW: a plain staff may read business totals with no export permission.
select lives_ok(
  $$ select public.dashboard_metrics() $$,
  'Any active staff may VIEW dashboard business totals (no export permission needed)');

-- Honest zeros on empty data — never null, never fabricated.
select is((public.dashboard_metrics() ->> 'total_sales'), '0.00',
  'Empty data shows an honest zero total, not null or fake');
select is((public.dashboard_metrics() ->> 'verified_collections'), '0.00',
  'Empty data shows honest zero verified collections');
select is((public.dashboard_metrics() ->> 'collection_trend'), '[]',
  'Empty collection trend is an empty array, not fabricated points');

-- report_sales_summary VIEWING is now broad too (was export-gated before).
select lives_ok(
  $$ select public.report_sales_summary(now() - interval '30 days', now()) $$,
  'Any active staff may VIEW the sales summary (viewing broad; export gated)');

select is((public.dashboard_metrics() ->> 'total_official_orders')::int, 0,
  'No orders exist yet → zero, reported honestly');

reset role;
select * from finish();
rollback;
