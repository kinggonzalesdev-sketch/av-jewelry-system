-- ============================================================================
-- 0001 SETTINGS: the SQL-evaluated configuration keys, their readers, eligibility and the night rule.
-- ----------------------------------------------------------------------------
-- CURRENT: rules are literals at their point of use (timezone in the clock-in function,
-- M/20260907120000:45; hour 22 and a flat amount in the insert trigger, M/20260722200000:34-37;
-- 22:00 and 8 hours in report_payroll, M/20260907160000:41, 51). The only setting-like object,
-- app_private.night_ot_bonus(), is RECONSTRUCTED.
-- GENERIC (DATABASE.md 5.12; CONFIGURATION.md 1.2 to 1.4 and 2.8): one key-value store,
-- app_private.hr_settings(key, value jsonb, effective_from). Keys are the CONFIGURATION.md key names.
-- A payroll.* key may hold several effective-dated rows; every other key holds only the '-infinity'
-- row, so the timezone never changes by date. Per-session and per-day payroll keys are read as in
-- force on the session's work_date; period-wide keys as of the period end (CONFIGURATION.md 1.4).
-- The seed below writes every key of CONFIGURATION.md 2.8 with its recommended default. Keys that
-- are set at onboarding are seeded as JSON null, and every reader that needs them raises until they
-- are set, so nothing runs on a guessed value. No reference value is seeded.
-- The store refuses an unknown key and any value the SQL of this template does not implement
-- (for example payroll.approvalRequired = true), instead of silently ignoring it.
-- Changes: by reviewed migration. The optional runtime editor set_hr_setting (DATABASE.md 5.12) is
-- not built here.
-- RECOMMENDED TEMPLATE IMPROVEMENTS: one night predicate, computed on read, with an optional window
-- end (CURRENT has two rules and no window, M/20260722200000:34-37 and M/20260907160000:41); one
-- eligibility predicate (CURRENT roster lists demo accounts, M/20260907160000:20-25, and clock-in
-- accepts a Super Admin target, M/20260907120000:30-37).
-- Rollback: drop trigger employees_apply_exclusions on public.employees; drop the functions of this
-- file; drop table app_private.hr_settings; update public.employees set timekeeping_exempt = false
-- only if no other module relies on it.
-- ============================================================================

