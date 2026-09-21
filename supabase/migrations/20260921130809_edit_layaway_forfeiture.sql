-- Save the Edit Layaway fields and forfeit the account in one database
-- transaction. The two canonical functions retain their own permission checks,
-- row locks, inventory/code handling and audit behavior. If forfeiture fails,
-- PostgreSQL rolls back the preceding edit automatically.
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

comment on function public.update_layaway_ledger_and_forfeit(
  uuid, text, text, date, numeric, numeric, date, text
) is
  'Atomically saves Edit Layaway fields and invokes the canonical Owner-only forfeiture workflow. Any failure rolls back both operations.';

revoke all on function public.update_layaway_ledger_and_forfeit(
  uuid, text, text, date, numeric, numeric, date, text
) from public, anon;
grant execute on function public.update_layaway_ledger_and_forfeit(
  uuid, text, text, date, numeric, numeric, date, text
) to authenticated, service_role;
