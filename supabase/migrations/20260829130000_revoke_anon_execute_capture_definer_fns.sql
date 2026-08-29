-- Advisor hardening (Owner 2026-08-29): two newer SECURITY DEFINER functions were left executable by
-- the anon (unauthenticated) role — a gap vs the 2026-08-21 "revoke anon EXECUTE on public DEFINER
-- RPCs" pattern. has_capture_routing_work() is a system-only sweep check (called via the service-role
-- admin client); reset_capture_for_retry(uuid) resets a capture for retry (an anon caller with a
-- guessed id could tamper). Revoke anon (and any public grant) — authenticated staff + service_role
-- keep EXECUTE, so the app is unaffected (verified via has_function_privilege).
revoke execute on function public.has_capture_routing_work() from anon, public;
revoke execute on function public.reset_capture_for_retry(uuid) from anon, public;
