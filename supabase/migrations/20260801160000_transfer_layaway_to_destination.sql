-- Transfer an ACTIVE layaway account straight into an Orders Flow destination
-- (Pickup / For Delivery / For Shipping / Keep). ONE transaction: it reuses the
-- linked order (never duplicates), routes it via the SAME transfer_order_destination
-- used by the Orders workflow (so behaviour is identical), and marks the ledger
-- 'transferred' so it leaves ACTIVE layaway while its history is preserved. Guarded
-- by the fulfillment_preparation permission here AND inside transfer_order_destination.
create or replace function public.transfer_layaway_to_destination(
  p_ledger_id uuid,
  p_destination text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order uuid;
  v_status text;
begin
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_destination not in ('pickup', 'delivery', 'shipping', 'keep') then
    raise exception 'Select a valid destination.' using errcode = 'check_violation';
  end if;

  select status into v_status from public.layaway_ledger where id = p_ledger_id for update;
  if v_status is null then
    raise exception 'Layaway account not found.' using errcode = 'check_violation';
  end if;
  if v_status <> 'active' then
    raise exception 'Only an ACTIVE layaway account can be transferred (this one is %).', v_status
      using errcode = 'check_violation';
  end if;

  select id into v_order
  from public.official_orders
  where converted_layaway_ledger_id = p_ledger_id
  order by created_at desc
  limit 1
  for update;

  if v_order is null then
    raise exception 'This layaway has no linked order to transfer. Transfer is available for layaways set up from an order.'
      using errcode = 'check_violation';
  end if;

  update public.official_orders set converted_to_layaway = false where id = v_order;
  perform public.transfer_order_destination(v_order, p_destination);
  update public.layaway_ledger set status = 'transferred' where id = p_ledger_id;

  return jsonb_build_object('order_id', v_order, 'destination', p_destination, 'source', 'layaway');
end;
$function$;

revoke all on function public.transfer_layaway_to_destination(uuid, text) from public, anon;
grant execute on function public.transfer_layaway_to_destination(uuid, text) to authenticated;
