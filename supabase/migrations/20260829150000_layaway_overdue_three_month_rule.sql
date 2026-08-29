-- Align EVERY Layaway overdue surface to the ONE canonical rule (Owner-confirmed 2026-08-29):
--   OVERDUE DATE = date_purchased + 3 CALENDAR MONTHS   (never +90 days, never next_due_date).
--
-- Before this, the "Overdue" tab/filter + section counts + dashboard overdue count classified via
-- the stored next_due_date, while the new Overdue Date column / days-left / Near Overdue card use
-- purchase + 3 months — two competing definitions. This routes ALL of them through one SQL helper
-- (layaway_overdue_date), so the Overdue tab, its counts, the CSV export (same RPC), the dashboard,
-- and the row badges/highlighting agree exactly.
--
-- next_due_date is PRESERVED (not dropped): it stays the payment/reminder date and still drives the
-- dashboard due_today / due_7d reminder metrics — it is simply no longer the authoritative source for
-- the 3-month OVERDUE classification. No destructive change; interest/payment/balance/forfeiture and
-- the arrangement status lifecycle ('overdue'/'grace_period'/'forfeiture_eligible' stay authoritative)
-- are untouched. date_purchased is a real `date` column, so the arithmetic never parse-errors.

-- ── Canonical overdue date: date purchased + 3 calendar months (end-of-month clamped, matches the
--    client helper layawayOverdueDate and Postgres `date + interval '3 months'`). Pure, no table read. ──
create or replace function public.layaway_overdue_date(p_date_purchased date)
 returns date
 language sql
 immutable
as $function$
  select case
    when p_date_purchased is null then null
    else (p_date_purchased + interval '3 months')::date
  end;
$function$;

-- ── Overdue now keys off DATE PURCHASED (+3 months), not next_due_date. The 3rd param is renamed
--    (next_due → date_purchased), which CREATE OR REPLACE cannot do, so we DROP + CREATE. These are
--    pure old-style SQL helpers with no hard dependents (function bodies are not dependency-tracked),
--    and it is one atomic migration. The type signature (text, numeric, date, date) is unchanged, so
--    positional callers stay drop-in. Terminal statuses and paid-off rows are never overdue; the
--    order-workflow derived-overdue statuses stay authoritative (arrangement lifecycle preserved). ──
drop function if exists public.layaway_matches_section(text, numeric, numeric, numeric, date, text, date);
drop function if exists public.layaway_is_overdue(text, numeric, date, date);

create function public.layaway_is_overdue(p_nstatus text, p_balance numeric, p_date_purchased date, p_today date)
 returns boolean
 language sql
 immutable
as $function$
  select case
    when p_nstatus in ('completed','forfeited','cancelled') then false
    when coalesce(p_balance,0) <= 0 then false
    when p_nstatus in ('overdue','grace_period','forfeiture_eligible') then true
    else public.layaway_overdue_date(p_date_purchased) is not null
         and public.layaway_overdue_date(p_date_purchased) < p_today
  end;
$function$;

-- ── Section membership passes date_purchased through to the overdue check (recreated above via DROP). ──
create function public.layaway_matches_section(p_nstatus text, p_balance numeric, p_paid numeric, p_grand numeric, p_date_purchased date, p_section text, p_today date)
 returns boolean
 language sql
 immutable
as $function$
  select case p_section
    when 'all' then true
    when 'completed' then (p_nstatus = 'completed'
                            and coalesce(p_balance,0) <= 0
                            and coalesce(p_paid,0) >= coalesce(p_grand,0))
    when 'overdue' then public.layaway_is_overdue(p_nstatus, p_balance, p_date_purchased, p_today)
    when 'forfeited' then p_nstatus = 'forfeited'
    else (p_nstatus not in ('completed','forfeited','cancelled')
          and not public.layaway_is_overdue(p_nstatus, p_balance, p_date_purchased, p_today))
  end;
$function$;

