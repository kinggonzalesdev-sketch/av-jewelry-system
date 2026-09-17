-- ============================================================================
-- 0007 PAYROLL: rates, the one computation, frozen payslips, mark paid, void. DATABASE.md 5.8, 5.9, 5.13.
-- ----------------------------------------------------------------------------
-- CURRENT kept: payroll is derived from completed sessions in SQL on every read; days_worked = distinct
-- work dates with a completed session (M/20260907160000:52); hours beyond a threshold per session are
-- reported, never paid (:50-51); one rate per period, the newest row with effective_date on or before
-- the period end, ties broken by created_at (:59-74); gross = round(days_worked x daily rate + night
-- shifts x night amount, 2), null without a rate (:86-93); money leaves SQL as text; a payslip is a
-- frozen row with one lump-sum deduction >= 0 and status pending then paid (M/20260722210000:15-36).
-- RECOMMENDED TEMPLATE IMPROVEMENTS, each against CURRENT:
--   * DDL for the rate table and the rate function (CURRENT: both RECONSTRUCTED); rates append-only.
--   * app_private.payroll_lines: a DEFINER computation with the caller filter inside it (eligible AND
--     (own row OR payroll.view_all)); report_payroll is a thin INVOKER wrapper. CURRENT report_payroll
--     is INVOKER and depends on the caller's RLS over rates and the bonus function (:29-34, 100).
--   * One night predicate with dated settings (CURRENT: two rules, the pay rule at :41).
--   * minHoursForDay, overtime basis day, per_day rate selection and the hourly basis (PAYROLL.md 11);
--     warnings no_rate, open_session_in_period, rate_changed_mid_period (and unsupported_rate_basis).
--   * The payslip reads the SAME computation (the repository payslip body is stale,
--     M/20260722210000:75-132; the live body is RECONSTRUCTED).
--   * Negative net refused unless payroll.allowNegativeNet (CURRENT: no check, :28).
--   * One current payslip per period (partial unique index); regeneration supersedes a pending row
--     and is refused on a paid row; void is the only reverse path. CURRENT: two plain indexes (:41-44)
--     and a reader that keeps the newest row (src/lib/hr/payslip.ts:66-80).
--   * mark_payslip_paid instead of a direct UPDATE (src/lib/hr/payslip-actions.ts:124-135); a freeze
--     trigger instead of convention (CURRENT update policy is not column-limited, :62-65).
--   * Success rows audited in SQL; amounts in the context only when audit.payloadIncludesAmounts.
-- monthly: the rate CHECK keeps the value, but no formula exists (PAYROLL.md 11 step 4), so
-- set_staff_salary_rate refuses it and a monthly row yields a null gross with a warning.
-- Rollback: drop the functions of this file; drop tables public.payroll_snapshots and
-- public.employee_pay_rates.
-- ============================================================================

