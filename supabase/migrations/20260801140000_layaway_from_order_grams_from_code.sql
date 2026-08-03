-- Fix (Owner-reported): "Set Up Layaway" on a For-Layaway order rejected per-gram
-- interest with "This order has no grams" even though the modal showed the grams
-- (e.g. 2.01g) and the interest (₱301.50). Cause: the RPC derived grams ONLY from
-- inventory_items.grams_per_piece, which is blank when the weight lives only inside
-- the item code (e.g. "SBA-N-2683 1.80g"). The app parses grams from that code, so
-- the client and server disagreed. This makes the server fall back to the grams
-- embedded in the code — mirroring the app's parseInventoryCode and the earlier
-- grams backfill — so per-gram interest works whenever the code carries the weight.
--
-- Only the grams SELECT changes; the rest of the function is unchanged.
create or replace function public.create_layaway_from_order(
  p_order_id uuid,
  p_interest_type text,
  p_term smallint,
  p_remarks text,
  p_payment numeric,
  p_mode_of_payment text,
  p_reference text default null::text,
  p_admin_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid; v_admin uuid; v_customer uuid; v_customer_name text; v_order_no text;
  v_converted boolean; v_grams numeric; v_item_amount numeric; v_rate numeric;
  v_letter text; v_code text; v_month1 numeric; v_grand numeric; v_pay numeric;
  v_balance numeric; v_status text; v_ledger uuid; v_account_no text; v_date date;
  v_per numeric; v_running numeric := 0; v_due date; v_next_due date; v_basis text; n int;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: creating a layaway record is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;
  if p_order_id is null then
    raise exception 'An order is required.' using errcode = 'check_violation';
  end if;
  if coalesce(p_term, 0) not in (1, 2, 3) then
    raise exception 'Choose a term of 1, 2 or 3 months.' using errcode = 'check_violation';
  end if;
  if p_interest_type not in ('none', 'per_gram') then
    raise exception 'Choose an interest type.' using errcode = 'check_violation';
  end if;

  -- Lock the order so two saves cannot both convert it.
  select o.customer_id, cu.display_name, o.order_number, o.converted_to_layaway
    into v_customer, v_customer_name, v_order_no, v_converted
  from public.official_orders o
  left join public.customers cu on cu.id = o.customer_id
  where o.id = p_order_id
  for update of o;
  if v_customer_name is null then
    raise exception 'That order or its customer could not be found.' using errcode = 'no_data_found';
  end if;
  if v_converted then
    raise exception 'This order was already set up as a layaway.' using errcode = 'check_violation';
  end if;

  v_item_amount := round(coalesce(app_private.total_amount_payable(p_order_id), 0), 2);
  if v_item_amount <= 0 then
    raise exception 'This order has no amount to place on layaway.' using errcode = 'check_violation';
  end if;

  -- Grams: prefer the stored weight; when blank (the weight lives only in the item
  -- code, e.g. "SBA-N-2683 1.80g"), fall back to the grams embedded in the code so
  -- per-gram interest matches what the app shows.
  select coalesce(sum(
           coalesce(
             nullif(ii.grams_per_piece, 0),
             nullif(substring(ii.item_code from '([0-9]*\.?[0-9]+)\s*[gG]'), '')::numeric,
             0
           )
         ), 0)
    into v_grams
  from public.official_order_claims oc
  join public.claims c on c.id = oc.claim_id
  join public.inventory_items ii on ii.id = c.inventory_item_id
  where oc.official_order_id = p_order_id;

  v_staff := app_private.current_staff_id();
  v_admin := app_private.resolve_admin_staff(p_admin_id);
  v_date  := (now() at time zone 'Asia/Manila')::date;
  v_rate  := app_private.layaway_interest_per_gram();

  if p_interest_type = 'none' then
    v_basis := 'zero'; v_month1 := 0;
  else
    if coalesce(v_grams, 0) <= 0 then
      raise exception 'This order has no grams, so per-gram interest cannot be charged. Use No Interest.'
        using errcode = 'check_violation';
    end if;
    v_basis := 'per_gram_150';
    v_month1 := round(v_grams * v_rate, 2);
  end if;

  v_grand := round(v_item_amount + v_month1, 2);
  v_pay := round(coalesce(p_payment, 0), 2);
  if v_pay < 0 then
    raise exception 'Enter a payment of zero or more.' using errcode = 'check_violation';
  end if;
  if v_pay > v_grand then
    raise exception 'Payment exceeds the remaining balance of %.',
      '₱' || to_char(v_grand, 'FM999,999,999,990.00') using errcode = 'check_violation';
  end if;
  v_balance := round(v_grand - v_pay, 2);
  v_status  := case when v_balance <= 0 then 'completed' else 'active' end;

  v_letter := public.layaway_letter_for_name(v_customer_name);
  if v_letter is null then
    raise exception 'The customer name has no letter to derive a layaway code from.'
      using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('layaway_code_pool'));
  v_code := public.next_layaway_code(v_letter);
  if v_code is null and v_balance > 0 then
    raise exception 'No available layaway code remains under letter %.', v_letter
      using errcode = 'check_violation';
  end if;

  select 'LAY-' || to_char(v_date, 'YYYY') || '-' ||
         lpad((coalesce(max(substring(account_no from '\d+$')::int), 0) + 1)::text, 6, '0')
    into v_account_no
  from public.layaway_ledger
  where account_no like 'LAY-' || to_char(v_date, 'YYYY') || '-%';

  insert into public.layaway_ledger (
    account_no, customer_name, status, remarks, date_purchased,
    item_amount, interest, grand_total, payment, balance,
    layaway_code, monthly_interest, total_installment_interest,
    mode_of_payment, latest_payment_dp, last_payment_date,
    interest_type, layaway_term, interest_rate,
    grams, interest_basis, monthly_interest_rate,
    inventory_item_id, customer_id, admin_staff_profile_id, created_by, source_kind
  ) values (
    v_account_no, trim(v_customer_name), v_status, nullif(trim(p_remarks), ''), v_date,
    v_item_amount, v_month1, v_grand, v_pay, v_balance,
    v_code, v_month1, v_month1,
    nullif(trim(p_mode_of_payment), ''), nullif(v_pay, 0),
    case when v_pay > 0 then v_date end,
    case when p_interest_type = 'none' then 'zero' else 'custom' end,
    p_term, 0,
    v_grams, v_basis, v_rate,
    null, v_customer, v_admin, v_staff, 'manual'
  ) returning id into v_ledger;

  if v_code is not null and v_balance > 0 then
    insert into public.layaway_code_pool (code, ref) values (v_code, 'ledger:' || v_ledger::text);
  end if;

  if v_month1 > 0 then
    insert into public.layaway_interest_charges
      (ledger_id, period_month, period_date, amount, grams, rate_per_gram, posted_by)
    values (v_ledger, 1, v_date, v_month1, v_grams, v_rate, v_staff);
  end if;

  v_per := round(v_item_amount / p_term, 2);
  for n in 1..p_term loop
    v_due := (v_date + (n || ' month')::interval)::date;
    if n = 1 then v_next_due := v_due; end if;
    insert into public.layaway_ledger_installments
      (ledger_id, sequence, due_date, interest, expected_dp, status)
    values (v_ledger, n::smallint, v_due, 0,
      case when n < p_term then v_per else round(v_item_amount - v_running, 2) end, 'pending');
    v_running := v_running + v_per;
  end loop;
  update public.layaway_ledger set next_due_date = v_next_due where id = v_ledger;

  if v_pay > 0 then
    insert into public.layaway_ledger_payments
      (ledger_id, sequence, payment_date, amount, mode_of_payment, reference, received_by, recorded_at)
    values (v_ledger, 1, v_date, v_pay, nullif(trim(p_mode_of_payment), ''),
            nullif(trim(p_reference), ''), v_staff, now());
  end if;

  -- Move the order OUT of Orders → For Layaway: mark it converted + link the ledger.
  update public.official_orders
     set converted_to_layaway = true, converted_layaway_ledger_id = v_ledger
   where id = p_order_id;

  return jsonb_build_object(
    'ledger_id', v_ledger, 'account_no', v_account_no, 'layaway_code', v_code,
    'letter', v_letter, 'item_amount', v_item_amount, 'monthly_interest', v_month1,
    'interest', v_month1, 'grand_total', v_grand, 'payment', v_pay,
    'balance', v_balance, 'status', v_status, 'order_number', coalesce(v_order_no, '—'), 'grams', v_grams
  );
end;
$function$;
