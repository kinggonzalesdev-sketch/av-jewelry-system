-- ORDER LINE PRICE SNAPSHOT (Owner 2026-09-26).
--
-- Send Invoice sent "Price Per gram:" blank. Two causes, both fixed here:
--   1. The rate typed on New Order / Use was never stored. Only its total (grams × rate) was
--      written, onto inventory_items.total_price_per_piece, so the invoice could only work the
--      rate out backwards from the total and the grams read out of the item code.
--   2. The live 'invoice' template (edited 2026-08-22) says "Price Per gram: " with NO
--      {price_per_gram} variable, so that line could never be filled.
--
-- WHAT THIS ADDS (strictly additive, backward-compatible, non-destructive):
--   * claims (the order line) gets four NULLABLE snapshot columns, written when a line is created
--     with a known price: pricing_mode ('per_gram' | 'fixed'), price_per_gram, grams_snapshot and
--     unit_price_snapshot. Existing rows stay NULL: legacy orders keep today's derivation.
--   * app_private.apply_line_pricing: writes one line's snapshot, and refuses a per-gram line whose
--     price is not exactly round(grams × rate, 2) — the same rounding the web form uses.
--   * A guard trigger on claims: a direct API write (authenticated / anon) can never set or change a
--     snapshot, so the rate an invoice prints is only ever the one saved when the item was added.
--   * public.create_new_order_multi_priced: create_new_order_multi (UNCHANGED) + the snapshots, in
--     ONE transaction. Used by New Order and Incoming Captures → Use.
--   * public.add_order_items_priced: add one or more items to an existing order in ONE
--     transaction, through add_order_item (UNCHANGED), with the order row locked first so a
--     concurrent cancel/edit waits. Used by Edit → Add Item (For Invoice included).
--   * The live 'invoice' template's bare "Price Per gram: " line gets the {price_per_gram} variable,
--     ONLY if the body still has that exact line and no {price_per_gram} anywhere. The previous body
--     goes to message_template_history, exactly as the Settings editor's own save does.
--
-- NOT CHANGED: create_new_order_multi, add_order_item, order totals (still Σ total_price_per_piece
-- × quantity), payments, inventory statuses, any existing row. The web build that is live now never
-- calls the new functions, and the new web build falls back to the old functions when these do not
-- exist yet, so this can be applied before or after the web deploy.
--
-- LIVE BODIES THE WRAPPERS CALL (md5 of pg_get_functiondef, 2026-09-26):
--   public.create_new_order_multi(uuid,text,jsonb,uuid)   c4edf47c7d7decc6904504d03f72938a
--     returns jsonb with official_order_id; one claim per inventory item (duplicates refused)
--   public.add_order_item(uuid,uuid,numeric,integer)      0c4fe356a72e37780801562d51b0c98a
--     returns jsonb with claim_id; Owner only; locks the inventory row FOR UPDATE; refuses
--     app_private.order_items_locked statuses ('invoiced' = For Invoice is editable)
--
-- ROLLBACK (only if ever needed; the columns can simply stay unused):
--   drop function public.create_new_order_multi_priced(uuid, text, jsonb, uuid);
--   drop function public.add_order_items_priced(uuid, jsonb);
--   drop function app_private.apply_line_pricing(uuid, jsonb, numeric);
--   drop trigger claims_pricing_snapshot_guard on public.claims;
--   drop function app_private.guard_claim_pricing_snapshot();
--   The template's previous body is the newest 'invoice' row in message_template_history.

-- ---------------------------------------------------------------------------
-- 1. The snapshot columns on the order line.
-- ---------------------------------------------------------------------------
alter table public.claims
  add column if not exists pricing_mode text,
  add column if not exists price_per_gram numeric(14,2),
  add column if not exists grams_snapshot numeric(12,3),
  add column if not exists unit_price_snapshot numeric(14,2);

comment on column public.claims.pricing_mode is
  'How this order line was priced when it was added: per_gram (grams × price_per_gram) or fixed. NULL = legacy line, priced before snapshots existed.';
comment on column public.claims.price_per_gram is
  'The Price Per Gram entered when the line was added (transaction-time snapshot; per_gram lines only).';
comment on column public.claims.grams_snapshot is
  'The grams the line was priced at (per_gram lines only; a fixed-price line never carries grams).';
comment on column public.claims.unit_price_snapshot is
  'The line price when it was added: round(grams × price_per_gram, 2) or the fixed price.';

