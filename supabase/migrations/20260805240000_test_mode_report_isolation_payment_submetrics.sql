-- Phase 6 follow-up (Test Mode report isolation): the remaining payment-reading
-- report functions still counted TEST rows. dashboard_counts/dashboard_metrics
-- already filter is_test=false; this extends the same isolation to
-- dashboard_metrics_ranged (pending_payments, collection_trend, and its order CTE),
-- report_money_in_transit (every money bucket), and report_sales_summary. So a live
-- test session never inflates any dashboard/report figure. Patched via
-- pg_get_functiondef + replace so each function is preserved byte-for-byte except the
-- added filters; a not-found check aborts rather than silently no-op. fulfillment_records
-- has no is_test column, so its bucket is isolated via NOT EXISTS on the linked order.
do $mig$
declare
  v_src text;
  v_new text;
begin
  -- ============ report_sales_summary ============
  v_src := pg_get_functiondef('public.report_sales_summary(timestamptz, timestamptz)'::regprocedure);
  if position($s$  where p.recorded_at >= p_from and p.recorded_at <= p_to;$s$ in v_src) = 0 then
    raise exception 'report_sales_summary: payment filter not found — aborting.';
  end if;
  v_new := replace(v_src,
    $s$  where p.recorded_at >= p_from and p.recorded_at <= p_to;$s$,
    $r$  where p.is_test = false and p.recorded_at >= p_from and p.recorded_at <= p_to;$r$);
  execute v_new;

  -- ============ dashboard_metrics_ranged ============
  v_src := pg_get_functiondef('public.dashboard_metrics_ranged(date, date)'::regprocedure);

  -- (a) exclude test orders from the base order CTE
  if position($s$    from public.official_orders oo
    left join public.layaway_arrangements la on la.official_order_id = oo.id
  ),$s$ in v_src) = 0 then
    raise exception 'dashboard_metrics_ranged: order CTE not found — aborting.';
  end if;
  v_new := replace(v_src,
    $s$    from public.official_orders oo
    left join public.layaway_arrangements la on la.official_order_id = oo.id
  ),$s$,
    $r$    from public.official_orders oo
    left join public.layaway_arrangements la on la.official_order_id = oo.id
    where oo.is_test = false
  ),$r$);

  -- (b) pending_payments: exclude test payments
  if position($s$       where p.status = 'submitted_unverified' and p.voided_at is null and p.reversed_at is null),$s$ in v_new) = 0 then
    raise exception 'dashboard_metrics_ranged: pending_payments filter not found — aborting.';
  end if;
  v_new := replace(v_new,
    $s$       where p.status = 'submitted_unverified' and p.voided_at is null and p.reversed_at is null),$s$,
    $r$       where p.status = 'submitted_unverified' and p.voided_at is null and p.reversed_at is null and p.is_test = false),$r$);

  -- (c) collection_trend: exclude test payments
  if position($s$          and p.recorded_at::date between p_from and p_to$s$ in v_new) = 0 then
    raise exception 'dashboard_metrics_ranged: collection_trend filter not found — aborting.';
  end if;
  v_new := replace(v_new,
    $s$          and p.recorded_at::date between p_from and p_to$s$,
    $r$          and p.is_test = false
          and p.recorded_at::date between p_from and p_to$r$);
  execute v_new;

  -- ============ report_money_in_transit ============
  v_src := pg_get_functiondef('public.report_money_in_transit()'::regprocedure);

  -- (a) awaiting_verification: exclude test payments
  if position($s$      from public.payments p
      where p.status = 'submitted_unverified'
        and p.voided_at is null
        and p.reversed_at is null
    ), 0)::text,$s$ in v_src) = 0 then
    raise exception 'report_money_in_transit: awaiting_verification not found — aborting.';
  end if;
  v_new := replace(v_src,
    $s$      from public.payments p
      where p.status = 'submitted_unverified'
        and p.voided_at is null
        and p.reversed_at is null
    ), 0)::text,$s$,
    $r$      from public.payments p
      where p.status = 'submitted_unverified'
        and p.voided_at is null
        and p.reversed_at is null
        and p.is_test = false
    ), 0)::text,$r$);

  -- (b) customer_pending: exclude test orders
  if position($s$      where o.status = 'awaiting_required_payment'
    ), 0)::text,$s$ in v_new) = 0 then
    raise exception 'report_money_in_transit: customer_pending not found — aborting.';
  end if;
  v_new := replace(v_new,
    $s$      where o.status = 'awaiting_required_payment'
    ), 0)::text,$s$,
    $r$      where o.status = 'awaiting_required_payment'
        and o.is_test = false
    ), 0)::text,$r$);

  -- (c) in_transit / rider / lbc (all three share the same status guard)
  if position($s$        and o.status not in ('completed', 'cancelled')$s$ in v_new) = 0 then
    raise exception 'report_money_in_transit: in-transit status guard not found — aborting.';
  end if;
  v_new := replace(v_new,
    $s$        and o.status not in ('completed', 'cancelled')$s$,
    $r$        and o.status not in ('completed', 'cancelled')
        and o.is_test = false$r$);

  -- (d) collected_unremitted: fulfillment_records has no is_test — isolate via the order
  if position($s$      from public.fulfillment_records f
      where f.collected_at is not null
        and f.remitted_at is null
    ), 0)::text$s$ in v_new) = 0 then
    raise exception 'report_money_in_transit: collected_unremitted not found — aborting.';
  end if;
  v_new := replace(v_new,
    $s$      from public.fulfillment_records f
      where f.collected_at is not null
        and f.remitted_at is null
    ), 0)::text$s$,
    $r$      from public.fulfillment_records f
      where f.collected_at is not null
        and f.remitted_at is null
        and not exists (
          select 1 from public.official_orders o2
          where o2.id = f.official_order_id and o2.is_test
        )
    ), 0)::text$r$);
  execute v_new;
end;
$mig$;
