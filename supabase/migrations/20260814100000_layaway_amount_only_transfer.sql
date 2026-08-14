-- Make imported "amount-only" layaways (no inventory item, no Unique Code) transferable.
--
-- Context: 499 active layaways were bulk-imported from a spreadsheet as BALANCE-ONLY rows
-- (customer + grand_total + payment). The source sheet's "ITEM" column was a peso amount,
-- not an inventory code, so these rows have no inventory_item_id and no layaway_ledger_items.
-- Before this migration, create_order_from_layaway (added in 20260813220000) raised
-- "This layaway has no inventory items to move." for every one of them, so they could not be
-- routed to a fulfillment destination.
--
-- Fix: when there is no item to attach, synthesise a routable order whose payable equals the
-- ledger balance EXACTLY, by carrying the authoritative grand_total as one approved charge and
-- the amount already paid as an approved credit (no cash double-count). grand_total - payment =
-- balance holds for every imported amount-only row (verified in prod: 499/499). Item-bearing
-- layaways are UNCHANGED — only the previous unconditional "no items" raise is replaced.

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
  v_gross numeric;
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

  -- Amount-only / imported historical layaway (no inventory piece to attach). Synthesise a
  -- routable order whose payable equals the ledger balance EXACTLY: authoritative grand_total
  -- as one approved charge, already-paid amount as an approved credit (no cash double-count).
  if v_count = 0 then
    v_gross := round(coalesce(v_ledger.grand_total, 0), 2);
    if v_gross <= 0 then
      raise exception 'This layaway has no item and no balance to transfer.' using errcode = 'check_violation';
    end if;
    v_payment := round(coalesce(v_ledger.payment, 0), 2);
    v_credit := least(v_payment, v_gross);

    insert into public.official_order_charges
      (official_order_id, kind, label, amount, approved_at, approved_by, include_in_layaway_balance, created_by)
    values (v_order.id, 'charge', 'Layaway total carried forward (imported, no item detail)',
            v_gross, now(), v_staff, false, v_staff);

    if v_credit > 0 then
      insert into public.official_order_charges
        (official_order_id, kind, label, amount, approved_at, approved_by, include_in_layaway_balance, created_by)
      values (v_order.id, 'credit', 'Layaway payments carried forward', v_credit, now(), v_staff, false, v_staff);
    end if;

    update public.layaway_ledger set status = 'transferred' where id = p_ledger_id;
    perform public.transfer_order_destination(v_order.id, p_destination);

    return jsonb_build_object(
      'order_id', v_order.id, 'order_number', v_order.order_number, 'item_count', 0,
      'item_total', 0, 'interest', round(coalesce(v_ledger.interest, 0), 2),
      'grand_total', v_gross, 'carried_payment', v_credit,
      'total_payable', app_private.total_amount_payable(v_order.id),
      'ledger_balance', round(coalesce(v_ledger.balance, 0), 2),
      'amount_only', true, 'source', 'layaway'
    );
  end if;

  -- Item-bearing layaway (unchanged).
  v_item_total := app_private.order_item_total(v_order.id);
  v_interest := round(coalesce(v_ledger.interest, 0), 2);
  v_payment := round(coalesce(v_ledger.payment, 0), 2);

  if v_interest > 0 then
    insert into public.official_order_charges
      (official_order_id, kind, label, amount, approved_at, approved_by, include_in_layaway_balance, created_by)
    values (v_order.id, 'charge', 'Layaway interest', v_interest, now(), v_staff, false, v_staff);
  end if;

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
