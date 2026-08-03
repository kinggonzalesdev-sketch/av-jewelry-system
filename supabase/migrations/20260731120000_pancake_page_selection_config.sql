-- Pancake Page selection — the ONE managed Page this business posts as.
-- The access token is NEVER stored here (or in any table): it stays a server-only
-- Vercel env var. A Facebook Page ID is not a secret, so it is safe to persist,
-- together with an audit trail of who selected it and when.
create table if not exists public.pancake_integration_config (
  id boolean primary key default true,
  page_id text,
  page_name text,
  platform text,
  selected_by uuid references public.staff_profiles(id) on delete set null,
  selected_at timestamptz,
  constraint pancake_config_singleton check (id)
);

alter table public.pancake_integration_config enable row level security;

-- Only the Primary Super Admin may read the selection. No one writes directly —
-- writes go exclusively through save_pancake_page_selection (SECURITY DEFINER).
drop policy if exists pancake_config_read_primary on public.pancake_integration_config;
create policy pancake_config_read_primary on public.pancake_integration_config
  for select using (app_private.is_primary_super_admin());

create or replace function public.save_pancake_page_selection(
  p_page_id text, p_page_name text, p_platform text
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid;
begin
  if not app_private.is_primary_super_admin() then
    raise exception 'Not authorized: selecting the Pancake Page is reserved to the Primary Super Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_page_id), '') = '' then
    raise exception 'A Page ID is required.' using errcode = 'check_violation';
  end if;

  select sp.id into v_staff from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid());

  insert into public.pancake_integration_config
    (id, page_id, page_name, platform, selected_by, selected_at)
  values
    (true, trim(p_page_id),
     nullif(trim(coalesce(p_page_name, '')), ''),
     nullif(trim(coalesce(p_platform, '')), ''),
     v_staff, now())
  on conflict (id) do update
    set page_id = excluded.page_id,
        page_name = excluded.page_name,
        platform = excluded.platform,
        selected_by = excluded.selected_by,
        selected_at = excluded.selected_at;

  return jsonb_build_object('page_id', trim(p_page_id), 'selected_at', now());
end;
$function$;

revoke all on function public.save_pancake_page_selection(text, text, text) from public, anon;
grant execute on function public.save_pancake_page_selection(text, text, text) to authenticated;
