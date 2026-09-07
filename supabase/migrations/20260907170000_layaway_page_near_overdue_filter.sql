-- Add a hidden 'near_overdue' section to layaway_page so the "Near Overdue (30 Days)" card is
-- clickable and lists exactly the accounts it counts. The predicate MATCHES
-- layaway_near_overdue_count exactly (active LEDGER accounts with a balance whose canonical
-- overdue date is 1..30 days ahead). Business rule unchanged; only a new filter mode added.
create or replace function public.layaway_page(p_search text default ''::text, p_section text default 'all'::text, p_financer text default ''::text, p_date_from text default ''::text, p_date_to text default ''::text, p_limit integer default 25, p_offset integer default 0)
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
      coalesce(o.order_number,'—') as account_no,
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
