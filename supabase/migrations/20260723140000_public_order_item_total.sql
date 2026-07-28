-- ============================================================================
-- Public wrapper for order_item_total (Payments Excel-first spec §4).
--
-- The Layaway Accounts spreadsheet shows ITEM · INTEREST · GRAND TOTAL as three
-- columns, where Grand Total = Item principal + Interest (layaway fee). The
-- Grand Total and Interest are already readable, but the ITEM principal lives in
-- app_private.order_item_total, which PostgREST cannot call. Expose a thin public
-- wrapper so the reader gets the principal AUTHORITATIVELY from SQL — never by
-- subtracting money strings in JS (which would round a centavo off a balance).
--
-- SECURITY INVOKER: it reads official_order_claims / claims / inventory_items
-- under the caller's RLS, exactly like the app_private function it wraps.
-- ============================================================================
create or replace function public.order_item_total(p_order_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select app_private.order_item_total(p_order_id);
$$;

comment on function public.order_item_total(uuid) is
  'Payments Excel-first spec §4: the order''s item principal (sum of committed claim prices), authoritative from SQL. Grand Total = this + layaway fee (interest).';

revoke all on function public.order_item_total(uuid) from anon;
grant execute on function public.order_item_total(uuid) to authenticated;