create table if not exists app_private.hr_settings (
  key text not null check (length(key) between 1 and 120),
  value jsonb not null,                                      -- JSON null means "not configured"
  effective_from date not null default '-infinity',
  updated_by uuid references public.employees (id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (key, effective_from),
  constraint hr_settings_dated_keys check (effective_from = '-infinity' or key like 'payroll.%')
);

alter table app_private.hr_settings enable row level security;
alter table app_private.hr_settings force row level security;
revoke all on app_private.hr_settings from public, anon, authenticated;

-- Refuses unknown keys and unsupported values; stamps who changed the row.
create or replace function app_private.hr_settings_validate() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_type text;
  v_text text;
  v_ok boolean;
begin
  v_type := pg_catalog.jsonb_typeof(new.value);
  v_text := new.value #>> '{}';
  case new.key
    when 'locale.timezone' then
      v_ok := case v_type
        when 'null' then true
        when 'string' then exists (select 1 from pg_catalog.pg_timezone_names z where z.name = v_text)
        else false end;
    when 'payroll.nightRule.enabled', 'payroll.nightRule.oncePerDay', 'payroll.allowNegativeNet',
         'attendance.allowMultipleSessionsPerDay', 'audit.payloadIncludesAmounts' then
      v_ok := v_type = 'boolean';
    when 'payroll.nightRule.anchor' then
      v_ok := v_type = 'null' or (v_type = 'string' and v_text in ('clock_in', 'clock_out'));
    when 'payroll.nightRule.thresholdTime', 'payroll.nightRule.windowEnd' then
      v_ok := v_type = 'null' or (v_type = 'string' and v_text ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
    when 'payroll.nightRule.bonusAmount' then
      v_ok := v_type = 'string' and v_text ~ '^[0-9]{1,10}([.][0-9]{1,2})?$';
    when 'payroll.overtimeDisplayThresholdHours' then
      v_ok := case v_type
        when 'null' then true
        when 'number' then v_text::numeric > 0 and v_text::numeric <= 24
        else false end;
    when 'payroll.minHoursForDay' then
      v_ok := case v_type when 'number' then v_text::numeric >= 0 and v_text::numeric <= 24 else false end;
    when 'payroll.overtimeBasis' then
      v_ok := v_type = 'string' and v_text in ('session', 'day');
    when 'payroll.rateSelection' then
      v_ok := v_type = 'string' and v_text in ('period_end', 'per_day');
    when 'payroll.payFrequencies' then
      v_ok := case v_type
        when 'null' then true
        when 'array' then pg_catalog.jsonb_array_length(new.value) > 0 and not exists (
          select 1 from pg_catalog.jsonb_array_elements(new.value) as f(item)
          where pg_catalog.jsonb_typeof(f.item) <> 'string'
             or (f.item #>> '{}') not in ('weekly', 'bi_weekly', 'semi_monthly', 'monthly'))
        else false end;
    when 'payroll.approvalRequired' then
      v_ok := new.value = 'false'::jsonb;              -- day approval is not built here
    when 'payroll.lockPeriodAfterPayslip' then
      v_ok := new.value = '"off"'::jsonb;              -- the period lock is not built here
    when 'payroll.overtimePayMultiplier' then
      v_ok := new.value = '0'::jsonb;                  -- overtime hours are never paid
    when 'payroll.deductionsModel' then
      v_ok := new.value = '"lump_sum"'::jsonb;         -- itemized deductions are not built here
    when 'attendance.device.mode' then
      v_ok := v_type = 'string' and v_text in ('off', 'auto', 'required');
    when 'attendance.device.maxActiveDevices' then
      v_ok := case v_type
        when 'number' then v_text::numeric >= 1 and v_text::numeric <= 1000 and v_text::numeric = pg_catalog.trunc(v_text::numeric)
        else false end;
    when 'attendance.device.defaultLabel' then
      v_ok := v_type = 'string' and length(btrim(v_text)) between 1 and 80;
    when 'attendance.clockMode' then
      v_ok := v_type = 'null' or new.value = '"kiosk"'::jsonb;   -- self_service is not built here
    when 'attendance.correction.maxWindowDays' then
      v_ok := case v_type
        when 'null' then true
        when 'number' then v_text::numeric >= 1 and v_text::numeric <= 3650 and v_text::numeric = pg_catalog.trunc(v_text::numeric)
        else false end;
    when 'attendance.deletion.mode' then
      v_ok := v_type = 'string' and v_text in ('soft', 'hard');
    when 'attendance.selfie.mode' then
      v_ok := v_type = 'string' and v_text in ('off', 'optional');   -- required is not built here
    when 'review.dateFilterBasis' then
      v_ok := v_type = 'string' and v_text in ('work_date', 'time_in');
    when 'exclusions.excludedRoles' then
      v_ok := case v_type
        when 'array' then not exists (
          select 1 from pg_catalog.jsonb_array_elements(new.value) as r(item)
          where pg_catalog.jsonb_typeof(r.item) <> 'string' or length(r.item #>> '{}') not between 1 and 80)
        else false end;
    when 'exclusions.excludeDemoAccounts' then
      v_ok := new.value = 'true'::jsonb;               -- fixed true
    else
      raise exception 'Unknown setting key: %', new.key using hint = 'validation';
  end case;
  if not coalesce(v_ok, false) then
    raise exception 'Invalid or unsupported value for setting %: %', new.key, new.value using hint = 'validation';
  end if;
  new.updated_at := now();
  new.updated_by := app_private.current_staff_id();
  return new;
end $$;

create or replace trigger hr_settings_validate
  before insert or update on app_private.hr_settings
  for each row execute function app_private.hr_settings_validate();

-- Seed: every key of CONFIGURATION.md 2.8 with its recommended default; JSON null = set at onboarding.
insert into app_private.hr_settings (key, value) values
  ('locale.timezone', 'null'),
  ('payroll.nightRule.enabled', 'false'),
  ('payroll.nightRule.anchor', 'null'),
  ('payroll.nightRule.thresholdTime', 'null'),
  ('payroll.nightRule.windowEnd', 'null'),
  ('payroll.nightRule.bonusAmount', '"0.00"'),
  ('payroll.nightRule.oncePerDay', 'true'),
  ('payroll.overtimeDisplayThresholdHours', 'null'),
  ('payroll.overtimeBasis', '"session"'),
  ('payroll.minHoursForDay', '0'),
  ('payroll.rateSelection', '"period_end"'),
  ('payroll.approvalRequired', 'false'),
  ('payroll.allowNegativeNet', 'false'),
  ('payroll.lockPeriodAfterPayslip', '"off"'),
  ('payroll.payFrequencies', 'null'),
  ('payroll.overtimePayMultiplier', '0'),
  ('payroll.deductionsModel', '"lump_sum"'),
  ('attendance.device.mode', '"auto"'),
  ('attendance.device.maxActiveDevices', '1'),
  ('attendance.device.defaultLabel', '"Time clock"'),
  ('attendance.allowMultipleSessionsPerDay', 'true'),
  ('attendance.clockMode', 'null'),
  ('attendance.correction.maxWindowDays', 'null'),
  ('attendance.deletion.mode', '"soft"'),
  ('attendance.selfie.mode', '"off"'),
  ('review.dateFilterBasis', '"work_date"'),
  ('exclusions.excludedRoles', '[]'),
  ('exclusions.excludeDemoAccounts', 'true'),
  ('audit.payloadIncludesAmounts', 'false')
on conflict (key, effective_from) do nothing;

-- Readers. The timezone reader takes the '-infinity' row directly, so business_today() never recurses.
create or replace function app_private.business_timezone() returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone text;
begin
  select s.value #>> '{}' into v_zone
  from app_private.hr_settings s where s.key = 'locale.timezone' and s.effective_from = '-infinity';
  if v_zone is null then
    raise exception 'The business timezone (locale.timezone) is not configured.' using hint = 'unavailable';
  end if;
  return v_zone;
end $$;

create or replace function app_private.business_today() returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone app_private.business_timezone())::date
$$;

-- The value in force on p_as_of (default: business today); raises when the key has no row in force.
-- A key without dated rows can be read with any as-of date.
create or replace function app_private.hr_setting(p_key text, p_as_of date default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_as_of date := coalesce(p_as_of, app_private.business_today());
  v_value jsonb;
begin
  select s.value into v_value
  from app_private.hr_settings s
  where s.key = p_key and s.effective_from <= v_as_of
  order by s.effective_from desc
  limit 1;
  if not found then
    raise exception 'Setting % has no value in force on %.', p_key, v_as_of using hint = 'unavailable';
  end if;
  return v_value;
end $$;

-- A required scalar as text: raises while the value is JSON null (not configured).
create or replace function app_private.hr_setting_text(p_key text, p_as_of date default null) returns text
language plpgsql stable security definer set search_path = '' as $$
declare
  v_text text;
begin
  v_text := app_private.hr_setting(p_key, p_as_of) #>> '{}';
  if v_text is null then
    raise exception 'Setting % is not configured.', p_key using hint = 'unavailable';
  end if;
  return v_text;
end $$;

-- Replaces CURRENT night_ot_bonus() (RECONSTRUCTED).
create or replace function app_private.night_bonus_amount(p_as_of date) returns numeric
language sql stable security definer set search_path = '' as $$
  select app_private.hr_setting_text('payroll.nightRule.bonusAmount', p_as_of)::numeric
$$;

-- The ONE night predicate (DATABASE.md 5.12; PAYROLL.md 4 GENERIC). Keys as in force on the business
-- date of p_time_in. Qualifies when the business-time time of day of the anchored instant is at or
-- after thresholdTime, or, when windowEnd is set, before windowEnd. False when the rule is disabled,
-- or when the anchor is clock_out and the session is open. Raises on an incomplete configuration.
create or replace function app_private.is_night_session(p_time_in timestamptz, p_time_out timestamptz)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_zone text;
  v_as_of date;
  v_anchor text;
  v_threshold time;
  v_window_end time;
  v_instant timestamptz;
  v_local time;
begin
  if p_time_in is null then
    return false;
  end if;
  v_zone := app_private.business_timezone();
  v_as_of := (p_time_in at time zone v_zone)::date;
  if not app_private.hr_setting_text('payroll.nightRule.enabled', v_as_of)::boolean then
    return false;
  end if;
  v_anchor := app_private.hr_setting_text('payroll.nightRule.anchor', v_as_of);
  v_threshold := app_private.hr_setting_text('payroll.nightRule.thresholdTime', v_as_of)::time;
  v_window_end := (app_private.hr_setting('payroll.nightRule.windowEnd', v_as_of) #>> '{}')::time;
  if v_window_end is not null and v_window_end >= v_threshold then
    raise exception 'payroll.nightRule.windowEnd must be earlier than thresholdTime.' using hint = 'unavailable';
  end if;
  v_instant := case v_anchor when 'clock_in' then p_time_in else p_time_out end;
  if v_instant is null then
    return false;
  end if;
  v_local := (v_instant at time zone v_zone)::time;
  return v_local >= v_threshold or (v_window_end is not null and v_local < v_window_end);
end $$;

-- One eligibility rule for roster, status, clock, rates and payroll: active, not demo, not exempt.
create or replace function app_private.is_timekeeping_eligible(p_employee_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select e.is_active and not e.timekeeping_exempt
           and not (e.is_demo and app_private.hr_setting_text('exclusions.excludeDemoAccounts', '-infinity')::boolean)
    from public.employees e where e.id = p_employee_id
  ), false)
$$;

-- exclusions.excludedRoles only seeds the flag (DATABASE.md 5.2): a profile created in, or moved into,
-- a listed role becomes exempt; leaving the role does not clear it. Definer, so a host role that
-- writes employees needs no EXECUTE on the private readers.
create or replace function app_private.employees_apply_exclusions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.role_key in (
    select pg_catalog.jsonb_array_elements_text(app_private.hr_setting('exclusions.excludedRoles', '-infinity'))
  ) then
    new.timekeeping_exempt := true;
  end if;
  return new;
end $$;

create or replace trigger employees_apply_exclusions
  before insert or update of role_key on public.employees
  for each row execute function app_private.employees_apply_exclusions();

-- Backfill existing profiles (no-op while the list is empty, the default).
update public.employees e set timekeeping_exempt = true
where not e.timekeeping_exempt
  and e.role_key in (select pg_catalog.jsonb_array_elements_text(app_private.hr_setting('exclusions.excludedRoles', '-infinity')));

-- The values in force today, for the application to render labels and defaults from the same values
-- SQL uses (CONFIGURATION.md 1.3). Active accounts only.
create or replace function public.get_hr_settings() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_today date;
  v_result jsonb;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active account is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  v_today := app_private.business_today();
  select pg_catalog.jsonb_object_agg(k.key, app_private.hr_setting(k.key, v_today)) into v_result
  from (select distinct s.key from app_private.hr_settings s) k;
  return coalesce(v_result, '{}'::jsonb);
end $$;

revoke all on function app_private.hr_settings_validate(), app_private.employees_apply_exclusions()
  from public, anon, authenticated;
revoke all on function app_private.business_timezone(), app_private.business_today(), app_private.hr_setting(text, date),
  app_private.hr_setting_text(text, date), app_private.night_bonus_amount(date),
  app_private.is_night_session(timestamptz, timestamptz), app_private.is_timekeeping_eligible(uuid),
  public.get_hr_settings() from public, anon;
grant execute on function app_private.business_timezone(), app_private.business_today(), app_private.hr_setting(text, date),
  app_private.hr_setting_text(text, date), app_private.night_bonus_amount(date),
  app_private.is_night_session(timestamptz, timestamptz), app_private.is_timekeeping_eligible(uuid),
  public.get_hr_settings() to authenticated, service_role;
