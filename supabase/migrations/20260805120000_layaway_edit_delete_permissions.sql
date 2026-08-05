-- Owner request: make Edit Layaway and Delete Layaway assignable in Manage Access,
-- the same way Edit/Delete Inventory already are. Before, editing or deleting an
-- imported layaway account was hard-coded to "owner or selected_admin" — there was
-- no way for the Super Admin to grant it to a specific member (or to withhold it
-- from an admin). Now each is its own permission key, gated the same way in the UI
-- and re-checked here in SQL (Bible §30.3 r2). The Owner holds both implicitly via
-- app_private.has_permission → is_owner().

-- 1. Register the two keys. staff_permission_grants.permission_key has an FK to
--    permissions(key), so the keys must exist before any grant can reference them.
insert into public.permissions (key, label, description, is_request_only) values
  ('layaway_edit',   'Edit Layaway',   'Edit an imported layaway account.', false),
  ('layaway_delete', 'Delete Layaway', 'Permanently delete an imported layaway account.', false)
on conflict (key) do nothing;

-- 2. Editing a layaway account → gate on layaway_edit (was: role in owner/admin).
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
begin
  if not app_private.has_permission('layaway_edit') then
    raise exception 'Not authorized: you do not have permission to edit layaway accounts. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'A customer name is required.' using errcode = 'check_violation';
  end if;

  select coalesce(payment, 0), layaway_code into v_pay, v_code
  from public.layaway_ledger where id = p_id for update;
  if not found then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;

  v_grand := round(coalesce(p_item_amount, 0) + coalesce(p_interest, 0), 2);
  v_bal := round(v_grand - coalesce(v_pay, 0), 2);
  v_final := case when v_bal <= 0 and v_pay > 0 then 'completed' else 'active' end;

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

-- 3. Deleting a layaway account → gate on layaway_delete (was: role in owner/admin).
create or replace function public.delete_layaway_ledger_row(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_deleted int;
begin
  if not app_private.has_permission('layaway_delete') then
    raise exception 'Not authorized: you do not have permission to delete layaway records. No record was changed.'
      using errcode = 'insufficient_privilege';
  end if;
  perform public.release_layaway_code('ledger:' || p_id);
  delete from public.layaway_ledger where id = p_id;
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$function$;