create table if not exists public.employee_pay_rates (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  rate_basis text not null check (rate_basis in ('daily', 'hourly', 'monthly')),
  rate_amount numeric(12, 2) not null check (rate_amount >= 0),
  pay_frequency text not null,                 -- validated against payroll.payFrequencies by the function
  effective_date date not null,
  created_by uuid not null references public.employees (id) on delete restrict,
  -- clock_timestamp, not now(): two rows saved in one transaction still get a deterministic order.
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists employee_pay_rates_lookup_idx
  on public.employee_pay_rates (employee_id, effective_date desc, created_at desc);

create table if not exists public.payroll_snapshots (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete restrict,
  payroll_start_date date not null,
  payroll_end_date date not null,
  rate_basis text not null check (rate_basis in ('daily', 'hourly', 'monthly')),
  rate_amount numeric(12, 2) not null check (rate_amount >= 0),   -- the rate in force on the period end
  pay_frequency text not null,
  total_hours numeric(10, 2) not null default 0,
  overtime_hours numeric(10, 2) not null default 0,                -- display only
  days_worked integer not null default 0 check (days_worked >= 0),
  night_shifts integer not null default 0 check (night_shifts >= 0),
  regular_salary numeric(12, 2) not null default 0,
  overtime_pay numeric(12, 2) not null default 0,                  -- the night bonus pay (IMPLEMENTATION_PROMPT.md P13)
  gross_salary numeric(12, 2) not null default 0,
  deductions numeric(12, 2) not null default 0 check (deductions >= 0),
  net_salary numeric(12, 2) not null default 0,                    -- add check (net_salary >= 0) when negative net is never allowed
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'void')),
  payment_date date,
  paid_at timestamptz,
  paid_by uuid references public.employees (id) on delete restrict,
  voided_at timestamptz,
  voided_by uuid references public.employees (id) on delete restrict,
  void_reason text,
  superseded_by uuid,
  generated_by uuid not null references public.employees (id) on delete restrict,
  generated_at timestamptz not null default now(),
  constraint payroll_period_valid check (payroll_end_date >= payroll_start_date),
  constraint payroll_paid_complete
    check (payment_status <> 'paid' or (paid_at is not null and paid_by is not null and payment_date is not null)),
  constraint payroll_pending_unpaid check (payment_status <> 'pending' or paid_at is null),
  constraint payroll_void_complete
    check ((payment_status = 'void') = (voided_at is not null and voided_by is not null
                                        and void_reason is not null and length(btrim(void_reason)) > 0)),
  constraint payroll_not_self_superseded check (superseded_by is null or superseded_by <> id),
  -- Deferred: generation points the old row at the new id before inserting the new row (DATABASE.md 5.9).
  constraint payroll_superseded_by_fk foreign key (superseded_by)
    references public.payroll_snapshots (id) on delete restrict deferrable initially deferred
);
create unique index if not exists payroll_snapshots_current_uq
  on public.payroll_snapshots (employee_id, payroll_start_date, payroll_end_date)
  where superseded_by is null and payment_status <> 'void';
create index if not exists payroll_snapshots_employee_idx on public.payroll_snapshots (employee_id, generated_at desc);
create index if not exists payroll_snapshots_period_idx on public.payroll_snapshots (payroll_start_date, payroll_end_date);

-- Freeze: figures never change; allowed transitions pending to paid, pending to void, paid to void;
-- payment facts once set never change; superseded and void rows never change; no delete.
create or replace function app_private.payroll_snapshot_freeze() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_mutable text[] := array['payment_status', 'payment_date', 'paid_at', 'paid_by', 'voided_at', 'voided_by',
                            'void_reason', 'superseded_by'];
begin
  if tg_op = 'DELETE' then
    raise exception 'Payslip snapshots cannot be deleted.' using hint = 'conflict';
  end if;
  if (pg_catalog.to_jsonb(new) - v_mutable) is distinct from (pg_catalog.to_jsonb(old) - v_mutable) then
    raise exception 'Payslip figures are frozen. Generate a new payslip instead.' using hint = 'conflict';
  end if;
  if old.superseded_by is not null or old.payment_status = 'void' then
    raise exception 'A superseded or void payslip cannot change.' using hint = 'conflict';
  end if;
  if new.payment_status is distinct from old.payment_status
     and not ((old.payment_status = 'pending' and new.payment_status in ('paid', 'void'))
              or (old.payment_status = 'paid' and new.payment_status = 'void')) then
    raise exception 'A payslip cannot move from % to %.', old.payment_status, new.payment_status using hint = 'conflict';
  end if;
  if (old.paid_at is not null and new.paid_at is distinct from old.paid_at)
     or (old.paid_by is not null and new.paid_by is distinct from old.paid_by)
     or (old.payment_date is not null and new.payment_date is distinct from old.payment_date) then
    raise exception 'The payment facts of a paid payslip cannot change.' using hint = 'conflict';
  end if;
  if new.superseded_by is not null and new.payment_status <> 'pending' then
    raise exception 'Only a pending payslip can be superseded.' using hint = 'conflict';
  end if;
  return new;
