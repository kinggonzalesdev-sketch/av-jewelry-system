-- Payroll (and the Team Members roster) source only REAL team members. The seeded
-- demo/UAT accounts are excluded at the DATA layer via a persistent `is_demo` flag
-- (set once here — no runtime name/email matching). Demo accounts stay active auth
-- users so demo login keeps working; they are simply not real employees. All
-- attendance/payroll history is preserved (nothing deleted).

alter table public.staff_profiles
  add column if not exists is_demo boolean not null default false;

update public.staff_profiles sp
set is_demo = true
from auth.users u
where u.id = sp.auth_user_id
  and u.email like 'uat-%@uat.local'
  and sp.is_demo = false;

-- report_payroll: identical computation, source narrowed to active, non-demo team
-- members (adds `and not sp.is_demo`). Hours from attendance by staff_profile_id;
-- rate/salary unchanged; still self-scoped (own row) or all for the Owner.
create or replace function public.report_payroll(p_from date, p_to date)
returns table(
  staff_profile_id uuid, full_name text, role_key text,
  total_hours numeric, overtime_hours numeric, hourly_rate text, computed_salary text
)
language sql
stable
set search_path to ''
as $function$
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
    sp.hourly_rate::text as hourly_rate,
    case
      when sp.hourly_rate is null then null
      else round(coalesce(t.total_hours, 0) * sp.hourly_rate, 2)::text
    end as computed_salary
  from public.staff_profiles sp
  left join totals t on t.staff_profile_id = sp.id
  where sp.is_active
    and not sp.is_demo
    and (sp.id = app_private.current_staff_id() or app_private.is_owner())
  order by sp.full_name;
$function$;
