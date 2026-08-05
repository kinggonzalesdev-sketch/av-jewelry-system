-- Owner request: the Attendance kiosk ("Select who is signing in") must work for a
-- staff/admin account granted hr_attendance, not just the Owner. The kiosk clock
-- (kiosk_clock_in / kiosk_clock_out) already allows any active staff on the approved
-- device; what blocked a granted member was reading the roster to fill the dropdown —
-- staff_profiles RLS is owner-or-self only.
--
-- Provide a narrow, permission-scoped roster read: active staff NAME + role only (no
-- email or other PII), available to any holder of hr_attendance (the Owner holds it
-- implicitly). SECURITY DEFINER so it can see all active profiles, with the
-- permission re-checked inside — the same key the page and nav already require.
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
    order by sp.full_name;
end;
$function$;
