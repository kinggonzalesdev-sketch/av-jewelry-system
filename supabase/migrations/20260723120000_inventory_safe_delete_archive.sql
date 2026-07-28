-- ============================================================================
-- Inventory safe delete & archive (Inventory Safe-Delete spec §1–§9).
--
-- The Delete action is for INCORRECTLY ENCODED / DUPLICATE / TEST records — never
-- a way to erase real business or financial history. So:
--
--   * Soft ARCHIVE is the default. It sets is_archived = true and NEVER touches
--     availability_status or any link, so it destroys nothing, cannot trip the
--     return-to-available guard, and is fully reversible. An archived item leaves
--     Active Inventory and becomes unavailable (available_quantity() = 0), so it
--     cannot be mined, reserved, or ordered.
--   * PERMANENT delete is Owner-only, requires the item be already archived AND
--     have ZERO dependencies (no claim / order / reservation / batch / RTS). The
--     audit_events row survives the delete (no FK), so history is preserved.
--
-- Every mutating function is SECURITY DEFINER and does its OWN permission check —
-- a direct RPC call cannot bypass it (same pattern as complete_order_fulfillment).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Archive metadata on inventory_items.
-- ----------------------------------------------------------------------------
alter table public.inventory_items
  add column is_archived boolean not null default false,
  add column archived_at timestamptz,
  add column archived_by uuid references public.staff_profiles (id) on delete restrict,
  add column archive_reason_code text check (
    archive_reason_code is null or archive_reason_code in (
      'incorrectly_encoded',
      'duplicate_entry',
      'test_record',
      'wrong_excel_import',
      'other'
    )
  ),
  add column archive_reason_detail text,
  -- The availability_status the item held at archive time. Archive does not change
  -- availability_status, so this is a faithful snapshot for the Archived view's
  -- "Original Status" column and documents what Restore returns the item to.
  add column archived_from_status text;

-- Archived rows carry their who / when / why; non-archived rows carry none. And
-- 'other' demands a written explanation (spec §2).
alter table public.inventory_items
  add constraint inventory_items_archive_consistency_ck check (
    (is_archived = false
       and archived_at is null
       and archived_by is null
       and archive_reason_code is null
       and archived_from_status is null)
    or
    (is_archived = true
       and archived_at is not null
       and archived_by is not null
       and archive_reason_code is not null
       and archived_from_status is not null
       and (archive_reason_code <> 'other'
            or length(trim(coalesce(archive_reason_detail, ''))) > 0))
  );

create index inventory_items_archived_idx
  on public.inventory_items (is_archived, archived_at desc);

comment on column public.inventory_items.is_archived is
  'Soft-delete flag (Inventory Safe-Delete spec §4). An archived item leaves Active Inventory and is never available — but the row and all its links are preserved.';

-- ----------------------------------------------------------------------------
-- 2. Availability: an archived item is NEVER available (spec §4). Same no-oversell
--    guarantee as completed/released — derived, never a stored counter.
-- ----------------------------------------------------------------------------
create or replace function app_private.available_quantity(p_item_id uuid)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    -- Archived (incorrect / duplicate / test) items are out of circulation.
    when i.is_archived then 0
    -- Sold / released items are historical — never available (spec §4/§7).
    when i.availability_status in ('completed', 'released') then 0
    else i.quantity_total - coalesce((
      select sum(r.quantity)
      from public.inventory_reservations r
      where r.inventory_item_id = p_item_id
        and r.state in ('provisional', 'committed')
    ), 0)
  end
  from public.inventory_items i
  where i.id = p_item_id;
$$;

comment on function app_private.available_quantity(uuid) is
  'Available = total - (provisional + committed). ALWAYS 0 for archived and for completed/released items (never oversell). Derived, never stored.';

