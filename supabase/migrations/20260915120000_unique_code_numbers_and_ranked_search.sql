-- NUMERIC CODE UNIQUENESS + CODE-FIRST SEARCH RANKING + LAYAWAY DUE STATUS ON COMPLETED ITEMS
-- (Owner 2026-09-15). Apply AFTER 20260913120000/-130000 — this file redefines the two inventory
-- page RPCs ON TOP of the visible-fields-only bodies from those files.
--
-- 1. THE NUMERIC CODE IS THE ITEM'S IDENTITY. SBA-E-8413 (1.30g) and SBA-P-8413 (2.07g) both
--    exist in production: full-code uniqueness (lower(item_code)) allowed the same sequence 8413
--    under two prefixes. From now on a NEW code whose sequence number already belongs to another
--    live item is refused — in the database, so no bypassed form can create one. EXISTING
--    duplicates are grandfathered (never renamed or deleted here); a review RPC lists them for
--    manual correction.
-- 2. CODE-FIRST SEARCH: searching a code must put the exact item first — exact full code, then
--    exact numeric code, then prefix, then contains, then other fields. No fuzzy matching.
-- 3. LAYAWAY DUE STATUS on Completed Items: an item financed through layaway keeps its main stage
--    (e.g. "For Layaway") AND gains a derived payment-due state (Overdue / Due Today / Near Due /
--    On Track) computed from the ledger's date_purchased + 3 CALENDAR MONTHS and live balance —
--    the same canonical rule the Layaway page uses (layaway_overdue_date / 30-day near window,
--    Asia/Manila business date). Paid off / closed accounts yield NULL, so the badge clears itself.

