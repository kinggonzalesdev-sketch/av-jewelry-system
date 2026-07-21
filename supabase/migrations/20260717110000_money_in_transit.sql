-- ============================================================================
-- Money-in-Transit — immediate visibility of money not yet in the bank
-- (business problem #14; solution G "Money-in-Transit Dashboard").
-- ----------------------------------------------------------------------------
-- The team cannot instantly see how much money is "out there". This read-only,
-- RLS-scoped aggregation answers it from REAL records. ALL SUMS ARE DONE IN SQL
-- (numeric) — never a JS float on the client. security invoker, so RLS scopes
-- exactly what the caller may already read; the balance arithmetic reuses the
-- approved app_private helpers (the screens must never re-implement it).
--
-- Buckets (honest, and each is money genuinely not-yet-collected/verified):
--   awaiting_verification  — submitted payment evidence not yet verified.
--   customer_pending       — outstanding balance on orders awaiting payment.
--   in_transit_to_collect  — outstanding on COD orders dispatched but not
--                            completed (money a rider/courier is carrying to
--                            collect). A finer rider-vs-LBC split, and the
--                            collected-but-not-remitted distinction, need a
--                            courier enum + remittance status — a later slice.
-- ============================================================================

create or replace function public.report_money_in_transit()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  -- Each sum is cast to TEXT so it crosses to the client as a string, never a
  -- JS float (Bible: money is numeric in SQL, a string in TS).
  select jsonb_build_object(
    'awaiting_verification', coalesce((
      select sum(p.amount)
      from public.payments p
      where p.status = 'submitted_unverified'
        and p.voided_at is null
        and p.reversed_at is null
    ), 0)::text,
    'customer_pending', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      where o.status = 'awaiting_required_payment'
    ), 0)::text,
    'in_transit_to_collect', coalesce((
      select sum(app_private.outstanding_balance(o.id))
      from public.official_orders o
      join public.fulfillment_records f on f.official_order_id = o.id
      where f.is_cod = true
        and f.dispatched_at is not null
        and f.completed_at is null
        and o.status not in ('completed', 'cancelled')
    ), 0)::text
  );
$$;

comment on function public.report_money_in_transit() is
  'Money-in-Transit aggregation (Bible §14 solution G). All sums numeric in SQL. security invoker: RLS scopes what the caller may read.';

-- Revoke the default PUBLIC execute (Postgres grants it automatically), so anon
-- holds nothing; then grant to authenticated explicitly.
revoke all on function public.report_money_in_transit() from public;
grant execute on function public.report_money_in_transit() to authenticated;
