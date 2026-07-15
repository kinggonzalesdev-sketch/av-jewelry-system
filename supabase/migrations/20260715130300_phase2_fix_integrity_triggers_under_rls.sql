-- ============================================================================
-- Phase 2 — Corrective forward migration: integrity triggers under RLS
-- ----------------------------------------------------------------------------
-- Phase 1 is merged, so its migrations are not edited. This corrects them
-- forward (ADR §12: correct forward, never rewrite applied history).
--
-- THE BUG
-- -------
-- `enforce_reservation_rules` and `enforce_selected_admin_limit` were written as
-- SECURITY INVOKER. That was correct while Phase 1 had no policies, because the
-- only callers were privileged. Once Phase 2 added permission-aware RLS, both
-- broke in ways that only surfaced under a real, non-privileged user:
--
-- 1. `SELECT ... FOR UPDATE` on inventory_items applies the caller's *UPDATE*
--    policy for row locking. A user holding confirm_claim_print_label but not an
--    inventory-update permission had the row filtered out, so `quantity_total`
--    came back NULL and the trigger raised "Inventory item does not exist" — for
--    an item that plainly exists. That is a misleading error, and it would have
--    made legitimate claim confirmation impossible in Phase 3.
--
-- 2. `enforce_selected_admin_limit` counted staff_profiles under the caller's
--    RLS. A caller who can only see their own profile counts zero existing
--    admins, so the cap would not compute correctly. RLS happens to reject those
--    writes anyway, but an integrity check must not depend on the caller's
--    row visibility to be correct.
--
-- THE FIX
-- -------
-- Both run as SECURITY DEFINER with `search_path = ''`. This is narrow and
-- justified: an integrity check must see the true state of the data, not a
-- filtered view of it. Neither function grants anything — they only ever REJECT.
-- The permission gate is unaffected: a BEFORE trigger runs before the RLS WITH
-- CHECK, so an unauthorized INSERT is still refused by the policy afterwards.
-- ============================================================================

create or replace function app_private.enforce_reservation_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_claim_status text;
  v_claim_item uuid;
  v_total integer;
  v_reserved integer;
begin
  -- Serialize concurrent reservations for THIS item. Runs as definer so the lock
  -- reflects real data rather than the caller's row-level visibility.
  select i.quantity_total into v_total
  from public.inventory_items i
  where i.id = new.inventory_item_id
  for update;

  if v_total is null then
    raise exception 'Inventory item % does not exist', new.inventory_item_id
      using errcode = 'foreign_key_violation';
  end if;

  -- RULE: a reservation may exist ONLY for a Confirmed Claim.
  select c.status, c.inventory_item_id into v_claim_status, v_claim_item
  from public.claims c
  where c.id = new.claim_id;

  if v_claim_status is null then
    raise exception 'Claim % does not exist', new.claim_id
      using errcode = 'foreign_key_violation';
  end if;

  if v_claim_status is distinct from 'confirmed_claim' then
    raise exception
      'Only a Confirmed Claim may hold an inventory reservation (claim status: %). A Pending Claim reserves nothing (Bible §22.3).',
      v_claim_status
      using errcode = 'check_violation';
  end if;

  -- RULE: the claim's item and the reservation's item must agree.
  if v_claim_item is distinct from new.inventory_item_id then
    raise exception 'Reservation item does not match the claim''s item'
      using errcode = 'check_violation';
  end if;

  -- RULE: confirmed quantity must never exceed available quantity (Bible §19.8).
  select coalesce(sum(r.quantity), 0) into v_reserved
  from public.inventory_reservations r
  where r.inventory_item_id = new.inventory_item_id
    and r.state in ('provisional', 'committed')
    and r.id <> new.id;

  if v_reserved + new.quantity > v_total then
    raise exception
      'Reservation would exceed available quantity for item % (total %, already reserved %, requested %). Excess belongs on the waitlist (Bible §19.8, §19.9).',
      new.inventory_item_id, v_total, v_reserved, new.quantity
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_reservation_rules() is
  'Reserve-exactly-once + no-oversell guard. SECURITY DEFINER so the FOR UPDATE lock and the availability sum reflect real data, not the caller''s RLS view. Rejects only; grants nothing.';

create or replace function app_private.enforce_selected_admin_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if new.role_key <> 'selected_admin' or new.is_active = false then
    return new;
  end if;

  -- Serialize concurrent promotions; without this, two simultaneous inserts
  -- could each see one existing admin and both succeed, yielding three.
  lock table public.staff_profiles in exclusive mode;

  -- Runs as definer: the count must be the TRUE number of active admins, not
  -- however many happen to be visible to the caller.
  select count(*) into v_count
  from public.staff_profiles
  where role_key = 'selected_admin'
    and is_active = true
    and id <> new.id;

  if v_count >= 2 then
    raise exception 'A maximum of two active Selected Admin accounts is permitted (Bible §5.4)'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function app_private.enforce_selected_admin_limit() is
  'Caps active Selected Admins at two (Bible §5.4). SECURITY DEFINER so the count is the true count regardless of the caller''s RLS visibility.';

-- `available_quantity` stays SECURITY INVOKER on purpose: it is a read helper,
-- and a caller seeing only what their policies permit is the correct behaviour
-- for a read. It performs no locking, so RLS filtering cannot corrupt an
-- integrity decision here.
