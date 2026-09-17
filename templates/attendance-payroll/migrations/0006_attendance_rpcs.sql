-- ============================================================================
-- 0006 ATTENDANCE FUNCTIONS: roster, status, kiosk clock in and out, clock-out correction, delete.
-- ----------------------------------------------------------------------------
-- Clocking is a shared KIOSK: an operator holding attendance.clock_operate picks a member from
-- list_clock_staff() and clocks that member (CURRENT: src/components/hr/attendance-clock.tsx:145-150;
-- M/20260907160000:9-27; M/20260907120000:14-54). Names and signatures follow DATABASE.md 5.13.
-- Every function has an empty search_path and checks its key first. Authority refusals use SQLSTATE
-- 42501; every refusal carries its SERVER_API.md 9.10 code in the hint (forbidden, validation,
-- not_found, conflict, device_not_approved, unavailable). Refusals are audited by the server layer
-- (0002 header). Writes are never retried by the transport (src/lib/supabase/retry-fetch.ts:58-60).
-- Not built here: review_attendance_page (paged team rows with names), self_clock_in and
-- self_clock_out, review_attendance_day, the period lock, the deletion request path.
-- RECOMMENDED TEMPLATE IMPROVEMENTS, each against CURRENT:
--   * list_clock_staff: CURRENT gates on hr_attendance, returns the role too, excludes Super Admins
--     but lists demo accounts (M/20260907160000:9-27). Here: clock_operate or view_team, id and name
--     only, one eligibility rule.
--   * attendance_status: CURRENT kiosk reads open sessions under the operator's own RLS, so an
--     operator without the review key is never offered Clock Out (src/lib/hr/attendance.ts:111-146).
--   * kiosk_clock_in and kiosk_clock_out: CURRENT gate is "any active staff" (M/20260907120000:25-28)
--     and the device is checked in TypeScript only; kiosk_clock_out is RECONSTRUCTED.
--   * correct_attendance_clock_out: CURRENT gate is the role title with a NULL-role guard, no row
--     lock, no overlap check, no edited_at, no SQL audit row (M/20260907130000:29-61); the review
--     dialog truncates to the minute, so an untouched save rewrites a completed clock-out
--     (src/components/hr/review-attendance-view.tsx:674-679). Here: key, lock, whole minutes,
--     unchanged value refused, no overlap, optional window, audit row with old and new values.
--   * delete_attendance_record: CURRENT is a RECONSTRUCTED hard delete with a role-title gate and no
--     reason (src/lib/hr/attendance.ts:348-390). Here: key, required reason, soft or hard per
--     attendance.deletion.mode, the full row kept in the audit context on a hard delete.
-- Rollback: drop the six functions of this file.
-- ============================================================================

-- Kiosk roster and team employee filter: eligible employees, id and display name only.
create or replace function public.list_clock_staff()
returns table (id uuid, full_name text)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if not (app_private.has_permission('attendance.clock_operate') or app_private.has_permission('attendance.view_team')) then
    raise exception 'Not authorized: attendance.clock_operate or attendance.view_team is required.'
      using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  return query
    select e.id, e.full_name
    from public.employees e
    where app_private.is_timekeeping_eligible(e.id)
    order by e.full_name, e.id;
end $$;

-- Clock state per member: the open session (of any date) and the last clock-out on business today.
-- Columns after the first three (DATABASE.md 5.13) serve SERVER_API.md 9.4 ClockStatus.openSession.
create or replace function public.attendance_status(p_employee_ids uuid[] default null)
returns table (employee_id uuid, open_since timestamptz, last_clock_out_today timestamptz,
               open_session_id uuid, open_work_date date)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  v_today date;
begin
  if not (app_private.has_permission('attendance.clock_operate') or app_private.has_permission('attendance.view_team')) then
    raise exception 'Not authorized: attendance.clock_operate or attendance.view_team is required.'
      using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_employee_ids is not null and exists (
    select 1 from pg_catalog.unnest(p_employee_ids) as x(eid) where not app_private.is_timekeeping_eligible(x.eid)
  ) then
    raise exception 'The list holds an unknown or ineligible team member.' using hint = 'validation';
  end if;
  v_today := app_private.business_today();
  return query
    select e.id, o.time_in, l.last_out, o.id, o.work_date
    from public.employees e
    left join public.attendance_sessions o on o.employee_id = e.id and o.time_out is null and o.deleted_at is null
    left join lateral (
      select max(c.time_out) as last_out from public.attendance_sessions c
      where c.employee_id = e.id and c.work_date = v_today and c.time_out is not null and c.deleted_at is null
    ) l on true
    where app_private.is_timekeeping_eligible(e.id)
      and (p_employee_ids is null or e.id = any (p_employee_ids))
    order by e.full_name, e.id;
