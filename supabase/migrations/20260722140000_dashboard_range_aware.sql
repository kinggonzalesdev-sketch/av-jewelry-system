-- Range-aware dashboard (Owner request 2026-07-22): the Start/End date now scopes
-- the money figures and the collection trend, not only the "Sales for the Period"
-- chart. Same per-order money functions as dashboard_metrics() — the Official-Order
-- sums are bounded to [p_from, p_to] by created_at, the trend by recorded_at.
-- sales_today/week/month and pending_payments stay as-of-now (their own windows).

create or replace function public.dashboard_metrics_ranged(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  with o as (
    select oo.id, oo.status, oo.created_at,
           (la.official_order_id is not null) as is_layaway,
           la.status as layaway_status
    from public.official_orders oo
    left join public.layaway_arrangements la on la.official_order_id = oo.id
  ),
  o_r as (
    select * from o where created_at::date between p_from and p_to
  ),
  valid_r as (
    select * from o_r where status <> 'cancelled'
  ),
  valid_all as (
    select * from o where status <> 'cancelled'
  )
  select jsonb_build_object(
    'total_official_orders', (select count(*) from o_r),
    'order_count_valid', (select count(*) from valid_r),
    'total_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_r),
    'verified_collections',
      (select coalesce(sum(app_private.verified_net_payments(id)), 0)::numeric(20, 2)::text from valid_r),
    'outstanding_balance',
      (select coalesce(sum(app_private.outstanding_balance(id)), 0)::numeric(20, 2)::text from valid_r),
    'full_payment_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_r where not is_layaway),
    'total_layaway_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_r where is_layaway),
    'layaway_collections',
      (select coalesce(sum(app_private.verified_net_payments(id)), 0)::numeric(20, 2)::text from valid_r where is_layaway),
    'pending_payments',
      (select coalesce(sum(p.amount), 0)::numeric(20, 2)::text
       from public.payments p
       where p.status = 'submitted_unverified' and p.voided_at is null and p.reversed_at is null),
    'cancelled_amount',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from o_r where status = 'cancelled'),
    'forfeited_amount',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from o_r where layaway_status = 'forfeited'),
    'sales_today',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_all where created_at >= date_trunc('day', now())),
    'sales_week',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_all where created_at >= date_trunc('week', now())),
    'sales_month',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text from valid_all where created_at >= date_trunc('month', now())),
    'average_order_value',
      (select case when count(*) = 0 then '0.00'
              else (sum(app_private.total_amount_payable(id)) / count(*))::numeric(20, 2)::text end
       from valid_r),
    'collection_trend', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
                    'day', d.day,
                    'verified', d.v::numeric(20, 2)::text,
                    'weight', round(d.v * 100)::bigint)
                  order by d.day),
        '[]'::jsonb)
      from (
        select p.recorded_at::date as day,
               sum(coalesce(v.verified_amount, p.amount)) as v
        from public.payments p
        left join public.payment_verifications v on v.payment_id = p.id
        where p.status = 'verified'
          and p.voided_at is null and p.reversed_at is null
          and p.correction_pending = false
          and p.recorded_at::date between p_from and p_to
        group by p.recorded_at::date
      ) d
    )
  );
$function$;

grant execute on function public.dashboard_metrics_ranged(date, date) to authenticated;

-- Range-aware scrap total (replaces the all-time no-arg version).
drop function if exists public.dashboard_scrap_total();
create or replace function public.dashboard_scrap_total(p_from date, p_to date)
returns table(total_amount numeric, sale_count bigint)
language sql
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::numeric as total_amount,
         count(*)::bigint as sale_count
  from public.scrap_sales
  where sold_on between p_from and p_to;
$$;

grant execute on function public.dashboard_scrap_total(date, date) to authenticated;