end $$;
revoke all on function app_private.payroll_snapshot_freeze() from public, anon, authenticated;
create or replace trigger payroll_snapshots_freeze before update or delete on public.payroll_snapshots
  for each row execute function app_private.payroll_snapshot_freeze();

alter table public.employee_pay_rates enable row level security;
alter table public.employee_pay_rates force row level security;
alter table public.payroll_snapshots enable row level security;
alter table public.payroll_snapshots force row level security;
revoke all on public.employee_pay_rates, public.payroll_snapshots from public, anon, authenticated;
drop policy if exists employee_pay_rates_read on public.employee_pay_rates;
create policy employee_pay_rates_read on public.employee_pay_rates for select to authenticated
  using (employee_id = app_private.current_staff_id() or app_private.has_permission('payroll.view_all')
         or app_private.has_permission('payroll.rates.edit'));
drop policy if exists payroll_snapshots_read on public.payroll_snapshots;
create policy payroll_snapshots_read on public.payroll_snapshots for select to authenticated
  using (employee_id = app_private.current_staff_id() or app_private.has_permission('payroll.view_all'));
grant select on public.employee_pay_rates, public.payroll_snapshots to authenticated;

-- Append a rate row. A manual repeat appends an identical row, which does not change pay.
create or replace function public.set_staff_salary_rate(
  p_employee uuid, p_basis text, p_amount numeric, p_frequency text, p_effective date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_basis text := nullif(btrim(p_basis), '');
  v_frequencies jsonb;
  v_id uuid;
begin
  if v_actor is null or not app_private.has_permission('payroll.rates.edit') then
    raise exception 'Not authorized: payroll.rates.edit is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_employee is null or not exists (select 1 from public.employees e where e.id = p_employee) then
    raise exception 'That team member could not be found.' using hint = 'not_found';
  end if;
  if not app_private.is_timekeeping_eligible(p_employee) then
    raise exception 'That team member is not on payroll (inactive, demo or exempt).' using hint = 'validation';
  end if;
  if v_basis is null or v_basis not in ('daily', 'hourly') then
    raise exception 'The rate basis must be daily or hourly.' using hint = 'validation';
  end if;
  if p_amount is null or p_amount < 0 or p_amount <> round(p_amount, 2) or p_amount >= 10000000000 then
    raise exception 'The rate must be zero or more, with at most two decimals and ten integer digits.' using hint = 'validation';
  end if;
  if p_effective is null then
    raise exception 'An effective date is required.' using hint = 'validation';
  end if;
  v_frequencies := app_private.hr_setting('payroll.payFrequencies', p_effective);
  if pg_catalog.jsonb_typeof(v_frequencies) <> 'array' then
    raise exception 'Setting payroll.payFrequencies is not configured.' using hint = 'unavailable';
  end if;
  if p_frequency is null or not (v_frequencies ? p_frequency) then
    raise exception 'That pay frequency is not offered.' using hint = 'validation';
  end if;
  insert into public.employee_pay_rates (employee_id, rate_basis, rate_amount, pay_frequency, effective_date, created_by)
  values (p_employee, v_basis, p_amount, p_frequency, p_effective, v_actor)
  returning id into v_id;
  perform app_private.record_audit_event('payroll.set_salary_rate', 'employee', p_employee, 'succeeded', null,
    pg_catalog.jsonb_build_object('rate_id', v_id, 'rate_basis', v_basis, 'pay_frequency', p_frequency, 'effective_date', p_effective)
    || case when app_private.hr_setting_text('audit.payloadIncludesAmounts')::boolean
            then pg_catalog.jsonb_build_object('rate_amount', p_amount) else '{}'::jsonb end);
  return v_id;
end $$;

-- The ONE payroll computation (PAYROLL.md 11; IMPLEMENTATION_PROMPT.md P5 to P9, P16, P19).
-- DEFINER; the caller filter is part of this function, so the EXECUTE grant to the signed-in role is
-- safe: a direct call returns exactly what report_payroll returns to the same caller. Identity and
-- permission helpers read auth.uid() from the request, so they name the real caller here.
-- Per-session and per-day keys are read as of the work_date; rateSelection as of the period end.
create or replace function app_private.payroll_lines(p_from date, p_to date)
returns table (
  employee_id uuid, full_name text, role_key text, period_start date, period_end date,
  days_worked integer, total_hours numeric, overtime_hours numeric, night_shifts integer,
  rate_basis text, rate_amount text, pay_frequency text, rate_effective_date date,
  gross_regular text, gross_night_bonus text, gross_overtime text, gross_total text,
  open_sessions integer, warnings text[]
)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_me uuid := app_private.current_staff_id();
  v_all boolean := app_private.has_permission('payroll.view_all');
  v_selection text;
begin
  if v_me is null then
    raise exception 'Not authorized: an active account is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a valid period: from must be on or before to.' using hint = 'validation';
  end if;
  v_selection := app_private.hr_setting_text('payroll.rateSelection', p_to);
  return query
    with emp as (
      select e.id as emp_id, e.full_name as emp_name, e.role_key as emp_role
      from public.employees e
      where app_private.is_timekeeping_eligible(e.id) and (e.id = v_me or v_all)
    ),
    done as (                                   -- completed, not deleted sessions in the period
      select s.employee_id as emp_id, s.work_date as wd,
             extract(epoch from (s.time_out - s.time_in)) / 3600.0 as hrs,
             app_private.is_night_session(s.time_in, s.time_out) as is_night
      from public.attendance_sessions s
      join emp on emp.emp_id = s.employee_id
      where s.work_date between p_from and p_to and s.deleted_at is null and s.time_out is not null
    ),
    day_cfg as (                                -- per-day keys as in force on each work date
      select w.wd,
             app_private.hr_setting_text('payroll.overtimeDisplayThresholdHours', w.wd)::numeric as ot_threshold,
             app_private.hr_setting_text('payroll.overtimeBasis', w.wd) as ot_basis,
             app_private.hr_setting_text('payroll.minHoursForDay', w.wd)::numeric as min_hours,
             app_private.hr_setting_text('payroll.nightRule.oncePerDay', w.wd)::boolean as once_per_day,
             app_private.night_bonus_amount(w.wd) as bonus
      from (select distinct d.wd from done d) w
    ),
    days as (
      select d.emp_id, d.wd, sum(d.hrs) as day_hrs,
             sum(greatest(d.hrs - c.ot_threshold, 0)) as ot_by_session,
             count(*) filter (where d.is_night) as night_sessions,
             c.ot_threshold, c.ot_basis, c.min_hours, c.once_per_day, c.bonus
      from done d join day_cfg c on c.wd = d.wd
      group by d.emp_id, d.wd, c.ot_threshold, c.ot_basis, c.min_hours, c.once_per_day, c.bonus
    ),
    day_totals as (
      select y.emp_id, y.wd, y.day_hrs,
             case y.ot_basis when 'day' then greatest(y.day_hrs - y.ot_threshold, 0) else y.ot_by_session end as day_ot,
             y.day_hrs >= y.min_hours as counted,
             case when y.night_sessions = 0 then 0 when y.once_per_day then 1 else y.night_sessions end as day_nights,
             y.bonus
      from days y
    ),
    totals as (
      select t.emp_id,
             (count(*) filter (where t.counted))::integer as n_days,
             sum(t.day_hrs) as n_hrs,
             sum(t.day_ot) as n_ot,
             sum(t.day_nights)::integer as n_nights,
             sum(t.day_nights * t.bonus) as n_bonus
      from day_totals t group by t.emp_id
    ),
    rate_end as (                               -- newest row effective on or before the period end
      select distinct on (r.employee_id) r.employee_id as emp_id, r.rate_basis as basis, r.rate_amount as amount,
             r.pay_frequency as freq, r.effective_date as eff
      from public.employee_pay_rates r
      join emp on emp.emp_id = r.employee_id
      where r.effective_date <= p_to
      order by r.employee_id, r.effective_date desc, r.created_at desc
    ),
    per_day_regular as (                        -- rateSelection per_day: each work date uses its own rate
      select t.emp_id,
             case when bool_or(dr.amount is null or dr.basis not in ('daily', 'hourly')) then null
                  else sum(case dr.basis when 'daily' then (case when t.counted then dr.amount else 0 end)
                                         else t.day_hrs * dr.amount end)
             end as regular
      from day_totals t
      left join lateral (
        select r.rate_basis as basis, r.rate_amount as amount
        from public.employee_pay_rates r
        where r.employee_id = t.emp_id and r.effective_date <= t.wd
        order by r.effective_date desc, r.created_at desc
        limit 1
      ) dr on true
      group by t.emp_id
    ),
    open_counts as (
      select s.employee_id as emp_id, count(*)::integer as n_open
      from public.attendance_sessions s
      join emp on emp.emp_id = s.employee_id
      where s.work_date between p_from and p_to and s.deleted_at is null and s.time_out is null
      group by s.employee_id
    ),
    rate_changes as (
      select r.employee_id as emp_id, true as changed
      from public.employee_pay_rates r
      join emp on emp.emp_id = r.employee_id
      where r.effective_date > p_from and r.effective_date <= p_to
      group by r.employee_id
    )
    select e.emp_id, e.emp_name, e.emp_role, p_from, p_to,
           coalesce(t.n_days, 0), round(coalesce(t.n_hrs, 0), 2), round(coalesce(t.n_ot, 0), 2), coalesce(t.n_nights, 0),
           re.basis, re.amount::text, re.freq, re.eff,
           round(g.regular, 2)::text,
           round(coalesce(t.n_bonus, 0), 2)::text,
           '0.00'::text,
           case when g.regular is null then null else round(g.regular + coalesce(t.n_bonus, 0), 2)::text end,
           coalesce(oc.n_open, 0),
           pg_catalog.array_remove(array[
             case when re.emp_id is null then 'no_rate' end,
             case when coalesce(oc.n_open, 0) > 0 then 'open_session_in_period' end,
             case when rc.changed then 'rate_changed_mid_period' end,
             case when re.basis is not null and re.basis not in ('daily', 'hourly') then 'unsupported_rate_basis' end
           ]::text[], null)
    from emp e
    left join totals t on t.emp_id = e.emp_id
    left join rate_end re on re.emp_id = e.emp_id
    left join per_day_regular pd on pd.emp_id = e.emp_id
    left join open_counts oc on oc.emp_id = e.emp_id
    left join rate_changes rc on rc.emp_id = e.emp_id
    cross join lateral (
      select case
        when re.emp_id is null then null::numeric                                   -- never treat a missing rate as zero
        when v_selection = 'per_day' and t.emp_id is not null then pd.regular
        when re.basis = 'daily' then coalesce(t.n_days, 0) * re.amount
        when re.basis = 'hourly' then coalesce(t.n_hrs, 0) * re.amount
        else null::numeric
      end as regular
    ) g
    order by e.emp_name, e.emp_id;
end $$;

-- Stable public signature; adds no protection (the filter is inside payroll_lines).
create or replace function public.report_payroll(p_from date, p_to date)
returns table (
  employee_id uuid, full_name text, role_key text, period_start date, period_end date,
  days_worked integer, total_hours numeric, overtime_hours numeric, night_shifts integer,
  rate_basis text, rate_amount text, pay_frequency text, rate_effective_date date,
  gross_regular text, gross_night_bonus text, gross_overtime text, gross_total text,
  open_sessions integer, warnings text[]
)
language sql stable security invoker set search_path = '' as $$
  select * from app_private.payroll_lines(p_from, p_to)
$$;

-- Generate the current payslip for an exact period from the same computation. Regeneration is explicit
-- (IMPLEMENTATION_PROMPT.md P14): with a current pending payslip, a call without p_regenerate returns
-- conflict (a repeated click never creates a second row); with it, the new row supersedes the old one.
create or replace function public.generate_payslip_snapshot(
  p_employee uuid, p_from date, p_to date, p_deductions numeric default 0, p_regenerate boolean default false
) returns public.payroll_snapshots language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_deductions numeric := coalesce(p_deductions, 0);
  v_line record;
  v_current public.payroll_snapshots;
  v_has_current boolean;
  v_new_id uuid := gen_random_uuid();
  v_gross numeric;
  v_bonus numeric;
  v_row public.payroll_snapshots;
begin
  if v_actor is null
     or not (app_private.has_permission('payroll.payslip.generate') and app_private.has_permission('payroll.view_all')) then
    raise exception 'Not authorized: payroll.payslip.generate and payroll.view_all are required.'
      using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_employee is null or p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose an employee and a valid period.' using hint = 'validation';
  end if;
  if v_deductions < 0 or v_deductions <> round(v_deductions, 2) or v_deductions >= 10000000000 then
    raise exception 'Deductions must be zero or more, with at most two decimals.' using hint = 'validation';
  end if;
  -- Serialize generation per employee and exact period (a date difference keeps the key DateStyle-free).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_employee::text || ':' || (p_from - '2000-01-01'::date)::text || ':' || (p_to - '2000-01-01'::date)::text, 0));
  select * into v_line from app_private.payroll_lines(p_from, p_to) l where l.employee_id = p_employee;
  if not found then
    raise exception 'No payroll line for this employee: not eligible for payroll.' using hint = 'not_found';
  end if;
  if v_line.gross_total is null then
    raise exception 'This employee has no usable pay rate for the period.' using hint = 'validation';
  end if;
  v_gross := v_line.gross_total::numeric;
  v_bonus := v_line.gross_night_bonus::numeric;
  if v_gross - v_deductions < 0 and not app_private.hr_setting_text('payroll.allowNegativeNet', p_to)::boolean then
    raise exception 'Deductions exceed gross pay, and negative net pay is not allowed.' using hint = 'validation';
  end if;
  select * into v_current from public.payroll_snapshots p
  where p.employee_id = p_employee and p.payroll_start_date = p_from and p.payroll_end_date = p_to
    and p.superseded_by is null and p.payment_status <> 'void'
  for update;
  v_has_current := found;
  if v_has_current and v_current.payment_status = 'paid' then
    raise exception 'A paid payslip exists for this period. Void it before generating a new one.' using hint = 'conflict';
  end if;
  if v_has_current and not coalesce(p_regenerate, false) then
    raise exception 'A pending payslip exists for this period. Regenerate it explicitly to replace it.' using hint = 'conflict';
  end if;
  if v_has_current then
    update public.payroll_snapshots set superseded_by = v_new_id where id = v_current.id;
  end if;
  insert into public.payroll_snapshots (id, employee_id, payroll_start_date, payroll_end_date, rate_basis, rate_amount,
    pay_frequency, total_hours, overtime_hours, days_worked, night_shifts, regular_salary, overtime_pay, gross_salary,
    deductions, net_salary, generated_by)
  values (v_new_id, p_employee, p_from, p_to, v_line.rate_basis, v_line.rate_amount::numeric,
    v_line.pay_frequency, v_line.total_hours, v_line.overtime_hours, v_line.days_worked, v_line.night_shifts,
    v_gross - v_bonus, v_bonus, v_gross, v_deductions, v_gross - v_deductions, v_actor)
  returning * into v_row;
  perform app_private.record_audit_event('payroll.payslip_generated', 'payroll_snapshot', v_row.id, 'succeeded', null,
    pg_catalog.jsonb_build_object('employee_id', p_employee, 'payroll_start_date', p_from, 'payroll_end_date', p_to,
                                  'superseded_id', case when v_has_current then v_current.id end)
    || case when app_private.hr_setting_text('audit.payloadIncludesAmounts')::boolean
            then pg_catalog.jsonb_build_object('gross_salary', v_gross, 'deductions', v_deductions, 'net_salary', v_gross - v_deductions)
            else '{}'::jsonb end);
  return v_row;
