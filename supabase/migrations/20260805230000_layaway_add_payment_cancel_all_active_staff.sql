-- Owner request: every active staff member (Owner, Admin, AND Staff) must be able
-- to Add Payment and Cancel Order on a layaway ledger account. The two RPCs
-- previously gated on current_staff_role() in ('owner','selected_admin'); relax both
-- to app_private.is_active_staff() so any active staff of any role may run them (and
-- a non-staff / inactive caller is still refused). Patched via pg_get_functiondef +
-- replace so the rest of each function is preserved byte-for-byte; a safety check
-- aborts if the expected guard text is absent (never a silent no-op).
do $mig$
declare
  v_src text;
  v_search text;
  v_replace text;
begin
  v_replace := $q$  if not app_private.is_active_staff() then
    raise exception 'Not authorized: you must be signed in as an active staff member.'
      using errcode = 'insufficient_privilege';
  end if;$q$;

  -- add_layaway_ledger_payment
  select pg_get_functiondef(
    'public.add_layaway_ledger_payment(uuid, numeric, date, text, text)'::regprocedure
  ) into v_src;
  v_search := $q$  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: recording a layaway payment is reserved to the Owner or Selected Admin.'
      using errcode = 'insufficient_privilege';
  end if;$q$;
  if position(v_search in v_src) = 0 then
    raise exception 'Guard text not found in add_layaway_ledger_payment — aborting.';
  end if;
  execute replace(v_src, v_search, v_replace);

  -- cancel_layaway_ledger
  select pg_get_functiondef('public.cancel_layaway_ledger(uuid)'::regprocedure) into v_src;
  v_search := $q$  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: cancelling a layaway account is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;$q$;
  if position(v_search in v_src) = 0 then
    raise exception 'Guard text not found in cancel_layaway_ledger — aborting.';
  end if;
  execute replace(v_src, v_search, v_replace);
end;
$mig$;
