-- Controlled Layaway Ledger forfeiture (Owner request 2026-09-21).
--
-- One SECURITY DEFINER transaction performs the complete state change:
--   * preserve the ledger, payments, Layaway Code text and item links for history;
--   * mark the ledger forfeited;
--   * release only reservations owned by the converted order for this ledger;
--   * return every distinct linked inventory row to Available through an attributed,
--     approved Returned-to-Stock record;
--   * release only this ledger's active Layaway Code assignment; and
--   * append one success audit event containing the actor and released identifiers.
--
-- The ledger row is locked first, making a retry/concurrent double-click idempotent.
-- Any exception rolls back every change above, including the audit event.

-- Several Layaway Ledger objects predate this repository and exist only in the live schema.
-- Fail with one readable inventory of missing dependencies before creating an index/function,
-- rather than stopping later on the first opaque undefined-table/column error.
do $preflight$
declare
  v_missing text;
  v_duplicate_codes text;
  v_duplicate_refs text;
  v_mismatched_assignments text;
begin
  select string_agg(format('%I.%I', expected.table_name, expected.column_name), ', '
                    order by expected.table_name, expected.column_name)
    into v_missing
  from (values
    ('layaway_ledger', 'id'),
    ('layaway_ledger', 'status'),
    ('layaway_ledger', 'inventory_item_id'),
    ('layaway_ledger', 'layaway_code'),
    ('layaway_ledger_items', 'ledger_id'),
    ('layaway_ledger_items', 'inventory_item_id'),
    ('layaway_arrangements', 'official_order_id'),
    ('layaway_arrangements', 'status'),
    ('layaway_code_pool', 'code'),
    ('layaway_code_pool', 'ref'),
    ('inventory_items', 'id'),
    ('inventory_items', 'item_code'),
    ('inventory_items', 'availability_status'),
    ('inventory_items', 'is_archived'),
    ('inventory_items', 'quantity_total'),
    ('inventory_items', 'facebook_name'),
    ('inventory_items', 'custody_holder'),
    ('inventory_items', 'custody_handler_id'),
    ('inventory_items', 'custody_updated_at'),
    ('inventory_items', 'custody_updated_by'),
    ('inventory_reservations', 'id'),
    ('inventory_reservations', 'inventory_item_id'),
    ('inventory_reservations', 'claim_id'),
    ('inventory_reservations', 'quantity'),
    ('inventory_reservations', 'state'),
    ('inventory_reservations', 'released_at'),
    ('inventory_reservations', 'released_reason'),
    ('claims', 'id'),
    ('claims', 'inventory_item_id'),
    ('claims', 'status'),
    ('claims', 'status_reason'),
    ('official_orders', 'id'),
    ('official_orders', 'status'),
    ('official_orders', 'converted_to_layaway'),
    ('official_orders', 'converted_layaway_ledger_id'),
    ('official_orders', 'cancellation_approval_request_id'),
    ('official_orders', 'cancelled_at'),
    ('official_orders', 'cancelled_reason'),
    ('official_order_claims', 'official_order_id'),
    ('official_order_claims', 'claim_id'),
    ('fulfillment_records', 'official_order_id'),
    ('fulfillment_records', 'status'),
    ('returned_to_stock_reviews', 'inventory_item_id'),
    ('returned_to_stock_reviews', 'inventory_reservation_id'),
    ('returned_to_stock_reviews', 'trigger_kind'),
    ('returned_to_stock_reviews', 'status'),
    ('returned_to_stock_reviews', 'quantity'),
    ('returned_to_stock_reviews', 'reviewed_at'),
    ('returned_to_stock_reviews', 'reviewed_by'),
    ('returned_to_stock_reviews', 'review_note'),
    ('returned_to_stock_reviews', 'freed_unit_outcome'),
    ('returned_to_stock_reviews', 'freed_unit_note'),
    ('owner_approval_requests', 'id'),
    ('owner_approval_requests', 'action_kind'),
    ('owner_approval_requests', 'status'),
    ('owner_approval_requests', 'entity_type'),
    ('owner_approval_requests', 'entity_id'),
    ('owner_approval_requests', 'reason'),
    ('owner_approval_requests', 'requested_by'),
    ('owner_approval_requests', 'decided_at'),
    ('owner_approval_requests', 'decided_by'),
    ('owner_approval_requests', 'decision_note'),
    ('owner_approval_requests', 'executed_at'),
    ('owner_approval_requests', 'executed_by'),
    ('staff_profiles', 'id'),
    ('staff_profiles', 'full_name'),
    ('audit_events', 'actor_auth_uid'),
    ('audit_events', 'actor_kind'),
    ('audit_events', 'actor_label'),
    ('audit_events', 'action'),
    ('audit_events', 'entity_type'),
    ('audit_events', 'entity_id'),
    ('audit_events', 'outcome'),
    ('audit_events', 'reason'),
    ('audit_events', 'context')
  ) as expected(table_name, column_name)
  left join information_schema.columns actual
    on actual.table_schema = 'public'
   and actual.table_name = expected.table_name
   and actual.column_name = expected.column_name
  where actual.column_name is null;

  if v_missing is not null then
    raise exception 'Layaway forfeiture migration cannot apply; missing dependencies: %.', v_missing
      using errcode = 'undefined_column',
            hint = 'Reconcile the live-only Layaway Ledger schema before applying this migration.';
  end if;

  if to_regprocedure('app_private.is_owner()') is null
     or to_regprocedure('app_private.current_staff_id()') is null then
    raise exception
      'Layaway forfeiture migration cannot apply; app_private.is_owner() or app_private.current_staff_id() is missing.'
      using errcode = 'undefined_function';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class relation on relation.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'layaway_ledger'
      and constraint_row.contype = 'c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%forfeited%'
  ) then
    raise exception
      'Layaway forfeiture migration cannot apply; layaway_ledger has no CHECK constraint accepting forfeited.'
      using errcode = 'check_violation';
  end if;

  select string_agg(format('%L (%s rows)', duplicate.normalized_code, duplicate.row_count), ', '
                    order by duplicate.normalized_code)
    into v_duplicate_codes
  from (
    select lower(btrim(code)) as normalized_code, count(*) as row_count
    from public.layaway_code_pool
    group by lower(btrim(code))
    having count(*) > 1
    order by lower(btrim(code))
    limit 20
  ) duplicate;

  if v_duplicate_codes is not null then
    raise exception 'Layaway Code pool has duplicate normalized codes: %.', v_duplicate_codes
      using errcode = 'unique_violation',
            hint = 'Resolve these active assignments before adding the case-insensitive unique index.';
  end if;

  select string_agg(format('%L (%s rows)', duplicate.ref, duplicate.row_count), ', '
                    order by duplicate.ref)
    into v_duplicate_refs
  from (
    select ref, count(*) as row_count
    from public.layaway_code_pool
    where ref is not null
    group by ref
    having count(*) > 1
    order by ref
    limit 20
  ) duplicate;

  if v_duplicate_refs is not null then
    raise exception 'Layaway Code pool has refs holding more than one active code: %.', v_duplicate_refs
      using errcode = 'unique_violation',
            hint = 'Resolve these active assignments before adding the one-code-per-ref unique index.';
  end if;

  -- The pool is authoritative for current assignments while layaway_ledger keeps the
  -- historical display value. Prove every open ledger has exactly the matching pool row
  -- before the migration relies on that separation. This detects missing, swapped and
  -- untracked assignments without rewriting any production data.
  select string_agg(
           format('%s (ledger code %L; pool code %L)', mismatch.id,
                  mismatch.layaway_code, mismatch.pool_code),
           ', ' order by mismatch.id
         )
    into v_mismatched_assignments
  from (
    select l.id, l.layaway_code, p.code as pool_code
    from public.layaway_ledger l
    left join public.layaway_code_pool p
      on p.ref = 'ledger:' || l.id::text
    where lower(coalesce(l.status, '')) in
            ('active', 'overdue', 'grace_period', 'forfeiture_eligible')
      and (
        (l.layaway_code is null and p.ref is not null)
        or (
          l.layaway_code is not null
          and (
            p.ref is null
            or lower(btrim(p.code)) is distinct from lower(btrim(l.layaway_code))
          )
        )
      )
    order by l.id
    limit 20
  ) mismatch;

  if v_mismatched_assignments is not null then
    raise exception
      'Open Layaway Ledger code assignments do not match their historical codes: %.',
      v_mismatched_assignments
      using errcode = 'check_violation',
            hint = 'Reconcile each ledger:<uuid> pool ref with layaway_ledger.layaway_code before applying this migration.';
  end if;
