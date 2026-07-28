-- Perf (Supabase advisor auth_rls_initplan): wrap auth.uid() in a scalar subquery
-- so the planner evaluates it ONCE per query rather than once per row. Same access
-- semantics (Owner-only read of attendance_devices) — purely an optimization.
drop policy if exists attendance_devices_owner_read on public.attendance_devices;
create policy attendance_devices_owner_read on public.attendance_devices
  for select to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.auth_user_id = (select auth.uid())
        and sp.role_key = 'owner'
        and sp.is_active
    )
  );
