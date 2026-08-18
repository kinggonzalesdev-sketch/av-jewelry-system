-- Layaway scalability (Owner request 2026-08-18, P1-B). Applied live via MCP migration of the
-- same name; reproduced here so the repository matches production.
--
-- The Layaway Accounts table loaded EVERY imported ledger row into the browser
-- (listLayawayLedger → all 812, growing) and then classified (active/overdue/forfeited/
-- completed), searched, financer-filtered, summed and paginated CLIENT-SIDE. It will not
-- scale to 50k. This mirrors the proven orders_page / inventory_active_ids_page pattern: ONE
-- SQL RPC does the section + search + financer filter + full-store section counts + exact
-- filtered total + the financial summary in the DB and returns only the CURRENT PAGE's ids;
-- the TS reader then builds rows with the SAME ledger/arrangement readers (row shape + money
-- identical to the old lists).
--
-- The Layaway table has TWO independent sources, kept separate on purpose:
--   • layaway_ledger        — imported / manual flat accounts (the real data; STORED money).
--   • layaway_arrangements  — order-derived layaways (0 today; money via order_balance()/
--                             order_item_total(), the SAME functions listLayaways calls, so
--                             the figures are identical). The union pays a per-row function
--                             cost only for arrangement rows; the ledger is pure stored
--                             columns and scales to 50k.

-- Overdue = a live account past its Next Due Date that still owes money. 1:1 with the client
-- isOverdueRow(): terminal + fully-paid are never overdue; a DB-derived overdue status
-- (overdue/grace_period/forfeiture_eligible) is overdue if it still owes; else Next Due < today.
create or replace function public.layaway_is_overdue(
  p_nstatus text, p_balance numeric, p_next_due date, p_today date
) returns boolean
language sql immutable
set search_path to ''
as $function$
  select case
    when p_nstatus in ('completed','forfeited','cancelled') then false
    when coalesce(p_balance,0) <= 0 then false
    when p_nstatus in ('overdue','grace_period','forfeiture_eligible') then true
    else p_next_due is not null and p_next_due < p_today
  end;
$function$;

-- Section membership — 1:1 with the client section filter. 'active' EXCLUDES overdue so no
-- account is ever in both. A COMPLETED account must have genuinely closed (balance <= 0 AND
-- paid >= grand); imported completed rows with blank money (all zero) are valid completed.
create or replace function public.layaway_matches_section(
  p_nstatus text, p_balance numeric, p_paid numeric, p_grand numeric,
  p_next_due date, p_section text, p_today date
) returns boolean
language sql immutable
set search_path to ''
as $function$
  select case p_section
    when 'all' then true
    when 'completed' then (p_nstatus = 'completed'
                            and coalesce(p_balance,0) <= 0
                            and coalesce(p_paid,0) >= coalesce(p_grand,0))
    when 'overdue' then public.layaway_is_overdue(p_nstatus, p_balance, p_next_due, p_today)
    when 'forfeited' then p_nstatus = 'forfeited'
    else (p_nstatus not in ('completed','forfeited','cancelled')
          and not public.layaway_is_overdue(p_nstatus, p_balance, p_next_due, p_today))
  end;
$function$;

create or replace function public.layaway_page(
  p_search text default '',
  p_section text default 'all',
  p_financer text default '',
  p_date_from text default '',
  p_date_to text default '',
  p_limit int default 25,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer
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
    -- LEDGER: imported / manual accounts. Stored money — scales to 50k with no function calls.
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
      l.next_due_date as next_due,
      l.created_at,
      coalesce(l.item_amount,0)  as item_amt,
      coalesce(l.interest,0)     as interest_amt,
      coalesce(l.grand_total,0)  as grand_amt,
      coalesce(l.payment,0)      as paid_amt,
      coalesce(l.balance,0)      as balance_amt
    from public.layaway_ledger l
    left join public.inventory_items inv on inv.id = l.inventory_item_id
    where lower(btrim(l.status)) <> 'needs_review'   -- ERROR rows are never listed/counted/summed
      and l.status <> 'transferred'                  -- moved into Orders; leaves active layaway

    union all

    -- ARRANGEMENTS: order-derived layaways. Money via the SAME SQL functions listLayaways uses,
    -- so the figures match exactly. 0 rows today; the lateral runs order_balance once per row.
    select
      'a'::text as source,
      a.id,
      lower(btrim(a.status)) as nstatus,
      coalesce(cust.display_name,'Unknown') as customer_name,
      coalesce(o.order_number,'—') as account_no,
      a.layaway_code,
      a.remarks,
      fin.name as financer_name,
      null::text as unique_code,   -- resolved for page display only (reader), never for filtering
      a.final_due_date as next_due,
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
      public.layaway_is_overdue(nstatus, balance_amt, next_due, v_today) as is_overdue,
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
    where public.layaway_matches_section(nstatus, balance_amt, paid_amt, grand_amt,
                                         next_due, p_section, v_today)
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
        'all',       count(*),
        'active',    count(*) filter (where nstatus not in ('completed','forfeited','cancelled') and not is_overdue),
        'overdue',   count(*) filter (where is_overdue),
        'forfeited', count(*) filter (where nstatus = 'forfeited'),
        'completed', count(*) filter (where nstatus = 'completed' and balance_amt <= 0 and paid_amt >= grand_amt)
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

-- Scale indexes. next_due_date drives the overdue section; trigram GINs power %term% search on
-- the searchable text columns at 50k. (status / customer / created already exist.)
create index if not exists layaway_ledger_next_due_idx on public.layaway_ledger (next_due_date);
create index if not exists layaway_ledger_customer_name_trgm on public.layaway_ledger using gin (customer_name gin_trgm_ops);
create index if not exists layaway_ledger_account_no_trgm on public.layaway_ledger using gin (account_no gin_trgm_ops);
create index if not exists layaway_ledger_code_trgm on public.layaway_ledger using gin (layaway_code gin_trgm_ops);
create index if not exists layaway_ledger_remarks_trgm on public.layaway_ledger using gin (remarks gin_trgm_ops);
