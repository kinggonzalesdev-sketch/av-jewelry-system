-- Pancake Private Reply sender (verified contract 2026-08-17). private_replies.sender_id
-- MUST be an ACTIVE Pancake user (Get Users List users[].id), explicitly chosen by the
-- Owner — never page_id / PSID / page_customer_id / fb_id. Store the canonical id (+ a
-- display name) on the existing singleton config. Additive + nullable: no private reply
-- is sent until a sender is selected (fail-closed).
--
-- Applied live via Supabase MCP; committed here so the schema is not drift-only.
alter table public.pancake_integration_config
  add column if not exists sender_user_id text,
  add column if not exists sender_user_name text;

create or replace function public.save_pancake_sender_selection(p_user_id text, p_user_name text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare v_staff uuid;
begin
  if not app_private.is_primary_super_admin() then
    raise exception 'Not authorized: selecting the Pancake Private Reply sender is reserved to the Primary Super Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_user_id), '') = '' then
    raise exception 'A Pancake user id is required.' using errcode = 'check_violation';
  end if;
  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  insert into public.pancake_integration_config (id, sender_user_id, sender_user_name, selected_by, selected_at)
  values (true, trim(p_user_id), nullif(trim(coalesce(p_user_name, '')), ''), v_staff, now())
  on conflict (id) do update
    set sender_user_id = excluded.sender_user_id,
        sender_user_name = excluded.sender_user_name;
  return jsonb_build_object('sender_user_id', trim(p_user_id), 'selected_at', now());
end;
$function$;
