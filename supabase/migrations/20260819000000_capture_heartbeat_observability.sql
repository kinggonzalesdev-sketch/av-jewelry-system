-- Capture device / APK heartbeat observability (offline pre-live batch, 2026-08-19).
--
-- ADDITIVE + non-destructive: adds nullable metadata columns and REPLACES the writer with an
-- all-defaulted superset so OLD Capture clients (which call it with only device/platform) keep
-- working and NEVER wipe the new fields (coalesce preserves). New APKs report app version/build
-- commit + printer state via request headers → resolveMobileStaff → this fn.
--
-- Stores NO secrets: no Bluetooth key, no token, no screenshot, no customer name/message. The
-- printer NAME is the Bluetooth device label (e.g. "XP-236B") — not PII.

alter table public.capture_device_heartbeats
  add column if not exists app_version_name        text,
  add column if not exists app_version_code        integer,
  add column if not exists build_commit            text,
  add column if not exists printer_configured      boolean,
  add column if not exists printer_enabled         boolean,
  add column if not exists printer_connection_state text,
  add column if not exists printer_name            text;

-- Replace the 2-arg writer with a superset (defaults null). Dropping the old signature first
-- avoids an ambiguous-overload error when a 2-arg named call is made.
drop function if exists public.record_capture_heartbeat(text, text);

create or replace function public.record_capture_heartbeat(
  p_device                   text default null,
  p_platform                 text default null,
  p_app_version_name         text default null,
  p_app_version_code         integer default null,
  p_build_commit             text default null,
  p_printer_configured       boolean default null,
  p_printer_enabled          boolean default null,
  p_printer_connection_state text default null,
  p_printer_name             text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  v_staff := app_private.current_staff_id();
  if v_staff is null then
    return; -- not an active staff session; record nothing
  end if;
  insert into public.capture_device_heartbeats (
    staff_profile_id, device_installation_id, app_platform, last_seen_at,
    app_version_name, app_version_code, build_commit,
    printer_configured, printer_enabled, printer_connection_state, printer_name
  ) values (
    v_staff, nullif(trim(p_device), ''), nullif(trim(p_platform), ''), now(),
    nullif(trim(p_app_version_name), ''), p_app_version_code, nullif(trim(p_build_commit), ''),
    p_printer_configured, p_printer_enabled, nullif(trim(p_printer_connection_state), ''),
    nullif(trim(p_printer_name), '')
  )
  on conflict (staff_profile_id) do update set
    last_seen_at             = now(),
    device_installation_id   = coalesce(nullif(trim(excluded.device_installation_id), ''),
                                        public.capture_device_heartbeats.device_installation_id),
    app_platform             = coalesce(excluded.app_platform, public.capture_device_heartbeats.app_platform),
    app_version_name         = coalesce(nullif(trim(excluded.app_version_name), ''),
                                        public.capture_device_heartbeats.app_version_name),
    app_version_code         = coalesce(excluded.app_version_code, public.capture_device_heartbeats.app_version_code),
    build_commit             = coalesce(nullif(trim(excluded.build_commit), ''),
                                        public.capture_device_heartbeats.build_commit),
    printer_configured       = coalesce(excluded.printer_configured, public.capture_device_heartbeats.printer_configured),
    printer_enabled          = coalesce(excluded.printer_enabled, public.capture_device_heartbeats.printer_enabled),
    printer_connection_state = coalesce(nullif(trim(excluded.printer_connection_state), ''),
                                        public.capture_device_heartbeats.printer_connection_state),
    printer_name             = coalesce(nullif(trim(excluded.printer_name), ''),
                                        public.capture_device_heartbeats.printer_name);
end;
$function$;

revoke all on function public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text
) to authenticated;
