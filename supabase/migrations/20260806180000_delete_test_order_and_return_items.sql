-- Super Admin (Owner) safe deletion of a TEST order, returning its item(s) to
-- Active Inventory. Unlike the production return-to-inventory flow, this DELIBERATELY
-- allows a recorded TEST payment (it removes the test payment + verification). It is
-- gated hard on is_test = true, so a real production order can NEVER be deleted here.
-- Test rows are excluded from every dashboard/report (is_test = false filters), so
-- removing them cannot change any financial figure. Owner-only (SECURITY DEFINER
-- re-checks is_owner()). Items return to available via an owner-approved RTS review
-- (Bible §19) so the enforce_return_to_available guard is satisfied.
create or replace function public.delete_test_order_and_return_items(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_is_test   boolean;
  v_claim_ids uuid[];
  v_item_ids  uuid[];
  v_pay_ids   uuid[];
  v_item      uuid;
  v_remaining int;
  v_returned  int := 0;
  v_qty       int;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: deleting a test order is reserved to the Super Admin (Owner). No record was changed.';
  end if;

  select is_test into v_is_test from public.official_orders where id = p_order_id;
  if v_is_test is null then
    raise exception 'Order not found.';
  end if;
  -- HARD SAFETY: only a test-marked order. Never a production order.
  if v_is_test is not true then
    raise exception 'This is not a test order. Only a test-marked order can be deleted here — nothing was changed.';
  end if;

  -- Capture the order's claims, their items, and its payments BEFORE unlinking.
  select array_agg(distinct ooc.claim_id) into v_claim_ids
    from public.official_order_claims ooc where ooc.official_order_id = p_order_id;
  select array_agg(distinct c.inventory_item_id) into v_item_ids
    from public.claims c
    where c.id = any(coalesce(v_claim_ids, '{}'::uuid[])) and c.inventory_item_id is not null;
  select array_agg(id) into v_pay_ids
    from public.payments where official_order_id = p_order_id or reassigned_from_order_id = p_order_id;

  -- === Test payments + their children (safe: is_test rows never hit reports) ===
  delete from public.layaway_installments
    where payment_id = any(coalesce(v_pay_ids, '{}'::uuid[]))
       or layaway_arrangement_id in (select id from public.layaway_arrangements where official_order_id = p_order_id);
  if v_pay_ids is not null then
    delete from public.payment_verifications where payment_id = any(v_pay_ids);
    delete from public.payment_evidence      where payment_id = any(v_pay_ids);
    update public.layaway_arrangements set deposit_verified_payment_id = null
      where deposit_verified_payment_id = any(v_pay_ids);
  end if;

  -- === Order-level records ===
  delete from public.message_send_attempts where customer_message_id in (
    select id from public.customer_messages where official_order_id = p_order_id);
  delete from public.customer_messages     where official_order_id = p_order_id;
  delete from public.fulfillment_records   where official_order_id = p_order_id;
  delete from public.official_order_charges where official_order_id = p_order_id;
  delete from public.layaway_arrangements  where official_order_id = p_order_id;
  delete from public.price_overrides       where official_order_id = p_order_id;
  update public.capture_review_queue set official_order_id = null where official_order_id = p_order_id;
  update public.capture_records      set official_order_id = null where official_order_id = p_order_id;
  delete from public.payments where official_order_id = p_order_id or reassigned_from_order_id = p_order_id;

  -- === Claim dependents (RESTRICT) ===
  if v_claim_ids is not null then
    delete from public.claim_evidence       where claim_id = any(v_claim_ids);
    delete from public.invoice_draft_claims where claim_id = any(v_claim_ids);
    delete from public.print_attempts where label_job_id in (
      select id from public.label_jobs where claim_id = any(v_claim_ids));
    delete from public.label_jobs           where claim_id = any(v_claim_ids);
    delete from public.price_overrides       where claim_id = any(v_claim_ids);
    delete from public.waitlist_entries      where claim_id = any(v_claim_ids);
    delete from public.miner_positions
      where claim_id = any(v_claim_ids) or switched_from_claim_id = any(v_claim_ids);
  end if;

  -- Reservations for the order's items/claims — detach review refs first (RESTRICT).
  update public.returned_to_stock_reviews set inventory_reservation_id = null
    where inventory_reservation_id in (
      select id from public.inventory_reservations
      where inventory_item_id = any(coalesce(v_item_ids, '{}'::uuid[]))
         or claim_id = any(coalesce(v_claim_ids, '{}'::uuid[])));
  delete from public.inventory_reservations
    where inventory_item_id = any(coalesce(v_item_ids, '{}'::uuid[]))
       or claim_id = any(coalesce(v_claim_ids, '{}'::uuid[]));

  -- === The order + its claim links + the claims ===
  delete from public.official_order_claims where official_order_id = p_order_id;
  delete from public.official_orders where id = p_order_id;
  if v_claim_ids is not null then
    delete from public.claims where id = any(v_claim_ids);
  end if;

  -- === Return each freed item to Active Inventory (owner-approved RTS review) ===
  if v_item_ids is not null then
    foreach v_item in array v_item_ids loop
      select count(*) into v_remaining from public.claims c where c.inventory_item_id = v_item;
      if v_remaining = 0
         and exists (select 1 from public.inventory_items i where i.id = v_item
                     and i.availability_status in ('provisionally_reserved','committed','sold_released','completed','released')) then
        select greatest(coalesce(quantity_total, 1), 1) into v_qty from public.inventory_items where id = v_item;
        update public.capture_records set inventory_item_id = null where inventory_item_id = v_item;
        delete from public.capture_review_queue where inventory_item_id = v_item;
        insert into public.returned_to_stock_reviews (
          inventory_item_id, inventory_reservation_id, trigger_kind, status, quantity,
          reviewed_at, reviewed_by, review_note, freed_unit_outcome
        ) values (
          v_item, null, 'order_cancelled', 'approved_return', v_qty,
          now(), app_private.current_staff_id(),
          'Test order deleted by Super Admin — item returned to Active Inventory.',
          'returned_to_available'
        );
        update public.inventory_items
           set availability_status = 'available',
               facebook_name = null,
               custody_holder = 'av_jewelry',
               custody_handler_id = null,
               custody_updated_at = now(),
               custody_updated_by = null
         where id = v_item;
        v_returned := v_returned + 1;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'returned_items', v_returned,
    'payments_removed', coalesce(array_length(v_pay_ids, 1), 0));
end;
$function$;

revoke all on function public.delete_test_order_and_return_items(uuid) from public, anon, authenticated;
grant execute on function public.delete_test_order_and_return_items(uuid) to authenticated;
