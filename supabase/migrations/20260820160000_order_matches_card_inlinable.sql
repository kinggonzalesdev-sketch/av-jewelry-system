-- #6 scale fix (Owner 2026-08-20): orders_page renders 11 live card-counts, each calling
-- order_matches_card() per order per page load. The function is LANGUAGE sql IMMUTABLE and SHOULD
-- inline (making the 11xN calls near-free), but the `SET search_path TO ''` clause made it
-- NON-INLINABLE (Postgres never inlines a SQL function that has a SET clause), so every call paid
-- full function-call overhead (~33us) -> ~355ms at 972 orders, projecting to ~18-20s at 50k.
--
-- The body is PURE boolean logic on its arguments: it references NO tables, types, or schema
-- objects (only literals, CASE, coalesce, and pg_catalog operators), so the search_path pin was
-- unnecessary. Removing it (body byte-identical) lets the planner inline the CASE into the caller,
-- collapsing the 11xN calls.
--
-- VERIFIED on prod (972 orders): all 11 card counts byte-identical before/after
-- (all:972, for_invoice:10, ship_confirm:490, delivery:139, pickup:54, for_layaway:21, keep:2,
-- cancelled:33, unverified_pay:679, walk_in:135, completed:153); cardCounts block 355ms -> 4.0ms
-- (~89x), function now inlined (no per-row function scan in the plan). Pure DB change, no app code.
--
-- Rollback: re-add `set search_path to ''` to the function definition below.
create or replace function public.order_matches_card(
  p_status text, p_dest text, p_source text, p_converted boolean, p_awaiting boolean, p_card text
) returns boolean
  language sql
  immutable
as $function$
  select case p_card
    when 'all' then true
    when 'walk_in' then p_source = 'walk_in'
    when 'for_invoice' then p_status in ('invoiced','awaiting_required_payment') and p_dest is null
    when 'for_reminder' then p_status = 'awaiting_required_payment' and p_dest is null
    when 'for_prepare' then p_status = 'for_preparation' and p_dest is null
    when 'for_confirm' then p_status = 'required_payment_verified'
    when 'for_shipping' then
      p_status not in ('approved_for_release','exceptional_release_pending','dispatched_or_picked_up')
      and p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'for_shipping_or_pickup' or p_dest = 'shipping')
    when 'ship_confirm' then
      p_status in ('approved_for_release','exceptional_release_pending','dispatched_or_picked_up')
      and coalesce(p_dest,'') not in ('delivery','pickup','layaway','keep')
    when 'delivery' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and p_dest = 'delivery'
    when 'pickup' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and p_dest = 'pickup'
    when 'for_layaway' then
      not coalesce(p_converted,false)
      and p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'for_layaway' or p_dest = 'layaway')
    when 'keep' then
      p_status not in ('cancelled','for_cancel','completed','closed','delivered','picked_up','released')
      and (p_status = 'keep' or p_dest = 'keep')
    when 'cancelled' then p_status = 'cancelled'
    when 'unverified_pay' then coalesce(p_awaiting, false)
    when 'completed' then p_status in ('completed','closed','delivered','picked_up','released')
    when 'for_cancel' then p_status <> 'cancelled' and (p_status = 'for_cancel' or p_dest = 'cancelled')
    else false
  end;
$function$;
