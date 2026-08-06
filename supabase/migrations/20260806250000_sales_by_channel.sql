-- Dashboard "Sales by Channel": total order value in [from,to] split into Walk In /
-- Pick Up / Rider / Shipment (+ an "Other/unrouted" catch-all so it stays honest).
-- Classification: walk-in by order_source; online orders by their For-Prepare
-- destination (pickup/delivery/shipping) or the fulfillment record's method/channel.
-- Excludes cancelled + test orders. Money summed via the tested order-total function.
create or replace function public.sales_by_channel(p_from date, p_to date)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_result jsonb;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active staff session is required.';
  end if;

  with base as (
    select
      o.id,
      o.order_source,
      o.fulfillment_destination,
      app_private.total_amount_payable(o.id) as amount,
      (select f.method from public.fulfillment_records f
         where f.official_order_id = o.id order by f.created_at desc limit 1) as f_method,
      (select f.collection_channel from public.fulfillment_records f
         where f.official_order_id = o.id order by f.created_at desc limit 1) as f_channel
    from public.official_orders o
    where coalesce(o.is_test, false) = false
      and o.status is distinct from 'cancelled'
      and o.status is distinct from 'for_cancel'
      and o.status is distinct from 'expired_overdue'
      and o.created_at::date between p_from and p_to
  ),
  classified as (
    select amount,
      case
        when order_source = 'walk_in' then 'walk_in'
        when coalesce(f_method, '') = 'pickup' or fulfillment_destination = 'pickup' then 'pickup'
        when coalesce(f_channel, '') = 'rider' or fulfillment_destination = 'delivery' then 'rider'
        when coalesce(f_method, '') = 'shipping' or fulfillment_destination = 'shipping' then 'shipment'
        else 'other'
      end as channel
    from base
  )
  select jsonb_build_object(
    'walk_in',        coalesce(sum(amount) filter (where channel = 'walk_in'), 0)::text,
    'pickup',         coalesce(sum(amount) filter (where channel = 'pickup'), 0)::text,
    'rider',          coalesce(sum(amount) filter (where channel = 'rider'), 0)::text,
    'shipment',       coalesce(sum(amount) filter (where channel = 'shipment'), 0)::text,
    'other',          coalesce(sum(amount) filter (where channel = 'other'), 0)::text,
    'walk_in_count',  count(*) filter (where channel = 'walk_in'),
    'pickup_count',   count(*) filter (where channel = 'pickup'),
    'rider_count',    count(*) filter (where channel = 'rider'),
    'shipment_count', count(*) filter (where channel = 'shipment'),
    'other_count',    count(*) filter (where channel = 'other')
  ) into v_result
  from classified;

  return coalesce(v_result, jsonb_build_object());
end;
$function$;

revoke all on function public.sales_by_channel(date, date) from public, anon;
grant execute on function public.sales_by_channel(date, date) to authenticated;