end $$;

-- Clock in. Server time only; work_date = business date at clock-in; "Continue Duty" is a second call.
create or replace function public.kiosk_clock_in(p_employee_id uuid, p_device_token text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_operator uuid := app_private.current_staff_id();
  v_note text := nullif(btrim(p_note), '');
  v_device uuid;
  v_work_date date;
  v_id uuid;
begin
  if v_operator is null or not app_private.has_permission('attendance.clock_operate') then
    raise exception 'Not authorized: attendance.clock_operate is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  v_device := app_private.attendance_resolve_device(p_device_token);
  if not exists (select 1 from public.employees e where e.id = p_employee_id) then
    raise exception 'That team member could not be found.' using hint = 'not_found';
  end if;
  if not app_private.is_timekeeping_eligible(p_employee_id) then
    raise exception 'That team member is not on timekeeping (inactive, demo or exempt).' using hint = 'conflict';
  end if;
  if length(v_note) > 500 then
    raise exception 'The note can hold at most 500 characters.' using hint = 'validation';
  end if;
  v_work_date := app_private.business_today();
  if not app_private.hr_setting_text('attendance.allowMultipleSessionsPerDay', v_work_date)::boolean
     and exists (select 1 from public.attendance_sessions s
                 where s.employee_id = p_employee_id and s.work_date = v_work_date and s.deleted_at is null) then
    raise exception 'That team member already has a session today, and only one session per day is allowed.' using hint = 'conflict';
  end if;
  begin
    insert into public.attendance_sessions (employee_id, work_date, time_in, note, clock_in_device_id, clock_in_by)
    values (p_employee_id, v_work_date, now(), v_note, v_device, v_operator)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'That team member is already clocked in. Clock out first.' using hint = 'conflict';
  end;
  perform app_private.record_audit_event('attendance.clock_in', 'attendance_session', v_id, 'succeeded', null,
    pg_catalog.jsonb_build_object('employee_id', p_employee_id, 'work_date', v_work_date, 'device_id', v_device));
  return v_id;
end $$;

-- Clock out the single open session of the member.
create or replace function public.kiosk_clock_out(p_employee_id uuid, p_device_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_operator uuid := app_private.current_staff_id();
  v_device uuid;
  v_session public.attendance_sessions;
begin
  if v_operator is null or not app_private.has_permission('attendance.clock_operate') then
    raise exception 'Not authorized: attendance.clock_operate is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  v_device := app_private.attendance_resolve_device(p_device_token);
  if not exists (select 1 from public.employees e where e.id = p_employee_id) then
    raise exception 'That team member could not be found.' using hint = 'not_found';
  end if;
  if not app_private.is_timekeeping_eligible(p_employee_id) then
    raise exception 'That team member is not on timekeeping. Close the open session with a correction.' using hint = 'conflict';
  end if;
  select * into v_session from public.attendance_sessions s
  where s.employee_id = p_employee_id and s.time_out is null and s.deleted_at is null
  for update;
  if not found then
    raise exception 'That team member is not clocked in.' using hint = 'conflict';
  end if;
  update public.attendance_sessions
  set time_out = now(), clock_out_by = v_operator, clock_out_device_id = v_device
  where id = v_session.id;
  perform app_private.record_audit_event('attendance.clock_out', 'attendance_session', v_session.id, 'succeeded', null,
    pg_catalog.jsonb_build_object('employee_id', p_employee_id, 'device_id', v_device));
  return v_session.id;
end $$;

-- Correct a clock-out, the only correctable time. Returns the old time_out (null when it closed an
-- open session). Closing an open session also sets clock_out_by to the corrector.
create or replace function public.correct_attendance_clock_out(p_record_id uuid, p_time_out timestamptz, p_reason text)
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_session public.attendance_sessions;
  v_window integer;
begin
  if v_actor is null or not app_private.has_permission('attendance.correct') then
    raise exception 'Not authorized: attendance.correct is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if v_reason is null then
    raise exception 'A correction reason is required.' using hint = 'validation';
  end if;
  if p_time_out is null then
    raise exception 'Enter a clock-out time.' using hint = 'validation';
  end if;
  select * into v_session from public.attendance_sessions s where s.id = p_record_id for update;
  if not found then
    raise exception 'That attendance session could not be found.' using hint = 'not_found';
  end if;
  if v_session.deleted_at is not null then
    raise exception 'That attendance session is deleted.' using hint = 'conflict';
  end if;
  v_window := (app_private.hr_setting('attendance.correction.maxWindowDays') #>> '{}')::numeric::integer;
  if v_window is not null and v_session.work_date < app_private.business_today() - v_window then
    raise exception 'This session is older than the correction window of % days.', v_window using hint = 'validation';
  end if;
  if p_time_out <> pg_catalog.date_trunc('minute', p_time_out) then
    raise exception 'The clock-out time must be a whole minute.' using hint = 'validation';
  elsif p_time_out < v_session.time_in then
    raise exception 'Clock-out cannot be before clock-in.' using hint = 'validation';
  elsif p_time_out > now() then
    raise exception 'Clock-out cannot be in the future.' using hint = 'validation';
  elsif v_session.time_out is not null and p_time_out = pg_catalog.date_trunc('minute', v_session.time_out) then
    raise exception 'The clock-out time is unchanged.' using hint = 'conflict';
  end if;
  if exists (select 1 from public.attendance_sessions n
             where n.employee_id = v_session.employee_id and n.id <> v_session.id and n.deleted_at is null
               and n.time_in > v_session.time_in and n.time_in < p_time_out) then
    raise exception 'The corrected clock-out overlaps the next session of this team member.' using hint = 'validation';
  end if;
  update public.attendance_sessions
  set time_out = p_time_out, clock_out_by = coalesce(clock_out_by, v_actor),
      edited_by = v_actor, edited_at = now(), edit_reason = v_reason
  where id = v_session.id;
  perform app_private.record_audit_event('attendance.clock_out_corrected', 'attendance_session', v_session.id, 'succeeded', v_reason,
    pg_catalog.jsonb_build_object('employee_id', v_session.employee_id, 'old_time_out', v_session.time_out,
                                  'new_time_out', p_time_out));
  return v_session.time_out;
end $$;

-- Delete a session with a reason, soft or hard per attendance.deletion.mode. The typed confirmation
-- phrase stays in the server action (src/lib/hr/actions.ts:143-148); it is not authority.
create or replace function public.delete_attendance_record(p_record_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_reason text := nullif(btrim(p_reason), '');
  v_session public.attendance_sessions;
  v_mode text;
begin
  if v_actor is null or not app_private.has_permission('attendance.delete') then
    raise exception 'Not authorized: attendance.delete is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if v_reason is null then
    raise exception 'A deletion reason is required.' using hint = 'validation';
  end if;
  select * into v_session from public.attendance_sessions s where s.id = p_record_id for update;
  if not found then
    raise exception 'That attendance session could not be found.' using hint = 'not_found';
  end if;
  if v_session.deleted_at is not null then
    raise exception 'That attendance session is already deleted.' using hint = 'conflict';
  end if;
  v_mode := app_private.hr_setting_text('attendance.deletion.mode');
  if v_mode = 'hard' then
    perform app_private.record_audit_event('attendance.delete', 'attendance_session', v_session.id, 'succeeded', v_reason,
      pg_catalog.jsonb_build_object('mode', 'hard', 'deleted_row', pg_catalog.to_jsonb(v_session)));
    delete from public.attendance_sessions where id = v_session.id;
  else
    update public.attendance_sessions
    set deleted_at = now(), deleted_by = v_actor, delete_reason = v_reason
    where id = v_session.id;
    perform app_private.record_audit_event('attendance.delete', 'attendance_session', v_session.id, 'succeeded', v_reason,
      pg_catalog.jsonb_build_object('mode', 'soft', 'employee_id', v_session.employee_id, 'work_date', v_session.work_date));
  end if;
end $$;

revoke all on function public.list_clock_staff(), public.attendance_status(uuid[]), public.kiosk_clock_in(uuid, text, text),
  public.kiosk_clock_out(uuid, text), public.correct_attendance_clock_out(uuid, timestamptz, text),
  public.delete_attendance_record(uuid, text) from public, anon;
grant execute on function public.list_clock_staff(), public.attendance_status(uuid[]), public.kiosk_clock_in(uuid, text, text),
  public.kiosk_clock_out(uuid, text), public.correct_attendance_clock_out(uuid, timestamptz, text),
  public.delete_attendance_record(uuid, text) to authenticated, service_role;
