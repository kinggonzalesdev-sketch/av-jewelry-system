-- SUPER ADMIN (Owner) correction of an order's Customer Name and Total Amount
-- (Owner request: Edit on every row, Owner-only, those two fields only).
--   * Customer Name -> updates the order's customer display_name (a rename fixes a
--     typo; it is the customer's name, so it applies to that customer).
--   * Total Amount  -> the order total is derived as sum(item.total_price_per_piece *
--     qty), so we set the item's price. Single-item only (captures are); a multi-item
--     order is rejected (edit its items individually) so we never silently mis-split.
create or replace function public.admin_edit_order(
  p_order_id uuid,
  p_customer_name text default null,
  p_total_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_customer_id uuid;
  v_claim_count int;
  v_item_id uuid;
  v_qty int;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: editing an order is reserved to the Super Admin (Owner).';
  end if;

  select customer_id into v_customer_id from public.official_orders where id = p_order_id;
  if v_customer_id is null then
    raise exception 'Order not found.';
  end if;

  if p_customer_name is not null and length(trim(p_customer_name)) > 0 then
    update public.customers set display_name = trim(p_customer_name) where id = v_customer_id;
  end if;

  if p_total_amount is not null then
    if p_total_amount < 0 then
      raise exception 'Total amount cannot be negative.';
    end if;
    select count(*) into v_claim_count
      from public.official_order_claims where official_order_id = p_order_id;
    if v_claim_count = 0 then
      raise exception 'This order has no items, so the total cannot be set here.';
    elsif v_claim_count > 1 then
      raise exception 'This order has % items — edit the item prices individually, not one total.', v_claim_count;
    end if;
    select c.inventory_item_id, greatest(coalesce(c.quantity, 1), 1)
      into v_item_id, v_qty
      from public.official_order_claims ooc
      join public.claims c on c.id = ooc.claim_id
      where ooc.official_order_id = p_order_id
      limit 1;
    if v_item_id is null then
      raise exception 'This order''s item could not be found.';
    end if;
    update public.inventory_items
      set total_price_per_piece = round(p_total_amount / v_qty, 2)
      where id = v_item_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke execute on function public.admin_edit_order(uuid, text, numeric) from public, anon;
grant execute on function public.admin_edit_order(uuid, text, numeric) to authenticated, service_role;
