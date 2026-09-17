-- ============================================================================
-- 0008 SELF-TEST. ONE transaction ending in ROLLBACK: nothing persists.
-- ----------------------------------------------------------------------------
-- Run as a superuser on a scratch database with 0000 to 0007 applied:
--   psql -v ON_ERROR_STOP=1 -d <scratch-db> -f 0008_selftest.sql
-- Success prints NOTICE: SELFTEST OK; a failed assertion raises SELFTEST FAIL with its label. Never
-- run it on production. Names and ids are fixtures, not people. The pay fixture is the template
-- fixture T3 of IMPLEMENTATION_PROMPT.md Step 10 (not reference data), with business time = UTC.
-- Kiosk clock events use now(), which is constant inside one transaction, so step 5 moves the sessions
-- to fixed January dates before payroll runs.
-- Covered: catalog hygiene (search_path, security mode, definer owners, EXECUTE for PUBLIC, anon and
-- authenticated; forced RLS and no end-user write grants); settings validation; eligibility; device
-- gate in auto mode for clock-in and clock-out; kiosk clocking and Continue Duty; status reader;
-- photo attach rules; every correction rule except maxWindowDays; rates; payroll lines for the base
-- fixture and seven variations (window end, dated bonus, clock-in anchor, day overtime basis,
-- period_end and per_day rates, hourly basis, minimum hours); payslip generate, supersede, mark paid,
-- void, negative net; the freeze and append-only triggers; own-row scoping for Staff, including a
-- direct call to app_private.payroll_lines; soft and hard deletion. Not covered: device mode
-- required and off, allowMultipleSessionsPerDay = false, maxWindowDays, storage policies.
-- ============================================================================

begin;

-- Test helpers (temporary objects, removed by the rollback).
create function pg_temp.expect_true(p_ok boolean, p_label text) returns void
language plpgsql set search_path = '' as $fn$
begin
  if not coalesce(p_ok, false) then
    raise exception 'SELFTEST FAIL: %', p_label;
  end if;
end $fn$;

-- Passes when p_sql raises with SQLSTATE p_expect or with hint p_expect (SERVER_API.md 9.10 codes).
create function pg_temp.expect_refusal(p_label text, p_sql text, p_expect text) returns void
language plpgsql set search_path = '' as $fn$
declare
  v_state text;
  v_hint text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
    if v_state = p_expect or v_hint = p_expect then
      return;
    end if;
    raise exception 'SELFTEST FAIL: % was refused with SQLSTATE % and hint %, expected %', p_label, v_state, v_hint, p_expect;
  end;
  raise exception 'SELFTEST FAIL: % was not refused', p_label;
end $fn$;

-- 1. Catalog checks, settings and fixtures (superuser).
do $$
declare
  v_expected text[] := array[
    'current_staff_id', 'current_staff_role', 'is_active_staff', 'is_owner', 'has_permission',
    'hr_settings_validate', 'business_timezone', 'business_today', 'hr_setting', 'hr_setting_text', 'night_bonus_amount',
    'is_night_session', 'is_timekeeping_eligible', 'employees_apply_exclusions', 'get_hr_settings',
    'audit_events_refuse_change', 'record_audit_event',
    'attendance_device_check_applies', 'attendance_resolve_device', 'attendance_gating_active', 'verify_attendance_device',
    'register_attendance_device', 'revoke_attendance_device', 'attach_attendance_photo',
    'list_clock_staff', 'attendance_status', 'kiosk_clock_in', 'kiosk_clock_out', 'correct_attendance_clock_out',
    'delete_attendance_record',
    'payroll_snapshot_freeze', 'set_staff_salary_rate', 'payroll_lines', 'report_payroll', 'generate_payslip_snapshot',
    'mark_payslip_paid', 'void_payslip'];
  -- Trigger functions, the audit writer and unfiltered private helpers: no end-user EXECUTE.
  v_internal text[] := array['hr_settings_validate', 'employees_apply_exclusions', 'audit_events_refuse_change',
    'record_audit_event', 'attendance_device_check_applies', 'attendance_resolve_device', 'payroll_snapshot_freeze'];
  -- Everything else is SECURITY DEFINER.
  v_invoker text[] := array['hr_settings_validate', 'audit_events_refuse_change', 'payroll_snapshot_freeze', 'report_payroll'];
  v_found bigint;
  v_bad text;
