-- #11 (2026-08-13) — Transfer a NO-linked-order layaway to a fulfillment destination.
--
-- 598 of the active layaways were created STANDALONE (create_layaway_account) with no
-- official_order, so the old transfer_layaway_to_destination raised "no linked order" and
-- the operator was stuck. This adds create_order_from_layaway to SYNTHESISE the order the
-- layaway never had, and makes transfer_layaway_to_destination delegate to it.
--
-- Model reconciliation (verified against live data before shipping):
--   * Items: a standalone layaway's inventory items are already 'committed' to the customer
--     WITHOUT a claim row. We formalise the confirmed claim + order link, skipping the
--     'available' gate. (Of the 598, 99 have inventory items — the transferable set; 499 are
--     imported amount-only rows with no items and correctly raise "no inventory items".)
--   * Interest → an APPROVED 'charge' so total_amount_payable = items + interest.
--   * The layaway stores its paid amount as ONE aggregate (ledger.payment), NEVER as payment
--     rows. Recording it as a new payment would DOUBLE-COUNT it as fresh cash in Daily Cash /
--     Reports (the sale was booked when the layaway was made). Instead it becomes an APPROVED
--     'credit', so the order balance == the layaway balance with NO new cash counted anywhere.
--   * order_source='online' (NOT 'walk_in') so it never inflates walk-in sales figures.
--
-- Verified across ALL 99 transferable layaways: projected order total_payable == ledger
-- balance (0 mismatches), and a rolled-back dry-run confirmed the DB writes + the match
-- (item_total 5500 + interest 1368 - credit 3400 = payable 3468 = ledger balance 3468).
-- Applied to production via Supabase MCP; this file version-controls the live definitions.

create or replace function public.create_order_from_layaway(p_ledger_id uuid, p_destination text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid; v_admin uuid; v_customer uuid;
  v_ledger public.layaway_ledger%rowtype;
  v_order public.official_orders%rowtype;
  v_item record; v_claim uuid; v_count int := 0;
  v_interest numeric; v_payment numeric; v_item_total numeric; v_credit numeric;
begin
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_destination not in ('pickup','delivery','shipping','keep') then
    raise exception 'Select a valid destination.' using errcode = 'check_violation';
  end if;

  select * into v_ledger from public.layaway_ledger where id = p_ledger_id for update;
  if v_ledger.id is null then
    raise exception 'Layaway account not found.' using errcode = 'check_violation';
  end if;
  if v_ledger.status <> 'active' then
    raise exception 'Only an ACTIVE layaway account can be transferred (this one is %).', v_ledger.status
      using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.official_orders where converted_layaway_ledger_id = p_ledger_id) then
    raise exception 'This layaway already has a linked order — transfer it directly.'
      using errcode = 'check_violation';
  end if;

  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  v_admin := coalesce(v_ledger.admin_staff_profile_id, v_staff);

  v_customer := v_ledger.customer_id;
  if v_customer is null then
    select id into v_customer from public.customers
      where lower(display_name) = lower(trim(coalesce(v_ledger.customer_name, ''))) and is_active
      order by created_at limit 1;
    if v_customer is null then
      insert into public.customers (display_name)
        values (nullif(trim(coalesce(v_ledger.customer_name, '')), ''))
        returning id into v_customer;
    end if;
  end if;

  insert into public.official_orders
    (customer_id, status, order_source, source_kind, created_by, admin_staff_profile_id,
     converted_layaway_ledger_id, converted_to_layaway, created_at)
  values (v_customer, 'invoiced', 'online', 'native', v_staff, v_admin,
     p_ledger_id, false, now())
  returning * into v_order;

  for v_item in
    select li.inventory_item_id, li.item_amount
    from public.layaway_ledger_items li
    where li.ledger_id = p_ledger_id and li.inventory_item_id is not null
  loop
    insert into public.claims (inventory_item_id, customer_id, quantity, intake_kind)
    values (v_item.inventory_item_id, v_customer, 1, 'live_capture') returning id into v_claim;
    update public.claims set status = 'confirmed_claim', confirmed_at = now(), confirmed_by = v_staff
      where id = v_claim;
    insert into public.official_order_claims (official_order_id, claim_id) values (v_order.id, v_claim);
    update public.inventory_items
      set total_price_per_piece = round(coalesce(v_item.item_amount, 0), 2),
          availability_status = 'committed'
      where id = v_item.inventory_item_id;
    v_count := v_count + 1;
  end loop;

  -- Legacy single-item layaway (predates layaway_ledger_items): fall back to the ledger's own item.
  if v_count = 0 and v_ledger.inventory_item_id is not null then
    insert into public.claims (inventory_item_id, customer_id, quantity, intake_kind)
    values (v_ledger.inventory_item_id, v_customer, 1, 'live_capture') returning id into v_claim;
    update public.claims set status = 'confirmed_claim', confirmed_at = now(), confirmed_by = v_staff
      where id = v_claim;
    insert into public.official_order_claims (official_order_id, claim_id) values (v_order.id, v_claim);
    update public.inventory_items
      set total_price_per_piece = round(coalesce(v_ledger.item_amount, 0), 2),
          availability_status = 'committed'
      where id = v_ledger.inventory_item_id;
    v_count := 1;
  end if;

  if v_count = 0 then
    raise exception 'This layaway has no inventory items to move.' using errcode = 'check_violation';
  end if;

  v_item_total := app_private.order_item_total(v_order.id);
  v_interest := round(coalesce(v_ledger.interest, 0), 2);
  v_payment := round(coalesce(v_ledger.payment, 0), 2);

  if v_interest > 0 then
    insert into public.official_order_charges
      (official_order_id, kind, label, amount, approved_at, approved_by, include_in_layaway_balance, created_by)
    values (v_order.id, 'charge', 'Layaway interest', v_interest, now(), v_staff, false, v_staff);
  end if;

  -- Capped so the payable can never go negative on an over-paid (balance_mismatch) account.
  v_credit := least(v_payment, round(v_item_total + v_interest, 2));
  if v_credit > 0 then
    insert into public.official_order_charges
      (official_order_id, kind, label, amount, approved_at, approved_by, include_in_layaway_balance, created_by)
    values (v_order.id, 'credit', 'Layaway payments carried forward', v_credit, now(), v_staff, false, v_staff);
  end if;

  update public.layaway_ledger set status = 'transferred' where id = p_ledger_id;
  perform public.transfer_order_destination(v_order.id, p_destination);

  return jsonb_build_object(
    'order_id', v_order.id, 'order_number', v_order.order_number, 'item_count', v_count,
    'item_total', v_item_total, 'interest', v_interest, 'carried_payment', v_credit,
    'total_payable', app_private.total_amount_payable(v_order.id),
    'ledger_balance', round(coalesce(v_ledger.balance, 0), 2), 'source', 'layaway'
  );
end;
$function$;

revoke all on function public.create_order_from_layaway(uuid, text) from public, anon;
grant execute on function public.create_order_from_layaway(uuid, text) to authenticated;

-- Delegate the no-linked-order case (order-linked layaways keep the reuse path unchanged).
create or replace function public.transfer_layaway_to_destination(p_ledger_id uuid, p_destination text)
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
    return public.create_order_from_layaway(p_ledger_id, p_destination);
  end if;

  update public.official_orders set converted_to_layaway = false where id = v_order;
  perform public.transfer_order_destination(v_order, p_destination);
  update public.layaway_ledger set status = 'transferred' where id = p_ledger_id;

  return jsonb_build_object('order_id', v_order, 'destination', p_destination, 'source', 'layaway');
end;
$function$;
