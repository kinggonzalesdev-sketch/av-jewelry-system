-- RETIRED IDENTIFIERS OUT OF SEARCH + LABELS; NEAR-OVERDUE COUNT HONOURS THE FINANCER FILTER
-- (Owner 2026-09-13).
--
-- Companion to 20260913120000_inventory_search_visible_fields_only.sql. That file fixed the two
-- Inventory RPCs; the same hidden-field audit found the SAME class of problem in two more places,
-- plus one Layaway count that ignored its own filter. Each change below is the minimal diff over the
-- live definition (read back 2026-09-13); everything else in each body is verbatim.
--
-- NOT APPLIED TO PRODUCTION BY THIS TASK (Owner: DEPLOYED: NO) — ships with the web deploy, because
-- the web now expects `sectionCounts.near_overdue` from layaway_page (it falls back to the seed
-- count when absent, so applying in either order is safe).

-- ---------------------------------------------------------------------------
-- 1. orders_page — stop matching the retired Order Number and Invoice Number.
--
-- /orders showed neither number anywhere (the row lists Customer / Amount / Payment / Date /
-- Status, and the Order Details header shows only a status badge), yet the search matched both.
-- All 2,269 live orders carry an ORD-… and a distinct INV-…, so "2026", "000048" or "ORD-" returned
-- rows for numbers the user could never see. The visible fields are the customer name and, inside
-- Order Details for shipping orders, the waybill — those stay.
-- ---------------------------------------------------------------------------
create or replace function public.orders_page(
  p_search text default ''::text,
  p_card text default 'all'::text,
  p_date_from text default ''::text,
  p_date_to text default ''::text,
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_result jsonb; v_search text := btrim(coalesce(p_search,''));
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  with pay as (
    -- exact verified net payments per order (replicates app_private.verified_net_payments)
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
           o.waybill_number,
           cust.display_name as customer_name,
           (coalesce(pay.verified, 0) = 0) as is_awaiting
    from public.official_orders o
    left join public.customers cust on cust.id = o.customer_id
    left join pay on pay.oid = o.id
  ),
  searched as (
    -- VISIBLE fields only: customer name (row) and waybill (Order Details). order_number and
    -- invoice_number deliberately removed — retired, never displayed.
    select * from base
    where (v_search = ''
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
    -- Card counts are over the WHOLE store (they ignore search/date/card), matching the
    -- current UI ("the status cards count every order in the store").
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

-- ---------------------------------------------------------------------------
-- 2. inventory_item_dependencies — label an order by customer + date, never by a number.
--
-- The Archived Items permanent-delete dialog lists what blocks a delete. The 'order' row was
-- labelled coalesce(order_number, invoice_number, id::text): the retired Order Number on every
-- order (it is NOT NULL), and a raw UUID as the last resort. Staff identify an order by customer
-- and date, so that is the label. Only the 'order' branch changes.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_item_dependencies(p_item_id uuid)
returns table(dependency_kind text, reference_label text, is_active boolean)
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  if app_private.current_staff_role() not in ('owner','selected_admin') then
    raise exception 'Not authorized: managing inventory is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  return query
  select 'order'::text,
         concat_ws(' · ', coalesce(cust.display_name, 'Order'),
                          to_char(o.created_at at time zone 'Asia/Manila', 'YYYY-MM-DD')),
         (o.status is distinct from 'completed' and o.status is distinct from 'cancelled')
  from public.official_orders o
  join public.official_order_claims ooc on ooc.official_order_id = o.id
  join public.claims c on c.id = ooc.claim_id
  left join public.customers cust on cust.id = o.customer_id
  where c.inventory_item_id = p_item_id
  union all
  select 'claim'::text, coalesce(c.claim_reference, c.id::text), false
  from public.claims c
  where c.inventory_item_id = p_item_id
    and not exists (select 1 from public.official_order_claims ooc where ooc.claim_id = c.id)
  union all
  select 'reservation'::text, r.state, (r.state in ('provisional', 'committed'))
  from public.inventory_reservations r where r.inventory_item_id = p_item_id
  union all
  select 'live_batch'::text, coalesce(lb.batch_reference, lb.id::text), false
  from public.live_batch_items lbi
  join public.live_batches lb on lb.id = lbi.live_batch_id
  where lbi.inventory_item_id = p_item_id
  union all
  select 'rts_review'::text, rts.status, (rts.status = 'in_review')
  from public.returned_to_stock_reviews rts where rts.inventory_item_id = p_item_id
  union all
  select 'completed_sale'::text, i.availability_status, false
  from public.inventory_items i
  where i.id = p_item_id and i.availability_status in ('completed', 'released', 'sold_released');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. layaway_page — (a) report near_overdue in sectionCounts, (b) stop mapping the retired Order
--    Number into account_no.
--
-- (a) The "Near Overdue (30 Days)" card read the global layaway_near_overdue_count(), which takes
--     no filter. Every list on the page narrows to the selected financer; the card did not, so with
--     "NEZ" selected it kept showing 148 while NEZ's own near-due list showed 7. The Owner read that
--     as financer accounts losing their due state. sectionCounts already come from `searched`
--     (search + financer + date applied) — near_overdue now joins them, under the SAME canonical
--     rule the card, the row badges and the hidden near_overdue section already share.
-- (b) For layaway_arrangements rows account_no was coalesce(o.order_number,'—'): the retired
--     number flowed into the row tooltip, the CSV, and the search predicate. Now '—'.
--     (0 arrangement rows live today — latent, closed anyway.)
-- Search predicate, sections, ordering, summary and financerOptions are otherwise verbatim.
-- ---------------------------------------------------------------------------
create or replace function public.layaway_page(
  p_search text default ''::text,
  p_section text default 'all'::text,
  p_financer text default ''::text,
  p_date_from text default ''::text,
  p_date_to text default ''::text,
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
  v_search text := btrim(coalesce(p_search,''));
  v_today  date := (now() at time zone 'Asia/Manila')::date;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  with acct as (
    select
      'l'::text as source,
      l.id,
      lower(btrim(l.status)) as nstatus,
      l.customer_name,
      l.account_no,
      l.layaway_code,
      l.remarks,
      null::text as financer_name,
      inv.item_code as unique_code,
      l.date_purchased as purchase_date,
      l.created_at,
      coalesce(l.item_amount,0)  as item_amt,
      coalesce(l.interest,0)     as interest_amt,
      coalesce(l.grand_total,0)  as grand_amt,
      coalesce(l.payment,0)      as paid_amt,
      coalesce(l.balance,0)      as balance_amt
    from public.layaway_ledger l
    left join public.inventory_items inv on inv.id = l.inventory_item_id
    where lower(btrim(l.status)) <> 'needs_review'
      and l.status <> 'transferred'

    union all

    select
      'a'::text as source,
      a.id,
      lower(btrim(a.status)) as nstatus,
      coalesce(cust.display_name,'Unknown') as customer_name,
      '—'::text as account_no,   -- was coalesce(o.order_number,'—'): retired number, never shown
      a.layaway_code,
      a.remarks,
      fin.name as financer_name,
      null::text as unique_code,
      a.started_at::date as purchase_date,
      a.created_at,
      coalesce(public.order_item_total(a.official_order_id),0) as item_amt,
      coalesce(a.layaway_fee,0) as interest_amt,
      coalesce((ob.j->>'total_amount_payable')::numeric,0) as grand_amt,
      coalesce((ob.j->>'verified_net_payments')::numeric,0) as paid_amt,
      coalesce((ob.j->>'outstanding_balance')::numeric,0)   as balance_amt
    from public.layaway_arrangements a
    left join public.official_orders o on o.id = a.official_order_id
    left join public.customers cust on cust.id = o.customer_id
    left join public.financers fin on fin.id = a.financer_id
    left join lateral (select public.order_balance(a.official_order_id) as j) ob on true
  ),
  flagged as (
    select acct.*,
      public.layaway_is_overdue(nstatus, balance_amt, purchase_date, v_today) as is_overdue,
      btrim(coalesce(financer_name, remarks, '')) as financer_of
    from acct
  ),
  searched as (
    select * from flagged
    where (v_search = ''
       or coalesce(unique_code,'')   ilike '%'||v_search||'%'
       or coalesce(layaway_code,'')  ilike '%'||v_search||'%'
       or coalesce(account_no,'')    ilike '%'||v_search||'%'
       or coalesce(customer_name,'') ilike '%'||v_search||'%'
       or coalesce(financer_name,'') ilike '%'||v_search||'%'
       or coalesce(remarks,'')       ilike '%'||v_search||'%')
      and (p_date_from = '' or created_at::date >= p_date_from::date)
      and (p_date_to   = '' or created_at::date <= p_date_to::date)
      and (
        p_financer = '' or p_financer = '__all__'
        or (p_financer = '__none__' and financer_of = '')
        or (p_financer not in ('__all__','__none__')
            and lower(regexp_replace(financer_of, '\s+', ' ', 'g')) = p_financer)
      )
  ),
  filtered as (
    select * from searched
    where case
      when p_section = 'near_overdue' then
        source = 'l'
        and nstatus = 'active'
        and balance_amt > 0
        and public.layaway_overdue_date(purchase_date) between v_today + 1 and v_today + 30
      else public.layaway_matches_section(nstatus, balance_amt, paid_amt, grand_amt,
                                          purchase_date, p_section, v_today)
    end
  ),
  page_ids as (
    select source, id,
           row_number() over (order by created_at desc nulls last, id desc) as ord
    from filtered
    order by created_at desc nulls last, id desc
    limit greatest(coalesce(p_limit,25),0) offset greatest(coalesce(p_offset,0),0)
  )
  select jsonb_build_object(
    'ids', coalesce(
      (select jsonb_agg(jsonb_build_object('s', source, 'id', id) order by ord) from page_ids),
      '[]'::jsonb),
    'total', (select count(*) from filtered),
    'sectionCounts', (
      select jsonb_build_object(
        'all',          count(*),
        'active',       count(*) filter (where nstatus not in ('completed','forfeited','cancelled') and not is_overdue),
        'overdue',      count(*) filter (where is_overdue),
        'forfeited',    count(*) filter (where nstatus = 'forfeited'),
        'completed',    count(*) filter (where nstatus = 'completed' and balance_amt <= 0 and paid_amt >= grand_amt),
        -- SAME predicate as the near_overdue section above and as layaway_near_overdue_count().
        'near_overdue', count(*) filter (where source = 'l' and nstatus = 'active' and balance_amt > 0
                                           and public.layaway_overdue_date(purchase_date)
                                               between v_today + 1 and v_today + 30)
      ) from searched
    ),
    'summary', (
      select jsonb_build_object(
        'qty',        count(*),
        'interest',   to_char(coalesce(sum(interest_amt),0), 'FM99999999999990.00'),
        'grandTotal', to_char(coalesce(sum(grand_amt),0),    'FM99999999999990.00'),
        'payment',    to_char(coalesce(sum(paid_amt),0),     'FM99999999999990.00'),
        'balance',    to_char(coalesce(sum(balance_amt),0),  'FM99999999999990.00')
      ) from filtered
    ),
    'financerOptions', (
      select coalesce(jsonb_agg(distinct financer_of), '[]'::jsonb)
      from flagged where financer_of <> ''
    )
  ) into v_result;

  return v_result;
end;
$function$;
