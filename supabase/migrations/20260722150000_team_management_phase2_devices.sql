-- Team Management Phase 2a: attendance schema additions + approved-device gating.
-- All additive; nothing dropped. Device gating is NON-BREAKING: until the Owner
-- registers a device, clock-in behaves exactly as before (enforced in app code).
-- The raw device token is NEVER stored — only its sha256 hash.

alter table public.attendance_records
  add column if not exists device_id uuid,
  add column if not exists clock_in_photo uuid,
  add column if not exists clock_out_photo uuid,
  add column if not exists edited_by uuid references public.staff_profiles(id),
  add column if not exists edit_reason text,
  add column if not exists status text;

create table if not exists public.attendance_devices (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  token_hash text not null,
  is_active boolean not null default true,
  registered_by uuid references public.staff_profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

alter table public.attendance_records
  drop constraint if exists attendance_device_fk;
alter table public.attendance_records
  add constraint attendance_device_fk
  foreign key (device_id) references public.attendance_devices(id) on delete set null;

alter table public.attendance_devices enable row level security;

drop policy if exists attendance_devices_owner_read on public.attendance_devices;
create policy attendance_devices_owner_read on public.attendance_devices
  for select to authenticated
  using (
    exists (
      select 1 from public.staff_profiles sp
      where sp.auth_user_id = auth.uid() and sp.role_key = 'owner' and sp.is_active
    )
  );

create or replace function public.register_attendance_device(p_label text, p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  select sp.id into v_owner from public.staff_profiles sp
  where sp.auth_user_id = auth.uid() and sp.role_key = 'owner' and sp.is_active;
  if v_owner is null then raise exception 'Not authorized'; end if;
  update public.attendance_devices set is_active = false, revoked_at = now() where is_active;
  insert into public.attendance_devices (label, token_hash, registered_by)
  values (coalesce(nullif(trim(p_label), ''), 'Shop phone'),
          encode(extensions.digest(p_token, 'sha256'), 'hex'), v_owner)
  returning id into v_id;
  return v_id;
end; $$;
grant execute on function public.register_attendance_device(text, text) to authenticated;

create or replace function public.verify_attendance_device(p_token text)
returns uuid language sql security definer stable set search_path = '' as $$
  select id from public.attendance_devices
  where is_active and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
  limit 1;
$$;
grant execute on function public.verify_attendance_device(text) to authenticated;

create or replace function public.attendance_gating_active()
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.attendance_devices where is_active);
$$;
grant execute on function public.attendance_gating_active() to authenticated;

create or replace function public.revoke_attendance_device(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff_profiles sp
    where sp.auth_user_id = auth.uid() and sp.role_key = 'owner' and sp.is_active)
  then raise exception 'Not authorized'; end if;
  update public.attendance_devices set is_active = false, revoked_at = now() where id = p_id;
end; $$;
grant execute on function public.revoke_attendance_device(uuid) to authenticated;
