-- ============================================================================
-- 0004 ATTENDANCE DEVICES: approved kiosk devices. DATABASE.md 5.6; IMPLEMENTATION_PROMPT.md DV1 to DV7.
-- ----------------------------------------------------------------------------
-- CURRENT kept: the server mints a random 32-byte token, keeps it in an httpOnly cookie and passes
-- it to SQL, which stores only its sha256 hex hash (src/lib/hr/devices.ts:75, 83-89;
-- M/20260722150000:42-55); verification matches the hash against active rows (:58-63); with one
-- active device, registering deactivates every active device (:49); in auto mode the gate is off
-- while no device is active (:66-69).
-- RECOMMENDED TEMPLATE IMPROVEMENTS:
--   * The check runs INSIDE both clock functions (0006), on the token. CURRENT checks in server
--     TypeScript only (src/lib/hr/attendance.ts:28-48); the live clock-in function has no device
--     check (M/20260907120000:14-54). PENDING (not live) adds an id-based check to clock-in only.
--   * attendance.device.mode: off, auto (CURRENT) or required (the gate applies with no device).
--   * attendance.device.maxActiveDevices above 1 refuses a registration once full.
--   * Forced RLS (CURRENT enabled only, M/20260722150000:30); token_hash never granted; revoked_by
--     recorded; a permission key instead of an inline role check; success rows audited in SQL.
-- attendance.device.failMode is a server pre-check setting only (CONFIGURATION.md 2.4); SQL refuses
-- on its own whenever the mode calls for a check.
-- Rollback: drop the functions of this file; alter table public.attendance_sessions drop constraint
-- attendance_sessions_clock_in_device_fk, drop constraint attendance_sessions_clock_out_device_fk;
-- drop table public.attendance_devices.
-- ============================================================================

create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null check (length(btrim(label)) between 1 and 80),
  token_hash text not null unique,                   -- sha256 hex of the cookie token
  is_active boolean not null default true,
  registered_by uuid not null references public.employees (id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references public.employees (id) on delete restrict,
  constraint attendance_devices_active_ck check (is_active = (revoked_at is null)),
  constraint attendance_devices_revoked_pair check ((revoked_at is null) = (revoked_by is null))
);

alter table public.attendance_sessions drop constraint if exists attendance_sessions_clock_in_device_fk;
alter table public.attendance_sessions add constraint attendance_sessions_clock_in_device_fk
  foreign key (clock_in_device_id) references public.attendance_devices (id) on delete set null;
alter table public.attendance_sessions drop constraint if exists attendance_sessions_clock_out_device_fk;
alter table public.attendance_sessions add constraint attendance_sessions_clock_out_device_fk
  foreign key (clock_out_device_id) references public.attendance_devices (id) on delete set null;

alter table public.attendance_devices enable row level security;
alter table public.attendance_devices force row level security;
revoke all on public.attendance_devices from public, anon, authenticated;
drop policy if exists attendance_devices_read on public.attendance_devices;
create policy attendance_devices_read on public.attendance_devices for select to authenticated
  using (app_private.has_permission('attendance.devices.manage'));
-- Column grant: token_hash is never readable; select * fails on purpose, so list the columns.
grant select (id, label, is_active, registered_by, created_at, revoked_at, revoked_by) on public.attendance_devices to authenticated;

-- Internal: true when clock actions must present an approved token (attendance.device.mode).
create or replace function app_private.attendance_device_check_applies() returns boolean
language sql stable security definer set search_path = '' as $$
  select case app_private.hr_setting_text('attendance.device.mode')
    when 'off' then false
    when 'required' then true
    else exists (select 1 from public.attendance_devices d where d.is_active)
  end
$$;

