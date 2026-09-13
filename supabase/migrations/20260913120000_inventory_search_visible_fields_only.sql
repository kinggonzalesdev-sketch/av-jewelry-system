-- INVENTORY SEARCH: MATCH ONLY WHAT THE USER CAN SEE (Owner 2026-09-13).
--
-- THE BUG, PROVEN AGAINST PRODUCTION DATA. In Inventory -> Completed Items, a search for "1124"
-- returned SBA-E-6486 0.83g and SBA-E-6490 1.30g. Neither item's detail shows "1124" anywhere.
-- Both are lines on the same order, whose official_orders.order_number is "ORD-2026-001124".
-- completed_inventory_page matched the search against five expressions, two of which the user can
-- never see: "orderNumber" (the Order Number, retired from the UI earlier) and "invoiceNumber".
-- Per-item proof (every other searched field was false for both):
--     SBA-E-6486 0.83g   hit_order_number = true   order_number = ORD-2026-001124
--     SBA-E-6490 1.30g   hit_order_number = true   order_number = ORD-2026-001124
-- The invoice number on that order, INV-2026-143128, does NOT contain 1124 — so the Owner's
-- suspicion of the invoice was reasonable but the culprit was the retired Order Number.
-- Verified: NO approved, visible field on any Completed item contains "1124", so after this change
-- that search correctly returns 0.
--
-- THE PRINCIPLE (Owner): search must be VISIBLE AND EXPLAINABLE. If a row appears for a term, the
-- term must be inside a business field the user can inspect on that row. Never a UUID, internal id,
-- foreign key, order number, invoice number, or joined-record identifier.
--
-- CANONICAL ALLOWLIST — mirrored in src/lib/inventory/search-fields.ts, which is what the tests
-- assert against. Keep the two in lock-step.
--   Shared (Active + Completed):
--     item_code          Inventory Code / Unique Code. Also carries the visible Grams, Size and the
--                        raw condition/type codes, because the UI parses those OUT of the code.
--     item_name          Item.
--     condition label    "Brand New" / "Subasta" / "Electro Form"   } derived from item_code by
--     item-type label    "Earrings", "Ring", "Necklace", ...        } app_private.inventory_code_labels
--     status             availability_status, underscores shown as spaces exactly as the UI renders it.
--   Active only:         custody holder label, storage location.
--   Completed only:      customer, courier, tracking number, completion type, current stage,
--                        final holder, final location.
--
-- DELIBERATELY NOT SEARCHED:
--   order_number, invoice_number  — retired, not shown to users (the root cause above).
--   the `size` COLUMN             — the UI displays size parsed from item_code, not this column, so a
--                                   stale value here would match something the user cannot see.
--   id / any uuid / foreign key   — never user-visible.
--   the Active "Notes" cell       — it renders system flags ("In RTS review", "forfeited"), not
--                                   stored text; there is no free-text notes column on inventory_items.
--
-- NOT APPLIED TO PRODUCTION BY THIS TASK (Owner: DEPLOYED: NO). An RPC change is live the instant it
-- is applied, independent of any web deploy, so it ships together with the web deploy. Validated
-- against production data inside a rolled-back transaction.
--
-- PERFORMANCE: no new index. The search runs over the post-join CTE (derived values like
-- currentStage / completionType cannot be indexed), which is the existing design and unchanged in
-- shape. The two trigram indexes that existed solely to serve the removed searches —
-- official_orders_order_no_trgm and official_orders_invoice_no_trgm — are now unused by this RPC and
-- are reported as a future cleanup candidate, NOT dropped here.

