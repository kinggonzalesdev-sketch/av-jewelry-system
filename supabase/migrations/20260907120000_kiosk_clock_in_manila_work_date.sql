-- Attendance forward-fix (Owner 2026-09-07): stamp work_date in the SHOP timezone.
--
-- kiosk_clock_in let attendance_records.work_date default to current_date, which is UTC. An
-- early-morning Manila clock-in (e.g. 07:20 = 23:20 UTC the previous day) was therefore filed
-- one calendar day off its real Manila day, which mis-groups the day and can miscount
-- days_worked in report_payroll. This sets work_date to the Manila date explicitly, matching how
-- "today" is read everywhere else in the app (attendance.ts, the overtime trigger, report_payroll's
-- night rule). Behaviour is otherwise IDENTICAL to the previous definition.
--
-- Note: this function was applied to production out-of-band (Supabase MCP) and was not previously
-- in the repo; this migration captures the full, corrected definition so the schema is
-- reproducible. `search_path` is '' so every reference stays schema-qualified.

create or replace function public.kiosk_clock_in(p_staff_id uuid, p_device_id uuid, p_note text)
  returns uuid
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_id uuid;
  v_active boolean;
  v_demo boolean;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: only active staff may operate the time clock.'
      using errcode = 'insufficient_privilege';
  end if;

  select sp.is_active, sp.is_demo into v_active, v_demo
  from public.staff_profiles sp where sp.id = p_staff_id;
  if v_active is null then
    raise exception 'That team member could not be found.';
  end if;
  if not v_active or v_demo then
    raise exception 'That team member is inactive and cannot clock in.';
  end if;

  begin
    insert into public.attendance_records (staff_profile_id, note, device_id, work_date)
    values (
      p_staff_id,
      nullif(btrim(p_note), ''),
      p_device_id,
      (now() at time zone 'Asia/Manila')::date
    )
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That team member is already clocked in. Clock out first.';
  end;

  return v_id;
end;
$function$;
