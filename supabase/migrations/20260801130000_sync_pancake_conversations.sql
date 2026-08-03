-- One-click auto-link (Owner request): match Pancake conversations to MineFlow
-- customers by name and fill customers.pancake_conversation_id, so Send Invoice /
-- Reminder can auto-deliver without anyone pasting ids by hand. Owner/Admin only.
create or replace function public.sync_pancake_conversations(p_pairs jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pair jsonb;
  v_name text;
  v_conv text;
  v_matched int := 0;
  v_updated int;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: only the Owner or Selected Admin can sync Pancake conversations.'
      using errcode = 'insufficient_privilege';
  end if;

  for v_pair in select * from jsonb_array_elements(coalesce(p_pairs, '[]'::jsonb)) loop
    v_name := trim(coalesce(v_pair->>'name', ''));
    v_conv := trim(coalesce(v_pair->>'conversation_id', ''));
    if v_name = '' or v_conv = '' then continue; end if;

    update public.customers
      set pancake_conversation_id = v_conv
      where lower(display_name) = lower(v_name) and is_active;

    get diagnostics v_updated = row_count;
    if v_updated > 0 then v_matched := v_matched + 1; end if;
  end loop;

  return jsonb_build_object('matched', v_matched);
end;
$function$;

revoke all on function public.sync_pancake_conversations(jsonb) from public, anon;
grant execute on function public.sync_pancake_conversations(jsonb) to authenticated;
