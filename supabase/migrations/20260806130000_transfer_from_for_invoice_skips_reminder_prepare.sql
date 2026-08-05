-- Owner: after Send Invoice the order STAYS in For Invoice, and the Admin transfers it
-- straight to a destination (skipping the reminder / confirm / prepare steps). The
-- transfer already accepts a For-Invoice order, but for pickup/delivery/shipping it kept
-- status 'invoiced', so the order never left the For Invoice card. Advance those (and any
-- reminder/confirm order) to 'for_preparation' on transfer, so it moves into the chosen
-- destination's pipeline. No payment gate — the Admin decides. Patched via
-- pg_get_functiondef + replace (aborts if the target text is missing).
do $mig$
declare v_src text;
begin
  v_src := pg_get_functiondef('public.transfer_order_destination(uuid, text)'::regprocedure);
  if position($s$when v_status in ('for_layaway', 'keep')$s$ in v_src) = 0 then
    raise exception 'transfer_order_destination: status case not found — aborting.';
  end if;
  execute replace(
    v_src,
    $s$when v_status in ('for_layaway', 'keep')$s$,
    $s$when v_status in ('for_layaway', 'keep', 'invoiced', 'awaiting_required_payment', 'required_payment_verified')$s$
  );
end;
$mig$;
