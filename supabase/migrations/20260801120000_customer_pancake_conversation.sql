-- Pancake conversation id per customer (Owner request): powers auto-delivery of
-- Send Invoice / Send Reminder through Pancake. This is NOT the Messenger URL
-- (facebook_conversation_url) — it is Pancake's own conversation identifier.
alter table public.customers add column if not exists pancake_conversation_id text;

create or replace function public.set_customer_pancake_conversation(
  p_customer_id uuid, p_conversation_id text
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: only the Owner or Selected Admin can set the Pancake conversation. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  update public.customers
    set pancake_conversation_id = nullif(trim(p_conversation_id), '')
    where id = p_customer_id;
end;
$function$;

revoke all on function public.set_customer_pancake_conversation(uuid, text) from public, anon;
grant execute on function public.set_customer_pancake_conversation(uuid, text) to authenticated;