-- Exact shapes only. Every term is written so it can never evaluate to NULL (a CHECK that is NULL
-- passes): all four empty, or a complete fixed line, or a complete per-gram line.
do $$
begin
  alter table public.claims
    add constraint claims_pricing_snapshot_ck check (
      (pricing_mode is null and price_per_gram is null and grams_snapshot is null
         and unit_price_snapshot is null)
      or (coalesce(pricing_mode = 'fixed', false)
         and price_per_gram is null and grams_snapshot is null
         and coalesce(unit_price_snapshot > 0, false))
      or (coalesce(pricing_mode = 'per_gram', false)
         and coalesce(price_per_gram > 0, false) and coalesce(grams_snapshot > 0, false)
         and coalesce(unit_price_snapshot > 0, false))
    );
exception when duplicate_object then null;
end $$;

-- Only the pricing functions below (SECURITY DEFINER, so they run as the table owner) may write a
-- snapshot. A direct API write as a signed-in user (authenticated) or anon may not set or change
-- one — staff who may update a claim's status still cannot rewrite the rate an invoice prints.
-- Other claim updates are untouched: the guard only fires when a snapshot column would change.
create or replace function app_private.guard_claim_pricing_snapshot()
returns trigger
language plpgsql
set search_path to ''
as $function$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.pricing_mode is not null or new.price_per_gram is not null
         or new.grams_snapshot is not null or new.unit_price_snapshot is not null then
        raise exception 'A line''s pricing snapshot is written only when the item is added to an order.'
          using errcode = 'insufficient_privilege';
      end if;
    elsif (new.pricing_mode, new.price_per_gram, new.grams_snapshot, new.unit_price_snapshot)
          is distinct from
          (old.pricing_mode, old.price_per_gram, old.grams_snapshot, old.unit_price_snapshot) then
      raise exception 'A line''s pricing snapshot cannot be changed directly.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end
$function$;

revoke all on function app_private.guard_claim_pricing_snapshot() from public, anon, authenticated;

do $$
begin
  create trigger claims_pricing_snapshot_guard
    before insert or update on public.claims
    for each row execute function app_private.guard_claim_pricing_snapshot();
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Write one line's snapshot.
--    p_pricing: {"mode":"per_gram","price_per_gram":"6800","grams":"1.12"} or {"mode":"fixed"}.
--    NULL / not an object = a caller that sends no pricing: the line stays a legacy line.
-- ---------------------------------------------------------------------------
create or replace function app_private.apply_line_pricing(
  p_claim_id uuid,
  p_pricing jsonb,
  p_unit_price numeric
)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_mode text;
  v_rate numeric;
  v_grams numeric;
  v_price numeric := round(p_unit_price, 2);
begin
  if p_pricing is null or jsonb_typeof(p_pricing) <> 'object' then
    return;
  end if;
  if p_claim_id is null then
    raise exception 'The order line was not found. No record was changed.' using errcode = 'no_data_found';
  end if;
  v_mode := p_pricing->>'mode';

  if v_mode = 'fixed' then
    update public.claims
       set pricing_mode = 'fixed', price_per_gram = null, grams_snapshot = null,
           unit_price_snapshot = v_price
     where id = p_claim_id;
  elsif v_mode = 'per_gram' then
    begin
      v_rate := round((p_pricing->>'price_per_gram')::numeric, 2);
      v_grams := round((p_pricing->>'grams')::numeric, 3);
    exception when invalid_text_representation then
      raise exception 'Grams and Price Per Gram must be numbers. No record was changed.'
        using errcode = 'check_violation';
    end;
    if v_rate is null or v_rate <= 0 or v_grams is null or v_grams <= 0 then
      raise exception 'A per-gram item needs its grams and Price Per Gram. No record was changed.'
        using errcode = 'check_violation';
    end if;
    -- The same rounding as the web form (item-pricing.ts): the nearest centavo.
    if round(v_rate * v_grams, 2) <> v_price then
      raise exception 'The item price (%) is not grams × Price Per Gram (% × % = %). No record was changed.',
        v_price, v_grams, v_rate, round(v_rate * v_grams, 2)
        using errcode = 'check_violation';
    end if;
    update public.claims
       set pricing_mode = 'per_gram', price_per_gram = v_rate, grams_snapshot = v_grams,
           unit_price_snapshot = v_price
     where id = p_claim_id;
  else
    raise exception 'Unknown pricing mode (%). No record was changed.', coalesce(v_mode, 'none')
      using errcode = 'check_violation';
  end if;
end
$function$;

