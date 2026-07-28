-- ============================================================================
-- Team Members portal — Owner-managed sign-in (Owner request 2026-07-22).
-- ----------------------------------------------------------------------------
-- The Owner can now create team accounts and (re)set a temporary password from
-- the app (Settings → Portal & Access). This is a DELIBERATE Owner decision to
-- enable what ADR §11 kept out of the UI — so it is Owner-only and runs through
-- the service-role admin client server-side (never the browser). This migration
-- adds only what the STATUS needs; the account creation itself is code.
--
--   password_is_temp = true  → the Owner set a temporary password the member has
--                              not changed yet ("Temp (Not Changed)").
--   password_is_temp = false → the member has since changed it ("Changed by them").
-- ============================================================================

alter table public.staff_profiles
  add column password_is_temp boolean not null default false;

comment on column public.staff_profiles.password_is_temp is
  'True when the Owner set a temp password the member has not yet changed. Cleared by clear_my_temp_password_flag() when the member changes their own password.';

-- ----------------------------------------------------------------------------
-- A member clears their OWN temp-password flag after changing their password.
-- staff_profiles UPDATE is Owner-only (staff_profiles_update_owner), so a member
-- cannot update their own row directly — this narrow, self-scoped, security
-- definer function is the only thing they may do to it, and only to their OWN row.
-- ----------------------------------------------------------------------------
create or replace function public.clear_my_temp_password_flag()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.staff_profiles
  set password_is_temp = false
  where auth_user_id = (select auth.uid());
end $$;

comment on function public.clear_my_temp_password_flag() is
  'A member clears the temp-password flag on their OWN staff_profile after changing their password. security definer, self-scoped to auth.uid().';

revoke all on function public.clear_my_temp_password_flag() from public;
grant execute on function public.clear_my_temp_password_flag() to authenticated;