end;
$preflight$;

-- The pool is the active-assignment registry; layaway_ledger.layaway_code is historical.
-- Protect both sides explicitly because the pool's original live DDL predates this repository.
create unique index if not exists layaway_code_pool_code_ci_uidx
  on public.layaway_code_pool (lower(btrim(code)));

create unique index if not exists layaway_code_pool_ref_uidx
  on public.layaway_code_pool (ref)
  where ref is not null;

-- IF NOT EXISTS trusts only an object's name. Prove a pre-existing same-named index has the
-- exact relation, uniqueness, key and predicate this workflow relies on.
do $index_guard$
declare
  v_unique boolean;
  v_valid boolean;
  v_ready boolean;
  v_table text;
  v_key text;
  v_predicate text;
  v_key_count integer;
begin
  select idx.indisunique, idx.indisvalid, idx.indisready, table_relation.relname,
         pg_get_indexdef(idx.indexrelid, 1, true),
         pg_get_expr(idx.indpred, idx.indrelid), idx.indnkeyatts
    into v_unique, v_valid, v_ready, v_table, v_key, v_predicate, v_key_count
  from pg_index idx
  join pg_class index_relation on index_relation.oid = idx.indexrelid
  join pg_namespace index_namespace on index_namespace.oid = index_relation.relnamespace
  join pg_class table_relation on table_relation.oid = idx.indrelid
  join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
  where index_namespace.nspname = 'public'
    and index_relation.relname = 'layaway_code_pool_code_ci_uidx'
    and table_namespace.nspname = 'public';

  if not found
     or not v_unique or not v_valid or not v_ready
     or v_table <> 'layaway_code_pool' or v_key_count <> 1
     or regexp_replace(lower(coalesce(v_key, '')), '[[:space:]]', '', 'g')
          <> 'lower(btrim(code))'
     or v_predicate is not null then
    raise exception
      'layaway_code_pool_code_ci_uidx exists but does not enforce UNIQUE lower(btrim(code)) on public.layaway_code_pool.'
      using errcode = 'invalid_object_definition';
  end if;

  select idx.indisunique, idx.indisvalid, idx.indisready, table_relation.relname,
         pg_get_indexdef(idx.indexrelid, 1, true),
         pg_get_expr(idx.indpred, idx.indrelid), idx.indnkeyatts
    into v_unique, v_valid, v_ready, v_table, v_key, v_predicate, v_key_count
  from pg_index idx
  join pg_class index_relation on index_relation.oid = idx.indexrelid
  join pg_namespace index_namespace on index_namespace.oid = index_relation.relnamespace
  join pg_class table_relation on table_relation.oid = idx.indrelid
  join pg_namespace table_namespace on table_namespace.oid = table_relation.relnamespace
  where index_namespace.nspname = 'public'
    and index_relation.relname = 'layaway_code_pool_ref_uidx'
    and table_namespace.nspname = 'public';

  if not found
     or not v_unique or not v_valid or not v_ready
     or v_table <> 'layaway_code_pool' or v_key_count <> 1
     or lower(coalesce(v_key, '')) <> 'ref'
     or regexp_replace(lower(coalesce(v_predicate, '')), '[[:space:]()]', '', 'g')
          <> 'refisnotnull' then
    raise exception
      'layaway_code_pool_ref_uidx exists but does not enforce one non-null active code per ref on public.layaway_code_pool.'
      using errcode = 'invalid_object_definition';
  end if;
