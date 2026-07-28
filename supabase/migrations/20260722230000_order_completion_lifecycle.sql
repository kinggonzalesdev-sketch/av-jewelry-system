-- ============================================================================
-- Order completion lifecycle (UI/UX spec §6/§7). When a fulfillment is COMPLETED
-- (final handoff — delivered / picked up), the order becomes Completed and its
-- claimed inventory items move to Completed Items. One inventory source of truth,
-- split by status; nothing is deleted or copied.
--
-- SAFETY FIRST (the double-selling invariant): available_quantity() derived
-- Available = total − active reservations and IGNORED availability_status, so a
-- "completed" item could be oversold if its reservation ever cleared. Fixed here:
-- a completed/released item is NEVER available, whatever its reservations say.
-- ============================================================================

create or replace function app_private.available_quantity(p_item_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    -- Sold / released items are historical — never available (spec §4/§7).
    when i.availability_status in ('completed', 'released') then 0
    else i.quantity_total - coalesce((
      select sum(r.quantity)
      from public.inventory_reservations r
      where r.inventory_item_id = p_item_id
        and r.state in ('provisional', 'committed')
    ), 0)
  end
  from public.inventory_items i
  where i.id = p_item_id;
$$;

comment on function app_private.available_quantity(uuid) is
  'Available = total - (provisional + committed), and ALWAYS 0 for completed/released items (never oversell). Derived, never stored.';

-- ----------------------------------------------------------------------------
-- Atomic completion: fulfillment → completed, order → completed, claimed items →
-- completed, in ONE transaction. SECURITY DEFINER (it spans official_orders and
-- inventory_items, whose RLS does not allow a direct status write), so it does
-- its OWN permission check — a direct RPC call cannot bypass it.
-- ----------------------------------------------------------------------------
create or replace function public.complete_order_fulfillment(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fstatus text;
begin
  if not app_private.has_permission('fulfillment_release') then
    raise exception 'Not authorized: the fulfillment_release permission is required. No record was changed.';
  end if;

  select status into v_fstatus
  from public.fulfillment_records
  where official_order_id = p_order_id;

  if v_fstatus is null then
    raise exception 'No fulfillment record for this order.';
  end if;
  -- Completing is the FINAL handoff — only after dispatch/pickup, never merely
  -- shipped (spec §7). Shipped stays In Transit until delivery is confirmed.
  if v_fstatus not in ('dispatched', 'picked_up') then
    raise exception 'Fulfillment is not in a completable state (must be dispatched or picked up first).';
  end if;

  update public.fulfillment_records
    set status = 'completed', completed_at = now()
    where official_order_id = p_order_id;

  update public.official_orders
    set status = 'completed'
    where id = p_order_id;

  -- Move the order's claimed items to Completed Items — status change only, the
  -- record and all its links are preserved.
  update public.inventory_items
    set availability_status = 'completed'
    where id in (
      select c.inventory_item_id
      from public.official_order_claims oc
      join public.claims c on c.id = oc.claim_id
      where oc.official_order_id = p_order_id
        and c.inventory_item_id is not null
    );
end;
$$;

grant execute on function public.complete_order_fulfillment(uuid) to authenticated;
