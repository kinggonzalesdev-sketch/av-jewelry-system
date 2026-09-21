-- Manual Layaway -> Overdue is an explicit disposition, separate from the
-- date-purchased + three-calendar-month display rule. The transaction below keeps
-- the ledger and all payment/installment history, returns the same linked inventory
-- rows to Available, and records who performed the transition.

alter table public.layaway_ledger
  add column if not exists manual_overdue_at timestamptz;

alter table public.layaway_ledger
  add column if not exists manual_overdue_by uuid
    references public.staff_profiles(id) on delete set null;

comment on column public.layaway_ledger.manual_overdue_at is
  'When set, this ledger was explicitly transferred to Overdue; independent of the automatic three-calendar-month overdue calculation.';
comment on column public.layaway_ledger.manual_overdue_by is
  'Staff profile that explicitly transferred this ledger to Overdue. The immutable actor snapshot also lives in audit_events.';

-- The availability guard requires approved Returned-to-Stock evidence. Add a
-- precise reason for this workflow instead of mislabelling it as forfeiture.
alter table public.returned_to_stock_reviews
  drop constraint if exists returned_to_stock_reviews_trigger_kind_check;
alter table public.returned_to_stock_reviews
  add constraint returned_to_stock_reviews_trigger_kind_check
  check (trigger_kind in (
    'withdrawal_confirmed',
    'order_cancelled',
    'order_expired',
    'claim_rejected',
    'layaway_forfeited_disposition',
    'layaway_manual_overdue_disposition',
    'delivered_return'
  ));

-- Once an item has been explicitly returned to Available Inventory, no later
-- payment/edit path may silently reactivate the ledger. Terminal workflows may
-- still move it onward (for example, Owner forfeiture or cancellation).
create or replace function app_private.enforce_manual_overdue_not_active()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.manual_overdue_at is not null and new.status = 'active' then
    raise exception
      'A Layaway manually transferred to Overdue cannot be reactivated because its linked inventory has returned to Available Inventory.'
      using errcode = 'check_violation';
  end if;
  if old.manual_overdue_at is not null
     and new.status = 'overdue'
     and coalesce(new.balance, 0) <= 0 then
    raise exception
      'A Layaway manually transferred to Overdue cannot be made fully paid by editing or adding a payment after its inventory returned to Available.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

drop trigger if exists layaway_ledger_manual_overdue_not_active on public.layaway_ledger;
create trigger layaway_ledger_manual_overdue_not_active
before update of status, balance on public.layaway_ledger
for each row execute function app_private.enforce_manual_overdue_not_active();

