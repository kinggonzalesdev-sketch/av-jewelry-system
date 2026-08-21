-- #7 (Owner 2026-08-21): merge the duplicate PERMISSIVE SELECT policies on 4 RBAC tables into one
-- each (advisor: multiple_permissive_policies). Permissive policies are OR'd, so one policy with
-- USING (owner_qual OR self_qual) is LOGICALLY IDENTICAL to the two it replaces — same rows visible
-- to every role. Quals transcribed verbatim from pg_policies. Non-SELECT (insert/update) policies are
-- untouched. sticker_settings deliberately left (its overlap is a FOR ALL write policy vs a SELECT
-- read policy — different shape, 1-row config table, not worth the extra surgery).
--
-- VERIFIED on prod: each table now has exactly 1 SELECT policy; e.g. staff_profiles_read =
-- (app_private.is_owner() OR auth_user_id = (select auth.uid())) — byte-identical OR of the originals.
-- Rollback: save point savepoint-2026-08-21-perf-inlining, or recreate the *_read_owner/*_read_self pairs.

-- staff_permission_grants
drop policy grants_read_owner on public.staff_permission_grants;
drop policy grants_read_self  on public.staff_permission_grants;
create policy grants_read on public.staff_permission_grants for select to authenticated
  using (app_private.is_owner() or staff_profile_id = app_private.current_staff_id());

-- staff_profiles
drop policy staff_profiles_read_owner on public.staff_profiles;
drop policy staff_profiles_read_self  on public.staff_profiles;
create policy staff_profiles_read on public.staff_profiles for select to authenticated
  using (app_private.is_owner() or auth_user_id = (select auth.uid()));

-- staff_scope_assignments
drop policy scope_assign_read_owner on public.staff_scope_assignments;
drop policy scope_assign_read_self  on public.staff_scope_assignments;
create policy scope_assign_read on public.staff_scope_assignments for select to authenticated
  using (app_private.is_owner() or staff_profile_id = app_private.current_staff_id());

-- trusted_devices
drop policy devices_read_owner on public.trusted_devices;
drop policy devices_read_self  on public.trusted_devices;
create policy devices_read on public.trusted_devices for select to authenticated
  using (app_private.is_owner() or staff_profile_id = app_private.current_staff_id());
