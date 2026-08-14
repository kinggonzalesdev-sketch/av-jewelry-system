-- Apply a TERM change (1/2/3 months) to an EXISTING layaway account, then recompute interest /
-- grand total / balance / installment charges from the new term using the SAME authoritative
-- app_private.recompute_layaway_from_items the add-item path uses (grams × ₱150 × term). This is
-- the one money action that did not exist (only account-CREATION functions set layaway_term).
--
-- SAFETY: recompute_layaway_from_items derives item_amount/grams from layaway_ledger_items, so
-- running it on an amount-only account (no item rows — e.g. a legacy import) would ZERO the
-- account out. We therefore REFUSE unless the account has >=1 itemized piece. Owner/Admin only,
-- active accounts only — matching add_layaway_item's guards.
--
-- NOTE: add_layaway_item / recompute_layaway_from_items themselves are live-DB-only (applied via
-- Supabase MCP, not committed here). This file commits ONLY the new set_layaway_term.

create or replace function public.set_layaway_term(p_ledger uuid, p_term smallint)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_status text;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: editing a layaway is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_term not in (1, 2, 3) then
    raise exception 'Choose a term of 1, 2 or 3 months.' using errcode = 'check_violation';
  end if;

  select status into v_status from public.layaway_ledger where id = p_ledger;
  if v_status is null then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;
  if v_status in ('cancelled', 'completed', 'forfeited') then
    raise exception 'This layaway can no longer be edited (it is %).', v_status using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.layaway_ledger_items where ledger_id = p_ledger) then
    raise exception 'This account has no itemized pieces yet, so its term cannot be recomputed. Add an item first.'
      using errcode = 'check_violation';
  end if;

  update public.layaway_ledger set layaway_term = p_term where id = p_ledger;
  perform app_private.recompute_layaway_from_items(p_ledger);
  return jsonb_build_object('ok', true, 'term', p_term);
end $function$;

grant execute on function public.set_layaway_term(uuid, smallint) to authenticated, service_role;