-- ── The Layaway page RPC (drives the Overdue tab, section counts, and the CSV export via the same
--    reader): feed date_purchased (ledger) / started_at (arrangement) into the overdue helpers
--    instead of next_due_date / final_due_date. Everything else is byte-for-byte unchanged. ──
create or replace function public.layaway_page(p_search text DEFAULT ''::text, p_section text DEFAULT 'all'::text, p_financer text DEFAULT ''::text, p_date_from text DEFAULT ''::text, p_date_to text DEFAULT ''::text, p_limit integer DEFAULT 25, p_offset integer DEFAULT 0)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    where public.layaway_matches_section(nstatus, balance_amt, paid_amt, grand_amt,
                                         purchase_date, p_section, v_today)
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

-- ── Dashboard metrics: the OVERDUE (and therefore ACTIVE = active-not-overdue) count now uses the
--    3-month rule too. due_today / due_7d stay on next_due_date — they are payment REMINDERS, not the
--    overdue classification, and the Owner kept next_due_date for exactly that. ──
create or replace function public.layaway_dashboard_metrics()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v jsonb;
  v_today date;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  v_today := (now() at time zone 'Asia/Manila')::date;

  with led as (
    select * from public.layaway_ledger
    where lower(trim(status)) in ('active', 'completed')
  ),
  led_class as (
    select
      l.*,
      (lower(trim(l.status)) = 'active'
        and public.layaway_overdue_date(l.date_purchased) is not null
        and public.layaway_overdue_date(l.date_purchased) < v_today
        and coalesce(l.balance, 0) > 0) as is_overdue,
      (lower(trim(l.status)) = 'completed'
        and round(coalesce(l.balance, 0), 2) <= 0
        and round(coalesce(l.payment, 0), 2) >= round(coalesce(l.grand_total, 0), 2)) as is_completed
    from led l
  ),
  arr as (
    select * from public.layaway_arrangements
  )
  select jsonb_build_object(
    'active',
      (select count(*) from led_class where lower(trim(status)) = 'active' and not is_overdue)
      + (select count(*) from arr where status = 'active'),
    'completed',
      (select count(*) from led_class where is_completed)
      + (select count(*) from arr where status = 'completed'),
    'overdue',
      (select count(*) from led_class where is_overdue)
      + (select count(*) from arr where status in ('overdue', 'grace_period', 'forfeiture_eligible')),
    'forfeited',
      (select count(*) from arr where status = 'forfeited'),
    'total_qty',
      (select count(*) from led_class) + (select count(*) from arr),
    'created_today',
      (select count(*) from led_class where (created_at at time zone 'Asia/Manila')::date = v_today)
      + (select count(*) from arr where (created_at at time zone 'Asia/Manila')::date = v_today),
    'created_month',
      (select count(*) from led_class
        where date_trunc('month', (created_at at time zone 'Asia/Manila')::date) = date_trunc('month', v_today))
      + (select count(*) from arr
        where date_trunc('month', (created_at at time zone 'Asia/Manila')::date) = date_trunc('month', v_today)),
    'due_today',
      (select count(*) from led_class
        where lower(trim(status)) = 'active' and next_due_date = v_today and coalesce(balance, 0) > 0),
    'due_7d',
      (select count(*) from led_class
        where lower(trim(status)) = 'active' and coalesce(balance, 0) > 0
          and next_due_date between v_today and v_today + 7),
    'total_item', coalesce((select sum(item_amount) from led_class), 0),
    'total_interest', coalesce((select sum(interest) from led_class), 0),
    'grand_total', coalesce((select sum(grand_total) from led_class), 0),
    'total_payment', coalesce((select sum(payment) from led_class), 0),
    'remaining_balance', coalesce((select sum(balance) from led_class), 0)
  ) into v;

  return v;
end;
$function$;

-- ── Near Overdue count: re-point onto the shared helper so it can never drift from the tab. ──
create or replace function public.layaway_near_overdue_count()
 returns integer
 language plpgsql
 stable
 security definer
 set search_path to ''
as $function$
declare
  v_today date;
  v_count integer;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  v_today := (now() at time zone 'Asia/Manila')::date;

  select count(*)
    into v_count
  from public.layaway_ledger l
  where lower(btrim(l.status)) = 'active'
    and coalesce(l.balance, 0) > 0
    and public.layaway_overdue_date(l.date_purchased) between v_today + 1 and v_today + 30;

  return coalesce(v_count, 0);
end;
$function$;
