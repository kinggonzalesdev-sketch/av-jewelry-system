-- =============================================================================
-- Inventory status integrity hardening (Owner request 2026-08-18).
--
-- A forensic audit found two failure modes, BOTH produced by out-of-band writes that
-- bypassed the canonical RPCs (all of which keep proper linkage):
--   A) an item reached availability_status='completed' with only a confirmed_claim and
--      NO official order / invoice / payment (2 items).
--   B) an item stayed availability_status='committed' with NO backing claim / reservation
--      / order / layaway (3 items).
--
-- Every legitimate path already maintains the invariant. Verified against live data:
--   184/186 completed items link to a completed official order; the 2 that do not are the
--   known orphans. 1063/1066 committed items have a backer (111 of the 114 claim-less
--   committed items are held by a layaway link); the 3 that do not are the known orphans.
--   0 committed items are backed only by a cancelled order.
--
-- Enforcement is a DEFERRABLE INITIALLY DEFERRED constraint trigger, so the check runs at
-- COMMIT against the row's FINAL state — fire-order-immune. That matters because
-- create_layaway_account sets the item 'committed' BEFORE it writes the layaway backer;
-- a plain BEFORE trigger would false-reject it, a deferred check does not. The WHEN clause
-- restricts the trigger to a real TRANSITION INTO a guarded state, so ordinary edits (name,
-- price, custody) to an already-committed/completed row — including the 5 frozen historical
-- orphans — are never touched or blocked. Nothing here auto-mutates any row.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- GOAL A + B: the completion + commitment invariant, checked at COMMIT.
-- ---------------------------------------------------------------------------
create or replace function app_private.enforce_inventory_status_integrity()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text;
begin
  -- Re-read the CURRENT status so a row moved through several states in one transaction
  -- (e.g. available -> committed -> completed, or committed -> available on a same-tx
  -- cancel) is judged by its FINAL state, never a stale NEW captured mid-transaction.
  select availability_status into v_status from public.inventory_items where id = new.id;
  if v_status is null then
    return null; -- row deleted later in the same transaction
  end if;

  -- GOAL A — an item is 'completed' ONLY as part of a completed official order/sale.
  -- A confirmed claim alone is not a sale (Bible §16/§17).
  if v_status = 'completed' then
    if not exists (
      select 1
      from public.official_order_claims oc
      join public.claims c on c.id = oc.claim_id
      join public.official_orders o on o.id = oc.official_order_id
      where c.inventory_item_id = new.id
        and o.status in ('completed','closed','delivered','picked_up','released')
    ) then
      raise exception
        'Inventory item % cannot be Completed: no completed official order/sale links it (a confirmed claim is not a sale).', new.id
        using errcode = 'check_violation';
    end if;

  -- GOAL B — an item is 'committed'/'provisionally_reserved' ONLY while a live backer holds
  -- it: a claim, an inventory reservation, or a layaway (ledger account or ledger item).
  elsif v_status in ('committed','provisionally_reserved') then
    if not exists (select 1 from public.claims c where c.inventory_item_id = new.id)
       and not exists (select 1 from public.inventory_reservations r where r.inventory_item_id = new.id)
       and not exists (select 1 from public.layaway_ledger l where l.inventory_item_id = new.id)
       and not exists (select 1 from public.layaway_ledger_items li where li.inventory_item_id = new.id)
    then
      raise exception
        'Inventory item % cannot be %: no backing claim, reservation, order, or layaway holds it.', new.id, v_status
        using errcode = 'check_violation';
    end if;
  end if;

  return null;
end;
$function$;

drop trigger if exists inventory_status_integrity on public.inventory_items;
create constraint trigger inventory_status_integrity
  after update on public.inventory_items
  deferrable initially deferred
  for each row
  when (old.availability_status is distinct from new.availability_status
        and new.availability_status in ('completed','committed','provisionally_reserved'))
  execute function app_private.enforce_inventory_status_integrity();

