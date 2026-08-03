-- Owner request: a Layaway account's View modal gains a "Cancel Order" action beside
-- Add Payment. This mirrors complete_layaway_ledger(uuid) but sets status='cancelled'.
-- Like completion, it releases the layaway code back to the pool (the code text stays
-- on the row for history). Owner/Admin only; the money/payment history is untouched.
create or replace function public.cancel_layaway_ledger(p_ledger_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: cancelling a layaway account is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_ledger_id is null then
    raise exception 'A layaway account is required.' using errcode = 'check_violation';
  end if;

  select status into v_status from public.layaway_ledger where id = p_ledger_id for update;
  if not found then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;
  if v_status = 'cancelled' then
    raise exception 'This layaway account is already cancelled.' using errcode = 'check_violation';
  end if;
  if v_status in ('completed', 'forfeited') then
    raise exception 'A % account cannot be cancelled.', v_status using errcode = 'check_violation';
  end if;

  update public.layaway_ledger set status = 'cancelled' where id = p_ledger_id;
  -- Release the code back to the pool (text preserved on the row for history).
  perform public.release_layaway_code_for(p_ledger_id);

  return jsonb_build_object('ledger_id', p_ledger_id, 'status', 'cancelled');
end;
$function$;

-- Same posture as the other layaway DEFINER functions: never anon/public-callable.
revoke all on function public.cancel_layaway_ledger(uuid) from public, anon;
grant execute on function public.cancel_layaway_ledger(uuid) to authenticated, service_role;
