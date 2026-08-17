-- P1 (2026-08-17): Scrap in Cash & Reports + Walk-In "Scrap" payment method.
--  * A STANDALONE scrap purchase paid from the drawer is a clean cash OUT.
--  * A WALK-IN scrap payment is the customer paying (cash IN) with the shop simultaneously
--    buying that scrap for cash (cash OUT) — the pair nets to zero on the drawer, so the plain
--    Cash portion is the only net movement (Owner's chosen model: cash purchase + full payment).
--  * CUTOFF 2026-08-17: scrap counts only from go-live, so historical daily summaries are
--    unchanged (no silent recalculation of the past — Req 15). Historical scrap (₱22.1M / 468
--    rows as of go-live) is reported separately, never folded into past days.
--
-- Applied live via Supabase MCP; committed here so the schema is not drift-only.

-- 1) Accept 'Scrap' as a payment method (added to the existing accepted set).
alter table public.payments drop constraint if exists payments_payment_method_check;
alter table public.payments add constraint payments_payment_method_check
  check (payment_method is null or payment_method = any (array[
    'bank_transfer','e_wallet','cash','card','other',
    'Cash','GCash','BPI','BDO','BDO NEW','BDO UNIBANK','Credit Card','Trade','Remittance','Scrap'
  ]::text[]));

-- 2) daily_cash_summary — add scrap cash-out + count the paired Scrap payment as cash-in.
create or replace function public.daily_cash_summary(p_date date)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_cash numeric; v_in numeric; v_out numeric; v_exp numeric; v_rem numeric;
  v_scrap numeric; v_prev numeric; v_close public.daily_cash_closes;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode='insufficient_privilege';
  end if;
  -- Cash IN from payments: physical Cash PLUS a walk-in Scrap payment (paired with the scrap
  -- cash-out below → the pair nets to zero; the plain Cash portion is the real movement).
  select coalesce(sum(amount),0) into v_cash from public.payments
   where payment_method in ('Cash','Scrap') and status='verified' and voided_at is null and reversed_at is null
     and coalesce(is_test,false)=false
     and date(coalesce(transacted_at, recorded_at, created_at) at time zone 'Asia/Manila') = p_date;
  select coalesce(sum(amount),0) into v_in from public.daily_cash_movements
   where direction='in' and movement_date=p_date and is_test=false;
  select coalesce(sum(amount),0) into v_out from public.daily_cash_movements
   where direction='out' and movement_date=p_date and is_test=false;
  select coalesce(sum(amount),0) into v_exp from public.daily_cash_expenses
   where expense_date=p_date and is_test=false;
  select coalesce(sum(amount),0) into v_rem from public.daily_cash_remittances
   where remit_date=p_date and is_test=false;
  -- Scrap purchases paid from the cash drawer (Cash or unspecified) — cash OUT. Go-live cutoff.
  select coalesce(sum(amount),0) into v_scrap from public.scrap_sales
   where sold_on = p_date and sold_on >= date '2026-08-17'
     and lower(coalesce(payment_method,'cash')) = 'cash';
  select coalesce((select actual_cash_count from public.daily_cash_closes
     where close_date < p_date and status='closed' order by close_date desc limit 1), 0) into v_prev;
  select * into v_close from public.daily_cash_closes where close_date = p_date;
  return jsonb_build_object(
    'date', p_date, 'cashSales', v_cash, 'previousCash', v_prev, 'otherCashIn', v_in,
    'expenses', v_exp, 'remittance', v_rem, 'otherCashOut', v_out, 'scrapCashOut', v_scrap,
    'expected', (v_cash + v_prev + v_in) - (v_exp + v_rem + v_out + v_scrap),
    'actualCount', v_close.actual_cash_count, 'closeStatus', coalesce(v_close.status,'open'));
end; $function$;
