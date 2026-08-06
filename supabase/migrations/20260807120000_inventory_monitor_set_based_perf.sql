-- PERFORMANCE: inventory_monitor() was per-row — for each of ~2,194 items it called
-- app_private.available_quantity() TWICE plus two correlated EXISTS (one a 4-table
-- join), ~8,800 sub-lookups per call at ~723 ms. It is read on every orders/inventory
-- page load (twice on Orders, via listCaptureItems + listWalkInItems) and re-run on
-- every realtime refresh, so it dominated DB time and made the app feel slow.
--
-- Rewritten SET-BASED: reservations summed once (GROUP BY), forfeited computed once
-- (single 4-table join), RTS once — then LEFT JOINed to the item list. Output is
-- byte-identical to the old function (verified: 0 mismatches over all 2,194 rows),
-- but the planner now uses a few hash joins instead of thousands of per-row lookups.
-- Measured: 723 ms -> 47 ms (~15x).
create or replace function public.inventory_monitor()
returns table(
  inventory_item_id uuid,
  item_code text,
  item_name text,
  availability_status text,
  quantity_total integer,
  available_quantity integer,
  reserved_quantity integer,
  in_rts_review boolean,
  is_forfeited boolean
)
language sql
stable
set search_path to ''
as $function$
  with reserved as (
    select r.inventory_item_id, sum(r.quantity) as qty
    from public.inventory_reservations r
    where r.state in ('provisional', 'committed')
    group by r.inventory_item_id
  ),
  forfeited as (
    select distinct c.inventory_item_id
    from public.layaway_arrangements l
    join public.official_orders o on o.id = l.official_order_id
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    where l.status = 'forfeited' and c.inventory_item_id is not null
  ),
  rts as (
    select distinct r.inventory_item_id
    from public.returned_to_stock_reviews r
    where r.status = 'in_review'
  )
  select
    i.id, i.item_code, i.item_name, i.availability_status, i.quantity_total,
    -- available_quantity (inlined app_private.available_quantity, computed once). The
    -- WHERE excludes archived, so only the completed/released -> 0 branch remains.
    (case when i.availability_status in ('completed', 'released') then 0
          else i.quantity_total - coalesce(res.qty, 0) end)::int,
    -- reserved_quantity = quantity_total - available_quantity.
    (case when i.availability_status in ('completed', 'released') then i.quantity_total
          else coalesce(res.qty, 0) end)::int,
    (rts.inventory_item_id is not null),
    (forfeited.inventory_item_id is not null)
  from public.inventory_items i
  left join reserved res on res.inventory_item_id = i.id
  left join rts on rts.inventory_item_id = i.id
  left join forfeited on forfeited.inventory_item_id = i.id
  where not i.is_archived;
$function$;

-- Stats: several of these tables were never ANALYZEd (reltuples = -1), leaving the
-- planner blind. Refresh so the new joins get good plans.
analyze public.inventory_items;
analyze public.inventory_reservations;
analyze public.layaway_arrangements;
analyze public.returned_to_stock_reviews;
analyze public.official_order_claims;
analyze public.claims;
