-- Review Attendance: correct a clock-out time (Owner 2026-09-07).
--
-- The only correction available today is a permanent DELETE. This adds a targeted, audited
-- clock-out correction so a manager can CLOSE a forgotten open session (unblocking that staff
-- member from clocking in again) or shorten an over-long one, without discarding the record.
--
-- Authority mirrors delete_attendance_record: Owner or Selected Admin only, re-checked in SQL.
-- It writes the who/why into the existing edited_by / edit_reason columns and returns the OLD
-- time_out so the caller can audit the before→after. Overtime is untouched (the overtime trigger
-- is BEFORE INSERT only, and the night bonus keys off clock-in). Payroll is derived, so it
-- recomputes on the next read; already-issued payslips are frozen snapshots and are unaffected.

create or replace function public.correct_attendance_clock_out(
  p_record_id uuid,
  p_time_out timestamptz,
  p_reason text
)
  returns timestamptz
  language plpgsql
  security definer
  set search_path to ''
as $function$
declare
  v_role text;
  v_time_in timestamptz;
  v_old_out timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
begin
  v_role := app_private.current_staff_role();
  if v_role is null or v_role not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: only the Owner or Selected Admin may correct attendance.'
      using errcode = 'insufficient_privilege';
  end if;

  if v_reason is null then
    raise exception 'A correction reason is required.';
  end if;

  select time_in, time_out into v_time_in, v_old_out
  from public.attendance_records where id = p_record_id;
  if v_time_in is null then
    raise exception 'That attendance record could not be found.';
  end if;

  if p_time_out is null then
    raise exception 'Enter a clock-out time.';
  end if;
  if p_time_out < v_time_in then
    raise exception 'Clock-out cannot be before clock-in.';
  end if;
  if p_time_out > now() then
    raise exception 'Clock-out cannot be in the future.';
  end if;

  update public.attendance_records
  set time_out = p_time_out,
      edited_by = app_private.current_staff_id(),
      edit_reason = v_reason
  where id = p_record_id;

  return v_old_out;
end;
$function$;

revoke execute on function public.correct_attendance_clock_out(uuid, timestamptz, text)
  from anon, public;
grant execute on function public.correct_attendance_clock_out(uuid, timestamptz, text)
  to authenticated, service_role;
