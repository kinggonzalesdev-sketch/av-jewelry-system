-- Completed Items server-side pagination (Owner request 2026-08-17): fixes the "999 of 999"
-- cap. The count of matching completed records is computed IN THE DATABASE (exact) and only
-- ONE page of rows is returned — the total never depends on how many rows the browser loaded.
-- Mirrors inventory_active_ids_page. Applied live via MCP migration of the same name;
-- reproduced here so the repository matches production.
--
-- Root cause it replaces: listCompletedInventory() did an unpaginated select, so PostgREST's
-- default max-rows (1000) capped it; the UI then used the loaded array length as the total
-- (1000 - 1 in-review item = "999 of 999"). This RPC's count(*) is a SQL aggregate with no
-- row cap, so 1,249 / 12,485 / 25,750 all report exactly.

-- Stage label from the linked order — 1:1 with stageFromOrder() in completed.ts.
create or replace function public.completed_item_stage(
  p_order_status text, p_destination text, p_availability text
) returns text
language sql immutable
set search_path to ''
as $function$
  select case
    when p_order_status in ('completed','cancelled','for_cancel','expired_overdue') then
      case p_order_status when 'completed' then 'Completed' else 'Cancelled' end
    when p_destination = 'shipping' then 'Ship Confirm'
    when p_destination = 'delivery' then 'Delivery'
    when p_destination = 'pickup' then 'Pickup'
    when p_destination = 'layaway' then 'For Layaway'
    when p_destination = 'keep' then 'Keep'
    when p_destination = 'cancelled' then 'Cancelled'
    when p_order_status = 'invoiced' then 'For Invoice'
    when p_order_status = 'awaiting_required_payment' then 'For Invoice'
    when p_order_status = 'required_payment_verified' then 'For Confirm'
    when p_order_status = 'for_preparation' then 'For Prepare'
    when p_order_status = 'for_shipping_or_pickup' then 'For Shipping'
    when p_order_status = 'approved_for_release' then 'Ship Confirm'
    when p_order_status = 'exceptional_release_pending' then 'Ship Confirm'
    when p_order_status = 'dispatched_or_picked_up' then 'Delivery'
    when p_order_status = 'for_layaway' then 'For Layaway'
    when p_order_status = 'keep' then 'Keep'
    when p_availability in ('released','sold_released') then 'Released'
    when p_availability = 'completed' then 'Completed'
    else '—'
  end;
$function$;

create or replace function public.completed_inventory_page(
  p_search text default '',
  p_type text default 'all',
  p_limit int default 25,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer
set search_path to ''
as $function$
declare v_result jsonb; v_search text := coalesce(p_search,'');
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  with items as (
    select i.id, i.item_code, i.item_name, i.availability_status,
           i.custody_holder, i.storage_location
    from public.inventory_items i
    where i.availability_status in
          ('provisionally_reserved','committed','sold_released','completed','released')
      and not exists (
        select 1 from public.returned_to_stock_reviews r
        where r.inventory_item_id = i.id and r.status = 'in_review'
      )
  ),
  item_order as (
    select distinct on (it.id)
      it.id as item_id, 1 as matched,
      o.order_number, o.invoice_number, o.status as order_status,
      o.fulfillment_destination, cust.display_name as customer_name,
      f.method as f_method, f.collection_channel as f_channel,
      f.courier as f_courier, f.tracking_number as f_tracking, f.completed_at as f_completed_at
    from items it
    join public.claims c on c.inventory_item_id = it.id
    join public.official_order_claims ooc on ooc.claim_id = c.id
    join public.official_orders o on o.id = ooc.official_order_id
    left join public.customers cust on cust.id = o.customer_id
    left join lateral (
      select fr.method, fr.collection_channel, fr.courier, fr.tracking_number, fr.completed_at
      from public.fulfillment_records fr
      where fr.official_order_id = o.id
      order by fr.completed_at desc nulls last
      limit 1
    ) f on true
    order by it.id, o.created_at desc
  ),
  base as (
    select
      it.id as "inventoryItemId",
      it.item_code as "itemCode",
      it.item_name as "itemName",
      it.availability_status as "availabilityStatus",
      io.customer_name as "customerName",
      io.order_number as "orderNumber",
      io.invoice_number as "invoiceNumber",
      case
        when io.matched is null then 'Released'
        when io.f_method = 'pickup' then 'Store Pickup'
        when io.f_method = 'shipping' then
          case when io.f_channel = 'rider' then 'Rider Delivery' else 'Delivered' end
        else 'Released'
      end as "completionType",
      io.f_courier as "courier",
      io.f_tracking as "trackingNumber",
      io.f_completed_at as "completedDate",
      case when it.custody_holder = 'financer' then 'Financer' else 'A.V. Jewelry' end as "currentHolder",
      it.storage_location as "currentLocation",
      public.completed_item_stage(io.order_status, io.fulfillment_destination, it.availability_status) as "currentStage"
    from items it
    left join item_order io on io.item_id = it.id
  ),
  matches as (
    select * from base
    where v_search = ''
       or "itemCode" ilike '%'||v_search||'%'
       or coalesce("itemName",'') ilike '%'||v_search||'%'
       or coalesce("customerName",'') ilike '%'||v_search||'%'
       or coalesce("orderNumber",'') ilike '%'||v_search||'%'
       or coalesce("invoiceNumber",'') ilike '%'||v_search||'%'
  ),
  filtered as (
    select * from matches
    where p_type = 'all' or "completionType" = p_type
  )
  select jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(to_jsonb(pg) order by pg."itemCode")
      from (
        select * from filtered order by "itemCode"
        limit greatest(coalesce(p_limit, 25), 0)
        offset greatest(coalesce(p_offset, 0), 0)
      ) pg
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'searchTotal', (select count(*) from matches),
    'typeCounts', coalesce((
      select jsonb_object_agg("completionType", c)
      from (select "completionType", count(*) c from matches group by "completionType") t
    ), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
