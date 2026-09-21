-- The code pool is the canonical active-assignment registry. A missing pool row
-- means a code is already available to the allocator; the historical code on a
-- ledger must remain intact. Legacy terminal transitions need to accept that
-- state while still failing closed if another ledger currently holds the code.
do $preflight$
begin
  if to_regprocedure('public.forfeit_layaway_ledger(uuid)') is null
     or to_regprocedure(
       'public.update_layaway_ledger_and_transfer_overdue(uuid,text,text,date,numeric,numeric,date,text)'
     ) is null then
    raise exception
      'Legacy Layaway code release migration requires the existing forfeiture and manual-Overdue functions.'
      using errcode = 'undefined_function';
  end if;

  if to_regprocedure('public.forfeit_layaway_ledger_strict(uuid)') is not null
     or to_regprocedure(
       'public.update_layaway_ledger_and_transfer_overdue_strict(uuid,text,text,date,numeric,numeric,date,text)'
     ) is not null then
    raise exception
      'Legacy Layaway code release migration found an existing strict-function name; inspect the prior migration before retrying.'
      using errcode = 'duplicate_function';
  end if;
end;
$preflight$;

-- This helper runs only from the two terminal transition wrappers below. It
-- takes the allocator's advisory lock, verifies both the historical code and
-- ledger reference, and creates at most one temporary matching pool row when
-- the code is already free. The strict transition consumes that temporary row
-- before commit, leaving the canonical allocator's available state unchanged.
create or replace function app_private.prepare_layaway_code_for_terminal_release(
  p_ledger_id uuid,
  p_historical_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_ref text := 'ledger:' || p_ledger_id::text;
  v_code text := upper(nullif(btrim(p_historical_code), ''));
  v_code_row_code text;
  v_code_row_ref text;
  v_ref_row_code text;
  v_code_found boolean := false;
  v_ref_found boolean := false;
begin
  if p_ledger_id is null then
    raise exception 'A layaway account is required.' using errcode = 'check_violation';
  end if;

  if v_code is null then
    return jsonb_build_object(
      'state', 'no_historical_code',
      'temporary_assignment', false,
      'assignment_deleted', 0
    );
  end if;

  if v_code !~ '^[A-Z]([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$' then
    raise exception
      'Historical Layaway Code % is not a canonical Layaway Code and cannot be reconciled. No record was changed.',
      v_code
      using errcode = 'check_violation';
  end if;

  -- New Layaway creation and explicit code claims take this same lock before
  -- choosing/inserting a code, so a terminal release cannot race allocation.
  perform pg_advisory_xact_lock(hashtext('layaway_code_pool'));

  select p.code, p.ref
    into v_code_row_code, v_code_row_ref
  from public.layaway_code_pool p
  where lower(btrim(p.code)) = lower(v_code)
  for update;
  v_code_found := found;

  select p.code
    into v_ref_row_code
  from public.layaway_code_pool p
  where p.ref = v_ref
  for update;
  v_ref_found := found;

  if v_code_found
     and v_code_row_ref = v_ref
     and v_ref_found
     and lower(btrim(v_ref_row_code)) = lower(v_code) then
    return jsonb_build_object(
      'state', 'active_assignment_released',
      'temporary_assignment', false,
      'assignment_deleted', 1,
      'historical_code', v_code
    );
  end if;

  if not v_code_found and not v_ref_found then
    -- The authoritative pool already treats this historical code as free. Add a
    -- transaction-local matching assignment solely so the strict workflow can
    -- validate and release through its normal path; rollback removes it on any
    -- later failure and the strict path deletes it before a successful commit.
    insert into public.layaway_code_pool (code, ref) values (v_code, v_ref);
    return jsonb_build_object(
      'state', 'already_available',
      'temporary_assignment', true,
      'assignment_deleted', 0,
      'historical_code', v_code
    );
  end if;

  if v_code_found and v_code_row_ref is distinct from v_ref then
    raise exception
      'Layaway Code % could not be released because it is currently assigned to another active Layaway. Please review the code assignment before transferring this account.',
      v_code
      using errcode = 'check_violation';
  end if;

  raise exception
    'Layaway Code % has a conflicting assignment for this account. Please review the code assignment before transferring this account.',
    v_code
    using errcode = 'check_violation';
end;
$function$;

comment on function app_private.prepare_layaway_code_for_terminal_release(uuid, text) is
  'Shared, advisory-lock-protected legacy-code resolver for Layaway forfeiture and manual-Overdue transitions. Preserves history, treats an absent pool row as already available, and fails closed on conflicting assignments.';

revoke all on function app_private.prepare_layaway_code_for_terminal_release(uuid, text)
  from public, anon, authenticated, service_role;

-- The existing close-status trigger releases a code before the historical
-- forfeiture function reaches its own guarded release step. Let the public
-- forfeiture wrapper defer that trigger release for its transaction only, so
-- the strict function remains the single validated path that deletes the exact
-- matching assignment. Every other close keeps the current trigger behavior.
create or replace function app_private.release_code_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status is distinct from old.status
     and new.status in ('completed', 'cancelled', 'forfeited')
     and coalesce(current_setting('app_private.defer_layaway_code_release', true), '') <> 'on' then
    perform public.release_layaway_code_for(new.id);
  end if;
  return new;
end;
$function$;

comment on function app_private.release_code_on_close() is
  'Releases a Layaway code on terminal close unless the Owner-only forfeiture wrapper defers the trigger inside its atomic strict-release transaction.';

-- Keep the original, fully-audited transition implementations intact under
-- internal names. Public wrappers below perform the shared legacy-safe code
-- resolution first, then invoke these strict implementations in the SAME
-- PostgreSQL transaction.
alter function public.forfeit_layaway_ledger(uuid)
  rename to forfeit_layaway_ledger_strict;
alter function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) rename to update_layaway_ledger_and_transfer_overdue_strict;