-- ----------------------------------------------------------------------------
-- 3. Active Inventory monitor EXCLUDES archived items (spec §4/§5). Archived items
--    are read separately through their own authorized view.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_monitor()
returns table (
  inventory_item_id uuid,
  item_code text,
  item_name text,
  availability_status text,
  quantity_total integer,
  available_quantity integer,
  reserved_quantity integer,
  in_rts_review boolean,
  is_forfeited boolean
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    i.id,
    i.item_code,
    i.item_name,
    i.availability_status,
    i.quantity_total,
    app_private.available_quantity(i.id),
    i.quantity_total - app_private.available_quantity(i.id),
    exists (
      select 1 from public.returned_to_stock_reviews r
      where r.inventory_item_id = i.id and r.status = 'in_review'
    ),
    exists (
      select 1
      from public.layaway_arrangements l
      join public.official_orders o on o.id = l.official_order_id
      join public.official_order_claims ooc on ooc.official_order_id = o.id
      join public.claims c on c.id = ooc.claim_id
      where c.inventory_item_id = i.id and l.status = 'forfeited'
    )
  from public.inventory_items i
  where not i.is_archived;
$$;

comment on function public.inventory_monitor() is
  'Bible §20.3: available vs remaining. EXCLUDES archived items (spec §4). Available is derived from reservations, never a stored counter.';

revoke all on function public.inventory_monitor() from anon;
grant execute on function public.inventory_monitor() to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Dependency check (spec §3). Returns one row per business record connected to
--    the item, so the UI can name exactly why a permanent delete is blocked
--    ("connected to Order ORD-2026-000123") and offer the safer action.
--
--    SECURITY DEFINER so it can see across tables regardless of the caller's RLS,
--    with its OWN permission gate. `is_active` marks a live/in-flight link
--    (active reservation, or a not-completed order) — those also block ARCHIVE.
-- ----------------------------------------------------------------------------
create or replace function public.inventory_item_dependencies(p_item_id uuid)
returns table (
  dependency_kind text,
  reference_label text,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app_private.has_permission('inventory_monitoring') then
    raise exception 'Not authorized: the inventory_monitoring permission is required.';
  end if;

  return query
  -- Official Orders (covers invoice / payment / layaway / fulfillment / customer,
  -- which all hang off the order) — the strongest, financial link.
  select 'order'::text,
         coalesce(o.order_number, o.invoice_number, o.id::text),
         (o.status is distinct from 'completed'
          and o.status is distinct from 'cancelled')
  from public.official_orders o
  join public.official_order_claims ooc on ooc.official_order_id = o.id
  join public.claims c on c.id = ooc.claim_id
  where c.inventory_item_id = p_item_id

  union all
  -- Claims not attached to any official order (captured but never invoiced). Not
  -- in-flight (is_active = false): archive is allowed, but the claim link still
  -- blocks a PERMANENT delete.
  select 'claim'::text, coalesce(c.claim_reference, c.id::text), false
  from public.claims c
  where c.inventory_item_id = p_item_id
    and not exists (
      select 1 from public.official_order_claims ooc where ooc.claim_id = c.id
    )

  union all
  -- Reservations — an active (provisional/committed) reservation is in-flight.
  select 'reservation'::text,
         r.state,
         (r.state in ('provisional', 'committed'))
  from public.inventory_reservations r
  where r.inventory_item_id = p_item_id

  union all
  -- Live batch presentation.
  select 'live_batch'::text, coalesce(lb.batch_reference, lb.id::text), false
  from public.live_batch_items lbi
  join public.live_batches lb on lb.id = lbi.live_batch_id
  where lbi.inventory_item_id = p_item_id

  union all
  -- Returned-to-Stock reviews (any state).
  select 'rts_review'::text, rts.status, (rts.status = 'in_review')
  from public.returned_to_stock_reviews rts
  where rts.inventory_item_id = p_item_id

  union all
  -- A completed/released/sold sale on the item itself.
  select 'completed_sale'::text, i.availability_status, false
  from public.inventory_items i
  where i.id = p_item_id
    and i.availability_status in ('completed', 'released', 'sold_released');
end;
$$;

comment on function public.inventory_item_dependencies(uuid) is
  'Inventory Safe-Delete spec §3: business records connected to an item. Any row blocks PERMANENT delete; an is_active row also blocks ARCHIVE. Names the reference so the UI can explain the block.';

revoke all on function public.inventory_item_dependencies(uuid) from anon;
grant execute on function public.inventory_item_dependencies(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Archive (soft delete). Permission-gated. Blocked for completed/released items
--    (those are historical — use Return-to-Stock Review) and for items with an
--    ACTIVE in-flight link (active reservation / not-completed order), which must
--    not be hidden mid-transaction. Otherwise allowed and fully reversible.
-- ----------------------------------------------------------------------------
create or replace function public.archive_inventory_item(
  p_item_id uuid,
  p_reason_code text,
  p_reason_detail text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_archived boolean;
  v_active_links int;
begin
  if not app_private.has_permission('inventory_monitoring') then
    raise exception 'Not authorized: the inventory_monitoring permission is required. No record was changed.';
  end if;

  if p_reason_code is null or p_reason_code not in (
    'incorrectly_encoded', 'duplicate_entry', 'test_record', 'wrong_excel_import', 'other'
  ) then
    raise exception 'A valid deletion reason is required.';
  end if;
  if p_reason_code = 'other'
     and length(trim(coalesce(p_reason_detail, ''))) = 0 then
    raise exception 'Select "Other" requires a written explanation.';
  end if;

  select availability_status, is_archived
    into v_status, v_archived
  from public.inventory_items
  where id = p_item_id;

  if v_status is null then
    raise exception 'Inventory item not found.';
  end if;
  if v_archived then
    raise exception 'This item is already archived.';
  end if;
  if v_status in ('completed', 'released', 'sold_released') then
    raise exception 'A completed, released, or sold item is historical and cannot be archived as an encoding error. Use Return to Stock Review instead.';
  end if;

  -- An active, in-flight link (active reservation or a not-completed order) must
  -- not be hidden. The dependency reader marks those is_active.
  select count(*) into v_active_links
  from public.inventory_item_dependencies(p_item_id) d
  where d.is_active;

  if v_active_links > 0 then
    raise exception 'This item is part of an in-flight order, reservation, or review and cannot be archived. Correct the item details, or resolve the in-flight record first.';
  end if;

  update public.inventory_items
    set is_archived = true,
        archived_at = now(),
        archived_by = app_private.current_staff_id(),
        archive_reason_code = p_reason_code,
        archive_reason_detail = nullif(trim(coalesce(p_reason_detail, '')), ''),
        archived_from_status = v_status
    where id = p_item_id;
end;
$$;

comment on function public.archive_inventory_item(uuid, text, text) is
  'Inventory Safe-Delete spec §2/§4: soft-archive an incorrect/duplicate/test item. Reversible; leaves availability_status and all links untouched. Blocked for completed/released items and in-flight links.';

revoke all on function public.archive_inventory_item(uuid, text, text) from anon;
grant execute on function public.archive_inventory_item(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Restore (spec §6). Duplicate-code guarded: refuses if another NON-archived
--    item now uses the same item_code. Returns the item to its exact prior status
--    (availability_status was never changed), never blindly to 'available'.
-- ----------------------------------------------------------------------------
create or replace function public.restore_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived boolean;
  v_code text;
  v_dupe int;
begin
  if not app_private.has_permission('inventory_monitoring') then
    raise exception 'Not authorized: the inventory_monitoring permission is required. No record was changed.';
  end if;

  select is_archived, item_code
    into v_archived, v_code
  from public.inventory_items
  where id = p_item_id;

  if v_archived is null then
    raise exception 'Inventory item not found.';
  end if;
  if not v_archived then
    raise exception 'This item is not archived.';
  end if;

  -- Another active item may have taken this code while it was archived (spec §6).
  select count(*) into v_dupe
  from public.inventory_items i
  where i.id <> p_item_id
    and not i.is_archived
    and lower(i.item_code) = lower(v_code);

  if v_dupe > 0 then
    raise exception 'Another active item now uses the code %. Resolve the duplicate before restoring.', v_code;
  end if;

  update public.inventory_items
    set is_archived = false,
        archived_at = null,
        archived_by = null,
        archive_reason_code = null,
        archive_reason_detail = null,
        archived_from_status = null
    where id = p_item_id;
end;
$$;

comment on function public.restore_inventory_item(uuid) is
  'Inventory Safe-Delete spec §6: restore an archived item to its exact prior status. Blocked if another active item now uses the same code.';

revoke all on function public.restore_inventory_item(uuid) from anon;
grant execute on function public.restore_inventory_item(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Permanent delete (spec §4). Owner-only, and only for a record that is ALREADY
--    archived AND has ZERO dependencies — a truly isolated test/incorrect row.
--    The audit_events trail (written by the TS layer) has no FK to the item, so it
--    survives the delete: history is preserved even when the row is gone.
-- ----------------------------------------------------------------------------
create or replace function public.permanently_delete_inventory_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_archived boolean;
  v_deps int;
begin
  -- Owner-only: the highest authority approves permanent deletion (spec §8).
  if app_private.current_staff_role() is distinct from 'owner' then
    raise exception 'Not authorized: permanent deletion is reserved to the Owner. No record was changed.';
  end if;

  select is_archived into v_archived
  from public.inventory_items
  where id = p_item_id;

  if v_archived is null then
    raise exception 'Inventory item not found.';
  end if;
  if not v_archived then
    raise exception 'Only an archived item may be permanently deleted. Archive it first.';
  end if;

  -- Last line of defence: never delete a record with any business dependency.
  select count(*) into v_deps
  from public.inventory_item_dependencies(p_item_id) d;

  if v_deps > 0 then
    raise exception 'This item cannot be permanently deleted because it is connected to % business record(s). It stays archived.', v_deps;
  end if;

  -- Item photos are metadata pointers with an on-delete-restrict FK; clear them so
  -- the isolated row can be removed. (Storage objects are managed separately.)
  delete from public.item_photos where inventory_item_id = p_item_id;
  delete from public.inventory_items where id = p_item_id;
end;
$$;

comment on function public.permanently_delete_inventory_item(uuid) is
  'Inventory Safe-Delete spec §4/§8: Owner-only hard delete of an ALREADY-ARCHIVED, dependency-free isolated record. The audit trail (no FK) survives.';

revoke all on function public.permanently_delete_inventory_item(uuid) from anon;
grant execute on function public.permanently_delete_inventory_item(uuid) to authenticated;
