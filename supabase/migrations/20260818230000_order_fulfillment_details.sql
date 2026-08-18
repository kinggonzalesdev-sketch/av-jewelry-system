-- Fulfillment Phase A (Owner request 2026-08-18): a small OPERATIONAL enhancement to the
-- existing Order Details workflow. official_orders stays the SINGLE source of truth
-- (fulfillment_destination = method, status = lifecycle, waybill_number = tracking, completed_at
-- = handoff). The dormant fulfillment_records lifecycle is NOT activated; no second status
-- machine, no COD/remittance/money-in-transit.
--
-- Only the genuinely missing operational fields are added (verified absent from official_orders):
--   courier         — shipping/delivery courier or rider name (optional)
--   dispatched_at   — shipping only: goods left the shop, BEFORE final completion
--   pickup_contact  — store pickup: who will collect (optional)
-- Store pickup + delivery handoff use the existing completed_at (via transfer_order_to_completed);
-- there is no independent Delivered/Picked-Up state in the live workflow (0 orders ever reach
-- 'dispatched_or_picked_up'), so no delivered_at/picked_up_at is added.

alter table public.official_orders
  add column if not exists courier text,
  add column if not exists dispatched_at timestamptz,
  add column if not exists pickup_contact text;

-- Set operational details (courier / pickup contact). A NULL argument leaves that field
-- unchanged; a provided value sets it (empty string clears it). Guarded by fulfillment_preparation;
-- never on a closed order. Touches no money and no inventory.
create or replace function public.set_fulfillment_details(
  p_order_id uuid,
  p_courier text default null,
  p_pickup_contact text default null
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text;
begin
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.official_orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order not found.' using errcode = 'check_violation';
  end if;
  if v_status in ('completed', 'cancelled', 'for_cancel') then
    raise exception 'Fulfillment details cannot be changed on a % order.', v_status
      using errcode = 'check_violation';
  end if;

  update public.official_orders set
    courier = case when p_courier is not null then nullif(btrim(p_courier), '') else courier end,
    pickup_contact = case when p_pickup_contact is not null then nullif(btrim(p_pickup_contact), '') else pickup_contact end
  where id = p_order_id;
end;
$function$;

-- Shipping only: stamp dispatched_at (goods left the shop). This does NOT complete the order —
-- final completion still goes through transfer_order_to_completed with its payment + waybill
-- gates. Idempotent (coalesce keeps the first dispatch). Guarded by fulfillment_preparation.
create or replace function public.mark_order_dispatched(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text; v_dest text;
begin
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  select status, fulfillment_destination into v_status, v_dest
  from public.official_orders where id = p_order_id for update;
  if v_status is null then
    raise exception 'Order not found.' using errcode = 'check_violation';
  end if;
  if coalesce(v_dest, '') <> 'shipping' then
    raise exception 'Only a shipping order can be marked Dispatched.' using errcode = 'check_violation';
  end if;
  if v_status in ('completed', 'cancelled', 'for_cancel') then
    raise exception 'A % order cannot be dispatched.', v_status using errcode = 'check_violation';
  end if;

  update public.official_orders set dispatched_at = coalesce(dispatched_at, now()) where id = p_order_id;
end;
$function$;
