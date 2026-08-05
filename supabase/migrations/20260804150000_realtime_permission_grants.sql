-- Make Manage Access changes appear AUTOMATICALLY on the assigned user's account.
--
-- DashboardSyncProvider (mounted in the app shell for every signed-in user) calls
-- router.refresh() on any Supabase Realtime change it is allowed to see. That
-- re-renders the (app) layout, re-runs getGrantedPermissions(), and updates the
-- sidebar + permission-gated buttons WITHOUT a manual reload. But
-- staff_permission_grants was not in the realtime publication, so a permission
-- save never nudged the TARGET user's session — they only saw it after a full
-- reload / re-login / tab refocus.
--
-- Add it to the publication. Realtime delivery is RLS-filtered: the grants_read_self
-- policy means each user is only told about changes to THEIR OWN grant rows, so a
-- member's session refreshes exactly when their own access changes (and Owners, who
-- can read all grants, refresh on any change). REPLICA IDENTITY FULL is required so
-- DELETE (revoke) events carry staff_profile_id for that RLS filter.
alter table public.staff_permission_grants replica identity full;
alter publication supabase_realtime add table public.staff_permission_grants;
