-- ============================================================================
-- Payroll payslips — IMMUTABLE snapshots (Bible §F).
-- ----------------------------------------------------------------------------
-- A payslip freezes the pay figures at generation time, so editing an hourly
-- rate or attendance later NEVER changes an already-issued payslip. Every figure
-- is computed in SQL from the existing authoritative reader (report_payroll) plus
-- the recorded overtime pay — the frontend never re-derives salary.
--
-- Overtime pay = the flat late-night overtime already recorded per clock-in
-- (attendance_records.overtime_amount). Deductions are supplied at generation
-- time (default 0). Both are the confirmed provisional rules and can change
-- later WITHOUT rewriting past snapshots.
-- ============================================================================

create table public.payroll_snapshots (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.staff_profiles (id) on delete restrict,
  payroll_start_date date not null,
  payroll_end_date date not null,
  regular_hours numeric(10, 2) not null default 0,
  overtime_hours numeric(10, 2) not null default 0,
  -- The hourly rate AS IT WAS when generated (null if none was set).
  hourly_rate numeric(10, 2),
  regular_salary numeric(12, 2) not null default 0,
  overtime_pay numeric(12, 2) not null default 0,
  gross_salary numeric(12, 2) not null default 0,
  deductions numeric(12, 2) not null default 0 check (deductions >= 0),
  net_salary numeric(12, 2) not null default 0,
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'paid')),
  payment_date date,
  approved_by uuid references public.staff_profiles (id),
  generated_by uuid references public.staff_profiles (id),
  generated_at timestamptz not null default now(),
  constraint payroll_period_valid check (payroll_end_date >= payroll_start_date)
);

comment on table public.payroll_snapshots is
  'Immutable payslip snapshots. Figures are frozen at generation time so later rate/attendance edits never change an issued payslip (Bible §F). All money numeric in SQL, a string on the wire.';

create index payroll_snapshots_employee_idx
  on public.payroll_snapshots (employee_id, generated_at desc);
create index payroll_snapshots_period_idx
  on public.payroll_snapshots (payroll_start_date, payroll_end_date);

alter table public.payroll_snapshots enable row level security;
alter table public.payroll_snapshots force row level security;
revoke all on public.payroll_snapshots from anon, authenticated;

-- Read: own payslips, or all for the Owner (mirrors report_payroll access).
create policy payroll_snapshots_read on public.payroll_snapshots
  for select to authenticated
  using (
    employee_id = app_private.current_staff_id() or app_private.is_owner()
  );

-- Write: Owner only — generating and marking-paid are money acts.
create policy payroll_snapshots_insert on public.payroll_snapshots
  for insert to authenticated
  with check (app_private.is_owner());

create policy payroll_snapshots_update on public.payroll_snapshots
  for update to authenticated
  using (app_private.is_owner())
  with check (app_private.is_owner());

-- No delete: an issued payslip is a record, not something to erase.
grant select, insert, update on public.payroll_snapshots to authenticated;

-- ----------------------------------------------------------------------------
-- Compute a payslip snapshot from the existing SQL and insert it. SECURITY
-- INVOKER, so the RLS insert (Owner-only) is the real gate. The money math lives
-- here, once — never re-implemented in the client.
-- ----------------------------------------------------------------------------
create or replace function public.generate_payslip_snapshot(
  p_employee uuid,
  p_from date,
  p_to date,
  p_deductions numeric default 0
)
returns public.payroll_snapshots
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_reg_hours numeric;
  v_ot_hours numeric;
  v_rate numeric;
  v_ot_pay numeric;
  v_regular_salary numeric;
  v_gross numeric;
  v_deductions numeric := greatest(coalesce(p_deductions, 0), 0);
  v_row public.payroll_snapshots;
begin
  -- Hours + rate from the existing authoritative reader (RLS-scoped).
  select total_hours, overtime_hours, nullif(hourly_rate, '')::numeric
    into v_reg_hours, v_ot_hours, v_rate
  from public.report_payroll(p_from, p_to)
  where staff_profile_id = p_employee;

  if not found then
    raise exception 'No payroll row for this employee in the selected period.';
  end if;

  -- Overtime pay = the recorded flat late-night overtime for completed sessions.
  select coalesce(sum(overtime_amount), 0) into v_ot_pay
  from public.attendance_records
  where staff_profile_id = p_employee
    and time_out is not null
    and work_date between p_from and p_to;

  v_regular_salary := round(coalesce(v_reg_hours, 0) * coalesce(v_rate, 0), 2);
  v_gross := v_regular_salary + coalesce(v_ot_pay, 0);

  insert into public.payroll_snapshots (
    employee_id, payroll_start_date, payroll_end_date,
    regular_hours, overtime_hours, hourly_rate,
    regular_salary, overtime_pay, gross_salary, deductions, net_salary,
    generated_by
  ) values (
    p_employee, p_from, p_to,
    round(coalesce(v_reg_hours, 0), 2), round(coalesce(v_ot_hours, 0), 2), v_rate,
    v_regular_salary, coalesce(v_ot_pay, 0), v_gross, v_deductions,
    v_gross - v_deductions,
    app_private.current_staff_id()
  )
  returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.generate_payslip_snapshot(uuid, date, date, numeric)
  to authenticated;

insert into app_private.provisional_fields (table_name, column_name, bible_reference, note) values
  ('payroll_snapshots', 'overtime_pay', '§F',
   'Overtime pay = recorded flat late-night OT (attendance_records.overtime_amount). Rule provisional; changing it does not rewrite past snapshots.'),
  ('payroll_snapshots', 'deductions', '§F',
   'Deductions entered at generation time (default 0). No standing deduction rules yet; awaiting Owner policy.')
on conflict (table_name, column_name) do nothing;
