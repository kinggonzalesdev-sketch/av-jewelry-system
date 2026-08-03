-- Owner request: a fully-paid LAYAWAY account must NOT auto-transfer to Completed.
-- Instead it STAYS in active layaway (fully paid, ✓) and the operator transfers it to
-- an Orders destination manually. So: never set 'completed' on full payment, and do
-- NOT release the code on full payment (the code stays with the account until it is
-- explicitly completed or transferred). Everything else — validation, overpayment
-- block, payment insert, balance recompute — is unchanged.
create or replace function public.add_layaway_ledger_payment(
  p_ledger_id uuid,
  p_amount numeric,
  p_payment_date date default null::date,
  p_mop text default null::text,
  p_reference text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid; v_seq smallint; v_grand numeric; v_paid numeric; v_remaining numeric;
  v_status text; v_code text; v_pay numeric; v_bal numeric; v_date date; v_final text;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: recording a layaway payment is reserved to the Owner or Selected Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Enter a payment amount greater than zero.' using errcode = 'check_violation';
  end if;

  select coalesce(grand_total, 0), coalesce(payment, 0), status, layaway_code
    into v_grand, v_paid, v_status, v_code
  from public.layaway_ledger where id = p_ledger_id for update;
  if not found then
    raise exception 'That layaway account could not be found.' using errcode = 'no_data_found';
  end if;
  if v_status = 'needs_review' then
    raise exception 'This account is flagged Needs Review — resolve it before recording a payment.'
      using errcode = 'check_violation';
  end if;

  v_remaining := round(v_grand - v_paid, 2);

  if v_remaining <= 0 then
    raise exception 'This layaway account is already fully paid.' using errcode = 'check_violation';
  end if;
  if round(p_amount, 2) > v_remaining then
    raise exception 'Payment exceeds the remaining balance of ₱%.',
      to_char(v_remaining, 'FM999,999,999,990.00') using errcode = 'check_violation';
  end if;

  v_staff := app_private.current_staff_id();
  v_date := coalesce(p_payment_date, (now() at time zone 'Asia/Manila')::date);

  select coalesce(max(sequence), 0) + 1 into v_seq
  from public.layaway_ledger_payments where ledger_id = p_ledger_id;

  insert into public.layaway_ledger_payments
    (ledger_id, sequence, payment_date, amount, mode_of_payment, reference, received_by, recorded_at)
  values
    (p_ledger_id, v_seq, v_date, round(p_amount, 2), nullif(trim(p_mop), ''),
     nullif(trim(p_reference), ''), v_staff, now());

  v_pay := round(v_paid + p_amount, 2);
  v_bal := round(v_grand - v_pay, 2);
  -- CHANGED (Owner request): a fully-paid account stays ACTIVE — it does NOT auto-
  -- complete. The operator transfers it to a destination manually.
  v_final := 'active';

  update public.layaway_ledger set
    payment = v_pay,
    balance = v_bal,
    balance_mismatch = false,
    last_payment_date = v_date,
    mode_of_payment = coalesce(nullif(trim(p_mop), ''), mode_of_payment),
    latest_payment_dp = round(p_amount, 2),
    status = v_final
  where id = p_ledger_id;

  -- CHANGED (Owner request): the code is NOT released on full payment — the account is
  -- still active, so releasing its code would let another account reuse it while this
  -- one still displays it. Release stays tied to explicit completion / transfer.

  return jsonb_build_object('payment', v_pay, 'balance', v_bal, 'status', v_final);
end;
$function$;