revoke all on function public.forfeit_layaway_ledger_strict(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_layaway_ledger_and_transfer_overdue_strict(
  uuid, text, text, date, numeric, numeric, date, text
) from public, anon, authenticated, service_role;

create or replace function public.forfeit_layaway_ledger(p_ledger_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ledger public.layaway_ledger%rowtype;
  v_resolution jsonb;
  v_result jsonb;
  v_actor_auth uuid := (select auth.uid());
  v_staff uuid;
  v_actor_label text;
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

  v_resolution := app_private.prepare_layaway_code_for_terminal_release(
    p_ledger_id,
    v_ledger.layaway_code
  );
  perform set_config('app_private.defer_layaway_code_release', 'on', true);
  v_result := public.forfeit_layaway_ledger_strict(p_ledger_id);

  -- Record the accurate pre-transition code state only when a successful
  -- transition used the no-net-new-row legacy reconciliation path. Retries are
  -- idempotent (`changed=false`) and add no duplicate history.
  if v_result ->> 'changed' = 'true'
     and coalesce((v_resolution ->> 'temporary_assignment')::boolean, false) then
    v_staff := app_private.current_staff_id();
    select sp.full_name into v_actor_label
    from public.staff_profiles sp
    where sp.id = v_staff;

    insert into public.audit_events (
      actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id,
      outcome, reason, context
    ) values (
      v_actor_auth, 'staff', coalesce(v_actor_label, 'Owner'),
      'layaway.code_resolution', 'layaway_ledger', p_ledger_id,
      'succeeded', null,
      jsonb_build_object(
        'historical_layaway_code', v_ledger.layaway_code,
        'state_before_transition', v_resolution ->> 'state',
        'temporary_assignment_removed_before_commit', true,
        'source', 'public.forfeit_layaway_ledger'
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'legacy_code_resolution', v_resolution ->> 'state',
    'layaway_code_was_already_available',
      coalesce((v_resolution ->> 'temporary_assignment')::boolean, false)
  );
end;
$function$;

comment on function public.forfeit_layaway_ledger(uuid) is
  'Owner-only, atomic and idempotent Layaway Ledger forfeiture. Uses the shared legacy-safe code resolver before the existing strict inventory/payment/history transition.';

revoke all on function public.forfeit_layaway_ledger(uuid) from public, anon;
grant execute on function public.forfeit_layaway_ledger(uuid) to authenticated, service_role;

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
  v_resolution jsonb;
  v_result jsonb;
  v_actor_auth uuid := (select auth.uid());
  v_staff uuid;
  v_actor_label text;
begin
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

  v_resolution := app_private.prepare_layaway_code_for_terminal_release(
    p_id,
    v_ledger.layaway_code
  );
  v_result := public.update_layaway_ledger_and_transfer_overdue_strict(
    p_id,
    p_customer_name,
    p_remarks,
    p_date_purchased,
    p_item_amount,
    p_interest,
    p_next_due_date,
    p_notes
  );

  if v_result ->> 'changed' = 'true'
     and coalesce((v_resolution ->> 'temporary_assignment')::boolean, false) then
    v_staff := app_private.current_staff_id();
    select sp.full_name into v_actor_label
    from public.staff_profiles sp
    where sp.id = v_staff;

    insert into public.audit_events (
      actor_auth_uid, actor_kind, actor_label, action, entity_type, entity_id,
      outcome, reason, context
    ) values (
      v_actor_auth, 'staff', coalesce(v_actor_label, 'Staff member'),
      'layaway.code_resolution', 'layaway_ledger', p_id,
      'succeeded', null,
      jsonb_build_object(
        'historical_layaway_code', v_ledger.layaway_code,
        'state_before_transition', v_resolution ->> 'state',
        'temporary_assignment_removed_before_commit', true,
        'source', 'public.update_layaway_ledger_and_transfer_overdue'
      )
    );
  end if;

  return v_result || jsonb_build_object(
    'legacy_code_resolution', v_resolution ->> 'state',
    'layaway_code_was_already_available',
      coalesce((v_resolution ->> 'temporary_assignment')::boolean, false)
  );
end;
$function$;

comment on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) is
  'Atomic, idempotent manual Layaway-to-Overdue transfer using the shared legacy-safe code resolver before the existing strict inventory/payment/history transition.';

revoke all on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) from public, anon;
grant execute on function public.update_layaway_ledger_and_transfer_overdue(
  uuid, text, text, date, numeric, numeric, date, text
) to authenticated, service_role;

-- The edit-and-forfeit wrapper was compiled before the public forfeiture
-- function was renamed above. Recreate it so its call resolves to the new
-- legacy-safe public wrapper rather than the strict internal implementation.
create or replace function public.update_layaway_ledger_and_forfeit(
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
security invoker
set search_path = ''
as $function$
declare
  v_edit jsonb;
  v_forfeit jsonb;
begin
  v_edit := public.update_layaway_ledger_account(
    p_id,
    p_customer_name,
    p_remarks,
    p_date_purchased,
    p_item_amount,
    p_interest,
    p_next_due_date,
    p_notes
  );
  v_forfeit := public.forfeit_layaway_ledger(p_id);

  return v_forfeit || jsonb_build_object(
    'grand_total', v_edit -> 'grandTotal',
    'balance', v_edit -> 'balance'
  );
end;
$function$;

revoke all on function public.update_layaway_ledger_and_forfeit(
  uuid, text, text, date, numeric, numeric, date, text
) from public, anon;
grant execute on function public.update_layaway_ledger_and_forfeit(
  uuid, text, text, date, numeric, numeric, date, text
) to authenticated, service_role;
