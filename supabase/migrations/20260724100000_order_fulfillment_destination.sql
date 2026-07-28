-- ============================================================================
-- "For Prepare" fulfillment destination transfer (Orders Workflow — For Prepare).
--
-- A For-Prepare order is routed to ONE destination (shipping / delivery / layaway
-- / pickup / keep). This is an ADDITIVE field on the order — the status enum and
-- the fulfillment_records lifecycle are untouched, so the smallest safe change:
-- the order keeps all its data and its 'for_preparation' status; the destination
-- routes it to the correct Orders status card.
--
--   shipping → Ship Confirm · delivery → Delivery · layaway → For Layaway
--   pickup   → Pickup       · keep     → Keep
--
-- The transfer is guarded, one-way-once (no duplicate transfers), and records who
-- transferred it and when. The audit_events trail (written by the TS layer) is
-- the transfer history.
-- ============================================================================

alter table public.official_orders
  add column fulfillment_destination text check (
    fulfillment_destination is null or fulfillment_destination in (
      'shipping', 'delivery', 'layaway', 'pickup', 'keep'
    )
  ),
  add column fulfillment_destination_set_at timestamptz,
  add column fulfillment_destination_set_by uuid
    references public.staff_profiles (id) on delete restrict;

comment on column public.official_orders.fulfillment_destination is
  'For-Prepare routing (Orders Workflow): shipping/delivery/layaway/pickup/keep. Additive — does not change status. Set once via transfer_order_destination().';

create index official_orders_destination_idx
  on public.official_orders (fulfillment_destination);

-- ----------------------------------------------------------------------------
-- Guarded transfer. SECURITY DEFINER (it writes official_orders, whose RLS does
-- not offer a direct destination write), with its OWN permission check. Only a
-- For-Prepare order may be transferred, and only ONCE — a second attempt is
-- refused, which is what prevents duplicate transfers at the database.
-- ----------------------------------------------------------------------------
create or replace function public.transfer_order_destination(
  p_order_id uuid,
  p_destination text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_existing text;
begin
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.';
  end if;

  if p_destination not in ('shipping', 'delivery', 'layaway', 'pickup', 'keep') then
    raise exception 'Invalid fulfillment destination.';
  end if;

  select status, fulfillment_destination
    into v_status, v_existing
  from public.official_orders
  where id = p_order_id;

  if v_status is null then
    raise exception 'Order not found.';
  end if;
  -- Follow the status rule: only a For-Prepare order is transferable.
  if v_status <> 'for_preparation' then
    raise exception 'Only an order in For Prepare can be transferred to a fulfillment destination.';
  end if;
  -- Prevent duplicate transfers.
  if v_existing is not null then
    raise exception 'This order was already transferred to %.', v_existing;
  end if;

  update public.official_orders
    set fulfillment_destination = p_destination,
        fulfillment_destination_set_at = now(),
        fulfillment_destination_set_by = app_private.current_staff_id()
    where id = p_order_id;
end;
$$;

comment on function public.transfer_order_destination(uuid, text) is
  'Orders Workflow For-Prepare: route a For-Prepare order to a destination ONCE (no duplicate transfers), attributed to the acting staff. Additive — does not change status.';

revoke all on function public.transfer_order_destination(uuid, text) from anon;
grant execute on function public.transfer_order_destination(uuid, text) to authenticated;