-- ---------------------------------------------------------------------------
-- Derived condition + item-type labels from an inventory code.
--
-- MUST mirror src/lib/inventory/code-parser.ts (CODE_RE, DEFAULT_CONDITIONS, DEFAULT_ITEM_TYPES).
-- A unit test reads this file and fails if a label here disagrees with the TypeScript maps.
-- Without this, searching "Earrings" could never match "SBA-E-6486 0.83g": the word "Earrings" is
-- not in the code — the parser turns the "E" segment into it for display.
--
-- IMMUTABLE and search_path-pinned so the planner can inline it.
-- ---------------------------------------------------------------------------
create or replace function app_private.inventory_code_labels(p_code text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select concat_ws(' ',
    case upper(m[1])
      when 'BN' then 'Brand New'
      when 'SB' then 'Subasta'
      when 'EF' then 'Electro Form'
    end,
    case upper(m[3])
      when 'B' then 'Bracelet / Anklet'
      when 'N' then 'Necklace'
      when 'R' then 'Ring'
      when 'E' then 'Earrings'
      when 'P' then 'Pendant'
      when 'C' then 'Chain'
    end
  )
  from (
    -- Same normalisation the parser applies: collapse whitespace runs, trim.
    select regexp_match(
      regexp_replace(trim(coalesce(p_code, '')), '\s+', ' ', 'g'),
      '^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)'
    ) as m
  ) x
$function$;

revoke all on function app_private.inventory_code_labels(text) from public;
revoke all on function app_private.inventory_code_labels(text) from anon;

-- ---------------------------------------------------------------------------
-- Completed Items page.
--
-- Changes from the live definition (read back 2026-09-13), and nothing else:
--   1. order_number and invoice_number are no longer selected or returned.
--   2. A boolean "hasOrder" replaces them for the one place the UI needs to know an order exists
--      (the "whole order is removed too" hint) — presence, never the number.
--   3. The `matches` predicate is rebuilt on the canonical allowlist.
-- The joins, stage derivation, completion-type derivation, filters, ordering, limits, and the
-- rows / total / searchTotal / typeCounts contract are verbatim. `total` and `searchTotal` still come
-- from the SAME `matches` CTE as the rows, so rows, total and page count cannot disagree.
-- ---------------------------------------------------------------------------
create or replace function public.completed_inventory_page(
  p_search text default ''::text,
  p_type text default 'all'::text,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
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
    -- order_number / invoice_number intentionally NOT selected: retired, never shown, and the
    -- direct cause of the "1124" false match.
    select distinct on (it.id)
      it.id as item_id, 1 as matched,
      o.status as order_status,
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
      (io.matched is not null) as "hasOrder",
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
    -- CANONICAL COMPLETED ALLOWLIST. Every field here is shown in the Completed Item detail.
    select * from base
    where v_search = ''
       or "itemCode" ilike '%'||v_search||'%'
       or coalesce("itemName",'') ilike '%'||v_search||'%'
       or app_private.inventory_code_labels("itemCode") ilike '%'||v_search||'%'
       or replace("availabilityStatus",'_',' ') ilike '%'||v_search||'%'
       or coalesce("customerName",'') ilike '%'||v_search||'%'
       or coalesce("courier",'') ilike '%'||v_search||'%'
       or coalesce("trackingNumber",'') ilike '%'||v_search||'%'
       or coalesce("completionType",'') ilike '%'||v_search||'%'
       or coalesce("currentStage",'') ilike '%'||v_search||'%'
       or coalesce("currentHolder",'') ilike '%'||v_search||'%'
       or coalesce("currentLocation",'') ilike '%'||v_search||'%'
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

-- ---------------------------------------------------------------------------
-- Active Inventory page.
--
-- Changes from the live definition (read back 2026-09-13): ONLY the search predicate, rebuilt on the
-- canonical allowlist so "Earrings" / "Subasta" / a status now work the same way they do in
-- Completed Items. It previously matched item_code and item_name only — no hidden field, but also
-- no way to find a type by name. Grouping, status filter, paging, groupCounts and statusOptions are
-- verbatim, and `total` still comes from the same `filtered` CTE as the ids.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_active_ids_page(
  p_search text default ''::text,
  p_status text default 'all'::text,
  p_group text default 'all'::text,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_result jsonb;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  with base as (
    select
      i.id,
      i.item_code,
      i.item_name,
      i.availability_status,
      i.custody_holder,
      i.storage_location,
      case
        when (coalesce(i.item_code,'') || ' ' || coalesce(i.item_name,'')) ~* 'hk\s*item'
          then 'HK ITEM'
        else case upper(substring(regexp_replace(coalesce(i.item_code,''), '[^a-zA-Z]', '', 'g') from 1 for 2))
          when 'BN' then 'BN' when 'SB' then 'SB' when 'EF' then 'EF' else 'Other' end
      end as item_group
    from public.inventory_items i
    where not i.is_archived
      and i.availability_status in ('available', 'returned_to_available')
  ),
  filtered as (
    select * from base
    where (p_status = 'all' or availability_status = p_status)
      and (p_group = 'all' or item_group = p_group)
      and (coalesce(p_search, '') = ''
           -- CANONICAL ACTIVE ALLOWLIST.
           or item_code ilike '%' || p_search || '%'
           or coalesce(item_name, '') ilike '%' || p_search || '%'
           or app_private.inventory_code_labels(item_code) ilike '%' || p_search || '%'
           or replace(availability_status, '_', ' ') ilike '%' || p_search || '%'
           or (case when custody_holder = 'financer' then 'Financer' else 'A.V. Jewelry' end)
                ilike '%' || p_search || '%'
           or coalesce(storage_location, '') ilike '%' || p_search || '%')
  )
  select jsonb_build_object(
    'ids', coalesce((
      select jsonb_agg(id order by item_code)
      from (
        select id, item_code from filtered
        order by item_code
        limit greatest(coalesce(p_limit, 25), 0)
        offset greatest(coalesce(p_offset, 0), 0)
      ) pg
    ), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'groupCounts', coalesce((
      select jsonb_object_agg(item_group, c)
      from (select item_group, count(*) c from base group by item_group) g
    ), '{}'::jsonb),
    'statusOptions', coalesce((
      select to_jsonb(array_agg(distinct availability_status order by availability_status))
      from base
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;