-- Keep ordinary edits usable for a manually-overdue historical account without
-- changing its explicit state. Payment rows are never read or written here.
create or replace function public.update_layaway_ledger_account(
  p_id uuid,
  p_customer_name text,
  p_remarks text,
  p_date_purchased date,
  p_item_amount numeric,
  p_interest numeric,
  p_next_due_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pay numeric;
  v_code text;
  v_grand numeric;
  v_bal numeric;
  v_final text;
  v_manual_overdue_at timestamptz;
begin
  if not app_private.has_permission('layaway_edit') then
    raise exception 'Not authorized: you do not have permission to edit layaway accounts. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;

  select coalesce(payment, 0), layaway_code, manual_overdue_at
    into v_pay, v_code, v_manual_overdue_at
  from public.layaway_ledger where id = p_id for update;
  if not found then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;

  v_grand := round(coalesce(p_item_amount, 0) + coalesce(p_interest, 0), 2);
  v_bal := round(v_grand - coalesce(v_pay, 0), 2);
  v_final := case
    when v_manual_overdue_at is not null then 'overdue'
    when v_bal <= 0 and v_pay > 0 then 'completed'
    else 'active'
  end;

  update public.layaway_ledger set
    customer_name = trim(p_customer_name),
    remarks = nullif(trim(p_remarks), ''),
    date_purchased = p_date_purchased,
    item_amount = p_item_amount,
    interest = p_interest,
    grand_total = v_grand,
    balance = v_bal,
    balance_mismatch = false,
    next_due_date = p_next_due_date,
    notes = nullif(trim(p_notes), ''),
    status = v_final
  where id = p_id;

  if v_final = 'completed' and v_code is not null then
    perform public.release_layaway_code('ledger:' || p_id::text);
    update public.layaway_ledger set layaway_code = null where id = p_id;
  end if;

  return jsonb_build_object('grandTotal', v_grand, 'balance', v_bal, 'status', v_final);
end;
$function$;

-- Save the Edit modal fields and perform the manual Overdue disposition in ONE
-- database call/transaction. Any exception (including an inventory trigger or RTS
-- failure) rolls back the field edit, reservation release, inventory state, ledger
-- state and audit insert together.
create or replace function public.update_layaway_ledger_and_transfer_overdue(
  p_id uuid,
  p_customer_name text,
  p_remarks text,
  p_date_purchased date,
  p_item_amount numeric,
  p_interest numeric,
  p_next_due_date date,
  p_notes text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ledger public.layaway_ledger%rowtype;
  v_staff uuid;
  v_actor_auth uuid := (select auth.uid());
  v_actor_label text;
  v_item_ids uuid[] := array[]::uuid[];
  v_item_codes text[] := array[]::text[];
  v_releasable_item_ids uuid[] := array[]::uuid[];
  v_already_available_item_ids uuid[] := array[]::uuid[];
  v_order_ids uuid[] := array[]::uuid[];
  v_released_reservation_ids uuid[] := array[]::uuid[];
  v_terminal_items text;
  v_invalid_items text;
  v_item_id uuid;
  v_primary_reservation uuid;
  v_quantity integer;
  v_inventory_quantity integer;
  v_grand numeric;
  v_balance numeric;
  v_returned integer := 0;
  v_now timestamptz := now();
begin
  -- This action edits the account and uses Transfer to Destination. Both existing
  -- permissions must be present; the dropdown is only a convenience gate.
  if not app_private.has_permission('layaway_edit') then
    raise exception 'Not authorized: you do not have permission to edit layaway accounts. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if not app_private.has_permission('fulfillment_preparation') then
    raise exception 'Not authorized: the fulfillment_preparation permission is required. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;

  select * into v_ledger
  from public.layaway_ledger
  where id = p_id
  for update;

  if v_ledger.id is null then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;

  -- The ledger row is the idempotency key. Concurrent tabs serialize here; after
  -- the first commit every retry is a successful no-op and creates no RTS/audit row.
  if v_ledger.manual_overdue_at is not null then
    if lower(coalesce(v_ledger.status, '')) <> 'overdue' then
      raise exception 'This Layaway already left the manual Overdue state. Nothing was changed.'
        using errcode = 'check_violation';
    end if;
    return jsonb_build_object(
      'ledger_id', p_id,
      'status', 'overdue',
      'changed', false,
      'deduplicated', true,
      'released_items', 0,
      'item_unique_codes', '[]'::jsonb,
      'grand_total', v_ledger.grand_total,
      'balance', v_ledger.balance,
      'manual_overdue_at', v_ledger.manual_overdue_at
    );
  end if;

  if lower(coalesce(v_ledger.status, '')) not in
       ('active', 'overdue', 'grace_period', 'forfeiture_eligible') then
    raise exception 'A % Layaway account cannot be transferred to Overdue.',
      coalesce(v_ledger.status, 'status-less') using errcode = 'check_violation';
  end if;

  v_grand := round(coalesce(p_item_amount, 0) + coalesce(p_interest, 0), 2);
  v_balance := round(v_grand - coalesce(v_ledger.payment, 0), 2);
  if v_balance <= 0 then
    raise exception 'A fully-paid Layaway cannot return inventory through the Overdue destination.'
      using errcode = 'check_violation';
  end if;

  v_staff := app_private.current_staff_id();
  select sp.full_name into v_actor_label
  from public.staff_profiles sp
  where sp.id = v_staff;

  select coalesce(array_agg(o.id order by o.id), array[]::uuid[])
    into v_order_ids
  from public.official_orders o
  where o.converted_layaway_ledger_id = p_id;

  perform 1
  from public.official_orders o
  where o.id = any(v_order_ids)
  order by o.id
  for update;

  -- A converted source order remains as historical linkage. It must still be in
  -- its converted/non-fulfilled state before its reservations can be released.
  if exists (
    select 1
    from public.official_orders o
    left join public.fulfillment_records f on f.official_order_id = o.id
    where o.id = any(v_order_ids)
      and (
        not coalesce(o.converted_to_layaway, false)
        or o.status in ('completed', 'closed', 'delivered', 'picked_up', 'released',
                        'dispatched_or_picked_up')
        or f.status in ('dispatched', 'delivered', 'picked_up', 'released')
      )
  ) then
    raise exception 'The converted source order has already entered fulfillment. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

  -- Resolve every supported link shape and deduplicate physical inventory rows:
  -- legacy direct link, current multi-item rows, and converted-order claims.
  with item_links as (
    select v_ledger.inventory_item_id as inventory_item_id
    union
    select li.inventory_item_id
    from public.layaway_ledger_items li
    where li.ledger_id = p_id
    union
    select c.inventory_item_id
    from public.official_orders o
    join public.official_order_claims ooc on ooc.official_order_id = o.id
    join public.claims c on c.id = ooc.claim_id
    where o.converted_layaway_ledger_id = p_id
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

  perform 1
  from public.inventory_items i
  where i.id = any(v_item_ids)
  order by i.id
  for update;

  if exists (
    select 1 from public.inventory_items i
    where i.id = any(v_item_ids) and coalesce(i.is_archived, true)
  ) then
    raise exception 'An archived Layaway item cannot be returned to Available Inventory. Restore the item first.'
      using errcode = 'check_violation';
  end if;

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
      v_terminal_items using errcode = 'check_violation';
  end if;

  if v_invalid_items is not null then
    raise exception 'A linked Layaway item is not in a releasable inventory state: %.',
      v_invalid_items using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from public.layaway_ledger l
    where l.id <> p_id
      and lower(coalesce(l.status, '')) not in ('completed', 'cancelled', 'forfeited', 'transferred')
      and l.inventory_item_id = any(v_item_ids)
  ) or exists (
    select 1
    from public.layaway_ledger_items li
    join public.layaway_ledger l on l.id = li.ledger_id
    where l.id <> p_id
      and lower(coalesce(l.status, '')) not in ('completed', 'cancelled', 'forfeited', 'transferred')
      and li.inventory_item_id = any(v_item_ids)
  ) then
    raise exception 'A linked item is also held by another open Layaway. Nothing was changed.'
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

  -- Only reservations belonging to the converted order(s) for THIS ledger may be
  -- released. Direct/multi-item Layaways normally have no reservation rows.
  perform 1
  from public.inventory_reservations r
  join public.claims c on c.id = r.claim_id
  join public.official_order_claims ooc on ooc.claim_id = c.id
  join public.official_orders o on o.id = ooc.official_order_id
  where o.converted_layaway_ledger_id = p_id
    and r.state in ('provisional', 'committed')
  order by r.id
  for update of r;

  with released as (
    update public.inventory_reservations r
       set state = 'released',
           released_at = v_now,
           released_reason = 'Layaway ledger ' || p_id::text || ' was manually transferred to Overdue.'
     where r.state in ('provisional', 'committed')
       and exists (
         select 1
         from public.official_order_claims ooc
         join public.official_orders o on o.id = ooc.official_order_id
         where ooc.claim_id = r.claim_id
           and o.converted_layaway_ledger_id = p_id
       )
    returning r.id
  )
  select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_released_reservation_ids
  from released;

  if exists (
    select 1
    from public.inventory_reservations r
    where r.inventory_item_id = any(v_item_ids)
      and r.state in ('provisional', 'committed')
  ) then
    raise exception 'A linked item has another active reservation. Nothing was changed.'
      using errcode = 'check_violation';
  end if;

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

    if v_quantity is null then
      if v_inventory_quantity is distinct from 1 then
        raise exception
          'Reservation-less Layaway item % has quantity_total %; its released quantity is ambiguous.',
          v_item_id, v_inventory_quantity using errcode = 'check_violation';
      end if;
      v_quantity := 1;
    elsif v_inventory_quantity is null
       or v_inventory_quantity < 1
       or v_quantity < 1
       or v_quantity > v_inventory_quantity then
      raise exception
        'Released reservation quantity % is invalid for Layaway item % (inventory quantity %).',
        v_quantity, v_item_id, v_inventory_quantity using errcode = 'check_violation';
    end if;

    insert into public.returned_to_stock_reviews (
      inventory_item_id, inventory_reservation_id, trigger_kind, status, quantity,
      reviewed_at, reviewed_by, review_note, freed_unit_outcome, freed_unit_note
    ) values (
      v_item_id, v_primary_reservation, 'layaway_manual_overdue_disposition',
      'approved_return', v_quantity, v_now, v_staff,
      'Authorized manual Layaway transfer to Overdue; the same inventory row returned to Available Inventory.',
      'returned_to_available',
      'Returned by public.update_layaway_ledger_and_transfer_overdue; no inventory row was copied or created.'
    );

    update public.inventory_items
       set availability_status = 'available',
           custody_holder = 'av_jewelry',
           custody_handler_id = null,
           custody_updated_at = v_now,
           custody_updated_by = v_staff
     where id = v_item_id;

    v_returned := v_returned + 1;
  end loop;

  -- Descriptive edits, computed money and the explicit status marker commit with
  -- the inventory release. Layaway Code and every payment/installment row remain.
  update public.layaway_ledger set
    customer_name = trim(p_customer_name),
    remarks = nullif(trim(p_remarks), ''),
    date_purchased = p_date_purchased,
    item_amount = p_item_amount,
    interest = p_interest,
    grand_total = v_grand,
    balance = v_balance,
    balance_mismatch = false,
    next_due_date = p_next_due_date,
    notes = nullif(trim(p_notes), ''),
    status = 'overdue',
    manual_overdue_at = v_now,
    manual_overdue_by = v_staff
  where id = p_id;

  insert into public.audit_events (
    actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id,
    outcome, reason, context
  ) values (
    v_actor_auth, 'staff', coalesce(v_actor_label, 'Staff member'),
    'layaway.transfer_to_overdue', 'layaway_ledger', p_id,
    'succeeded', null,
    jsonb_build_object(
      'layaway_id', p_id,
      'layaway_code', v_ledger.layaway_code,
      'previous_status', v_ledger.status,
      'new_status', 'overdue',
      'manual_transition', true,
      'manual_overdue_at', v_now,
      'performed_by_staff_id', v_staff,
      'item_ids', to_jsonb(v_item_ids),
      'item_unique_codes', to_jsonb(v_item_codes),
      'released_inventory_items', v_returned,
      'already_available_item_ids', to_jsonb(v_already_available_item_ids),
      'released_reservation_ids', to_jsonb(v_released_reservation_ids),
      'preserved_order_ids', to_jsonb(v_order_ids),
      'payment_history_preserved', true,
      'inventory_rows_created', 0,
      'automatic_overdue_rule_changed', false,
      'source', 'public.update_layaway_ledger_and_transfer_overdue'
    )
  );

  return jsonb_build_object(
    'ledger_id', p_id,
    'status', 'overdue',
    'changed', true,
    'deduplicated', false,
    'released_items', v_returned,
    'already_available_items', cardinality(v_already_available_item_ids),
    'item_ids', to_jsonb(v_item_ids),
    'item_unique_codes', to_jsonb(v_item_codes),
    'grand_total', v_grand,
    'balance', v_balance,
    'layaway_code', v_ledger.layaway_code,
    'manual_overdue_at', v_now
  );
end;
$function$;

comment on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) is
  'Atomic, idempotent manual Layaway-to-Overdue transfer. Saves the Edit modal, preserves financial history and Layaway identity, returns all distinct linked inventory rows to Available, and audits the actor/date.';

revoke all on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) from public, anon;
grant execute on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) to authenticated, service_role;