end;
$index_guard$;

-- A confirmed, Owner-attributed forfeiture disposition is now an approved way back to
-- Available Inventory. Other stock returns still require an approved RTS review, and a
-- forfeited legacy arrangement without this explicit disposition remains blocked.
create or replace function app_private.enforce_return_to_available()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_approved integer;
  v_forfeited integer;
  v_forfeiture_return integer;
begin
  if new.availability_status not in ('available', 'returned_to_available')
     or old.availability_status = new.availability_status then
    return new;
  end if;

  if old.availability_status = 'held_unavailable'
     or old.availability_status in ('provisionally_reserved', 'committed',
                                    'sold_released', 'in_returned_to_stock_review',
                                    'completed', 'released') then
    select count(*)::int into v_forfeited
    from public.layaway_arrangements l
    join public.official_orders o on o.id = l.official_order_id
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    where c.inventory_item_id = new.id
      and l.status = 'forfeited';

    select count(*)::int,
           count(*) filter (
             where r.trigger_kind = 'layaway_forfeited_disposition'
               and r.freed_unit_outcome = 'returned_to_available'
           )::int
      into v_approved, v_forfeiture_return
    from public.returned_to_stock_reviews r
    where r.inventory_item_id = new.id
      and r.status = 'approved_return';

    if v_forfeited > 0 and v_forfeiture_return = 0 then
      raise exception
        'That forfeited item has no approved forfeiture disposition returning it to inventory.'
        using errcode = 'check_violation';
    end if;

    if v_approved = 0 then
      raise exception
        'Stock returns to available only through an approved Returned-to-Stock Review. No review has approved this item.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$function$;

