-- Record WHICH PHONE is running the Capture app (Owner 2026-09-09).
--
-- WHY. When the Capture phone went silent for an hour on 2026-09-09, one of the live hypotheses
-- was an OEM battery manager killing the process — a failure mode that is entirely
-- manufacturer-specific (Xiaomi/MIUI, Oppo/ColorOS, Vivo, Huawei and Samsung all ship their own
-- app-killer with its own opt-out). We could not evaluate it, because the heartbeat records the
-- app version and printer state but nothing about the HARDWARE: no manufacturer, no model, no
-- Android version. The root cause turned out to be a silent logout instead, but the blind spot is
-- real and will matter the next time a device-specific theory needs testing.
--
-- Three nullable columns, filled from Build.MANUFACTURER / Build.MODEL / Build.VERSION.RELEASE via
-- X-MineFlow-* request headers. NO new privacy surface: this is the shop's own device, and these
-- identify a handset MODEL, not a person — the same class of data the existing app_version_name
-- and build_commit columns already carry.
--
-- Old app builds simply omit the headers → nulls → the RPC's coalesce keeps whatever is stored, so
-- nothing is wiped and no client is forced to upgrade.

alter table public.capture_device_heartbeats
  add column if not exists device_manufacturer text,
  add column if not exists device_model        text,
  add column if not exists android_release     text;

-- ---------------------------------------------------------------------------
-- ⚠️ DROP THE OLD 9-ARG SIGNATURE FIRST — this is not optional.
--
-- Postgres identifies a function by name + ARGUMENT TYPES, so `create or replace` with three extra
-- parameters does NOT replace the 9-arg version: it creates a SECOND overload beside it. Both would
-- then be callable, an exact 9-argument call would still bind to the OLD one, and the three new
-- columns would silently never be written — the change would look applied and do nothing. A call
-- that could match both raises "function is not unique" instead, which would break every mobile
-- request. Verified live 2026-09-09: exactly one overload exists today
-- (text,text,text,integer,text,boolean,boolean,text,text).
--
-- Dropping before creating leaves exactly one function, so there is nothing to resolve ambiguously.
-- ---------------------------------------------------------------------------
drop function if exists public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text
);

-- ---------------------------------------------------------------------------
-- record_capture_heartbeat — three new trailing params, everything else VERBATIM from the live
-- definition (read back 2026-09-09). New params carry defaults, so an older client that omits them
-- still calls successfully and the coalesce keeps whatever is already stored.
-- ---------------------------------------------------------------------------
create or replace function public.record_capture_heartbeat(
  p_device text default null::text,
  p_platform text default null::text,
  p_app_version_name text default null::text,
  p_app_version_code integer default null::integer,
  p_build_commit text default null::text,
  p_printer_configured boolean default null::boolean,
  p_printer_enabled boolean default null::boolean,
  p_printer_connection_state text default null::text,
  p_printer_name text default null::text,
  p_device_manufacturer text default null::text,
  p_device_model text default null::text,
  p_android_release text default null::text
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  v_staff := app_private.current_staff_id();
  if v_staff is null then
    return;
  end if;
  insert into public.capture_device_heartbeats (
    staff_profile_id, device_installation_id, app_platform, last_seen_at,
    app_version_name, app_version_code, build_commit,
    printer_configured, printer_enabled, printer_connection_state, printer_name,
    device_manufacturer, device_model, android_release
  ) values (
    v_staff, nullif(trim(p_device), ''), nullif(trim(p_platform), ''), now(),
    nullif(trim(p_app_version_name), ''), p_app_version_code, nullif(trim(p_build_commit), ''),
    p_printer_configured, p_printer_enabled, nullif(trim(p_printer_connection_state), ''),
    nullif(trim(p_printer_name), ''),
    nullif(trim(p_device_manufacturer), ''), nullif(trim(p_device_model), ''),
    nullif(trim(p_android_release), '')
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
                                        public.capture_device_heartbeats.printer_name),
    device_manufacturer      = coalesce(nullif(trim(excluded.device_manufacturer), ''),
                                        public.capture_device_heartbeats.device_manufacturer),
    device_model             = coalesce(nullif(trim(excluded.device_model), ''),
                                        public.capture_device_heartbeats.device_model),
    android_release          = coalesce(nullif(trim(excluded.android_release), ''),
                                        public.capture_device_heartbeats.android_release);
end;
$function$;

-- ---------------------------------------------------------------------------
-- ⚠️ RE-APPLY THE ACL — dropping a function destroys its grants along with it.
--
-- A newly created function gets Postgres's default of EXECUTE to PUBLIC, which in Supabase includes
-- the **anon** role. This one is SECURITY DEFINER and writes a table, so leaving it world-callable
-- would silently undo a deliberate earlier lockdown and let an unauthenticated caller poke at the
-- heartbeat. (In practice app_private.current_staff_id() returns null for anon and the function
-- returns early — but relying on the body to be the only gate is exactly the assumption not worth
-- making about a SECURITY DEFINER function.)
--
-- Restores the ACL read back from production before the drop, verbatim:
--   postgres=X/postgres | service_role=X/postgres | authenticated=X/postgres
-- ---------------------------------------------------------------------------
revoke all on function public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text, text, text, text
) from public;

revoke all on function public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text, text, text, text
) from anon;

grant execute on function public.record_capture_heartbeat(
  text, text, text, integer, text, boolean, boolean, text, text, text, text, text
) to authenticated, service_role;
