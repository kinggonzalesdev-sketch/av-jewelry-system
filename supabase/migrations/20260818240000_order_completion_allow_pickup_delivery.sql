-- Fulfillment Phase A (Owner request 2026-08-18): let Store Pickup and Delivery orders complete
-- through the canonical completion path.
--
-- Latent bug this fixes: order_completion_block required either a dormant fulfillment_records row
-- (System A, which is never created) or an OK-set status (keep / approved_for_release / …). A
-- pickup or delivery order routes to status 'for_preparation' with no fulfillment record, so it
-- returned 'Fulfillment has not started for this order.' forever — 0 pickup/delivery orders have
-- ever completed. Phase A makes official_orders the single source of truth, so a routed + fully
-- paid pickup/delivery order IS ready to complete (the handoff is the completion, stamped on
-- completed_at). This ADDS one allow-clause; it does NOT weaken any existing gate:
--   • paid-in-full is still required (checked above the clause),
--   • shipping still requires its waybill and still routes through Ship Confirm,
--   • keep / approved_for_release / layaway behaviour is unchanged.
-- The function is read-only (returns a block reason); it moves no money and no inventory.
create or replace function public.order_completion_block(p_order_id uuid)
 returns text
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare v_status text; v_dest text; v_fstatus text; v_waybill text;
begin
  select status, fulfillment_destination, waybill_number
    into v_status, v_dest, v_waybill
  from public.official_orders where id = p_order_id;
  if v_status is null then return 'Order not found.'; end if;
  if v_status = 'completed' then return 'This order is already completed.'; end if;
  if v_status = 'cancelled' then return 'A cancelled order cannot be completed.'; end if;
  if v_status = 'for_cancel' then return 'This order is awaiting a cancellation decision.'; end if;

  if not app_private.is_paid_in_full(p_order_id) then
    return 'This order is not fully paid yet.';
  end if;

  -- A shipping order must carry a waybill before completing.
  if v_dest = 'shipping' and coalesce(trim(v_waybill), '') = '' then
    return 'A waybill number is required before this shipping order can be completed.';
  end if;

  select status into v_fstatus from public.fulfillment_records where official_order_id = p_order_id;

  -- Layaway must still be routed to a fulfillment destination first.
  if v_status = 'for_layaway' then
    return 'Transfer this order to a fulfillment destination first.';
  end if;
  -- Keep and the Ship-Confirmed / handed-over states may complete on their order
  -- status alone even without a separate fulfillment row, once fully paid.
  if v_status in ('keep', 'approved_for_release', 'exceptional_release_pending', 'dispatched_or_picked_up') then
    return null;
  end if;
  -- Store Pickup and Delivery complete on their destination + fully-paid status alone (Phase A —
  -- official_orders is canonical; there is no fulfillment_records lifecycle to wait on).
  if v_dest in ('pickup', 'delivery') then
    return null;
  end if;
  if v_fstatus is null then
    return 'Fulfillment has not started for this order.';
  end if;
  if v_fstatus not in ('dispatched', 'delivered', 'picked_up', 'released', 'completed') then
    return 'Fulfillment is not finished yet.';
  end if;

  return null;
end;
$function$;
