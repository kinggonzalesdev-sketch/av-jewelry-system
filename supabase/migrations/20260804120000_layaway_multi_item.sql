-- Layaway New Entry overhaul (Owner request):
--   1. Support MULTIPLE items per layaway (mirrors the Orders multi-item flow).
--   2. Interest reflects the FULL TERM: (total grams × ₱150) per month × term,
--      instead of "Month 1 only".
--   3. Grams fall back to the weight embedded in the item code/name when the stored
--      grams_per_piece is blank (fixes "has no grams recorded" when the app showed
--      grams parsed from the code).
--   4. The opening payment carries its own Date Payment.
--
-- New child table layaway_ledger_items holds one row per item; layaway_ledger keeps
-- the aggregate (item_amount = Σ, grams = Σ) so every existing reader still works.

-- ---- Grams embedded in a code/name (e.g. "BNA-B-1694 1.86g") ----------------
create or replace function app_private.grams_from_code(p_code text)
returns numeric
language sql
immutable
as $$
  select nullif(substring(coalesce(p_code, '') from '([0-9]*\.?[0-9]+)\s*[gG]'), '')::numeric;
$$;

-- ---- One row per item on a layaway account ---------------------------------
create table if not exists public.layaway_ledger_items (
  id uuid primary key default gen_random_uuid(),
  ledger_id uuid not null references public.layaway_ledger(id) on delete cascade,
  inventory_item_id uuid references public.inventory_items(id) on delete set null,
  item_code text,
  item_name text,
  grams numeric,
  pricing_type text not null check (pricing_type in ('fixed', 'per_gram')),
  unit_price numeric not null,
  item_amount numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists layaway_ledger_items_ledger_idx
  on public.layaway_ledger_items (ledger_id);

alter table public.layaway_ledger_items enable row level security;
drop policy if exists layaway_ledger_items_read on public.layaway_ledger_items;
create policy layaway_ledger_items_read on public.layaway_ledger_items
  for select to authenticated using (app_private.is_active_staff());

-- ---- Rewritten create RPC (multi-item, full-term interest, payment date) ----
drop function if exists public.create_layaway_account(
  text, uuid, text, numeric, text, smallint, date, text, numeric, text, uuid);

create or replace function public.create_layaway_account(
  p_customer_name text,
  p_items jsonb,
  p_interest_type text,
  p_term smallint,
  p_date_purchased date,
  p_remarks text,
  p_payment numeric,
  p_payment_date date,
  p_mode_of_payment text,
  p_admin_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_staff uuid; v_admin uuid; v_customer uuid;
  v_rate numeric; v_letter text; v_code text;
  v_total_item numeric := 0; v_total_grams numeric := 0;
  v_monthly numeric; v_interest numeric; v_grand numeric;
  v_pay numeric; v_balance numeric; v_status text;
  v_ledger uuid; v_account_no text; v_date date; v_pay_date date;
  v_per numeric; v_running numeric := 0; v_due date; v_next_due date;
  v_basis text; n int; v_first_iid uuid; v_first_code text; v_count int;
  v_elem jsonb; v_computed jsonb := '[]'::jsonb;
  v_iid uuid; v_ptype text; v_price numeric;
  v_avail text; v_archived boolean; v_ic text; v_iname text; v_gpp numeric;
  v_g numeric; v_amount numeric;
begin
  if app_private.current_staff_role() not in ('owner', 'selected_admin') then
    raise exception 'Not authorized: creating a layaway account is reserved to the Owner or an Admin.'
      using errcode = 'insufficient_privilege';
  end if;

  if coalesce(trim(p_customer_name), '') = '' then
    raise exception 'Enter the customer name.' using errcode = 'check_violation';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one item to the layaway.' using errcode = 'check_violation';
  end if;
  if coalesce(p_term, 0) not in (1, 2, 3) then
    raise exception 'Choose a term of 1, 2 or 3 months.' using errcode = 'check_violation';
  end if;
  if p_interest_type not in ('none', 'per_gram') then
    raise exception 'Choose an interest type.' using errcode = 'check_violation';
  end if;

  v_staff    := app_private.current_staff_id();
  v_admin    := app_private.resolve_admin_staff(p_admin_id);
  v_date     := coalesce(p_date_purchased, (now() at time zone 'Asia/Manila')::date);
  v_pay_date := coalesce(p_payment_date, v_date);
  v_rate     := app_private.layaway_interest_per_gram();

  -- Pass 1: validate + lock + consume each item, accumulate the totals.
  for v_elem in select * from jsonb_array_elements(p_items) loop
    v_iid   := nullif(v_elem->>'inventory_item_id', '')::uuid;
    v_ptype := coalesce(v_elem->>'pricing_type', 'fixed');
    v_price := coalesce(nullif(v_elem->>'price', '')::numeric, 0);

    if v_iid is null then
      raise exception 'Select an item from Active Inventory.' using errcode = 'check_violation';
    end if;
    if v_ptype not in ('fixed', 'per_gram') then
      raise exception 'Choose a pricing type for each item.' using errcode = 'check_violation';
    end if;
    if v_price <= 0 then
      raise exception 'Enter a price greater than zero for each item.' using errcode = 'check_violation';
    end if;

    select availability_status, is_archived, item_code, item_name, grams_per_piece
      into v_avail, v_archived, v_ic, v_iname, v_gpp
    from public.inventory_items where id = v_iid for update;
    if v_ic is null then
      raise exception 'That inventory item could not be found.' using errcode = 'no_data_found';
    end if;
    if v_archived or v_avail not in ('available', 'returned_to_available') then
      raise exception 'Item % is no longer available. Please select another item.', v_ic
        using errcode = 'check_violation';
    end if;

    -- Grams: stored weight, else the weight embedded in the item code or name.
    v_g := coalesce(nullif(v_gpp, 0), app_private.grams_from_code(v_ic),
                    app_private.grams_from_code(v_iname), 0);

    if v_ptype = 'per_gram' then
      if coalesce(v_g, 0) <= 0 then
        raise exception 'Item % has no grams recorded, so it cannot be priced per gram.', v_ic
          using errcode = 'check_violation';
      end if;
      v_amount := round(v_g * v_price, 2);
    else
      v_amount := round(v_price, 2);
    end if;

    v_total_item  := v_total_item + v_amount;
    v_total_grams := v_total_grams + coalesce(v_g, 0);

    update public.inventory_items set availability_status = 'committed' where id = v_iid;

    if v_first_iid is null then v_first_iid := v_iid; v_first_code := v_ic; end if;
    v_computed := v_computed || jsonb_build_object(
      'iid', v_iid, 'code', v_ic, 'name', v_iname,
      'grams', v_g, 'ptype', v_ptype, 'price', v_price, 'amount', v_amount);
  end loop;

  -- Interest = (total grams × ₱150) per month × the whole term.
  if p_interest_type = 'none' then
    v_basis := 'zero'; v_monthly := 0;
  else
    if coalesce(v_total_grams, 0) <= 0 then
      raise exception 'No grams recorded on these items, so per-gram interest cannot be charged. Use No Interest.'
        using errcode = 'check_violation';
    end if;
    v_basis := 'per_gram_150';
    v_monthly := round(v_total_grams * v_rate, 2);
  end if;
  v_interest := round(v_monthly * p_term, 2);
  v_grand    := round(v_total_item + v_interest, 2);

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

  -- Automatic layaway code.
  v_letter := public.layaway_letter_for_name(p_customer_name);
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

  -- Overdue date = end of the chosen term.
  v_next_due := (v_date + (p_term || ' month')::interval)::date;

  insert into public.layaway_ledger (
    account_no, customer_name, status, remarks, date_purchased,
    item_amount, interest, grand_total, payment, balance,
    layaway_code, monthly_interest, total_installment_interest,
    mode_of_payment, latest_payment_dp, last_payment_date,
    interest_type, layaway_term, interest_rate,
    grams, interest_basis, monthly_interest_rate,
    inventory_item_id, customer_id, admin_staff_profile_id, created_by, source_kind,
    next_due_date
  ) values (
    v_account_no, trim(p_customer_name), v_status, nullif(trim(p_remarks), ''), v_date,
    v_total_item, v_interest, v_grand, v_pay, v_balance,
    v_code, v_monthly, v_interest,
    nullif(trim(p_mode_of_payment), ''), nullif(v_pay, 0),
    case when v_pay > 0 then v_pay_date end,
    case when p_interest_type = 'none' then 'zero' else 'custom' end,
    p_term, 0,
    v_total_grams, v_basis, v_rate,
    v_first_iid, null, v_admin, v_staff, 'manual',
    v_next_due
  ) returning id into v_ledger;

  -- One row per item.
  for v_elem in select * from jsonb_array_elements(v_computed) loop
    insert into public.layaway_ledger_items
      (ledger_id, inventory_item_id, item_code, item_name, grams, pricing_type, unit_price, item_amount)
    values (
      v_ledger, nullif(v_elem->>'iid', '')::uuid,
      v_elem->>'code', v_elem->>'name',
      nullif(v_elem->>'grams', '')::numeric,
      v_elem->>'ptype', (v_elem->>'price')::numeric, (v_elem->>'amount')::numeric);
  end loop;

  if v_code is not null and v_balance > 0 then
    insert into public.layaway_code_pool (code, ref) values (v_code, 'ledger:' || v_ledger::text);
  end if;

  -- Interest charged upfront for the whole term (one posting per month).
  if v_monthly > 0 then
    for n in 1..p_term loop
      insert into public.layaway_interest_charges
        (ledger_id, period_month, period_date, amount, grams, rate_per_gram, posted_by)
      values (v_ledger, n::smallint, (v_date + (n || ' month')::interval)::date,
              v_monthly, v_total_grams, v_rate, v_staff);
    end loop;
  end if;

  select id into v_customer from public.customers
   where lower(display_name) = lower(trim(p_customer_name)) and is_active
   order by created_at limit 1;
  if v_customer is null then
    insert into public.customers (display_name) values (trim(p_customer_name)) returning id into v_customer;
  end if;
  update public.layaway_ledger set customer_id = v_customer where id = v_ledger;

  -- Installment schedule: the principal spread over the term.
  v_per := round(v_total_item / p_term, 2);
  for n in 1..p_term loop
    v_due := (v_date + (n || ' month')::interval)::date;
    insert into public.layaway_ledger_installments
      (ledger_id, sequence, due_date, interest, expected_dp, status)
    values (v_ledger, n::smallint, v_due, 0,
      case when n < p_term then v_per else round(v_total_item - v_running, 2) end, 'pending');
    v_running := v_running + v_per;
  end loop;

  -- Opening payment, on its own Date Payment.
  if v_pay > 0 then
    insert into public.layaway_ledger_payments
      (ledger_id, sequence, payment_date, amount, mode_of_payment, received_by, recorded_at)
    values (v_ledger, 1, v_pay_date, v_pay, nullif(trim(p_mode_of_payment), ''), v_staff, now());
  end if;

  v_count := jsonb_array_length(v_computed);
  return jsonb_build_object(
    'ledger_id', v_ledger, 'account_no', v_account_no, 'layaway_code', v_code,
    'letter', v_letter, 'item_amount', v_total_item, 'monthly_interest', v_monthly,
    'interest', v_interest, 'grand_total', v_grand, 'payment', v_pay,
    'balance', v_balance, 'status', v_status,
    'item_code', case when v_count > 1 then v_first_code || ' +' || (v_count - 1) || ' more' else v_first_code end,
    'grams', v_total_grams, 'item_count', v_count);
end;
$function$;

revoke all on function public.create_layaway_account(
  text, jsonb, text, smallint, date, text, numeric, date, text, uuid) from public, anon;
grant execute on function public.create_layaway_account(
  text, jsonb, text, smallint, date, text, numeric, date, text, uuid) to authenticated, service_role;
