-- ============================================================================
-- Dashboard business-total metrics (Bible §7, §23, §25). Phase: visibility.
-- ----------------------------------------------------------------------------
-- The dashboard had counts but no money totals. This adds the audited business
-- totals as ONE aggregate, computed by SUMMING the tested per-order readers
-- (app_private.total_amount_payable / verified_net_payments / outstanding_balance)
-- — never reinventing money math, so there is one source of truth.
--
-- Visibility (Owner-approved): on-screen totals are readable by ANY active staff.
--   - security invoker: RLS still scopes every underlying row to the caller, so
--     a total can never include an order the caller could not already read.
--   - granted to authenticated: viewing is NOT gated by export_data_reports.
--     Only EXPORT/DOWNLOAD remains export-gated.
--
-- Verified money only where applicable: collections count VERIFIED payments only;
-- "sales" is order value (payable). Cancelled orders are excluded from sales and
-- reported separately; forfeited layaways stay in sales and are also reported
-- separately (the sale happened, then forfeited).
-- ============================================================================

create or replace function public.dashboard_metrics()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with o as (
    select
      oo.id,
      oo.status,
      oo.created_at,
      (la.official_order_id is not null) as is_layaway,
      la.status as layaway_status
    from public.official_orders oo
    left join public.layaway_arrangements la on la.official_order_id = oo.id
  ),
  valid as (
    -- Valid sales = every Official Order that is not cancelled.
    select * from o where status <> 'cancelled'
  )
  select jsonb_build_object(
    'total_official_orders', (select count(*) from o),
    'order_count_valid', (select count(*) from valid),

    'total_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid),
    'verified_collections',
      (select coalesce(sum(app_private.verified_net_payments(id)), 0)::numeric(20, 2)::text
       from valid),
    'outstanding_balance',
      (select coalesce(sum(app_private.outstanding_balance(id)), 0)::numeric(20, 2)::text
       from valid),

    'full_payment_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid where not is_layaway),
    'total_layaway_sales',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid where is_layaway),
    'layaway_collections',
      (select coalesce(sum(app_private.verified_net_payments(id)), 0)::numeric(20, 2)::text
       from valid where is_layaway),

    -- Pending = recorded-but-unverified payment evidence. Not yet collected.
    'pending_payments',
      (select coalesce(sum(p.amount), 0)::numeric(20, 2)::text
       from public.payments p
       where p.status = 'submitted_unverified'
         and p.voided_at is null and p.reversed_at is null),

    'cancelled_amount',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from o where status = 'cancelled'),
    'forfeited_amount',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from o where layaway_status = 'forfeited'),

    'sales_today',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid where created_at >= date_trunc('day', now())),
    'sales_week',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid where created_at >= date_trunc('week', now())),
    'sales_month',
      (select coalesce(sum(app_private.total_amount_payable(id)), 0)::numeric(20, 2)::text
       from valid where created_at >= date_trunc('month', now())),

    'average_order_value',
      (select case when count(*) = 0 then '0.00'
              else (sum(app_private.total_amount_payable(id)) / count(*))::numeric(20, 2)::text
              end
       from valid),

    -- Verified collection per day over the last 30 days (verified money only).
    'collection_trend', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
                    'day', d.day,
                    'verified', d.v::numeric(20, 2)::text,
                    -- Exact integer centavos, so the client scales the bar with
                    -- no float money math (the displayed figure stays the string).
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
          and p.recorded_at >= (now() - interval '30 days')
        group by p.recorded_at::date
      ) d
    )
  );
$$;

comment on function public.dashboard_metrics() is
  'Bible §7/§25: audited business totals for the dashboard. security invoker (RLS scopes every row) and granted to authenticated so ANY active staff may VIEW totals — only export stays gated. Sums the tested per-order money readers; verified money only where applicable.';

revoke all on function public.dashboard_metrics() from anon;
grant execute on function public.dashboard_metrics() to authenticated;

-- ----------------------------------------------------------------------------
-- Visibility: on-screen report totals are viewable by any active staff.
-- report_sales_summary used to require export_data_reports even to VIEW. Per the
-- approved visibility model, VIEWING on-screen totals is broad; only actual
-- export/download remains export-gated (added when a download feature exists).
-- security invoker still scopes every row to the caller via RLS.
-- ----------------------------------------------------------------------------
create or replace function public.report_sales_summary(p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Any active staff may view the summary on screen. Row visibility is enforced
  -- by RLS (security invoker); it can never include a row the caller cannot read.
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: active staff only.'
      using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'verified_collected', coalesce(sum(
      case when p.status = 'verified'
            and p.voided_at is null
            and p.reversed_at is null
            and p.correction_pending = false
      then coalesce(v.verified_amount, p.amount) else 0 end
    ), 0),
    'payments_recorded', count(*),
    'payments_verified', count(*) filter (where p.status = 'verified'),
    'payments_unverified', count(*) filter (where p.status = 'submitted_unverified')
  )
  into v_result
  from public.payments p
  left join public.payment_verifications v on v.payment_id = p.id
  where p.recorded_at >= p_from and p.recorded_at <= p_to;

  return v_result;
end;
$$;

comment on function public.report_sales_summary(timestamptz, timestamptz) is
  'Bible §25: on-screen sales summary, viewable by any ACTIVE STAFF (visibility is broad; only export/download is gated by export_data_reports). security invoker keeps it within the caller''s RLS scope. Verified money only.';

revoke all on function public.report_sales_summary(timestamptz, timestamptz) from anon;
grant execute on function public.report_sales_summary(timestamptz, timestamptz) to authenticated;