begin
  select count(distinct p.proname) into v_found
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'app_private') and p.proname = any (v_expected);
  perform pg_temp.expect_true(v_found = pg_catalog.array_length(v_expected, 1), 'every template function exists');

  select string_agg(n.nspname || '.' || p.proname, ', ') into v_bad
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  join pg_catalog.pg_roles r on r.oid = p.proowner
  where n.nspname in ('public', 'app_private') and p.proname = any (v_expected)
    and (not exists (select 1 from pg_catalog.unnest(p.proconfig) c where pg_catalog.replace(c, '"', '') = 'search_path=')
         or (p.proname = any (v_invoker)) = p.prosecdef
         or (p.prosecdef and not (r.rolsuper or r.rolbypassrls))
         or pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
         or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
         or (p.proname = any (v_internal) and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
         or (p.proname <> all (v_internal) and not pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')));
  if v_bad is not null then
    raise exception 'SELFTEST FAIL: search_path, security mode, definer owner or EXECUTE grant wrong for: %', v_bad;
  end if;

  select count(*), string_agg(c.oid::regclass::text, ', ') filter (
           where not c.relrowsecurity or not c.relforcerowsecurity
              or pg_catalog.has_table_privilege('anon', c.oid, 'SELECT')
              or pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE')
              or pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE')
              or (c.relname <> 'audit_events' and pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT')))
    into v_found, v_bad
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where (n.nspname, c.relname) in (('app_private', 'hr_settings'), ('public', 'audit_events'), ('public', 'attendance_sessions'),
                                   ('public', 'attendance_devices'), ('public', 'attendance_photos'),
                                   ('public', 'employee_pay_rates'), ('public', 'payroll_snapshots'));
  perform pg_temp.expect_true(v_found = 7, 'every template table exists');
  if v_bad is not null then
    raise exception 'SELFTEST FAIL: RLS not forced, or an end-user write or anon read grant, on: %', v_bad;
  end if;

  -- Settings of the T3 fixture. Keys not listed keep their seeded defaults.
  update app_private.hr_settings s set value = v.value
  from (values
    ('locale.timezone', '"UTC"'::jsonb),
    ('payroll.nightRule.enabled', 'true'),
    ('payroll.nightRule.anchor', '"clock_out"'),
    ('payroll.nightRule.thresholdTime', '"21:00"'),
    ('payroll.nightRule.windowEnd', 'null'),
    ('payroll.nightRule.bonusAmount', '"50.00"'),
    ('payroll.nightRule.oncePerDay', 'true'),
    ('payroll.overtimeDisplayThresholdHours', '9'),
    ('payroll.overtimeBasis', '"session"'),
    ('payroll.minHoursForDay', '0'),
    ('payroll.rateSelection', '"period_end"'),
    ('payroll.allowNegativeNet', 'false'),
    ('payroll.payFrequencies', '["weekly", "monthly"]'),
    ('attendance.device.mode', '"auto"'),
    ('attendance.allowMultipleSessionsPerDay', 'true'),
    ('attendance.clockMode', '"kiosk"'),
    ('attendance.deletion.mode', '"soft"'),
    ('exclusions.excludedRoles', '["owner"]'),
    ('audit.payloadIncludesAmounts', 'false')
  ) as v(key, value)
  where s.key = v.key and s.effective_from = '-infinity';

  insert into public.employees (id, auth_user_id, full_name, role_key, is_demo) values
    ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-0000000000a1', '<super-admin>', 'owner', false),
    ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-0000000000a2', '<employee-a>', 'staff', false),
    ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-0000000000a3', '<kiosk-operator>', 'staff', false),
    ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-0000000000a4', '<demo-account>', 'staff', true);
  -- The kiosk operator holds attendance.clock_operate through an explicit grant; the Super Admin needs none.
  insert into public.employee_permission_grants (employee_id, permission_key)
  values ('00000000-0000-4000-8000-000000000003', 'attendance.clock_operate');
  perform pg_temp.expect_true(
    (select e.timekeeping_exempt from public.employees e where e.id = '00000000-0000-4000-8000-000000000001'),
    'an excluded role sets timekeeping_exempt');
end $$;

-- 2. Employee A (Staff, no keys).
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
do $$
begin
  perform pg_temp.expect_refusal('roster without a key', 'select * from public.list_clock_staff()', '42501');
  perform pg_temp.expect_refusal('direct session insert',
    'insert into public.attendance_sessions (employee_id, clock_in_by) values '
    || '(''00000000-0000-4000-8000-000000000002'', ''00000000-0000-4000-8000-000000000002'')', '42501');
  perform pg_temp.expect_refusal('device registration without a key',
    format('select public.register_attendance_device(%L, %L)', 'Kiosk', repeat('5e', 32)), '42501');
  perform pg_temp.expect_refusal('settings table read', 'select count(*) from app_private.hr_settings', '42501');
  perform pg_temp.expect_true((public.get_hr_settings() ->> 'locale.timezone') = 'UTC', 'get_hr_settings returns the values in force');
end $$;

-- 3. Super Admin: auto mode has no gate until a device is active; register one.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
do $$
declare
  v_token text := repeat('5e', 32);
  v_device uuid;
begin
  perform pg_temp.expect_true(not public.attendance_gating_active(), 'auto mode: no gate while no device is active');
  perform pg_temp.expect_refusal('a short device token',
    format('select public.register_attendance_device(%L, %L)', 'Kiosk', 'short'), 'validation');
  v_device := public.register_attendance_device('Kiosk 1', v_token);
  perform pg_temp.expect_true(public.attendance_gating_active(), 'auto mode: gate on once a device is active');
  perform pg_temp.expect_true(public.verify_attendance_device(v_token) = v_device, 'the token verifies to its device');
  perform pg_temp.expect_true(public.verify_attendance_device(repeat('0f', 32)) is null, 'an unknown token verifies to nothing');
  perform pg_temp.expect_true(exists (select 1 from public.audit_events a
    where a.action = 'attendance.device_register' and a.entity_id = v_device), 'device registration audited in SQL');
end $$;

-- 4. Kiosk operator clocks Employee A: four completed sessions and one left open.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a3';
do $$
declare
  v_token text := repeat('5e', 32);
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_s uuid;
  v_open uuid;
  v_i integer;
begin
  perform pg_temp.expect_true((select count(*) from public.list_clock_staff()) = 2,
    'roster lists the two eligible members (Super Admin and demo account excluded)');
  perform pg_temp.expect_refusal('clock-in without the device token',
    format('select public.kiosk_clock_in(%L, null)', v_a), 'device_not_approved');
  perform pg_temp.expect_refusal('clock-in of an excluded Super Admin',
    format('select public.kiosk_clock_in(%L, %L)', '00000000-0000-4000-8000-000000000001', v_token), 'conflict');
  perform pg_temp.expect_refusal('clock-in of a demo account',
    format('select public.kiosk_clock_in(%L, %L)', '00000000-0000-4000-8000-000000000004', v_token), 'conflict');
  for v_i in 1..4 loop
    v_s := public.kiosk_clock_in(v_a, v_token);      -- sessions 2 to 4 are "Continue Duty" calls
    if v_i = 1 then
      perform pg_temp.expect_refusal('a second open session',
        format('select public.kiosk_clock_in(%L, %L)', v_a, v_token), 'conflict');
    end if;
    perform pg_temp.expect_true(public.kiosk_clock_out(v_a, v_token) = v_s, 'clock-out closes the open session');
    perform set_config('selftest.s' || v_i, v_s::text, true);
  end loop;
  v_s := public.kiosk_clock_in(v_a, v_token, 'left open on purpose');
  perform set_config('selftest.s5', v_s::text, true);
  perform pg_temp.expect_refusal('clock-out without the device token',
    format('select public.kiosk_clock_out(%L, null)', v_a), 'device_not_approved');
  select st.open_session_id into v_open from public.attendance_status(array[v_a]) st;
  perform pg_temp.expect_true(v_open = v_s, 'the status reader shows the open session to the operator');
  perform public.attach_attendance_photo(current_setting('selftest.s1')::uuid, 'clock_in',
    current_setting('selftest.s1') || '/clock_in.jpg', 'image/jpeg', 1024);
  perform pg_temp.expect_refusal('a photo path outside the session prefix',
    format('select public.attach_attendance_photo(%L, %L, %L, %L, 1024)', current_setting('selftest.s1'), 'clock_out',
           current_setting('selftest.s2') || '/clock_out.jpg', 'image/jpeg'), 'validation');
  perform pg_temp.expect_refusal('a photo for a clock event nobody recorded',
    format('select public.attach_attendance_photo(%L, %L, %L, %L, 1024)', v_s, 'clock_out', v_s::text || '/clock_out.jpg',
           'image/jpeg'), '42501');
end $$;

-- 5. Fixture (superuser): fixed times of the T3 fixture. Session 3 gets a clock-out with seconds,
-- corrected in step 6.
reset role;
update public.attendance_sessions
  set work_date = '2026-01-05', time_in = '2026-01-05 09:00+00', time_out = '2026-01-05 17:00+00'
  where id = current_setting('selftest.s1')::uuid;
update public.attendance_sessions
  set work_date = '2026-01-06', time_in = '2026-01-06 08:00+00', time_out = '2026-01-06 12:00+00'
  where id = current_setting('selftest.s2')::uuid;
update public.attendance_sessions
  set work_date = '2026-01-06', time_in = '2026-01-06 13:00+00', time_out = '2026-01-06 18:00:30+00'
  where id = current_setting('selftest.s3')::uuid;
update public.attendance_sessions
  set work_date = '2026-01-07', time_in = '2026-01-07 22:15+00', time_out = '2026-01-08 00:30+00'
  where id = current_setting('selftest.s4')::uuid;
update public.attendance_sessions
  set work_date = '2026-01-08', time_in = '2026-01-08 09:00+00'
  where id = current_setting('selftest.s5')::uuid;

-- 6. Super Admin: corrections and rates.
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
do $$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_s2 text := current_setting('selftest.s2');
  v_s3 uuid := current_setting('selftest.s3')::uuid;
  v_old timestamptz;
begin
  perform pg_temp.expect_refusal('a correction without a reason',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', v_s3, '2026-01-06 22:30+00', '   '), 'validation');
  perform pg_temp.expect_refusal('a correction that is not a whole minute',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', v_s3, '2026-01-06 22:30:15+00', 'Forgot'), 'validation');
  perform pg_temp.expect_refusal('an unchanged minute of a completed session',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', v_s3, '2026-01-06 18:00+00', 'No change'), 'conflict');
  perform pg_temp.expect_refusal('a correction overlapping the next session',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', v_s2, '2026-01-06 13:30+00', 'Too late'), 'validation');
  perform pg_temp.expect_refusal('a correction in the future',
    format('select public.correct_attendance_clock_out(%L, date_trunc(%L, now()) + interval %L, %L)', v_s3, 'minute', '1 day',
           'Future'), 'validation');
  v_old := public.correct_attendance_clock_out(v_s3, '2026-01-06 22:30+00', 'Forgot to clock out');
  perform pg_temp.expect_true(v_old = '2026-01-06 18:00:30+00'::timestamptz, 'the correction returns the old clock-out');
  perform pg_temp.expect_true(exists (select 1 from public.attendance_sessions s
    where s.id = v_s3 and s.time_out = '2026-01-06 22:30+00' and s.edited_by is not null and s.edited_at is not null
      and s.edit_reason = 'Forgot to clock out'), 'the correction stamps the edit columns');
  perform pg_temp.expect_true(exists (select 1 from public.audit_events a
    where a.entity_id = v_s3 and a.action = 'attendance.clock_out_corrected' and a.reason = 'Forgot to clock out'
      and a.context ->> 'old_time_out' is not null and a.context ->> 'new_time_out' is not null),
    'the correction is audited with old and new values');
  perform pg_temp.expect_true((select app_private.is_night_session(s.time_in, s.time_out)
    from public.attendance_sessions s where s.id = v_s3), 'the corrected 22:30 clock-out is a night session');
  perform public.set_staff_salary_rate(v_a, 'daily', 120.00, 'weekly', '2026-01-01');
  perform public.set_staff_salary_rate('00000000-0000-4000-8000-000000000003', 'daily', 100.00, 'weekly', '2026-01-01');
  perform pg_temp.expect_refusal('a frequency the client does not offer',
    format('select public.set_staff_salary_rate(%L, %L, 120, %L, %L)', v_a, 'daily', 'bi_weekly', '2026-01-01'), 'validation');
  perform pg_temp.expect_refusal('the monthly basis, which has no formula',
    format('select public.set_staff_salary_rate(%L, %L, 120, %L, %L)', v_a, 'monthly', 'weekly', '2026-01-01'), 'validation');
  perform pg_temp.expect_refusal('a rate for an excluded Super Admin',
    format('select public.set_staff_salary_rate(%L, %L, 120, %L, %L)', '00000000-0000-4000-8000-000000000001', 'daily',
           'weekly', '2026-01-01'), 'validation');
end $$;

-- 7. Super Admin: payroll lines and payslips.
do $$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_b uuid := '00000000-0000-4000-8000-000000000003';
  v_line record;
  v_gen1 public.payroll_snapshots;
  v_gen2 public.payroll_snapshots;
  v_gen3 public.payroll_snapshots;
begin
  perform pg_temp.expect_true((select count(*) from public.report_payroll('2026-01-05', '2026-01-08')) = 2,
    'a payroll.view_all holder sees both eligible lines');
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  -- Expected for Employee A (daily rate 120.00; night bonus 50.00 at or after 21:00, clock-out anchor,
  -- once per day, no window end; overtime shown above 9 hours per session):
  --   2026-01-05  09:00-17:00                 8.00 h
  --   2026-01-06  08:00-12:00 and 13:00-22:30 4.00 h + 9.50 h; the 22:30 clock-out is a night session
  --   2026-01-07  22:15-00:30 next day        2.25 h; clock-out 00:30 is before 21:00, not a night session
  --   2026-01-08  09:00, still open           excluded from every total
  --   total_hours = 8.00 + 4.00 + 9.50 + 2.25 = 23.75; days_worked = 3; night_shifts = 1
  --   overtime_hours = 9.50 - 9 = 0.50
  --   gross = round(3 x 120.00 + 1 x 50.00, 2) = 360.00 + 50.00 = 410.00
  perform pg_temp.expect_true(v_line.total_hours = 23.75 and v_line.days_worked = 3 and v_line.night_shifts = 1
    and v_line.overtime_hours = 0.50 and v_line.gross_regular = '360.00' and v_line.gross_night_bonus = '50.00'
    and v_line.gross_total = '410.00' and v_line.open_sessions = 1 and v_line.warnings = array['open_session_in_period'],
    'base payroll line ' || row_to_json(v_line)::text);
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_b;
  perform pg_temp.expect_true(v_line.days_worked = 0 and v_line.gross_total = '0.00' and cardinality(v_line.warnings) = 0,
    'a rate without sessions gives 0.00, never null ' || row_to_json(v_line)::text);

  -- net = 410.00 - 20.00 = 390.00
  v_gen1 := public.generate_payslip_snapshot(v_a, '2026-01-05', '2026-01-08', 20.00);
  perform pg_temp.expect_true(v_gen1.gross_salary = 410.00 and v_gen1.regular_salary = 360.00 and v_gen1.overtime_pay = 50.00
    and v_gen1.deductions = 20.00 and v_gen1.net_salary = 390.00 and v_gen1.total_hours = 23.75
    and v_gen1.days_worked = 3 and v_gen1.night_shifts = 1 and v_gen1.payment_status = 'pending',
    'payslip ' || row_to_json(v_gen1)::text);
  perform pg_temp.expect_refusal('deductions above gross (410.00 - 500.00 < 0)',
    format('select public.generate_payslip_snapshot(%L, %L, %L, 500.00)', v_a, '2026-01-05', '2026-01-08'), 'validation');
  perform pg_temp.expect_refusal('a repeated generation that does not ask to regenerate',
    format('select public.generate_payslip_snapshot(%L, %L, %L, 20.00)', v_a, '2026-01-05', '2026-01-08'), 'conflict');
  v_gen2 := public.generate_payslip_snapshot(v_a, '2026-01-05', '2026-01-08', 0, true);
  perform pg_temp.expect_true((select p.superseded_by from public.payroll_snapshots p where p.id = v_gen1.id) = v_gen2.id,
    'explicit regeneration supersedes the pending payslip');
  perform pg_temp.expect_refusal('mark paid on a superseded payslip',
    format('select public.mark_payslip_paid(%L)', v_gen1.id), 'conflict');
  v_gen2 := public.mark_payslip_paid(v_gen2.id);
  perform pg_temp.expect_true(v_gen2.payment_status = 'paid' and v_gen2.paid_at is not null and v_gen2.payment_date is not null,
    'mark paid stamps the payment facts');
  perform pg_temp.expect_refusal('a second mark paid', format('select public.mark_payslip_paid(%L)', v_gen2.id), 'conflict');
  perform pg_temp.expect_refusal('regeneration over a paid payslip',
    format('select public.generate_payslip_snapshot(%L, %L, %L, 0, true)', v_a, '2026-01-05', '2026-01-08'), 'conflict');
  perform pg_temp.expect_refusal('void without a reason', format('select public.void_payslip(%L, %L)', v_gen2.id, ' '), 'validation');
  v_gen2 := public.void_payslip(v_gen2.id, 'Issued with the wrong deductions');
  perform pg_temp.expect_true(v_gen2.payment_status = 'void' and v_gen2.paid_at is not null, 'void keeps the paid facts');
  v_gen3 := public.generate_payslip_snapshot(v_a, '2026-01-05', '2026-01-08', 20.00);
  perform pg_temp.expect_true(v_gen3.payment_status = 'pending' and v_gen3.net_salary = 390.00, 'a new payslip after a void');
  perform set_config('selftest.gen2', v_gen2.id::text, true);
  perform set_config('selftest.gen3', v_gen3.id::text, true);
  -- Employee B: gross 0.00; deductions 50.00 would give net -50.00.
  perform pg_temp.expect_refusal('a negative net payslip',
    format('select public.generate_payslip_snapshot(%L, %L, %L, 50.00)', v_b, '2026-01-05', '2026-01-08'), 'validation');
  perform pg_temp.expect_true((select count(*) from public.audit_events a where a.action = 'payroll.payslip_generated') = 3,
    'each successful generation is audited once; refused calls leave no row');
end $$;

-- 8. Employee A: own rows only.
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a2';
do $$
declare
  v_line record;
begin
  perform pg_temp.expect_true((select count(*) from public.report_payroll('2026-01-05', '2026-01-08')) = 1,
    'staff see only their own payroll line');
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08');
  perform pg_temp.expect_true(v_line.employee_id = '00000000-0000-4000-8000-000000000002' and v_line.gross_total = '410.00',
    'the own line carries the same figures');
  perform pg_temp.expect_true((select count(*) from app_private.payroll_lines('2026-01-05', '2026-01-08')) = 1,
    'a direct call to payroll_lines is filtered the same way');
  perform pg_temp.expect_true((select count(*) from public.payroll_snapshots) = 3, 'staff read their own three payslip rows');
  perform pg_temp.expect_true((select count(*) from public.attendance_sessions) = 5, 'staff read their own five sessions');
  perform pg_temp.expect_true((select count(*) from public.attendance_photos) = 1, 'the subject reads the photo of their session');
  perform pg_temp.expect_true((select count(*) from public.audit_events) = 0, 'staff read no attendance or payroll audit rows');
  perform pg_temp.expect_refusal('a direct payslip update', 'update public.payroll_snapshots set net_salary = 0', '42501');
  perform pg_temp.expect_refusal('a direct rate insert',
    format('insert into public.employee_pay_rates (employee_id, rate_basis, rate_amount, pay_frequency, effective_date, created_by) '
           || 'values (%L, %L, 1, %L, %L, %L)', '00000000-0000-4000-8000-000000000002', 'daily', 'weekly', '2026-01-01',
           '00000000-0000-4000-8000-000000000002'), '42501');
  perform pg_temp.expect_refusal('payslip generation without the keys',
    format('select public.generate_payslip_snapshot(%L, %L, %L, 0)', '00000000-0000-4000-8000-000000000002', '2026-01-05',
           '2026-01-08'), '42501');
  perform pg_temp.expect_refusal('a correction without the key',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', current_setting('selftest.s1'), '2026-01-05 17:30+00', 'x'),
    '42501');
end $$;

-- 9. Superuser acting with the Super Admin's identity: payroll variations and triggers.
reset role;
set local request.jwt.claim.sub = '00000000-0000-4000-8000-0000000000a1';
do $$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_line record;
  v_rate uuid;
begin
  -- (a) window end 06:00: the 00:30 clock-out of 2026-01-07 qualifies too. gross = 360.00 + 2 x 50.00 = 460.00
  update app_private.hr_settings set value = '"06:00"' where key = 'payroll.nightRule.windowEnd';
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.night_shifts = 2 and v_line.gross_total = '460.00', '(a) ' || row_to_json(v_line)::text);
  -- (b) a dated bonus of 80.00 from 2026-01-07 prices only the later night.
  --     gross = 360.00 + 50.00 (2026-01-06) + 80.00 (2026-01-07) = 490.00
  insert into app_private.hr_settings (key, value, effective_from)
  values ('payroll.nightRule.bonusAmount', '"80.00"', '2026-01-07');
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.gross_night_bonus = '130.00' and v_line.gross_total = '490.00',
    '(b) ' || row_to_json(v_line)::text);
  delete from app_private.hr_settings where key = 'payroll.nightRule.bonusAmount' and effective_from = '2026-01-07';
  update app_private.hr_settings set value = 'null' where key = 'payroll.nightRule.windowEnd';
  -- (c) clock-in anchor: only the 22:15 clock-in of 2026-01-07 qualifies. gross = 360.00 + 50.00 = 410.00
  update app_private.hr_settings set value = '"clock_in"' where key = 'payroll.nightRule.anchor';
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.night_shifts = 1 and v_line.gross_total = '410.00'
    and (select app_private.is_night_session(s.time_in, s.time_out) from public.attendance_sessions s
         where s.id = current_setting('selftest.s4')::uuid), '(c) ' || row_to_json(v_line)::text);
  update app_private.hr_settings set value = '"clock_out"' where key = 'payroll.nightRule.anchor';
  -- (d) overtime basis day: 2026-01-06 totals 13.50 h, so 13.50 - 9 = 4.50
  update app_private.hr_settings set value = '"day"' where key = 'payroll.overtimeBasis';
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.overtime_hours = 4.50, '(d) ' || row_to_json(v_line)::text);
  update app_private.hr_settings set value = '"session"' where key = 'payroll.overtimeBasis';
  -- (e) a second rate of 150.00 from 2026-01-07.
  --     period_end: 3 x 150.00 + 50.00 = 500.00; per_day: 120.00 + 120.00 + 150.00 + 50.00 = 440.00
  v_rate := public.set_staff_salary_rate(v_a, 'daily', 150.00, 'weekly', '2026-01-07');
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.gross_total = '500.00' and 'rate_changed_mid_period' = any (v_line.warnings),
    '(e) period_end ' || row_to_json(v_line)::text);
  update app_private.hr_settings set value = '"per_day"' where key = 'payroll.rateSelection';
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.gross_total = '440.00', '(e) per_day ' || row_to_json(v_line)::text);
  update app_private.hr_settings set value = '"period_end"' where key = 'payroll.rateSelection';
  delete from public.employee_pay_rates where id = v_rate;
  -- (f) hourly 15.00, saved after the daily row with the same effective date (newest created_at wins):
  --     23.75 x 15.00 + 50.00 = 356.25 + 50.00 = 406.25
  v_rate := public.set_staff_salary_rate(v_a, 'hourly', 15.00, 'weekly', '2026-01-01');
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.rate_basis = 'hourly' and v_line.gross_total = '406.25', '(f) ' || row_to_json(v_line)::text);
  delete from public.employee_pay_rates where id = v_rate;
  -- (g) minimum 3 hours for a day: 2026-01-07 (2.25 h) no longer counts. gross = 2 x 120.00 + 50.00 = 290.00
  update app_private.hr_settings set value = '3' where key = 'payroll.minHoursForDay';
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.days_worked = 2 and v_line.gross_total = '290.00', '(g) ' || row_to_json(v_line)::text);
  update app_private.hr_settings set value = '0' where key = 'payroll.minHoursForDay';

  -- Triggers hold even where RLS does not apply.
  perform pg_temp.expect_refusal('a rewrite of frozen payslip figures',
    format('update public.payroll_snapshots set net_salary = 0 where id = %L', current_setting('selftest.gen3')), 'conflict');
  perform pg_temp.expect_refusal('clearing the paid facts of a void payslip',
    format('update public.payroll_snapshots set paid_at = null where id = %L', current_setting('selftest.gen2')), 'conflict');
  perform pg_temp.expect_refusal('a payslip delete',
    format('delete from public.payroll_snapshots where id = %L', current_setting('selftest.gen3')), 'conflict');
  perform pg_temp.expect_refusal('an audit row update', 'update public.audit_events set reason = null', 'conflict');
  perform pg_temp.expect_refusal('a settings value the template does not implement',
    'update app_private.hr_settings set value = ''true'' where key = ''payroll.approvalRequired''', 'validation');
  perform pg_temp.expect_refusal('an unknown settings key',
    'insert into app_private.hr_settings (key, value) values (''payroll.unknownKey'', ''1'')', 'validation');
  perform pg_temp.expect_refusal('a dated row for a key that is not a payroll key',
    'insert into app_private.hr_settings (key, value, effective_from) values (''locale.timezone'', ''"UTC"'', ''2026-01-01'')',
    '23514');
end $$;

-- 10. Super Admin: soft deletion (the seeded mode).
set local role authenticated;
do $$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_s1 uuid := current_setting('selftest.s1')::uuid;
  v_line record;
begin
  perform pg_temp.expect_refusal('a deletion without a reason',
    format('select public.delete_attendance_record(%L, %L)', v_s1, ''), 'validation');
  perform public.delete_attendance_record(v_s1, 'Entered on the wrong day');
  perform pg_temp.expect_refusal('a second deletion', format('select public.delete_attendance_record(%L, %L)', v_s1, 'Again'), 'conflict');
  perform pg_temp.expect_refusal('a correction of a deleted session',
    format('select public.correct_attendance_clock_out(%L, %L, %L)', v_s1, '2026-01-05 17:30+00', 'Late'), 'conflict');
  -- Without 2026-01-05: total_hours = 4.00 + 9.50 + 2.25 = 15.75; days_worked = 2; gross = 2 x 120.00 + 50.00 = 290.00
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.total_hours = 15.75 and v_line.days_worked = 2 and v_line.gross_total = '290.00',
    'a soft-deleted session is excluded from payroll ' || row_to_json(v_line)::text);
