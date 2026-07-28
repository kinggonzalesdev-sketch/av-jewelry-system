-- ============================================================================
-- HR #4 polish — surface the hourly rate so the Owner can edit it (Bible §F).
-- ----------------------------------------------------------------------------
-- The rate already lives on staff_profiles.hourly_rate, and only the Owner may
-- update it (RLS policy staff_profiles_update_owner). What was missing was a way
-- to SEE the current rate next to the payroll it drives. report_payroll now
-- returns it too — numeric in SQL, crossing to the client as a STRING (never a
-- JS float), or null when unset (honestly blank, never invented).
--
-- Adding a column to a RETURNS TABLE changes the function's result type, which
-- CREATE OR REPLACE cannot do — so we DROP and recreate, then re-apply the exact
-- same grants (revoke the automatic PUBLIC execute; grant authenticated only).
-- The body is unchanged except for the new hourly_rate output column. Still
-- security invoker: RLS on staff_profiles/attendance_records scopes every row to
-- self-or-Owner, so a Staff member sees only their own rate, the Owner sees all.
-- ============================================================================

drop function if exists public.report_payroll(date, date);

create function public.report_payroll(p_from date, p_to date)
returns table (
  staff_profile_id uuid,
  full_name text,
  role_key text,
  total_hours numeric,
  overtime_hours numeric,
  hourly_rate text,
  computed_salary text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with sessions as (
    select
      a.staff_profile_id,
      extract(epoch from (a.time_out - a.time_in)) / 3600.0 as hours
    from public.attendance_records a
    where a.time_out is not null
      and a.work_date between p_from and p_to
  ),
  totals as (
    select
      staff_profile_id,
      sum(hours) as total_hours,
      sum(greatest(hours - 8, 0)) as overtime_hours
    from sessions
    group by staff_profile_id
  )
  select
    sp.id,
    sp.full_name,
    sp.role_key,
    round(coalesce(t.total_hours, 0), 2) as total_hours,
    round(coalesce(t.overtime_hours, 0), 2) as overtime_hours,
    -- Rate is numeric in SQL; hand it over as a string, null when unset.
    sp.hourly_rate::text as hourly_rate,
    case
      when sp.hourly_rate is null then null
      else round(coalesce(t.total_hours, 0) * sp.hourly_rate, 2)::text
    end as computed_salary
  from public.staff_profiles sp
  left join totals t on t.staff_profile_id = sp.id
  where sp.is_active
    and (sp.id = app_private.current_staff_id() or app_private.is_owner())
  order by sp.full_name;
$$;

comment on function public.report_payroll(date, date) is
  'Payroll from attendance (Bible §F). Hours/OT/rate/salary computed in SQL; rate and salary are strings, null without a rate. security invoker — RLS scopes rows to self/Owner.';

revoke all on function public.report_payroll(date, date) from public;
grant execute on function public.report_payroll(date, date) to authenticated;
