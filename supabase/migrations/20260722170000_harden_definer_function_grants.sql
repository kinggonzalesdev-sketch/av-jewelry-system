-- Security hardening (Supabase advisor 0028/0029): definer-rights functions
-- default-grant EXECUTE to PUBLIC (which includes the anon role). Revoke that and
-- keep only `authenticated` — every one of these is meant to be called by a
-- signed-in user and re-checks the caller's identity internally. Non-breaking:
-- the app always calls them as the authenticated user. (This migration creates no
-- functions; it only adjusts EXECUTE grants.)

revoke execute on function public.attendance_gating_active() from public, anon;
grant execute on function public.attendance_gating_active() to authenticated;

revoke execute on function public.verify_attendance_device(text) from public, anon;
grant execute on function public.verify_attendance_device(text) to authenticated;

revoke execute on function public.register_attendance_device(text, text) from public, anon;
grant execute on function public.register_attendance_device(text, text) to authenticated;

revoke execute on function public.revoke_attendance_device(uuid) from public, anon;
grant execute on function public.revoke_attendance_device(uuid) to authenticated;

revoke execute on function public.clear_my_temp_password_flag() from public, anon;
grant execute on function public.clear_my_temp_password_flag() to authenticated;
