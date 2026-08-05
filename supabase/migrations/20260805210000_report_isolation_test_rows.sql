-- Keep TEST-tagged rows out of production reports (Owner request, completes Test
-- Mode safety). The dashboard RPCs read from official_orders / payments CTEs; add an
-- is_test=false filter to those source scans WITHOUT retyping the functions — read
-- the current definition and patch the single source line. A no-op if the line ever
-- changes, so it can never corrupt the report.
--
-- Covers the order-count buckets (dashboard_counts) and every sales figure
-- (dashboard_metrics, via its `valid` CTE). The payment-only sub-metrics
-- (pending_payments, collection_trend) still include test payments — a minor
-- follow-up.
do $do$
declare v_def text;
begin
  select pg_get_functiondef('public.dashboard_counts()'::regprocedure) into v_def;
  v_def := replace(v_def,
    'from public.official_orders o',
    'from public.official_orders o where not coalesce(o.is_test, false)');
  v_def := replace(v_def,
    'from public.payments where status = ''submitted_unverified''',
    'from public.payments where status = ''submitted_unverified'' and not coalesce(is_test, false)');
  execute v_def;

  select pg_get_functiondef('public.dashboard_metrics()'::regprocedure) into v_def;
  v_def := replace(v_def,
    'left join public.layaway_arrangements la on la.official_order_id = oo.id',
    'left join public.layaway_arrangements la on la.official_order_id = oo.id where not coalesce(oo.is_test, false)');
  execute v_def;
end
$do$;
