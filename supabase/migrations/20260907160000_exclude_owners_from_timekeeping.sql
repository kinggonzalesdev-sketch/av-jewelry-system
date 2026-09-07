-- Exclude Owners from timekeeping + payroll (Owner 2026-09-07).
--
-- The Owners (role_key = 'owner': King Gonzales + April Mendoza Vergel) do NOT clock in/out and
-- are not on payroll, so drop them from the clock-in roster, the Review Attendance roster (both
-- read list_clock_staff), and the Payroll report. A Selected-Admin account (e.g. the second
-- "King Gonzales", role_key = 'selected_admin') is NOT an owner and stays. CREATE OR REPLACE
-- preserves existing grants.

create or replace function public.list_clock_staff()
 returns table(id uuid, full_name text, role_key text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if not app_private.has_permission('hr_attendance') then
    raise exception 'Not authorized: attendance access is required to view the clock roster.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
    select sp.id, sp.full_name, sp.role_key
    from public.staff_profiles sp
    where sp.is_active
      and sp.role_key <> 'owner'   -- Owners don't clock in/out (Owner 2026-09-07)
    order by sp.full_name;
end;
$function$;

create or replace function public.report_payroll(p_from date, p_to date)
 returns table(staff_profile_id uuid, full_name text, role_key text, total_hours numeric, overtime_hours numeric, days_worked integer, night_shifts integer, daily_rate text, pay_frequency text, overtime_pay text, computed_salary text)
 language sql
 stable
 set search_path to ''
as $function$
  with sessions as (
    select
      a.staff_profile_id,
      a.work_date,
      extract(epoch from (a.time_out - a.time_in)) / 3600.0 as hours,
      -- "Out from 10pm" is judged in MANILA time; a UTC hour would be 8 off.
      ((a.time_out at time zone 'Asia/Manila')::time >= time '22:00') as night_out
    from public.attendance_records a
    where a.time_out is not null
      and a.work_date between p_from and p_to
  ),
  totals as (
    select
      staff_profile_id,
      sum(hours) as total_hours,
      -- Hours beyond 8 are still reported for visibility; pay uses the flat bonus.
      sum(greatest(hours - 8, 0)) as overtime_hours,
      count(distinct work_date)::int as days_worked,
      -- The night bonus is per DAY, not per session — a day with two late sessions
      -- still earns exactly one ₱300 bonus.
      count(distinct work_date) filter (where night_out)::int as night_shifts
    from sessions
    group by staff_profile_id
  ),
  effective_rate as (
    select sp.id as staff_profile_id,
      (
        select r.daily_rate from public.staff_salary_rates r
        where r.staff_profile_id = sp.id and r.effective_date <= p_to
        order by r.effective_date desc, r.created_at desc
        limit 1
      ) as rate,
      (
        select r.pay_frequency from public.staff_salary_rates r
        where r.staff_profile_id = sp.id and r.effective_date <= p_to
        order by r.effective_date desc, r.created_at desc
        limit 1
      ) as frequency
    from public.staff_profiles sp
  )
  select
    sp.id,
    sp.full_name,
    sp.role_key,
    round(coalesce(t.total_hours, 0), 2) as total_hours,
    round(coalesce(t.overtime_hours, 0), 2) as overtime_hours,
    coalesce(t.days_worked, 0) as days_worked,
    coalesce(t.night_shifts, 0) as night_shifts,
    er.rate::text as daily_rate,
    coalesce(er.frequency, 'weekly') as pay_frequency,
    (coalesce(t.night_shifts, 0) * app_private.night_ot_bonus())::text as overtime_pay,
    case
      when er.rate is null then null
      else round(
        coalesce(t.days_worked, 0) * er.rate
        + coalesce(t.night_shifts, 0) * app_private.night_ot_bonus(),
        2
      )::text
    end as computed_salary
  from public.staff_profiles sp
  left join totals t on t.staff_profile_id = sp.id
  left join effective_rate er on er.staff_profile_id = sp.id
  where sp.is_active
    and not sp.is_demo
    and sp.role_key <> 'owner'   -- Owners are not on payroll (Owner 2026-09-07)
    and (sp.id = app_private.current_staff_id() or app_private.is_owner())
  order by sp.full_name;
$function$;
