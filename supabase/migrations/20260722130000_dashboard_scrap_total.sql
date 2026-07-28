-- All-time scrap income total for the dashboard chart (Owner request 2026-07-22).
--
-- Security invoker so RLS on scrap_sales scopes it to what the caller may already
-- read, matching getDashboardMetrics. The amount is summed in SQL and returned as
-- an exact numeric — never a JS float — consistent with every other money figure.

create or replace function public.dashboard_scrap_total()
returns table(total_amount numeric, sale_count bigint)
language sql
security invoker
set search_path = ''
as $$
  select coalesce(sum(amount), 0)::numeric as total_amount,
         count(*)::bigint as sale_count
  from public.scrap_sales;
$$;

grant execute on function public.dashboard_scrap_total() to authenticated;