end $$;

-- Mark paid: a current pending row only; payment date defaults to business today, never in the future.
create or replace function public.mark_payslip_paid(p_snapshot_id uuid, p_payment_date date default null)
returns public.payroll_snapshots language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_today date;
  v_row public.payroll_snapshots;
begin
  if v_actor is null or not app_private.has_permission('payroll.payslip.mark_paid') then
    raise exception 'Not authorized: payroll.payslip.mark_paid is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  v_today := app_private.business_today();
  select * into v_row from public.payroll_snapshots p where p.id = p_snapshot_id for update;
  if not found then
    raise exception 'That payslip could not be found.' using hint = 'not_found';
  end if;
  if v_row.superseded_by is not null then
    raise exception 'A newer payslip replaced this one. Mark the current payslip paid.' using hint = 'conflict';
  end if;
  if v_row.payment_status <> 'pending' then
    raise exception 'This payslip is not pending.' using hint = 'conflict';
  end if;
  if coalesce(p_payment_date, v_today) > v_today then
    raise exception 'The payment date cannot be in the future.' using hint = 'validation';
  end if;
  update public.payroll_snapshots
  set payment_status = 'paid', payment_date = coalesce(p_payment_date, v_today), paid_at = now(), paid_by = v_actor
  where id = v_row.id
  returning * into v_row;
  perform app_private.record_audit_event('payroll.payslip_marked_paid', 'payroll_snapshot', v_row.id, 'succeeded', null,
    pg_catalog.jsonb_build_object('employee_id', v_row.employee_id, 'payment_date', v_row.payment_date));
  return v_row;