comment on function app_private.enforce_return_to_available() is
  'Stock returns require an approved RTS review. A confirmed Owner-attributed layaway forfeiture disposition may explicitly return the item; no scheduled or implicit forfeiture return is allowed.';

create or replace function public.forfeit_layaway_ledger(p_ledger_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ledger public.layaway_ledger%rowtype;
  v_actor_auth uuid := (select auth.uid());
  v_staff uuid;
  v_actor_label text;
  v_item_ids uuid[] := array[]::uuid[];
  v_item_codes text[] := array[]::text[];
  v_releasable_item_ids uuid[] := array[]::uuid[];
  v_already_available_item_ids uuid[] := array[]::uuid[];
  v_terminal_items text;
  v_invalid_items text;
  v_order_ids uuid[] := array[]::uuid[];
  v_order_approval_ids uuid[] := array[]::uuid[];
  v_withdrawn_claim_ids uuid[] := array[]::uuid[];
  v_released_reservation_ids uuid[] := array[]::uuid[];
  v_order_id uuid;
  v_order_status text;
  v_order_approval_id uuid;
  v_primary_reservation uuid;
  v_quantity integer;
  v_inventory_quantity integer;
  v_item_id uuid;
  v_assigned_code text;
  v_assignment_found boolean := false;
  v_code_assignments_deleted integer := 0;
  v_returned integer := 0;
begin
  if not app_private.is_owner() then
    raise exception 'Not authorized: Layaway forfeiture is reserved to the Owner. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_ledger_id is null then
    raise exception 'A layaway account is required.' using errcode = 'check_violation';
  end if;

  select * into v_ledger
  from public.layaway_ledger
  where id = p_ledger_id
  for update;

  if v_ledger.id is null then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;

  -- A retry is a successful no-op. Repair a stale assignment for this same historical
  -- ledger if one exists, but never touch a code that has since been assigned to another ref.
  if lower(coalesce(v_ledger.status, '')) = 'forfeited' then
    perform pg_advisory_xact_lock(hashtext('layaway_code_pool'));

    select p.code into v_assigned_code
    from public.layaway_code_pool p
    where p.ref = 'ledger:' || p_ledger_id::text
    for update;
    v_assignment_found := found;

    if v_assignment_found and (
      v_ledger.layaway_code is null
      or lower(btrim(v_assigned_code)) is distinct from lower(btrim(v_ledger.layaway_code))
    ) then
      raise exception
        'Layaway Code assignment mismatch for forfeited ledger %. Historical code is %, but its active pool ref holds %. Nothing was changed.',
        p_ledger_id, coalesce(v_ledger.layaway_code, '(none)'), coalesce(v_assigned_code, '(none)')
        using errcode = 'check_violation';
    end if;

    delete from public.layaway_code_pool
    where ref = 'ledger:' || p_ledger_id::text
      and lower(btrim(code)) = lower(btrim(v_ledger.layaway_code));
    return jsonb_build_object(
      'ledger_id', p_ledger_id,
      'status', 'forfeited',
      'changed', false,
      'deduplicated', true,
      'released_items', 0,
      'layaway_code', v_ledger.layaway_code
    );
  end if;

  if lower(coalesce(v_ledger.status, '')) not in
       ('active', 'overdue', 'grace_period', 'forfeiture_eligible') then
    raise exception 'A % layaway account cannot be forfeited.', coalesce(v_ledger.status, 'status-less')
      using errcode = 'check_violation';
  end if;

  v_staff := app_private.current_staff_id();
  select sp.full_name into v_actor_label
  from public.staff_profiles sp
  where sp.id = v_staff;

  select coalesce(array_agg(o.id order by o.id), array[]::uuid[])
    into v_order_ids
  from public.official_orders o
  where o.converted_layaway_ledger_id = p_ledger_id;

  -- A converted source order is historical after forfeiture. Lock it and later mark it
  -- cancelled with a real Owner approval so a bookmarked Order Details screen cannot ship,
  -- complete or otherwise act on an item that has returned to stock.
  perform 1
  from public.official_orders o
  where o.id = any(v_order_ids)
  order by o.id
  for update;

  if exists (
    select 1
    from public.official_orders o
    left join public.fulfillment_records f on f.official_order_id = o.id
    where o.id = any(v_order_ids)
      and (
        (not coalesce(o.converted_to_layaway, false) and o.status <> 'cancelled')
        or o.status in ('completed', 'closed', 'delivered', 'picked_up', 'released',
                        'dispatched_or_picked_up')
        or f.status in ('dispatched', 'delivered', 'picked_up', 'released')
      )
  ) then
    raise exception 'The converted source order has already entered fulfillment. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  -- Resolve the three supported item-link shapes and deduplicate the physical rows.
  with item_links as (
    select v_ledger.inventory_item_id as inventory_item_id
    union
    select li.inventory_item_id
    from public.layaway_ledger_items li
    where li.ledger_id = p_ledger_id
    union
    select c.inventory_item_id
    from public.official_orders o
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    where o.converted_layaway_ledger_id = p_ledger_id
  ), linked_items as (
    select i.id, i.item_code
    from item_links l
    join public.inventory_items i on i.id = l.inventory_item_id
    where l.inventory_item_id is not null
  )
  select coalesce(array_agg(id order by id), array[]::uuid[]),
         coalesce(array_agg(item_code order by id), array[]::text[])
    into v_item_ids, v_item_codes
  from linked_items;

  -- Deterministic locks prevent concurrent sale/layaway assignment while this transaction
  -- proves that each item can safely return to the pool.
  perform 1
  from public.inventory_items i
  where i.id = any(v_item_ids)
  order by i.id
  for update;

  if exists (
    select 1 from public.inventory_items i
    where i.id = any(v_item_ids) and coalesce(i.is_archived, true)
  ) then
    raise exception 'An archived layaway item cannot be returned to Available Inventory. Restore the item first.'
      using errcode = 'check_violation';
  end if;

  -- A normal manual/order-derived layaway holds inventory as committed (older rows may still
  -- be provisionally_reserved). Already-available rows need no second RTS/update, but closing
  -- the stale ledger is safe and removes the duplicate logical hold. Terminal or unrelated
  -- states fail closed: forfeiture must never resurrect sold/completed/released inventory.
  select
    coalesce(array_agg(i.id order by i.id) filter (
      where i.availability_status in ('committed', 'provisionally_reserved')
    ), array[]::uuid[]),
    coalesce(array_agg(i.id order by i.id) filter (
      where i.availability_status in ('available', 'returned_to_available')
    ), array[]::uuid[]),
    string_agg(format('%s (%s)', coalesce(i.item_code, i.id::text), i.availability_status), ', '
               order by i.id) filter (
      where i.availability_status in ('completed', 'released', 'sold_released')
    ),
    string_agg(format('%s (%s)', coalesce(i.item_code, i.id::text), i.availability_status), ', '
               order by i.id) filter (
      where coalesce(i.availability_status, '') not in (
        'committed', 'provisionally_reserved', 'available', 'returned_to_available',
        'completed', 'released', 'sold_released'
      )
    )
    into v_releasable_item_ids, v_already_available_item_ids,
         v_terminal_items, v_invalid_items
  from public.inventory_items i
  where i.id = any(v_item_ids);

  if v_terminal_items is not null then
    raise exception
      'A linked Layaway item is already sold/completed/released and cannot be returned: %.',
      v_terminal_items
      using errcode = 'check_violation';
  end if;

  if v_invalid_items is not null then
    raise exception 'A linked Layaway item is not in a releasable inventory state: %.', v_invalid_items
      using errcode = 'check_violation';
  end if;

  -- A second open ledger link indicates corrupted/shared ownership. Abort rather than make
  -- stock available underneath that account.
  if exists (
    select 1
    from public.layaway_ledger l
    where l.id <> p_ledger_id
      and lower(coalesce(l.status, '')) not in ('completed', 'cancelled', 'forfeited', 'transferred')
      and l.inventory_item_id = any(v_item_ids)
  ) or exists (
    select 1
    from public.layaway_ledger_items li
    join public.layaway_ledger l on l.id = li.ledger_id
    where l.id <> p_ledger_id
      and lower(coalesce(l.status, '')) not in ('completed', 'cancelled', 'forfeited', 'transferred')
      and li.inventory_item_id = any(v_item_ids)
  ) then
    raise exception 'A linked item is also held by another open layaway. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.official_order_claims ooc
    join public.official_orders o on o.id = ooc.official_order_id
    join public.claims c on c.id = ooc.claim_id
    where c.inventory_item_id = any(v_item_ids)
      and o.id <> all(v_order_ids)
      and o.status <> 'cancelled'
  ) then
    raise exception 'A linked item also belongs to another non-cancelled order. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  -- Lock and release only reservations belonging to order(s) converted into THIS ledger.
  perform 1
  from public.inventory_reservations r
  join public.claims c on c.id = r.claim_id
  join public.official_order_claims ooc on ooc.claim_id = c.id
  join public.official_orders o on o.id = ooc.official_order_id
  where o.converted_layaway_ledger_id = p_ledger_id
    and r.state in ('provisional', 'committed')
  order by r.id
  for update of r;

  with released as (
    update public.inventory_reservations r
       set state = 'released',
           released_at = now(),
           released_reason = 'Layaway ledger ' || p_ledger_id::text || ' was forfeited.'
     where r.state in ('provisional', 'committed')
       and exists (
         select 1
         from public.official_order_claims ooc
         join public.official_orders o on o.id = ooc.official_order_id
         where ooc.claim_id = r.claim_id
           and o.converted_layaway_ledger_id = p_ledger_id
       )
    returning r.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_released_reservation_ids
  from released;

  -- No unrelated active reservation may survive on an item that is about to become sellable.
  if exists (
    select 1
    from public.inventory_reservations r
    where r.inventory_item_id = any(v_item_ids)
      and r.state in ('provisional', 'committed')
  ) then
    raise exception 'A linked item has another active reservation. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  -- Neutralize each converted source order without deleting any order, claim, invoice,
  -- payment or link. The Owner is requester, decider and executor, all attributed.
  foreach v_order_id in array v_order_ids loop
    select o.status into v_order_status
    from public.official_orders o
    where o.id = v_order_id;

    if v_order_status <> 'cancelled' then
      insert into public.owner_approval_requests (
        action_kind, status, entity_type, entity_id, reason,
        requested_by, decided_at, decided_by, decision_note, executed_at, executed_by
      ) values (
        'official_order_cancellation', 'approved', 'official_order', v_order_id,
        'Converted source order neutralized by an Owner-confirmed Layaway forfeiture.',
        v_staff, now(), v_staff,
        'Approved as part of the same atomic Layaway forfeiture transaction.',
        now(), v_staff
      ) returning id into v_order_approval_id;

      v_order_approval_ids := array_append(v_order_approval_ids, v_order_approval_id);

      update public.official_orders
         set status = 'cancelled',
             cancellation_approval_request_id = v_order_approval_id,
             cancelled_at = now(),
             cancelled_reason = 'Linked Layaway account was forfeited by the Owner.',
             converted_to_layaway = true
       where id = v_order_id;
    end if;
  end loop;

  with withdrawn as (
    update public.claims c
       set status = 'withdrawn_confirmed',
           status_reason = 'Converted source order was neutralized when Layaway ledger '
                           || p_ledger_id::text || ' was forfeited.'
     where c.status = 'confirmed_claim'
       and exists (
         select 1
         from public.official_order_claims ooc
         where ooc.claim_id = c.id
           and ooc.official_order_id = any(v_order_ids)
       )
    returning c.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_withdrawn_claim_ids
  from withdrawn;

  -- The success mutation is intentionally ordered inside one transaction: the RTS evidence
  -- exists before the guarded availability update, while the ledger/code/audit commit with it.
  foreach v_item_id in array v_releasable_item_ids loop
    select i.quantity_total into v_inventory_quantity
    from public.inventory_items i
    where i.id = v_item_id;

    select r.id into v_primary_reservation
    from public.inventory_reservations r
    where r.inventory_item_id = v_item_id
      and r.id = any(v_released_reservation_ids)
    order by r.id
    limit 1;

    select sum(r.quantity)::int into v_quantity
    from public.inventory_reservations r
    where r.inventory_item_id = v_item_id
      and r.id = any(v_released_reservation_ids);

    -- Manual Layaway Ledger creation has no reservation row and selects one Unique Code once;
    -- it is safe to infer one returned unit only for a single-unit inventory row. A multi-stock
    -- row without reservation quantity is ambiguous, so fail closed instead of making the whole
    -- row sellable with an invented quantity.
    if v_quantity is null then
      if v_inventory_quantity is distinct from 1 then
        raise exception
          'Reservation-less Layaway item % has quantity_total %; its released quantity is ambiguous.',
          v_item_id, v_inventory_quantity
          using errcode = 'check_violation';
      end if;
      v_quantity := 1;
    elsif v_inventory_quantity is null
       or v_inventory_quantity < 1
       or v_quantity < 1
       or v_quantity > v_inventory_quantity then
      raise exception
        'Released reservation quantity % is invalid for Layaway item % (inventory quantity %).',
        v_quantity, v_item_id, v_inventory_quantity
        using errcode = 'check_violation';
    end if;

    insert into public.returned_to_stock_reviews (
      inventory_item_id, inventory_reservation_id, trigger_kind, status, quantity,
      reviewed_at, reviewed_by, review_note, freed_unit_outcome, freed_unit_note
    ) values (
      v_item_id, v_primary_reservation, 'layaway_forfeited_disposition',
      'approved_return', v_quantity, now(), v_staff,
      'Owner-confirmed layaway forfeiture; the same inventory item returned to Available Inventory.',
      'returned_to_available',
      'Returned by public.forfeit_layaway_ledger; no inventory row was copied or created.'
    );

    update public.inventory_items
       set availability_status = 'available',
           facebook_name = null,
           custody_holder = 'av_jewelry',
           custody_handler_id = null,
           custody_updated_at = now(),
           custody_updated_by = null
     where id = v_item_id;

    v_returned := v_returned + 1;
  end loop;

  update public.layaway_ledger
     set status = 'forfeited'
   where id = p_ledger_id;

  -- Serialize against next_layaway_code/create_layaway_account and remove only the current
  -- assignment. The historical text on v_ledger/layaway_ledger is deliberately untouched.
  perform pg_advisory_xact_lock(hashtext('layaway_code_pool'));

  select p.code into v_assigned_code
  from public.layaway_code_pool p
  where p.ref = 'ledger:' || p_ledger_id::text
  for update;
  v_assignment_found := found;

  if v_assignment_found and (
    v_ledger.layaway_code is null
    or lower(btrim(v_assigned_code)) is distinct from lower(btrim(v_ledger.layaway_code))
  ) then
    raise exception
      'Layaway Code assignment mismatch for ledger %. Historical code is %, but its active pool ref holds %. Nothing was changed.',
      p_ledger_id, coalesce(v_ledger.layaway_code, '(none)'), coalesce(v_assigned_code, '(none)')
      using errcode = 'check_violation';
  end if;

  if v_ledger.layaway_code is not null and not v_assignment_found then
    raise exception
      'Layaway Code assignment is missing for ledger % (historical code %). Nothing was changed.',
      p_ledger_id, v_ledger.layaway_code
      using errcode = 'check_violation';
  end if;

  delete from public.layaway_code_pool
   where ref = 'ledger:' || p_ledger_id::text
     and lower(btrim(code)) = lower(btrim(v_ledger.layaway_code));
  get diagnostics v_code_assignments_deleted = row_count;

  insert into public.audit_events (
    actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id,
    outcome, reason, context
  ) values (
    v_actor_auth, 'staff', coalesce(v_actor_label, 'Owner'),
    'layaway.forfeit', 'layaway_ledger', p_ledger_id,
    'succeeded', null,
    jsonb_build_object(
      'layaway_id', p_ledger_id,
      'layaway_code', v_ledger.layaway_code,
      'previous_status', v_ledger.status,
      'new_status', 'forfeited',
      'performed_by_staff_id', v_staff,
      'item_ids', to_jsonb(v_item_ids),
      'item_unique_codes', to_jsonb(v_item_codes),
      'released_inventory_items', v_returned,
      'already_available_item_ids', to_jsonb(v_already_available_item_ids),
      'already_available_items', cardinality(v_already_available_item_ids),
      'released_reservation_ids', to_jsonb(v_released_reservation_ids),
      'neutralized_order_ids', to_jsonb(v_order_ids),
      'order_cancellation_approval_ids', to_jsonb(v_order_approval_ids),
      'withdrawn_claim_ids', to_jsonb(v_withdrawn_claim_ids),
      'released_layaway_code_assignments', v_code_assignments_deleted,
      'historical_layaway_code_preserved', true,
      'inventory_rows_created', 0,
      'source', 'public.forfeit_layaway_ledger'
    )
  );

  return jsonb_build_object(
    'ledger_id', p_ledger_id,
    'status', 'forfeited',
    'changed', true,
    'deduplicated', false,
    'released_items', v_returned,
    'already_available_items', cardinality(v_already_available_item_ids),
    'item_ids', to_jsonb(v_item_ids),
    'item_unique_codes', to_jsonb(v_item_codes),
    'layaway_code', v_ledger.layaway_code,
    'layaway_code_released', v_code_assignments_deleted > 0
  );
end;
$function$;

comment on function public.forfeit_layaway_ledger(uuid) is
  'Owner-only, atomic and idempotent Layaway Ledger forfeiture. Preserves history, returns distinct linked items through approved RTS evidence, releases exact reservations and the active code assignment, and audits the transaction.';

revoke all on function public.forfeit_layaway_ledger(uuid) from public, anon;
grant execute on function public.forfeit_layaway_ledger(uuid) to authenticated, service_role;
