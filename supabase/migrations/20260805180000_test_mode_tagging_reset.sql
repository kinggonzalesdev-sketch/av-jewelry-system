-- Test Mode tagging + Reset (Owner request, live-readiness). Additive + low-risk:
--   * new `is_test` columns default FALSE (constant default = metadata-only, no table
--     rewrite, no lock) on the transactional tables a live test creates;
--   * a BEFORE INSERT trigger stamps each new row with the CURRENT test-mode flag, so
--     tagging needs NO change to the create RPCs;
--   * reset_test_data() (Super Admin) deletes only is_test rows, children-first, in one
--     transaction (all-or-nothing — a wrong step rolls back, never a partial delete).
--
-- NOTE: this does not yet release inventory that a test order committed, nor filter
-- test rows out of reports — those are the next increment (make create_capture_order
-- skip inventory commitment in test mode + report isolation).

create or replace function app_private.is_test_mode()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce((select active from public.live_test_state where id = 1), false);
$function$;

alter table public.capture_records   add column if not exists is_test boolean not null default false;
alter table public.official_orders   add column if not exists is_test boolean not null default false;
alter table public.customer_messages add column if not exists is_test boolean not null default false;
alter table public.payments          add column if not exists is_test boolean not null default false;
alter table public.label_jobs        add column if not exists is_test boolean not null default false;
alter table public.order_reminders   add column if not exists is_test boolean not null default false;

create or replace function app_private.stamp_is_test()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  new.is_test := app_private.is_test_mode();
  return new;
end;
$function$;

drop trigger if exists trg_stamp_is_test on public.capture_records;
create trigger trg_stamp_is_test before insert on public.capture_records
  for each row execute function app_private.stamp_is_test();
drop trigger if exists trg_stamp_is_test on public.official_orders;
create trigger trg_stamp_is_test before insert on public.official_orders
  for each row execute function app_private.stamp_is_test();
drop trigger if exists trg_stamp_is_test on public.customer_messages;
create trigger trg_stamp_is_test before insert on public.customer_messages
  for each row execute function app_private.stamp_is_test();
drop trigger if exists trg_stamp_is_test on public.payments;
create trigger trg_stamp_is_test before insert on public.payments
  for each row execute function app_private.stamp_is_test();
drop trigger if exists trg_stamp_is_test on public.label_jobs;
create trigger trg_stamp_is_test before insert on public.label_jobs
  for each row execute function app_private.stamp_is_test();
drop trigger if exists trg_stamp_is_test on public.order_reminders;
create trigger trg_stamp_is_test before insert on public.order_reminders
  for each row execute function app_private.stamp_is_test();

create or replace function public.reset_test_data()
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_orders int; v_payments int; v_messages int;
  v_labels int; v_captures int; v_reminders int;
begin
  if not app_private.is_owner() then
    raise exception 'Only the Super Admin can reset test data.'
      using errcode = 'insufficient_privilege';
  end if;

  -- Children of test PAYMENTS.
  delete from public.payment_verifications where payment_id in (select id from public.payments where is_test);
  delete from public.payment_evidence      where payment_id in (select id from public.payments where is_test);
  delete from public.layaway_installments   where payment_id in (select id from public.payments where is_test);
  delete from public.layaway_arrangements   where deposit_verified_payment_id in (select id from public.payments where is_test);
  -- Children of test LABEL JOBS / MESSAGES.
  delete from public.print_attempts         where label_job_id in (select id from public.label_jobs where is_test);
  delete from public.message_send_attempts  where customer_message_id in (select id from public.customer_messages where is_test);
  -- Children of test ORDERS.
  delete from public.official_order_claims  where official_order_id in (select id from public.official_orders where is_test);
  delete from public.official_order_charges where official_order_id in (select id from public.official_orders where is_test);
  delete from public.fulfillment_records    where official_order_id in (select id from public.official_orders where is_test);
  delete from public.price_overrides        where official_order_id in (select id from public.official_orders where is_test);
  delete from public.layaway_arrangements   where official_order_id in (select id from public.official_orders where is_test);

  -- The tagged rows themselves (order_reminders + capture_records clear before orders).
  delete from public.payments where is_test;          get diagnostics v_payments  = row_count;
  delete from public.customer_messages where is_test; get diagnostics v_messages  = row_count;
  delete from public.label_jobs where is_test;        get diagnostics v_labels    = row_count;
  delete from public.order_reminders where is_test;   get diagnostics v_reminders = row_count;
  delete from public.capture_records where is_test;   get diagnostics v_captures  = row_count;
  delete from public.official_orders where is_test;   get diagnostics v_orders    = row_count;

  return jsonb_build_object(
    'orders', v_orders, 'payments', v_payments, 'messages', v_messages,
    'labels', v_labels, 'captures', v_captures, 'reminders', v_reminders);
end;
$function$;
