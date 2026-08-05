-- Test Mode safety (Owner request): a test session must NEVER reduce or change real
-- inventory. create_capture_order (the live-capture order path) touches inventory in
-- two ways — it overwrites the item's catalogue price/grams, and it commits the item
-- (availability_status='committed', which reduces available stock). Both are now
-- SKIPPED when app_private.is_test_mode() is true. Everything else (order, claim,
-- capture record) still runs so the live flow is fully exercised; those rows are
-- is_test-tagged and cleared by reset_test_data(). Verbatim copy with only the two
-- inventory writes guarded.
create or replace function public.create_capture_order(p_device text, p_capture_id text, p_customer_name text, p_inventory_item_id uuid, p_price numeric, p_grams numeric default null::numeric, p_screenshot_path text default null::text, p_ocr jsonb default null::jsonb, p_pancake_conversation_id text default null::text, p_pancake_customer_id text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid; v_customer uuid; v_order public.official_orders%rowtype;
  v_key text; v_existing public.capture_records%rowtype; v_claim uuid;
  v_status text; v_archived boolean; v_code text; v_capture uuid;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_device), '') = '' or coalesce(trim(p_capture_id), '') = '' then
    raise exception 'A device id and capture id are required.' using errcode = 'check_violation';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;
  if p_inventory_item_id is null then
    raise exception 'An inventory item is required.' using errcode = 'check_violation';
  end if;
  if p_price is null or p_price <= 0 then
    raise exception 'A unit price greater than zero is required.' using errcode = 'check_violation';
  end if;

  v_key := 'capture:' || trim(p_device) || ':' || trim(p_capture_id);

  -- Idempotency: a capture already turned into an order returns that order.
  select * into v_existing from public.capture_records where idempotency_key = v_key;
  if found and v_existing.official_order_id is not null then
    select * into v_order from public.official_orders where id = v_existing.official_order_id;
    return jsonb_build_object(
      'official_order_id', v_order.id, 'order_number', v_order.order_number,
      'invoice_number', v_order.invoice_number, 'idempotent', true,
      'capture_record_id', v_existing.id
    );
  end if;

  select sp.id into v_staff from public.staff_profiles sp
  where sp.auth_user_id = (select auth.uid());

  select id into v_customer from public.customers
    where lower(display_name) = lower(trim(p_customer_name)) and is_active
    order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (display_name) values (trim(p_customer_name)) returning id into v_customer;
  end if;

  select availability_status, is_archived, item_code into v_status, v_archived, v_code
    from public.inventory_items where id = p_inventory_item_id for update;
  if v_code is null or v_archived
     or v_status not in ('available', 'returned_to_available')
     or app_private.available_quantity(p_inventory_item_id) < 1 then
    raise exception 'That item is no longer available. Select another item.' using errcode = 'check_violation';
  end if;

  insert into public.official_orders
    (invoice_draft_id, customer_id, status, order_source, created_by, admin_staff_profile_id, created_at)
  values (null, v_customer, 'invoiced', 'capture_app', v_staff, v_staff, now())
  returning * into v_order;

  -- Real inventory writes — SKIPPED in Test Mode so a test never alters the catalogue
  -- price/grams and never reduces available stock.
  if not app_private.is_test_mode() then
    update public.inventory_items
      set total_price_per_piece = round(p_price, 2),
          grams_per_piece = coalesce(grams_per_piece, p_grams)
      where id = p_inventory_item_id;
  end if;

  insert into public.claims (inventory_item_id, customer_id, quantity, intake_kind)
  values (p_inventory_item_id, v_customer, 1, 'live_capture') returning id into v_claim;
  update public.claims set status = 'confirmed_claim', confirmed_at = now(), confirmed_by = v_staff
    where id = v_claim;
  insert into public.official_order_claims (official_order_id, claim_id) values (v_order.id, v_claim);
  if not app_private.is_test_mode() then
    update public.inventory_items set availability_status = 'committed' where id = p_inventory_item_id;
  end if;

  insert into public.capture_records
    (device_installation_id, capture_id, official_order_id, inventory_item_id, customer_id,
     captured_by, screenshot_path, ocr, confirmed, pancake_conversation_id, pancake_customer_id)
  values
    (trim(p_device), trim(p_capture_id), v_order.id, p_inventory_item_id, v_customer,
     v_staff, p_screenshot_path, p_ocr,
     jsonb_build_object('customer_name', trim(p_customer_name), 'price', round(p_price, 2), 'grams', p_grams),
     p_pancake_conversation_id, p_pancake_customer_id)
  on conflict (idempotency_key) do update set official_order_id = excluded.official_order_id
  returning id into v_capture;

  return jsonb_build_object(
    'official_order_id', v_order.id, 'order_number', v_order.order_number,
    'invoice_number', v_order.invoice_number, 'idempotent', false,
    'capture_record_id', v_capture
  );
end;
$function$;

-- create_layaway_account commits inventory too. Guard that one commit line without
-- retyping the function (its account-number regex must survive byte-for-byte): read
-- the current definition, wrap only the commit, re-create. No-op if the line ever
-- changes, so it can never corrupt the function.
do $do$
declare v_def text;
begin
  select pg_get_functiondef('public.create_layaway_account'::regproc) into v_def;
  v_def := replace(
    v_def,
    'update public.inventory_items set availability_status = ''committed'' where id = v_iid;',
    'if not app_private.is_test_mode() then update public.inventory_items set availability_status = ''committed'' where id = v_iid; end if;'
  );
  execute v_def;
end
$do$;