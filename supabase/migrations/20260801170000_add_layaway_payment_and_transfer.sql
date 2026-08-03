-- Record a layaway payment AND transfer the account to an Orders destination in ONE
-- transaction. It composes the two existing SECURITY DEFINER functions — the payment
-- (with all its validation) then the transfer — so if EITHER fails, the WHOLE thing
-- rolls back (no partial payment, no partial move). Both inner functions enforce
-- their own permission + rules; nothing here bypasses them.
create or replace function public.add_layaway_payment_and_transfer(
  p_ledger_id uuid,
  p_amount numeric,
  p_payment_date date,
  p_mop text,
  p_reference text,
  p_destination text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform public.add_layaway_ledger_payment(p_ledger_id, p_amount, p_payment_date, p_mop, p_reference);
  perform public.transfer_layaway_to_destination(p_ledger_id, p_destination);
  return jsonb_build_object('ledger_id', p_ledger_id, 'destination', p_destination, 'source', 'layaway_payment');
end;
$function$;

revoke all on function public.add_layaway_payment_and_transfer(uuid, numeric, date, text, text, text) from public, anon;
grant execute on function public.add_layaway_payment_and_transfer(uuid, numeric, date, text, text, text) to authenticated;
