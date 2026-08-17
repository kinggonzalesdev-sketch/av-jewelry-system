-- P1 (2026-08-17): Walk-In "Scrap" Mode of Payment — atomic order + Scrap payment + scrap purchase.
-- Additive to save_walkin_order: existing walk-ins (which never use 'Scrap') are byte-for-byte
-- unchanged. When a payment line's method is 'Scrap', the same transaction ALSO records a
-- scrap_sales purchase (payment_method='cash') so the trade-in is traceable in Scrap and its
-- cash-OUT nets the paired Scrap cash-IN to zero on the drawer (Owner model). All-or-nothing:
-- the order, the Scrap payment, and the scrap purchase commit together or roll back together.
--
-- Applied live via Supabase MCP; committed here so the schema is not drift-only.
create or replace function public.save_walkin_order(p_customer_name text, p_items jsonb, p_payments jsonb default '[]'::jsonb, p_sale_date date default null::date, p_admin_id uuid default null::uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid; v_admin uuid; v_customer uuid; v_order public.official_orders%rowtype;
  v_item jsonb; v_pay jsonb; v_id uuid; v_price numeric; v_status text; v_archived boolean;
  v_code text; v_claim uuid; v_count int := 0; v_ids uuid[] := '{}'; v_ts timestamptz;
  v_total numeric; v_method text; v_amount numeric; v_ref text; v_pdate date;
  v_payid uuid; v_paid numeric := 0; v_first_code text;
  v_scrap_grams numeric; v_scrap_material text; v_scrap_karat text;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the sale.' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(coalesce(p_payments, '[]'::jsonb)) > 3 then
    raise exception 'A Walk-In accepts at most three payment methods.' using errcode = 'check_violation';
  end if;

  select sp.id into v_staff from public.staff_profiles sp where sp.auth_user_id = (select auth.uid());
  v_admin := app_private.resolve_admin_staff(p_admin_id);
  v_ts := coalesce(p_sale_date::timestamptz, now());

  select id into v_customer from public.customers
    where lower(display_name) = lower(trim(p_customer_name)) and is_active
    order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (display_name) values (trim(p_customer_name)) returning id into v_customer;
  end if;

  insert into public.official_orders
    (invoice_draft_id, customer_id, status, order_source, created_by, admin_staff_profile_id, created_at)
  values (null, v_customer, 'invoiced', 'walk_in', v_staff, v_admin, v_ts)
  returning * into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_id := (v_item->>'id')::uuid;
    v_price := round((v_item->>'price')::numeric, 2);
    if v_id is null then
      raise exception 'Every item row must reference an inventory item.' using errcode = 'check_violation';
    end if;
    if v_id = any(v_ids) then
      raise exception 'The same inventory item was added more than once. Remove the duplicate.'
        using errcode = 'check_violation';
    end if;
    v_ids := array_append(v_ids, v_id);
    if v_price is null or v_price <= 0 then
      raise exception 'Each item needs a unit price greater than zero.' using errcode = 'check_violation';
    end if;

    select availability_status, is_archived, item_code into v_status, v_archived, v_code
    from public.inventory_items where id = v_id for update;
    if v_code is null or v_archived
       or v_status not in ('available', 'returned_to_available')
       or app_private.available_quantity(v_id) < 1 then
      raise exception 'An item is no longer available (%). Please select another item.', coalesce(v_code, 'unknown')
        using errcode = 'check_violation';
    end if;
    if v_first_code is null then v_first_code := v_code; end if;

    update public.inventory_items set total_price_per_piece = v_price where id = v_id;
    insert into public.claims (inventory_item_id, customer_id, quantity, intake_kind)
    values (v_id, v_customer, 1, 'live_capture') returning id into v_claim;
    update public.claims set status = 'confirmed_claim', confirmed_at = now(), confirmed_by = v_staff
      where id = v_claim;
    insert into public.official_order_claims (official_order_id, claim_id) values (v_order.id, v_claim);
    update public.inventory_items set availability_status = 'committed' where id = v_id;
    v_count := v_count + 1;
  end loop;

  v_total := app_private.order_item_total(v_order.id);

  for v_pay in select * from jsonb_array_elements(coalesce(p_payments, '[]'::jsonb)) loop
    v_amount := round((v_pay->>'amount')::numeric, 2);
    if v_amount is null or v_amount <= 0 then continue; end if;
    v_method := coalesce(nullif(trim(v_pay->>'method'), ''), 'Cash');
    if v_method not in ('bank_transfer','e_wallet','cash','card','other','Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance','Scrap') then v_method := 'other'; end if;
    v_pdate := coalesce((v_pay->>'date')::date, v_ts::date);
    v_ref := coalesce(nullif(trim(v_pay->>'reference'), ''),
                      case when lower(v_method) = 'cash' then 'WALKIN-' || v_first_code || '-' || to_char(now(),'HH24MISSMS') else null end);

    if round(v_paid + v_amount, 2) > round(v_total, 2) then
      raise exception 'The combined payment exceeds the total price of %.',
        '₱' || to_char(v_total, 'FM999,999,999,990.00') using errcode = 'check_violation';
    end if;

    insert into public.payments
      (official_order_id, amount, status, payment_method, reference_number, recorded_by, received_by, recorded_at, transacted_at)
    values
      (v_order.id, v_amount, 'submitted_unverified', v_method, v_ref, v_staff, v_staff, now(), v_pdate::timestamptz)
    returning id into v_payid;
    insert into public.payment_verifications (payment_id, outcome, verified_amount, verified_by)
    values (v_payid, 'verified', v_amount, v_staff);
    update public.payments set status = 'verified' where id = v_payid;
    v_paid := round(v_paid + v_amount, 2);

    -- Walk-In "Scrap" payment: the customer settles part of the order by trading in scrap,
    -- and the shop simultaneously BUYS that scrap for cash. Record the scrap purchase as a
    -- cash-OUT (payment_method='cash') so it is traceable in Scrap and nets the paired Scrap
    -- cash-IN to zero on the drawer (Owner model 2026-08-17). In THIS transaction, so the
    -- order + the Scrap payment + the scrap purchase are all-or-nothing.
    if v_method = 'Scrap' then
      v_scrap_grams := round(nullif(trim(v_pay->>'scrap_grams'), '')::numeric, 3);
      if v_scrap_grams is null or v_scrap_grams <= 0 then
        raise exception 'A Scrap payment needs the scrap weight in grams (greater than zero).' using errcode = 'check_violation';
      end if;
      v_scrap_material := lower(coalesce(nullif(trim(v_pay->>'scrap_material'), ''), 'gold'));
      if v_scrap_material not in ('gold','silver') then v_scrap_material := 'gold'; end if;
      v_scrap_karat := left(nullif(trim(v_pay->>'scrap_karat'), ''), 20);
      insert into public.scrap_sales
        (material, grams, amount, buyer, sold_on, per_gram, karat, payment_method, recorded_by, note)
      values
        (v_scrap_material, v_scrap_grams, v_amount, left(trim(p_customer_name), 160), v_pdate,
         round(v_amount / v_scrap_grams, 2), v_scrap_karat, 'cash', v_staff,
         'Walk-In scrap payment · order ' || coalesce(v_order.order_number, v_order.id::text));
    end if;
  end loop;

  return jsonb_build_object(
    'official_order_id', v_order.id, 'order_number', v_order.order_number,
    'invoice_number', v_order.invoice_number, 'item_count', v_count,
    'total', v_total, 'verified_paid', v_paid, 'balance', round(v_total - v_paid, 2)
  );
end;
$function$;
