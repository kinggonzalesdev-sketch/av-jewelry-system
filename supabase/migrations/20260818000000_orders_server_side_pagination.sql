-- Orders scalability (Owner request 2026-08-17, P1-A). Applied live via MCP migration of the
-- same name; reproduced here so the repository matches production. listOrders() range-paged
-- EVERY order into the browser + counted/filtered/searched/paginated client-side (won't scale
-- to 50k). This mirrors inventory_active_ids_page: ONE SQL RPC does the search + date + flow-
-- card filter + full-store card counts + exact filtered total in the DB and returns only the
-- CURRENT PAGE's order ids; the TS reader then builds rows with the SAME listOrders select +
-- getOrderBalances money reader.

create or replace function public.order_matches_card(
  p_status text, p_dest text, p_source text, p_converted boolean, p_awaiting boolean, p_card text
) returns boolean
language sql immutable
set search_path to ''
as $function$
  select case p_card
    when 'all' then true
    when 'walk_in' then p_source = 'walk_in'
    when 'for_invoice' then p_status in ('invoiced','awaiting_required_payment') and p_dest is null
    when 'for_reminder' then p_status = 'awaiting_required_payment' and p_dest is null
    when 'for_prepare' then p_status = 'for_preparation' and p_dest is null
    when 'for_confirm' then p_status = 'required_payment_verified'
    when 'for_shipping' then
      p_status not in ('approved_for_release','exceptional_release_pending','dispatched_or_picked_up')
      and p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'for_shipping_or_pickup' or p_dest = 'shipping')
    when 'ship_confirm' then
      p_status in ('approved_for_release','exceptional_release_pending','dispatched_or_picked_up')
      and coalesce(p_dest,'') not in ('delivery','pickup','layaway','keep')
    when 'delivery' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and p_dest = 'delivery'
    when 'pickup' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and p_dest = 'pickup'
    when 'for_layaway' then
      not coalesce(p_converted,false)
      and p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'for_layaway' or p_dest = 'layaway')
    when 'keep' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'keep' or p_dest = 'keep')
    when 'cancelled' then p_status = 'cancelled'
    when 'unverified_pay' then coalesce(p_awaiting, false)
    when 'completed' then p_status in ('completed','closed','delivered','picked_up','released')
    when 'for_cancel' then p_status <> 'cancelled' and (p_status = 'for_cancel' or p_dest = 'cancelled')
    else false
  end;
$function$;

create or replace function public.orders_page(
  p_search text default '',
  p_card text default 'all',
  p_date_from text default '',
  p_date_to text default '',
  p_limit int default 25,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer
set search_path to ''
as $function$
declare v_result jsonb; v_search text := btrim(coalesce(p_search,''));
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  with pay as (
    select p.official_order_id as oid, sum(coalesce(v.verified_amount, p.amount)) as verified
    from public.payments p
    join public.payment_verifications v on v.payment_id = p.id
    where p.status = 'verified' and v.outcome = 'verified'
      and p.voided_at is null and p.reversed_at is null and p.correction_pending = false
    group by p.official_order_id
  ),
  base as (
    select o.id, o.status, o.fulfillment_destination as dest, o.order_source as source,
           o.converted_to_layaway as converted, o.created_at, o.updated_at, o.completed_at,
           o.order_number, o.invoice_number, o.waybill_number,
           cust.display_name as customer_name,
           (coalesce(pay.verified, 0) = 0) as is_awaiting
    from public.official_orders o
    left join public.customers cust on cust.id = o.customer_id
    left join pay on pay.oid = o.id
  ),
  searched as (
    select * from base
    where (v_search = ''
       or order_number ilike '%'||v_search||'%'
       or invoice_number ilike '%'||v_search||'%'
       or coalesce(waybill_number,'') ilike '%'||v_search||'%'
       or coalesce(customer_name,'') ilike '%'||v_search||'%')
      and (p_date_from = '' or created_at::date >= p_date_from::date)
      and (p_date_to   = '' or created_at::date <= p_date_to::date)
  ),
  filtered as (
    select * from searched
    where public.order_matches_card(status, dest, source, converted, is_awaiting, p_card)
  ),
  page_ids as (
    select id, row_number() over (
      order by (case when p_card='completed' then completed_at end) desc nulls last,
               updated_at desc nulls last, created_at desc, id desc
    ) as ord
    from filtered
    order by (case when p_card='completed' then completed_at end) desc nulls last,
             updated_at desc nulls last, created_at desc, id desc
    limit greatest(coalesce(p_limit,25),0) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'ids', coalesce((select jsonb_agg(id order by ord) from page_ids), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'cardCounts', (
      select jsonb_build_object(
        'all',            count(*),
        'for_invoice',    count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'for_invoice')),
        'ship_confirm',   count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'ship_confirm')),
        'delivery',       count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'delivery')),
        'pickup',         count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'pickup')),
        'for_layaway',    count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'for_layaway')),
        'keep',           count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'keep')),
        'cancelled',      count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'cancelled')),
        'unverified_pay', count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'unverified_pay')),
        'walk_in',        count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'walk_in')),
        'completed',      count(*) filter (where public.order_matches_card(status,dest,source,converted,is_awaiting,'completed'))
      ) from base
    )
  ) into v_result;

  return v_result;
end;
$function$;

create index if not exists official_orders_updated_idx on public.official_orders (updated_at desc nulls last);
create index if not exists official_orders_completed_at_idx on public.official_orders (completed_at desc nulls last);
create index if not exists official_orders_source_idx on public.official_orders (order_source);
create index if not exists official_orders_order_no_trgm on public.official_orders using gin (order_number gin_trgm_ops);
create index if not exists official_orders_invoice_no_trgm on public.official_orders using gin (invoice_number gin_trgm_ops);
create index if not exists official_orders_waybill_trgm on public.official_orders using gin (waybill_number gin_trgm_ops);
create index if not exists customers_display_name_trgm on public.customers using gin (display_name gin_trgm_ops);
