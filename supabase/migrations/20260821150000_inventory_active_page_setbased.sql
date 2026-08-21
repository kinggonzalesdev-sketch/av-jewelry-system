-- #8 (Owner 2026-08-21): inventory_active_ids_page recomputed public.inventory_monitor() (a Function
-- Scan with 3 CTEs for reserved/forfeited/rts) on every page load — yet it only uses the base columns
-- (id/item_code/item_name/availability_status), never the monitor's computed availability. Rewrite to
-- read inventory_items DIRECTLY (proven byte-identical: monitor-filtered vs direct-filtered = 2111
-- rows, 0 diff both ways; full-output comparison total/groupCounts/statusOptions/first-page/search all
-- matched), which drops the unused reserved/forfeited/rts computation and lets the query use indexes.
-- Add a trigram index on item_code so the `item_code ilike OR item_name ilike` search can go
-- index-backed at scale (item_name already had one; without item_code's, the OR forces a scan).
-- Logic otherwise copied verbatim; output unchanged.
--
-- VERIFIED on prod: browse ~30ms(FunctionScan) -> 2.5ms(scan+topN); search 19ms -> 8ms; output
-- byte-identical vs the monitor-based version.
create index if not exists inventory_items_code_trgm_idx
  on public.inventory_items using gin (item_code gin_trgm_ops);

create or replace function public.inventory_active_ids_page(
  p_search text default ''::text, p_status text default 'all'::text, p_group text default 'all'::text,
  p_limit integer default 25, p_offset integer default 0)
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
           or item_code ilike '%' || p_search || '%'
           or coalesce(item_name, '') ilike '%' || p_search || '%')
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
