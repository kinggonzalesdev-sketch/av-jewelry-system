-- Batch balance reader — performance only, NO formula change, NO data change.
--
-- The Orders list (listOrders) and the Layaway/payments workspace each read money
-- by calling public.order_balance() ONCE PER ROW. At ~100 rows that is ~100
-- separate PostgREST round-trips per page load — the cause of the multi-second
-- delay the Owner reported when opening those pages.
--
-- This function collapses those N round-trips into ONE. It does NOT reimplement
-- any formula: it simply calls the existing, tested public.order_balance() for
-- each id. That guarantees the approved money formula keeps a SINGLE
-- implementation and cannot drift (the whole point of balances.ts's warning).
--
--   * SECURITY INVOKER + the same empty search_path as order_balance(): every
--     figure stays RLS-scoped to the caller, exactly as before.
--   * Per-row BEGIN/EXCEPTION preserves the existing resilience — an order whose
--     balance cannot be computed yields a NULL balance (the caller renders it as
--     "unavailable"), never a broken page and never a fabricated ₱0.00.
--   * Read-only. Creates a function; touches no table and no row.

create or replace function public.order_balances(p_order_ids uuid[])
returns table (order_id uuid, balance jsonb)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  oid uuid;
begin
  foreach oid in array coalesce(p_order_ids, array[]::uuid[]) loop
    begin
      order_id := oid;
      balance := public.order_balance(oid);
    exception
      when others then
        -- A single un-computable order must not fail the whole page. The caller
        -- treats a null balance exactly like a failed single read: "unavailable".
        order_id := oid;
        balance := null;
    end;
    return next;
  end loop;
end;
$$;

revoke all on function public.order_balances(uuid[]) from anon;
grant execute on function public.order_balances(uuid[]) to authenticated;

comment on function public.order_balances(uuid[]) is
  'Batch wrapper over order_balance() — one round-trip for many orders. Same '
  'formula, same RLS (SECURITY INVOKER). Performance only; no data change.';
