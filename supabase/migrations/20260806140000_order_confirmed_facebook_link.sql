-- Per-transaction confirmed Facebook/Pancake identity (spec §6/§7/§8). The ORDER keeps
-- its OWN conversation reference so Send Invoice / Open FB Chat use exactly that chat,
-- and it survives even if the customer profile is edited later. All additive & nullable;
-- when an order has no link of its own, delivery falls back to the customer's link.

alter table public.official_orders
  add column if not exists fb_pancake_conversation_id text,
  add column if not exists fb_conversation_url text,
  add column if not exists fb_pancake_customer_id text,
  add column if not exists fb_page_id text,
  add column if not exists fb_link_method text,
  add column if not exists fb_link_confidence text,
  add column if not exists fb_link_status text,
  add column if not exists fb_linked_by uuid references public.staff_profiles(id),
  add column if not exists fb_linked_at timestamptz;

-- Save (or clear) the confirmed Facebook/Pancake link on ONE order. Owner/Admin only.
create or replace function public.set_order_facebook_link(
  p_order_id uuid,
  p_conversation_id text default null,
  p_url text default null,
  p_pancake_customer_id text default null,
  p_page_id text default null,
  p_method text default null,
  p_confidence text default null
) returns void language plpgsql security definer set search_path to '' as $$
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Only the Owner or an Admin can set an order''s Facebook link.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_url is not null and length(trim(p_url)) > 0 and p_url !~* '^https?://' then
    raise exception 'Enter a full link starting with http:// or https://.'
      using errcode = 'check_violation';
  end if;

  update public.official_orders set
    fb_pancake_conversation_id = nullif(trim(coalesce(p_conversation_id, '')), ''),
    fb_conversation_url = nullif(trim(coalesce(p_url, '')), ''),
    fb_pancake_customer_id = nullif(trim(coalesce(p_pancake_customer_id, '')), ''),
    fb_page_id = nullif(trim(coalesce(p_page_id, '')), ''),
    fb_link_method = nullif(trim(coalesce(p_method, '')), ''),
    fb_link_confidence = nullif(trim(coalesce(p_confidence, '')), ''),
    fb_link_status = case
      when nullif(trim(coalesce(p_conversation_id, '')), '') is not null
        or nullif(trim(coalesce(p_url, '')), '') is not null
      then 'confirmed' else null end,
    fb_linked_by = case
      when nullif(trim(coalesce(p_conversation_id, '')), '') is not null
        or nullif(trim(coalesce(p_url, '')), '') is not null
      then app_private.current_staff_id() else null end,
    fb_linked_at = case
      when nullif(trim(coalesce(p_conversation_id, '')), '') is not null
        or nullif(trim(coalesce(p_url, '')), '') is not null
      then now() else null end
  where id = p_order_id;
end;
$$;

revoke all on function public.set_order_facebook_link(uuid, text, text, text, text, text, text) from public;
grant execute on function public.set_order_facebook_link(uuid, text, text, text, text, text, text) to authenticated;