end $$;

-- Void (optional module, NOT IN THE REFERENCE): from pending or paid, with a reason; paid facts kept.
create or replace function public.void_payslip(p_snapshot_id uuid, p_reason text)
returns public.payroll_snapshots language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_previous text;
  v_row public.payroll_snapshots;
begin
  if v_actor is null or not app_private.has_permission('payroll.payslip.generate') then
    raise exception 'Not authorized: payroll.payslip.generate is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if v_reason is null then
    raise exception 'A void reason is required.' using hint = 'validation';
  end if;
  select * into v_row from public.payroll_snapshots p where p.id = p_snapshot_id for update;
  if not found then
    raise exception 'That payslip could not be found.' using hint = 'not_found';
  end if;
  if v_row.superseded_by is not null or v_row.payment_status = 'void' then
    raise exception 'Only a current pending or paid payslip can be voided.' using hint = 'conflict';
  end if;
  v_previous := v_row.payment_status;
  update public.payroll_snapshots
  set payment_status = 'void', voided_at = now(), voided_by = v_actor, void_reason = v_reason
  where id = v_row.id
  returning * into v_row;
  perform app_private.record_audit_event('payroll.payslip_voided', 'payroll_snapshot', v_row.id, 'succeeded', v_reason,
    pg_catalog.jsonb_build_object('employee_id', v_row.employee_id, 'previous_status', v_previous));
  return v_row;
end $$;

revoke all on function public.set_staff_salary_rate(uuid, text, numeric, text, date), app_private.payroll_lines(date, date),
  public.report_payroll(date, date), public.generate_payslip_snapshot(uuid, date, date, numeric, boolean),
  public.mark_payslip_paid(uuid, date), public.void_payslip(uuid, text) from public, anon;
-- payroll_lines: the signed-in role needs EXECUTE because report_payroll runs as the caller (P16).
grant execute on function public.set_staff_salary_rate(uuid, text, numeric, text, date), app_private.payroll_lines(date, date),
  public.report_payroll(date, date), public.generate_payslip_snapshot(uuid, date, date, numeric, boolean),
  public.mark_payslip_paid(uuid, date), public.void_payslip(uuid, text) to authenticated, service_role;