end $$;

-- 11. Super Admin: hard deletion keeps the deleted row in the audit context.
reset role;
update app_private.hr_settings set value = '"hard"' where key = 'attendance.deletion.mode';
set local role authenticated;
do $$
declare
  v_a uuid := '00000000-0000-4000-8000-000000000002';
  v_s2 uuid := current_setting('selftest.s2')::uuid;
  v_line record;
begin
  perform public.delete_attendance_record(v_s2, 'Entered twice');
  perform pg_temp.expect_true(not exists (select 1 from public.attendance_sessions s where s.id = v_s2), 'the hard delete removed the row');
  perform pg_temp.expect_true(exists (select 1 from public.audit_events a
    where a.action = 'attendance.delete' and a.entity_id = v_s2 and a.context -> 'deleted_row' ->> 'id' = v_s2::text),
    'the hard delete keeps the deleted row in the audit context');
  -- Without the 08:00-12:00 session: total_hours = 9.50 + 2.25 = 11.75; days_worked = 2; gross = 290.00
  select * into v_line from public.report_payroll('2026-01-05', '2026-01-08') l where l.employee_id = v_a;
  perform pg_temp.expect_true(v_line.total_hours = 11.75 and v_line.days_worked = 2 and v_line.gross_total = '290.00',
    'payroll after the hard delete ' || row_to_json(v_line)::text);
  raise notice 'SELFTEST OK';
end $$;

rollback;