revoke all on function app_private.apply_line_pricing(uuid, jsonb, numeric) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. New Order / Incoming Captures → Use: create the order and store every line's snapshot in
--    ONE transaction. Each p_items element is create_new_order_multi's {id, price, qty} plus an
--    optional "pricing" object (see apply_line_pricing).
-- ---------------------------------------------------------------------------
create or replace function public.create_new_order_multi_priced(
  p_customer_id uuid,
  p_customer_name text,
  p_items jsonb,
  p_admin_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_res jsonb;
  v_order uuid;
  v_item jsonb;
  v_claim uuid;
begin
  -- Permission, availability, reservation and the order itself: the unchanged function.
  v_res := public.create_new_order_multi(p_customer_id, p_customer_name, p_items, p_admin_id);
  v_order := (v_res->>'official_order_id')::uuid;

  for v_item in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item->'pricing') = 'object' then
      select oc.claim_id into v_claim
        from public.official_order_claims oc
        join public.claims c on c.id = oc.claim_id
       where oc.official_order_id = v_order
         and c.inventory_item_id = (v_item->>'id')::uuid;
      perform app_private.apply_line_pricing(v_claim, v_item->'pricing', (v_item->>'price')::numeric);
    end if;
  end loop;

  return v_res;
end
$function$;

revoke all on function public.create_new_order_multi_priced(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.create_new_order_multi_priced(uuid, text, jsonb, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Edit → Add Item on an existing order (For Invoice included): every item is added through the
--    unchanged add_order_item and gets its snapshot, ALL OR NOTHING. The order row is locked first,
--    so two tabs editing the same order take turns and a cancel cannot slip in between. Each
--    inventory row is locked by add_order_item, so the same piece can never land on two orders: the
--    second attempt finds it committed and the whole batch rolls back.
--    p_items: [{"id": <inventory item uuid>, "price": <line price>, "qty": 1, "pricing": {...}}]
-- ---------------------------------------------------------------------------
create or replace function public.add_order_items_priced(p_order_id uuid, p_items jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status text;
  v_item jsonb;
  v_res jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_claims uuid[] := '{}';
begin
  -- "is distinct from": a caller with no staff role at all (NULL) is refused too.
  if app_private.current_staff_role() is distinct from 'owner' then
    raise exception 'Not authorized: editing an order''s items is reserved to the Super Admin. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item.' using errcode = 'check_violation';
  end if;

  select o.status into v_status from public.official_orders o where o.id = p_order_id for update;
  if v_status is null then
    raise exception 'Order not found.' using errcode = 'no_data_found';
  end if;

  -- Items in id order: every save locks inventory rows in the same order, so two saves that share
  -- items can never deadlock each other.
  for v_item in select e.value from jsonb_array_elements(p_items) e order by e.value->>'id' loop
    v_id := (v_item->>'id')::uuid;
    if v_id is null then
      raise exception 'Every item row must reference an inventory item.' using errcode = 'check_violation';
    end if;
    if v_id = any(v_ids) then
      raise exception 'The same inventory item was added more than once. Remove the duplicate.'
        using errcode = 'check_violation';
    end if;
    v_ids := array_append(v_ids, v_id);

    v_res := public.add_order_item(
      p_order_id, v_id, (v_item->>'price')::numeric, coalesce((v_item->>'qty')::int, 1)
    );
    perform app_private.apply_line_pricing(
      (v_res->>'claim_id')::uuid, v_item->'pricing', (v_item->>'price')::numeric
    );
    v_claims := array_append(v_claims, (v_res->>'claim_id')::uuid);
  end loop;

  return jsonb_build_object(
    'claim_ids', to_jsonb(v_claims),
    'item_count', (select count(*) from public.official_order_claims where official_order_id = p_order_id),
    'total', app_private.order_item_total(p_order_id)
  );
end
$function$;

revoke all on function public.add_order_items_priced(uuid, jsonb) from public, anon;
grant execute on function public.add_order_items_priced(uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. The live 'invoice' template: give the bare "Price Per gram: " line its variable. Guarded: only
--    when that exact line is present and the body uses {price_per_gram} nowhere, so an Owner edit
--    made after this file was written is never overwritten. {price_per_gram} renders "₱6,800/g",
--    "Mixed Rates" when the lines differ, and a fixed-price order drops the line.
-- ---------------------------------------------------------------------------
do $$
declare
  v_body text;
begin
  select body into v_body from public.message_templates where key = 'invoice' for update;
  if v_body is not null
     and position('{price_per_gram}' in v_body) = 0
     and position(E'Price Per gram: \n' in v_body) > 0 then
    insert into public.message_template_history (template_key, previous_body, updated_by)
    values ('invoice', v_body, null);
    -- updated_by NULL: this system change is not attributed to whoever edited it last.
    update public.message_templates
       set body = replace(v_body, E'Price Per gram: \n', E'Price Per gram: {price_per_gram}\n'),
           updated_at = now(),
           updated_by = null
     where key = 'invoice';
  end if;
end $$;