-- Internal: the device id for a clock function; raises when the check applies and the token is
-- missing, unknown or revoked.
create or replace function app_private.attendance_resolve_device(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if p_token is not null then
    select d.id into v_id from public.attendance_devices d
    where d.is_active and d.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex');
  end if;
  if v_id is null and app_private.attendance_device_check_applies() then
    raise exception 'This device is not an approved time clock.'
      using errcode = 'insufficient_privilege', hint = 'device_not_approved';
  end if;
  return v_id;
end $$;

-- Gate state for the page (SERVER_API.md A13, 9.7). Active callers only; the page gate stays on the key.
create or replace function public.attendance_gating_active() returns boolean
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active account is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  return app_private.attendance_device_check_applies();
end $$;

-- The device id for a presented token, or null. Active callers only (CURRENT had no caller check).
create or replace function public.verify_attendance_device(p_token text) returns uuid
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active account is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  return (
    select d.id from public.attendance_devices d
    where d.is_active and d.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex')
  );
end $$;

-- Register: the server passes the raw token it minted and then sets the cookie; SQL stores the hash.
create or replace function public.register_attendance_device(p_label text, p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
  v_max integer;
  v_active integer;
  v_replaced integer := 0;
  v_label text;
  v_id uuid;
begin
  if v_actor is null or not app_private.has_permission('attendance.devices.manage') then
    raise exception 'Not authorized: attendance.devices.manage is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if p_token is null or length(p_token) < 32 or length(p_token) > 256 then
    raise exception 'The device token must be a server-generated random value of 32 to 256 characters.' using hint = 'validation';
  end if;
  v_label := coalesce(nullif(btrim(p_label), ''), app_private.hr_setting_text('attendance.device.defaultLabel'));
  if length(v_label) > 80 then
    raise exception 'The device label can hold at most 80 characters.' using hint = 'validation';
  end if;
  v_max := app_private.hr_setting_text('attendance.device.maxActiveDevices')::numeric::integer;   -- "2.0" is valid JSON
  lock table public.attendance_devices in share row exclusive mode;
  if v_max = 1 then
    update public.attendance_devices set is_active = false, revoked_at = now(), revoked_by = v_actor where is_active;
    get diagnostics v_replaced = row_count;
  else
    select count(*) into v_active from public.attendance_devices d where d.is_active;
    if v_active >= v_max then
      raise exception 'The maximum of % active devices is reached. Revoke one first.', v_max using hint = 'conflict';
    end if;
  end if;
  begin
    insert into public.attendance_devices (label, token_hash, registered_by)
    values (v_label, pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex'), v_actor)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'This token is already registered. Mint a new one.' using hint = 'conflict';
  end;
  perform app_private.record_audit_event('attendance.device_register', 'attendance_device', v_id, 'succeeded', null,
    pg_catalog.jsonb_build_object('label', v_label, 'replaced_active_devices', v_replaced));
  return v_id;
end $$;

-- Revoke: an unknown id is not_found; revoking an already revoked device succeeds without change.
create or replace function public.revoke_attendance_device(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := app_private.current_staff_id();
begin
  if v_actor is null or not app_private.has_permission('attendance.devices.manage') then
    raise exception 'Not authorized: attendance.devices.manage is required.' using errcode = 'insufficient_privilege', hint = 'forbidden';
  end if;
  if not exists (select 1 from public.attendance_devices d where d.id = p_id) then
    raise exception 'That device could not be found.' using hint = 'not_found';
  end if;
  update public.attendance_devices set is_active = false, revoked_at = now(), revoked_by = v_actor
  where id = p_id and is_active;
  if found then
    perform app_private.record_audit_event('attendance.device_revoke', 'attendance_device', p_id, 'succeeded', null, '{}'::jsonb);
  end if;
end $$;

revoke all on function app_private.attendance_device_check_applies(), app_private.attendance_resolve_device(text)
  from public, anon, authenticated;
revoke all on function public.attendance_gating_active(), public.verify_attendance_device(text),
  public.register_attendance_device(text, text), public.revoke_attendance_device(uuid) from public, anon;
grant execute on function public.attendance_gating_active(), public.verify_attendance_device(text),
  public.register_attendance_device(text, text), public.revoke_attendance_device(uuid) to authenticated, service_role;
