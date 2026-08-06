-- Daily automatic Pancake→customer link sync (Owner chose "daily automatic sync").
-- The linking loop is extracted into ONE internal helper so the Owner-gated UI RPC
-- and the service-role cron RPC share a single source of truth. The cron runs with no
-- human session, so it needs a function that is NOT gated on a staff role — its auth
-- boundary is instead the EXECUTE grant (only service_role, a server-only key).

-- Shared, un-gated linker. Callable only by the SECURITY DEFINER wrappers below (which
-- run as the function owner); direct API roles are revoked as defense in depth.
create or replace function app_private.link_pancake_conversations(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_pair jsonb;
  v_name text;
  v_conv text;
  v_norm text;
  v_count int;
  v_matched int := 0;
begin
  for v_pair in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_pair->>'name', ''));
    v_conv := trim(coalesce(v_pair->>'conversation_id', ''));
    if v_name = '' or v_conv = '' then continue; end if;

    v_norm := app_private.normalize_name(v_name);
    if v_norm = '' then continue; end if;

    -- Only auto-link when the normalized name is UNIQUE among active customers.
    select count(*) into v_count
    from public.customers
    where is_active and app_private.normalize_name(display_name) = v_norm;

    if v_count = 1 then
      update public.customers
        set pancake_conversation_id = v_conv
        where is_active and app_private.normalize_name(display_name) = v_norm;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return jsonb_build_object('matched', v_matched);
end;
$$;

revoke execute on function app_private.link_pancake_conversations(jsonb) from public, anon, authenticated;

-- Owner-gated UI RPC — behavior unchanged, now delegates to the shared helper.
create or replace function public.sync_pancake_conversations(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: only the Owner or Selected Admin can sync Pancake conversations.'
      using errcode = 'insufficient_privilege';
  end if;
  return app_private.link_pancake_conversations(p_pairs);
end;
$$;

-- Service-role-only system RPC for the daily cron. No human-role gate — its auth
-- boundary is the EXECUTE grant below (service_role is a server-only key, and the cron
-- route is additionally guarded by CRON_SECRET).
create or replace function public.sync_pancake_conversations_system(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  return app_private.link_pancake_conversations(p_pairs);
end;
$$;

revoke execute on function public.sync_pancake_conversations_system(jsonb) from public, anon, authenticated;
grant execute on function public.sync_pancake_conversations_system(jsonb) to service_role;
