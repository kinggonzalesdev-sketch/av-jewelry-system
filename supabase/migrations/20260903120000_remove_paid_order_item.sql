-- Paid-order item removal (Owner 2026-09-03).
-- A Super Admin may remove an item from a Fully-Paid / settled (LOCKED) order — the corresponding
-- inventory piece returns to Active stock, the order total recalculates (derived from its claims),
-- payment history is preserved (payments reference the ORDER, never a claim), and any resulting
-- overpayment surfaces as a CREDIT via order_balance (never an auto-refund). A reason is mandatory and
-- the caller records a PAID_ORDER_ITEM_REMOVED_AND_RESTOCKED audit with the financial snapshot returned.
--
-- ADDITIVE: a NEW function. The existing remove_order_item (editable orders, no reason) is UNCHANGED —
-- this one is used only for locked/settled orders and REQUIRES a reason. Idempotent: a second call finds
-- the claim already detached (raises) and an already-available item is skipped (no double restock).
create or replace function public.remove_paid_order_item(
  p_order_id uuid,
  p_claim_id uuid,
  p_reason   text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status     text;
  v_item       uuid;
  v_code       text;
  v_links      int;
  v_staff      uuid;
  v_prev_total numeric;
  v_new_total  numeric;
  v_bal        jsonb;
begin
  -- Super Admin only.
  if app_private.current_staff_role() <> 'owner' then
    raise exception 'Not authorized: removing an item from a paid order is reserved to the Super Admin. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  -- A reason is mandatory for a paid-order removal.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to remove an item from a paid order.'
      using errcode = 'check_violation';
  end if;

  select o.status into v_status from public.official_orders o where o.id = p_order_id;
  if v_status is null then
    raise exception 'Order not found.';
  end if;

  -- The claim must belong to this order.
  if not exists (
    select 1 from public.official_order_claims ooc
    where ooc.official_order_id = p_order_id and ooc.claim_id = p_claim_id
  ) then
    raise exception 'That item is not part of this order.' using errcode = 'check_violation';
  end if;

  -- Keep at least one item — voiding the whole order is a separate Cancel Order action.
  select count(*) into v_links from public.official_order_claims where official_order_id = p_order_id;
  if v_links <= 1 then
    raise exception 'An order must keep at least one item. Use Cancel Order instead.'
      using errcode = 'check_violation';
  end if;

  v_prev_total := app_private.total_amount_payable(p_order_id);
  select c.inventory_item_id into v_item from public.claims c where c.id = p_claim_id;
  select i.item_code into v_code from public.inventory_items i where i.id = v_item;
  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());

  -- Detach + WITHDRAW the confirmed claim (kept for history; the order's payments are untouched).
  delete from public.official_order_claims
    where official_order_id = p_order_id and claim_id = p_claim_id;
  update public.claims
    set status = 'withdrawn_confirmed',
        status_reason = 'Removed from PAID order ' || p_order_id::text || ': ' || btrim(p_reason)
    where id = p_claim_id;

  -- Restore the EXACT same inventory item to Active stock — committed/reserved OR a completed/sold
  -- piece on a settled order. The status-integrity trigger passes because the item ends as
  -- 'returned_to_available' (not orphan-completed/committed).
  if v_item is not null
     and (select availability_status from public.inventory_items where id = v_item)
         in ('committed', 'provisionally_reserved', 'completed')
  then
    insert into public.returned_to_stock_reviews
      (inventory_item_id, trigger_kind, status, quantity, reviewed_at, reviewed_by,
       review_note, freed_unit_outcome, freed_unit_note)
    values
      (v_item, 'withdrawal_confirmed', 'approved_return', 1, now(), v_staff,
       'Item removed from a PAID/settled order by the Super Admin. Reason: ' || btrim(p_reason),
       'returned_to_available', 'Returned to Active Inventory by the paid-order item removal.');
    update public.inventory_items
      set availability_status = 'returned_to_available'
      where id = v_item;
  end if;

  v_new_total := app_private.total_amount_payable(p_order_id);
  v_bal := public.order_balance(p_order_id);

  return jsonb_build_object(
    'inventory_item_id',     v_item,
    'inventory_code',        v_code,
    'previous_total',        v_prev_total,
    'new_total',             v_new_total,
    'verified_net_payments', v_bal->'verified_net_payments',
    'overpayment_credit',    v_bal->'overpayment_credit',
    'outstanding_balance',   v_bal->'outstanding_balance',
    'order_status',          v_status
  );
end;
$function$;

revoke all on function public.remove_paid_order_item(uuid, uuid, text) from public, anon;
grant execute on function public.remove_paid_order_item(uuid, uuid, text) to authenticated;
