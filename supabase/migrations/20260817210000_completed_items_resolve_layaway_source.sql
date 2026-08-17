-- Completed Items (Owner request 2026-08-17): rows showed "—" for Customer / Sale Amount /
-- Payment / Current Stage. Root cause: those are LAYAWAY items — committed to a layaway plan,
-- which does NOT create an official order/claim — so the order-only joins resolved nothing
-- (of 116 order-less completed items, 111 are layaway; only 5 have neither order nor layaway).
-- Fix: resolve customer / sale / payment / stage from the layaway records (layaway_ledger via
-- layaway_ledger_items, or the single-item layaway_ledger.inventory_item_id), preferring an
-- official order when one exists; give committed/reserved a real stage label so Stage is never
-- "—". Applied live via MCP migration of the same name. completed_items_money is used only by
-- the Completed Items reader, so extending it is safe.

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
    when p_availability = 'committed' then 'Committed'
    when p_availability = 'provisionally_reserved' then 'Reserved'
    else '—'
  end;
$function$;

create or replace function public.completed_items_money(p_item_ids uuid[])
 returns TABLE(inventory_item_id uuid, final_sale numeric, verified_paid numeric, payment_status text)
 language sql
 security definer
 set search_path to ''
as $function$
  with order_money as (
    select distinct on (c.inventory_item_id)
      c.inventory_item_id as item_id,
      app_private.total_amount_payable(o.id) as final_sale,
      app_private.verified_net_payments(o.id) as verified_paid
    from public.claims c
    join public.official_order_claims ooc on ooc.claim_id = c.id
    join public.official_orders o on o.id = ooc.official_order_id
    where c.inventory_item_id = any(p_item_ids)
    order by c.inventory_item_id, o.created_at desc
  ),
  layaway_money as (
    select distinct on (item_id)
      item_id, coalesce(grand_total, item_amount) as final_sale, coalesce(payment, 0) as verified_paid
    from (
      select li.inventory_item_id as item_id, ll.grand_total, ll.item_amount, ll.payment, ll.created_at
      from public.layaway_ledger_items li join public.layaway_ledger ll on ll.id = li.ledger_id
      where li.inventory_item_id = any(p_item_ids)
      union all
      select ll.inventory_item_id as item_id, ll.grand_total, ll.item_amount, ll.payment, ll.created_at
      from public.layaway_ledger ll
      where ll.inventory_item_id = any(p_item_ids)
    ) u
    order by item_id, created_at desc
  ),
  merged as (
    select p as item_id,
      coalesce(om.final_sale, lm.final_sale) as final_sale,
      coalesce(om.verified_paid, lm.verified_paid) as verified_paid
    from unnest(p_item_ids) p
    left join order_money om on om.item_id = p
    left join layaway_money lm on lm.item_id = p
    where om.item_id is not null or lm.item_id is not null
  )
  select
    m.item_id as inventory_item_id,
    m.final_sale,
    m.verified_paid,
    case
      when app_private.is_active_staff() is not true then null
      when m.final_sale is null then null
      when round(coalesce(m.verified_paid,0), 2) >= round(m.final_sale, 2) then 'paid_in_full'
      when coalesce(m.verified_paid,0) > 0 then 'partial'
      else 'unpaid'
    end as payment_status
  from merged m
  where app_private.is_active_staff();
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
  -- Layaway is the source of truth for items committed to a layaway (no official order).
  item_layaway as (
    select distinct on (item_id) item_id, customer_name
    from (
      select li.inventory_item_id as item_id, ll.customer_name, ll.created_at
      from public.layaway_ledger_items li join public.layaway_ledger ll on ll.id = li.ledger_id
      where li.inventory_item_id in (select id from items)
      union all
      select ll.inventory_item_id as item_id, ll.customer_name, ll.created_at
      from public.layaway_ledger ll
      where ll.inventory_item_id in (select id from items)
    ) u
    where item_id is not null
    order by item_id, created_at desc
  ),
  base as (
    select
      it.id as "inventoryItemId",
      it.item_code as "itemCode",
      it.item_name as "itemName",
      it.availability_status as "availabilityStatus",
      coalesce(io.customer_name, lay.customer_name) as "customerName",
      io.order_number as "orderNumber",
      io.invoice_number as "invoiceNumber",
      case
        when io.matched is not null then
          case
            when io.f_method = 'pickup' then 'Store Pickup'
            when io.f_method = 'shipping' then
              case when io.f_channel = 'rider' then 'Rider Delivery' else 'Delivered' end
            else 'Released'
          end
        when lay.item_id is not null then 'Layaway'
        else 'Released'
      end as "completionType",
      io.f_courier as "courier",
      io.f_tracking as "trackingNumber",
      io.f_completed_at as "completedDate",
      case when it.custody_holder = 'financer' then 'Financer' else 'A.V. Jewelry' end as "currentHolder",
      it.storage_location as "currentLocation",
      case
        when io.matched is not null then
          public.completed_item_stage(io.order_status, io.fulfillment_destination, it.availability_status)
        when it.availability_status in ('completed','released','sold_released') then
          public.completed_item_stage(null, null, it.availability_status)
        when lay.item_id is not null then 'For Layaway'
        else public.completed_item_stage(null, null, it.availability_status)
      end as "currentStage"
    from items it
    left join item_order io on io.item_id = it.id
    left join item_layaway lay on lay.item_id = it.id
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
