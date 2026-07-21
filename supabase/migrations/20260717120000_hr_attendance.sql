-- ============================================================================
-- HR: Attendance & Payroll (business problem #15; solution F).
-- ----------------------------------------------------------------------------
-- Replaces the unreliable biometric with a tamper-evident digital record:
-- staff clock in/out, and payroll (hours / overtime / salary) is computed from
-- those records. A staff member sees only THEIR OWN attendance; the Owner sees
-- everyone. All money is numeric in SQL and crosses to the client as a string.
-- ============================================================================

-- Per-staff hourly rate for payroll. Nullable: salary is only computed once a
-- rate is set (never invented).
alter table public.staff_profiles
  add column hourly_rate numeric(10, 2)
    check (hourly_rate is null or hourly_rate >= 0);

comment on column public.staff_profiles.hourly_rate is
  'Hourly rate for payroll. Nullable — salary is computed only when a rate is set (Bible §F).';

-- ----------------------------------------------------------------------------
-- Attendance records — one row per work session (clock in → clock out).
-- ----------------------------------------------------------------------------
create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  staff_profile_id uuid not null references public.staff_profiles (id) on delete restrict,
  work_date date not null default current_date,
  time_in timestamptz not null default now(),
  time_out timestamptz,
  note text check (note is null or length(trim(note)) <= 500),
  created_at timestamptz not null default now(),

  -- Clock-out is never before clock-in.
  constraint attendance_time_out_after_in check (time_out is null or time_out >= time_in)
);

comment on table public.attendance_records is
  'Digital attendance (Bible §F). One row per session. A staff member owns their own rows; the Owner sees all. Payroll is derived from these, never hand-entered.';

create index attendance_staff_date_idx
  on public.attendance_records (staff_profile_id, work_date desc);

-- At most ONE open session (no clock-out) per staff member — you cannot clock in
-- twice without clocking out.
create unique index attendance_one_open_session_per_staff
  on public.attendance_records (staff_profile_id)
  where time_out is null;

alter table public.attendance_records enable row level security;
alter table public.attendance_records force row level security;
revoke all on public.attendance_records from anon, authenticated;

-- Read: own rows, or everything for the Owner.
create policy attendance_read on public.attendance_records
  for select to authenticated
  using (
    staff_profile_id = app_private.current_staff_id() or app_private.is_owner()
  );

-- Insert: a staff member clocks in for THEMSELVES only.
create policy attendance_insert on public.attendance_records
  for insert to authenticated
  with check (staff_profile_id = app_private.current_staff_id());

-- Update: a staff member clocks out their OWN open session; the Owner may
-- correct any record. Never a delete (attendance is not erased).
create policy attendance_update on public.attendance_records
  for update to authenticated
  using (
    staff_profile_id = app_private.current_staff_id() or app_private.is_owner()
  )
  with check (
    staff_profile_id = app_private.current_staff_id() or app_private.is_owner()
  );

-- Named grants only (the S3 lesson). No delete.
grant select, insert, update on public.attendance_records to authenticated;

-- ----------------------------------------------------------------------------
-- Payroll aggregation — hours / overtime / salary computed IN SQL.
-- ----------------------------------------------------------------------------
-- security invoker: RLS on attendance_records scopes the rows, so a non-Owner
-- only ever sees their own totals; the Owner sees everyone. Overtime is per
-- session beyond 8h (a first, honest rule — the exact policy is provisional).
-- Salary is numeric in SQL, returned as a STRING (never a JS float); null when
-- no hourly rate is set.
create or replace function public.report_payroll(p_from date, p_to date)
returns table (
  staff_profile_id uuid,
  full_name text,
  role_key text,
  total_hours numeric,
  overtime_hours numeric,
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
  'Payroll from attendance (Bible §F). Hours/OT/salary computed in SQL; salary is a string, null without a rate. security invoker — RLS scopes rows to self/Owner.';

revoke all on function public.report_payroll(date, date) from public;
grant execute on function public.report_payroll(date, date) to authenticated;

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('attendance_records', 'time_out', '§F',
   'Overtime rule is provisional (per-session beyond 8h). Exact OT / night-diff / holiday policy awaiting client confirmation.')
on conflict (table_name, column_name) do nothing;
