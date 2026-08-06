-- Super Admin (Owner) correction for a Completed item: remove the mistaken
-- ORDER/CUSTOMER info but RETURN THE ITEM to Active Inventory as available stock
-- ("madedelete lang yung info ko pero yung item babalik sa inventory"). The item
-- record is NOT deleted. Money is protected: refused when a linked order has a
-- recorded payment, or the item is tied to a layaway (incl. a forfeited one).
--
-- The return to available goes through an OWNER-APPROVED Returned-to-Stock Review
-- (Bible §19) so the enforce_return_to_available guard is satisfied by design and a
-- proper audit row is left. Owner-only (SECURITY DEFINER re-checks is_owner()).
-- Supersedes force_delete_completed_item (permanent delete), which is dropped below.
create or replace function public.return_completed_item_to_inventory(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status         text;
  v_qty            int;
  v_order_ids      uuid[];
  v_empty_orders   uuid[];
  v_payment_count  int;
  v_layaway_count  int;
  v_forfeited      int;
  v_deleted_orders int := 0;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: returning a Completed item is reserved to the Super Admin (Owner). No record was changed.';
  end if;

  select availability_status, greatest(coalesce(quantity_total, 1), 1)
    into v_status, v_qty
  from public.inventory_items where id = p_item_id;
  if v_status is null then
    raise exception 'Inventory item not found.';
  end if;
  if v_status not in ('provisionally_reserved','committed','sold_released','completed','released') then
    raise exception 'This only applies to Completed Items. This item is % — it is already active.', replace(v_status, '_', ' ');
  end if;

  -- MONEY GUARD 1: never disturb a layaway account's item.
  select count(*) into v_layaway_count
  from public.layaway_ledger where inventory_item_id = p_item_id;
  if v_layaway_count > 0 then
    raise exception 'This item belongs to a layaway account. Resolve the layaway first — nothing was changed.';
  end if;

  -- §19 GUARD: a forfeited item never auto-returns; its disposition is separate.
  select count(*) into v_forfeited
  from public.layaway_arrangements l
  join public.official_orders o on o.id = l.official_order_id
  join public.official_order_claims ooc on ooc.official_order_id = o.id
  join public.claims c on c.id = ooc.claim_id
  where c.inventory_item_id = p_item_id and l.status = 'forfeited';
  if v_forfeited > 0 then
    raise exception 'This item was forfeited (layaway). Its disposition is a separate decision — nothing was changed.';
  end if;

  -- Orders this item belongs to (via its claims).
  select array_agg(distinct o.id) into v_order_ids
  from public.claims c
  join public.official_order_claims ooc on ooc.claim_id = c.id
  join public.official_orders o on o.id = ooc.official_order_id
  where c.inventory_item_id = p_item_id;

  -- MONEY GUARD 2: never delete an order that has recorded payment(s).
  if v_order_ids is not null then
    select count(*) into v_payment_count
    from public.payments
    where official_order_id = any(v_order_ids)
       or reassigned_from_order_id = any(v_order_ids);
    if v_payment_count > 0 then
      raise exception 'A linked order has recorded payment(s). Void or refund it in Payments first — nothing was changed.';
    end if;
  end if;

  -- === Remove the mistaken order/customer INFO: claims + dependents ===
  delete from public.claim_evidence
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.invoice_draft_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.label_jobs
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.price_overrides
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.waitlist_entries
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.miner_positions
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id)
       or switched_from_claim_id in (select id from public.claims where inventory_item_id = p_item_id);
  delete from public.official_order_claims
    where claim_id in (select id from public.claims where inventory_item_id = p_item_id);

  -- Reservations for this item — detach any review refs (preserve review history),
  -- then drop the reservations so the item is no longer reserved/committed.
  update public.returned_to_stock_reviews set inventory_reservation_id = null
    where inventory_reservation_id in (
      select id from public.inventory_reservations where inventory_item_id = p_item_id);
  delete from public.inventory_reservations where inventory_item_id = p_item_id;

  delete from public.claims where inventory_item_id = p_item_id;

  -- === Delete any linked order that is now EMPTY (single-item mistake) ===
  select array_agg(o.id) into v_empty_orders
  from unnest(coalesce(v_order_ids, '{}'::uuid[])) as t(id)
  join public.official_orders o on o.id = t.id
  where not exists (
    select 1 from public.official_order_claims ooc where ooc.official_order_id = o.id);

  if v_empty_orders is not null then
    delete from public.customer_messages   where official_order_id = any(v_empty_orders);
    delete from public.fulfillment_records where official_order_id = any(v_empty_orders);
    delete from public.layaway_arrangements where official_order_id = any(v_empty_orders);
    delete from public.official_order_charges where official_order_id = any(v_empty_orders);
    delete from public.price_overrides      where official_order_id = any(v_empty_orders);
    update public.capture_review_queue set official_order_id = null where official_order_id = any(v_empty_orders);
    update public.capture_records      set official_order_id = null where official_order_id = any(v_empty_orders);
    delete from public.official_orders where id = any(v_empty_orders);
    v_deleted_orders := array_length(v_empty_orders, 1);
  end if;

  -- Detach the capture from the item; the item + its product photos stay.
  update public.capture_records set inventory_item_id = null where inventory_item_id = p_item_id;
  delete from public.capture_review_queue where inventory_item_id = p_item_id;

  -- === RETURN THE ITEM to Active Inventory via an owner-approved RTS review ===
  insert into public.returned_to_stock_reviews (
    inventory_item_id, inventory_reservation_id, trigger_kind, status, quantity,
    reviewed_at, reviewed_by, review_note, freed_unit_outcome
  ) values (
    p_item_id, null, 'order_cancelled', 'approved_return', v_qty,
    now(), app_private.current_staff_id(),
    'Super Admin returned this item to Active Inventory (order info removed).',
    'returned_to_available'
  );

  update public.inventory_items
     set availability_status = 'available',
         facebook_name = null,
         custody_holder = 'av_jewelry',
         custody_handler_id = null,
         custody_updated_at = now(),
         custody_updated_by = null
   where id = p_item_id;

  return jsonb_build_object('deleted_orders', coalesce(v_deleted_orders, 0), 'returned', true);
end;
$function$;

revoke all on function public.return_completed_item_to_inventory(uuid) from public, anon, authenticated;
grant execute on function public.return_completed_item_to_inventory(uuid) to authenticated;

-- The permanent-delete variant is superseded by return-to-inventory (Owner request).
drop function if exists public.force_delete_completed_item(uuid);