-- ---------------------------------------------------------------------------
-- Sequence-number + canonical-prefix extraction. MUST mirror CODE_RE in
-- src/lib/inventory/code-parser.ts (same normalisation: collapse whitespace, trim). Tests read
-- this file and fail if the regex drifts from the TypeScript parser.
-- ---------------------------------------------------------------------------
create or replace function app_private.inventory_code_number(p_code text)
returns text
language sql
immutable
set search_path to ''
as $function$
  -- 1. Canonical CODE_RE parse (SBA-E-8413 …). 2. Otherwise ANY prefix shape still claims its
  -- number (Owner: K18-8413 / EF-8413 must not reuse 8413): a standalone 3–6 digit run bounded
  -- by start/space/dash and end/space/dash — grams (1.30g), sizes (7"), and karat marks (K18)
  -- never qualify. PL- auto codes are internal placeholders: exempt. MUST mirror
  -- inventoryCodeNumber in src/lib/inventory/code-number.ts.
  select coalesce(
    (regexp_match(
      regexp_replace(trim(coalesce(p_code, '')), '\s+', ' ', 'g'),
      '^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)'
    ))[4],
    case
      when upper(trim(coalesce(p_code, ''))) like 'PL-%' then null
      else (regexp_match(
        regexp_replace(trim(coalesce(p_code, '')), '\s+', ' ', 'g'),
        '(?:^|[\s-])(\d{3,6})(?=[\s-]|$)'
      ))[1]
    end
  )
$function$;

create or replace function app_private.inventory_code_canonical(p_code text)
returns text
language sql
immutable
set search_path to ''
as $function$
  select upper(m[1] || m[2] || '-' || m[3] || '-' || m[4])
  from (
    select regexp_match(
      regexp_replace(trim(coalesce(p_code, '')), '\s+', ' ', 'g'),
      '^([A-Za-z]{2})([A-Za-z])[\s-]+([A-Za-z]+)[\s-]+(\d+)'
    ) as m
  ) x
$function$;

revoke all on function app_private.inventory_code_number(text) from public, anon;
revoke all on function app_private.inventory_code_canonical(text) from public, anon;
-- inventory_code_number is the EXPRESSION of inventory_items_code_number_idx below, and Postgres
-- checks EXECUTE on an index expression as the role WRITING the row. The web and mobile apps insert
-- and update inventory_items directly as `authenticated` (RLS-gated) and through the service-role
-- admin client, so both roles need it; without this grant every new or re-coded item fails with
-- "permission denied for function inventory_code_number". (Pre-apply review 2026-09-16.)
grant execute on function app_private.inventory_code_number(text) to authenticated, service_role;

-- Fast lookup by sequence number (duplicate check + exact-numeric search rank). NOT unique:
-- production already holds duplicates, which are grandfathered — the trigger below stops NEW ones.
create index if not exists inventory_items_code_number_idx
  on public.inventory_items ((app_private.inventory_code_number(item_code)))
  where is_archived = false;

-- ---------------------------------------------------------------------------
-- The guard. BEFORE INSERT, and BEFORE UPDATE only when the code actually changes — editing an
-- item without touching its own code (or re-saving one of the grandfathered duplicates) is always
-- allowed. Archived items do not reserve a number. Raises unique_violation so every existing
-- 23505 handler in the web code treats it as a duplicate, with the Owner's exact wording.
-- ---------------------------------------------------------------------------
create or replace function app_private.enforce_unique_inventory_code_number()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_number   text;
  v_existing text;
begin
  v_number := app_private.inventory_code_number(new.item_code);
  if v_number is null then
    return new; -- no numeric identity (HK ITEM, PL- codes, free text): full-code rule only
  end if;
  if tg_op = 'UPDATE'
     and app_private.inventory_code_number(old.item_code) is not distinct from v_number then
    return new; -- the number did not change: grandfathered, allowed
  end if;

  select i.item_code into v_existing
  from public.inventory_items i
  where i.is_archived = false
    and i.id is distinct from new.id
    and app_private.inventory_code_number(i.item_code) = v_number
  limit 1;

  if v_existing is not null then
    raise exception 'Code % is already assigned to %. Please use another code.',
      v_number, v_existing
      using errcode = 'unique_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists inventory_items_unique_code_number on public.inventory_items;
create trigger inventory_items_unique_code_number
  before insert or update of item_code on public.inventory_items
  for each row execute function app_private.enforce_unique_inventory_code_number();

-- ---------------------------------------------------------------------------
-- Admin review of the duplicates that already exist. Read-only; groups live (non-archived) items
-- sharing a sequence number. Nothing is renamed or deleted automatically — the Owner corrects
-- these by hand via the existing Super-Admin code correction.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_duplicate_code_numbers()
returns table(code_number text, item_count bigint, codes text[])
language sql
stable security definer
set search_path to ''
as $function$
  select app_private.inventory_code_number(i.item_code) as code_number,
         count(*) as item_count,
         array_agg(i.item_code order by i.item_code) as codes
  from public.inventory_items i
  where not i.is_archived
    and app_private.inventory_code_number(i.item_code) is not null
    and app_private.is_active_staff()
  group by 1
  having count(*) > 1
  order by 1
$function$;

revoke all on function public.inventory_duplicate_code_numbers() from public, anon;
grant execute on function public.inventory_duplicate_code_numbers() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Active Inventory page — same allowlist predicate as 20260913120000, plus code-first ranking.
-- ORDER: exact full code (0), exact numeric (1), prefix (2), contains (3), other fields (4);
-- item_code breaks rank ties. total/groupCounts/statusOptions contracts unchanged.
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
declare
  v_result jsonb;
  v_q text := lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'));
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
    select base.*,
      case
        when v_q = '' then 4
        when lower(regexp_replace(btrim(item_code), '\s+', ' ', 'g')) = v_q
          or app_private.inventory_code_canonical(item_code) = upper(v_q) then 0
        when v_q ~ '^\d+$' and app_private.inventory_code_number(item_code) = v_q then 1
        when item_code ilike btrim(coalesce(p_search,'')) || '%' then 2
        when item_code ilike '%' || btrim(coalesce(p_search,'')) || '%' then 3
        else 4
      end as code_rank
    from base
    where (p_status = 'all' or availability_status = p_status)
      and (p_group = 'all' or item_group = p_group)
      and (coalesce(p_search, '') = ''
           -- CANONICAL ACTIVE ALLOWLIST (20260913120000) — unchanged.
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
      select jsonb_agg(id order by ord)
      from (
        select id, row_number() over (order by code_rank, item_code) as ord
        from filtered
        order by code_rank, item_code
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

-- ---------------------------------------------------------------------------
-- Completed Items page — the 20260913120000 body, plus (a) the same code-first ranking and
-- (b) the layaway due status. item_layaway now also carries the latest account's status/balance/
-- date_purchased so the due state is DERIVED IN SQL from real payment records — never a frontend
-- calculation. rows/total/searchTotal/typeCounts contracts unchanged; new per-row fields only.
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
declare
  v_result jsonb;
  v_search text := coalesce(p_search,'');
  v_q text := lower(regexp_replace(btrim(coalesce(p_search, '')), '\s+', ' ', 'g'));
  v_today date := (now() at time zone 'Asia/Manila')::date;
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
  -- Layaway is the source of truth for items committed to a layaway (no official order). The
  -- latest account's status / balance / date_purchased feed the derived due state.
  item_layaway as (
    select distinct on (item_id) item_id, customer_name, nstatus, balance, date_purchased
    from (
      select li.inventory_item_id as item_id, ll.customer_name, ll.created_at,
             lower(btrim(ll.status)) as nstatus, coalesce(ll.balance,0) as balance,
             ll.date_purchased
      from public.layaway_ledger_items li join public.layaway_ledger ll on ll.id = li.ledger_id
      where li.inventory_item_id in (select id from items)
      union all
      select ll.inventory_item_id as item_id, ll.customer_name, ll.created_at,
             lower(btrim(ll.status)) as nstatus, coalesce(ll.balance,0) as balance,
             ll.date_purchased
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
      end as "currentStage",
      -- DERIVED PAYMENT-DUE STATE for a layaway-financed item (Owner 2026-09-15): an ADDITIONAL
      -- condition beside the main stage, never a replacement. Same canonical rule as the Layaway
      -- page: due = date_purchased + 3 calendar months (layaway_overdue_date), near = 30 days,
      -- Manila business date. Closed accounts and a settled balance yield NULL — a recorded
      -- payment that clears the overdue balance removes the indicator on the next read.
      case
        when lay.item_id is null then null
        when lay.nstatus in ('completed','forfeited','cancelled') then null
        when lay.balance <= 0 then null
        when lay.nstatus in ('overdue','grace_period','forfeiture_eligible') then 'Overdue'
        when public.layaway_overdue_date(lay.date_purchased) is null then null
        when public.layaway_overdue_date(lay.date_purchased) < v_today then 'Overdue'
        when public.layaway_overdue_date(lay.date_purchased) = v_today then 'Due Today'
        when public.layaway_overdue_date(lay.date_purchased) <= v_today + 30 then 'Near Due'
        else 'On Track'
      end as "layawayDueStatus",
      public.layaway_overdue_date(lay.date_purchased) as "layawayDueDate"
    from items it
    left join item_order io on io.item_id = it.id
    left join item_layaway lay on lay.item_id = it.id
  ),
  matches as (
    -- CANONICAL COMPLETED ALLOWLIST (20260913120000) — unchanged.
    select base.*,
      case
        when v_q = '' then 4
        when lower(regexp_replace(btrim("itemCode"), '\s+', ' ', 'g')) = v_q
          or app_private.inventory_code_canonical("itemCode") = upper(v_q) then 0
        when v_q ~ '^\d+$' and app_private.inventory_code_number("itemCode") = v_q then 1
        when "itemCode" ilike btrim(coalesce(p_search,'')) || '%' then 2
        when "itemCode" ilike '%' || btrim(coalesce(p_search,'')) || '%' then 3
        else 4
      end as code_rank
    from base
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
      select jsonb_agg(to_jsonb(pg) - 'code_rank' order by pg.code_rank, pg."itemCode")
      from (
        select * from filtered order by code_rank, "itemCode"
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
