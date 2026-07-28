-- Owner-only, atomic deletion of a team member (Owner request 2026-07-22).
--
-- Removes ONLY the member's own account-scoped rows (their notifications, trusted
-- devices, scope assignments, and permission grants) plus the account itself
-- (staff_profiles row + auth.users). A RESTRICT foreign key — the member authored
-- business records (orders, payments, permissions granted to OTHERS, etc.) —
-- aborts the whole transaction, so a member with activity can never be
-- half-deleted; the caller is told to disable the account instead.
--
-- SECURITY: SECURITY DEFINER, but it re-derives the caller from auth.uid() and
-- requires an ACTIVE Owner. It refuses to delete the caller's own account. The TS
-- boundary (requireOwner) gates it too; this is the last line, agreeing with it.

create or replace function public.delete_team_member(p_staff_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
  v_caller uuid := auth.uid();
begin
  if not exists (
    select 1 from public.staff_profiles sp
    where sp.auth_user_id = v_caller
      and sp.role_key = 'owner'
      and sp.is_active
  ) then
    raise exception 'Not authorized';
  end if;

  select auth_user_id into v_auth_user_id
  from public.staff_profiles
  where id = p_staff_profile_id;

  if v_auth_user_id is null then
    raise exception 'Member not found';
  end if;

  if v_auth_user_id = v_caller then
    raise exception 'Cannot delete your own account';
  end if;

  delete from public.notifications where staff_profile_id = p_staff_profile_id;
  delete from public.trusted_devices where staff_profile_id = p_staff_profile_id;
  delete from public.staff_scope_assignments where staff_profile_id = p_staff_profile_id;
  delete from public.staff_permission_grants where staff_profile_id = p_staff_profile_id;

  delete from public.staff_profiles where id = p_staff_profile_id;

  delete from auth.users where id = v_auth_user_id;
end;
$$;

revoke all on function public.delete_team_member(uuid) from public, anon;
grant execute on function public.delete_team_member(uuid) to authenticated;