-- ---------------------------------------------------------------------------
-- AUDIT LOGGING: every future status transition writes a durable audit event. The forensic
-- audit found historical transitions with no audit record; this closes that gap. Fires
-- immediately on the transition (a blocked transition rolls back with its tx, so only real
-- transitions persist).
-- ---------------------------------------------------------------------------
create or replace function app_private.log_inventory_status_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_label text;
  v_order_id uuid;
  v_claim_id uuid;
  v_layaway_id uuid;
begin
  select sp.full_name into v_label from public.staff_profiles sp where sp.auth_user_id = v_actor;

  -- Best-effort related records for context (the newest linked order/claim + any layaway).
  select oc.official_order_id, c.id into v_order_id, v_claim_id
  from public.official_order_claims oc
  join public.claims c on c.id = oc.claim_id
  where c.inventory_item_id = new.id
  order by oc.official_order_id
  limit 1;

  select l.id into v_layaway_id from public.layaway_ledger l where l.inventory_item_id = new.id limit 1;

  insert into public.audit_events
    (actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id, outcome, reason, context)
  values (
    v_actor,
    case when v_actor is null then 'system' else 'staff' end,
    coalesce(v_label, case when v_actor is null then 'system' else 'unknown' end),
    'inventory_item.status_change',
    'inventory_item',
    new.id,
    'succeeded',
    null,
    jsonb_build_object(
      'previous_status', old.availability_status,
      'new_status', new.availability_status,
      'item_code', new.item_code,
      'related_order_id', v_order_id,
      'related_claim_id', v_claim_id,
      'related_layaway_id', v_layaway_id,
      'source', 'inventory_items status trigger'
    )
  );
  return new;
end;
$function$;

drop trigger if exists inventory_status_audit on public.inventory_items;
create trigger inventory_status_audit
  after update on public.inventory_items
  for each row
  when (old.availability_status is distinct from new.availability_status)
  execute function app_private.log_inventory_status_change();

-- ---------------------------------------------------------------------------
-- RECONCILIATION DETECTOR (read-only): future audits can quickly get
-- ORPHAN_COMPLETED_COUNT and ORPHAN_COMMITTED_COUNT. Manager-gated; mutates nothing.
-- The definitions are 1:1 with the enforcement invariant above.
-- ---------------------------------------------------------------------------
create or replace function public.inventory_integrity_report()
returns jsonb
language plpgsql
stable security definer
set search_path to ''
as $function$
declare v_result jsonb;
begin
  if app_private.current_staff_role() not in ('owner','selected_admin') then
    raise exception 'Not authorized: the integrity report is manager-only.'
      using errcode = 'insufficient_privilege';
  end if;

  with orphan_completed as (
    select ii.id, ii.item_code, ii.updated_at from public.inventory_items ii
    where ii.availability_status = 'completed'
      and not exists (
        select 1 from public.official_order_claims oc
        join public.claims c on c.id = oc.claim_id
        join public.official_orders o on o.id = oc.official_order_id
        where c.inventory_item_id = ii.id
          and o.status in ('completed','closed','delivered','picked_up','released'))
  ),
  orphan_committed as (
    select ii.id, ii.item_code, ii.updated_at from public.inventory_items ii
    where ii.availability_status in ('committed','provisionally_reserved')
      and not exists (select 1 from public.claims c where c.inventory_item_id = ii.id)
      and not exists (select 1 from public.inventory_reservations r where r.inventory_item_id = ii.id)
      and not exists (select 1 from public.layaway_ledger l where l.inventory_item_id = ii.id)
      and not exists (select 1 from public.layaway_ledger_items li where li.inventory_item_id = ii.id)
  )
  select jsonb_build_object(
    'generated_at', now(),
    'orphan_completed_count', (select count(*) from orphan_completed),
    'orphan_committed_count', (select count(*) from orphan_committed),
    'orphan_completed', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'item_code', item_code, 'updated_at', updated_at) order by item_code), '[]') from orphan_completed),
    'orphan_committed', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'item_code', item_code, 'updated_at', updated_at) order by item_code), '[]') from orphan_committed)
  ) into v_result;

  return v_result;
end;
$function$;

grant execute on function public.inventory_integrity_report() to authenticated;
