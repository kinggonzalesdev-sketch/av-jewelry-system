-- ============================================================================
-- Phase 2 — Trusted-device limit enforcement + Owner-only promotion guard
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Concurrent-device limit enforcement.
-- ----------------------------------------------------------------------------
-- Approved targets: Owner 2, Selected Admin 2, Staff 1.
--
-- WHAT THIS ENFORCES: the number of ACTIVE (non-revoked) rows in
-- trusted_devices per staff member. The lock makes it atomic, so two concurrent
-- registrations cannot both slip past the limit.
--
-- WHAT THIS DOES NOT ENFORCE — and why the flag stays false:
-- Supabase (GoTrue) issues and validates sessions independently of this table.
-- A JWT already minted stays valid until it expires, whether or not its device
-- row is revoked here, and RLS cannot see a device fingerprint (it is not a JWT
-- claim). So this registry + the server-side `requireRegisteredDevice()` boundary
-- enforce the limit THROUGH THE APPLICATION, but they cannot revoke a provider
-- session. Concurrent-session enforcement is therefore NOT complete, and
-- role_device_limits.enforcement_implemented remains FALSE.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_device_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_max smallint;
  v_active integer;
begin
  -- Only registering or un-revoking a device consumes a slot.
  if new.revoked_at is not null then
    return new;
  end if;

  select sp.role_key into v_role
  from public.staff_profiles sp
  where sp.id = new.staff_profile_id
  for update;

  if v_role is null then
    raise exception 'Unknown staff profile %', new.staff_profile_id
      using errcode = 'foreign_key_violation';
  end if;

  select l.max_active_devices into v_max
  from public.role_device_limits l
  where l.role_key = v_role;

  if v_max is null then
    raise exception 'No device limit configured for role %', v_role
      using errcode = 'check_violation';
  end if;

  select count(*) into v_active
  from public.trusted_devices d
  where d.staff_profile_id = new.staff_profile_id
    and d.revoked_at is null
    and d.id <> new.id;

  if v_active + 1 > v_max then
    raise exception
      'Device limit reached for role % (maximum % active device(s); % already active). Revoke a device before registering another.',
      v_role, v_max, v_active
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_device_limit() is
  'Atomically caps active trusted devices per role (Owner 2 / Selected Admin 2 / Staff 1). Enforces the REGISTRY count only — it cannot revoke a provider session.';

create trigger trusted_devices_enforce_limit
  before insert or update of revoked_at, staff_profile_id
  on public.trusted_devices
  for each row execute function app_private.enforce_device_limit();

-- ----------------------------------------------------------------------------
-- Owner-only Selected Admin management (Bible §5.4).
-- ----------------------------------------------------------------------------
-- Phase 1 already caps active Selected Admins at two. This adds the AUTHORITY
-- half: only an Owner may grant or remove Selected Admin status.
--
-- RLS already restricts staff_profiles writes to the Owner. This trigger is the
-- last line of defence behind that — it also covers any privileged/server-side
-- path that bypasses RLS.
--
-- The guard deliberately skips when there is no authenticated caller (auth.uid()
-- is null), so migrations, seeds, and admin tooling can still bootstrap. That is
-- a real trade-off: it means this trigger protects against a mis-wired
-- application, not against someone who already holds the service-role key.
-- ----------------------------------------------------------------------------
create or replace function app_private.enforce_owner_only_admin_management()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changing_admin boolean;
begin
  v_changing_admin :=
    (tg_op = 'INSERT' and new.role_key = 'selected_admin')
    or (tg_op = 'UPDATE' and (
          (new.role_key = 'selected_admin' and old.role_key is distinct from 'selected_admin')
          or (old.role_key = 'selected_admin' and new.role_key is distinct from 'selected_admin')
        ));

  if not v_changing_admin then
    return new;
  end if;

  -- No authenticated caller: bootstrap/admin context. Nothing to check.
  if (select auth.uid()) is null then
    return new;
  end if;

  if not app_private.is_owner() then
    raise exception
      'Only the Owner may grant or remove Selected Admin status (Bible §5.4). Caller role: %.',
      coalesce(app_private.current_staff_role(), 'unknown')
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_owner_only_admin_management() is
  'Only the Owner may promote to or demote from Selected Admin (Bible §5.4). Skips when there is no authenticated caller so bootstrap/migrations still work.';

create trigger staff_profiles_owner_only_admin_mgmt
  before insert or update of role_key on public.staff_profiles
  for each row execute function app_private.enforce_owner_only_admin_management();

-- ----------------------------------------------------------------------------
-- Deactivation revokes devices — a disabled account loses FUTURE access
-- (Bible §30.6), while its history stays attributable.
--
-- Devices are REVOKED (revoked_at set), never deleted: the record of which
-- device was used, and when, must survive revocation.
-- ----------------------------------------------------------------------------
create or replace function app_private.revoke_devices_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and not new.is_active then
    update public.trusted_devices
    set revoked_at = now(),
        revoked_reason = coalesce(revoked_reason, 'Account deactivated')
    where staff_profile_id = new.id
      and revoked_at is null;
  end if;

  return new;
end;
$$;

comment on function app_private.revoke_devices_on_deactivation() is
  'Deactivating an account revokes its trusted devices (Bible §30.6). Devices are revoked, never deleted — history survives.';

create trigger staff_profiles_revoke_devices
  after update of is_active on public.staff_profiles
  for each row execute function app_private.revoke_devices_on_deactivation();
