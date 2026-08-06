-- Super Admin (Owner) force-delete of a COMPLETED item, for correcting mistakes
-- ("if magkamali ako I can delete pa"). Removes the item and every link it holds,
-- and deletes a linked order ONLY when that order becomes empty (a single-item
-- mistake); multi-item orders keep their remaining items. MONEY IS PROTECTED: the
-- delete is refused when a linked order has any recorded payment, or when the item
-- is part of a layaway account — those must be voided/resolved first.
--
-- Owner-only at the database (SECURITY DEFINER re-checks app_private.is_owner()),
-- so a crafted request from a non-owner can never reach it. Irreversible; the app
-- layer writes a surviving audit row.
create or replace function public.force_delete_completed_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status        text;
  v_order_ids     uuid[];
  v_empty_orders  uuid[];
  v_payment_count int;
  v_layaway_count int;
  v_deleted_orders int := 0;
begin
  -- SUPER ADMIN only. Never an Admin or Staff (Owner request).
  if not app_private.is_owner() then
    raise exception 'Not authorized: deleting a Completed item is reserved to the Super Admin (Owner). No record was changed.';
  end if;

  select availability_status into v_status
  from public.inventory_items where id = p_item_id;
  if v_status is null then
    raise exception 'Inventory item not found.';
  end if;

  -- This powerful delete is ONLY for Completed Items (consumed stock). Active,
  -- sellable stock uses the ordinary dependency-protected delete.
  if v_status not in ('provisionally_reserved','committed','sold_released','completed','released') then
    raise exception 'This tool only deletes Completed Items. This item is % — use the normal delete.', replace(v_status, '_', ' ');
  end if;

  -- MONEY GUARD 1: never silently drop a layaway account's item.
  select count(*) into v_layaway_count
  from public.layaway_ledger where inventory_item_id = p_item_id;
  if v_layaway_count > 0 then
    raise exception 'This item belongs to a layaway account. Resolve the layaway first — nothing was deleted.';
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
      raise exception 'A linked order has recorded payment(s). Void or refund it in Payments first — nothing was deleted.';
    end if;
  end if;

  -- === Unwind the item's CLAIMS and their dependent rows (RESTRICT FKs) ===
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

  -- Reservations for this item — remove their RTS reviews first (RESTRICT).
  delete from public.returned_to_stock_reviews
    where inventory_item_id = p_item_id
       or inventory_reservation_id in (
            select id from public.inventory_reservations where inventory_item_id = p_item_id);
  delete from public.inventory_reservations where inventory_item_id = p_item_id;

  -- Now the claims themselves.
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
    -- NO ACTION / SET NULL back-references: detach so the order can be removed.
    update public.capture_review_queue set official_order_id = null where official_order_id = any(v_empty_orders);
    update public.capture_records      set official_order_id = null where official_order_id = any(v_empty_orders);
    -- order_reminders cascades automatically.
    delete from public.official_orders where id = any(v_empty_orders);
    v_deleted_orders := array_length(v_empty_orders, 1);
  end if;

  -- === The item's remaining dependents, then the item itself ===
  update public.capture_records      set inventory_item_id = null where inventory_item_id = p_item_id;
  delete from public.capture_review_queue where inventory_item_id = p_item_id;
  delete from public.live_batch_items     where inventory_item_id = p_item_id;
  delete from public.miner_positions      where inventory_item_id = p_item_id;
  delete from public.waitlist_entries     where inventory_item_id = p_item_id;
  update public.layaway_ledger_items set inventory_item_id = null where inventory_item_id = p_item_id;
  delete from public.item_photos          where inventory_item_id = p_item_id;

  delete from public.inventory_items where id = p_item_id;

  return jsonb_build_object('deleted_orders', coalesce(v_deleted_orders, 0));
end;
$function$;

revoke all on function public.force_delete_completed_item(uuid) from public, anon, authenticated;
grant execute on function public.force_delete_completed_item(uuid) to authenticated;
