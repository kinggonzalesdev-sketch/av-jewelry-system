-- A lightweight "capture device is signed in" heartbeat, so the web System Check can
-- honestly show a registered screenshot device + active capture app. One row per staff
-- account; refreshed on every mobile API call (login included). RLS: readable by
-- capture-permitted staff; written only through the SECURITY DEFINER fn.
create table if not exists public.capture_device_heartbeats (
  staff_profile_id       uuid primary key references public.staff_profiles(id) on delete cascade,
  device_installation_id text,
  app_platform           text,
  last_seen_at           timestamptz not null default now()
);

alter table public.capture_device_heartbeats enable row level security;

drop policy if exists capture_device_heartbeats_read on public.capture_device_heartbeats;
create policy capture_device_heartbeats_read on public.capture_device_heartbeats
  for select using (app_private.has_permission('claim_capture'));

create or replace function public.record_capture_heartbeat(
  p_device text default null,
  p_platform text default null
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
  insert into public.capture_device_heartbeats (staff_profile_id, device_installation_id, app_platform, last_seen_at)
  values (v_staff, nullif(trim(p_device), ''), nullif(trim(p_platform), ''), now())
  on conflict (staff_profile_id) do update
    set last_seen_at = now(),
        device_installation_id = coalesce(nullif(trim(excluded.device_installation_id), ''),
                                          public.capture_device_heartbeats.device_installation_id),
        app_platform = coalesce(excluded.app_platform, public.capture_device_heartbeats.app_platform);
end;
$function$;

revoke all on function public.record_capture_heartbeat(text, text) from public, anon, authenticated;
grant execute on function public.record_capture_heartbeat(text, text) to authenticated;
