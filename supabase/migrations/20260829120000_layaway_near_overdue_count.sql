-- Layaway "Near Overdue (30 Days)" summary card — global, DB-backed count (Owner 2026-08-29).
--
-- AUTHORITATIVE overdue rule (Owner-confirmed): overdue date = date_purchased + 3 CALENDAR MONTHS
-- (Postgres `+ interval '3 months'` clamps end-of-month exactly like the client helper). An ACTIVE
-- account is "near overdue" when that date is 1..30 calendar days ahead of TODAY in the business
-- timezone (Asia/Manila) — i.e. not yet overdue (>= today+1) and inside the 30-day window.
--
-- EXCLUDES: completed / forfeited / cancelled (status), fully-paid rows (balance <= 0), and
-- already-overdue rows (date < today) — exactly the spec's card population. Counts the whole
-- ACTIVE ledger dataset globally (never a page). layaway_arrangements is empty, so ledger-only is
-- the complete set; if arrangements are ever used, extend here.
--
-- This is ADDITIVE and monitoring-only: it does NOT change the existing overdue business logic
-- (layaway_is_overdue / the Overdue section filter / forfeiture). SECURITY DEFINER + active-staff
-- gate mirrors layaway_dashboard_metrics; anon EXECUTE is revoked.

create or replace function public.layaway_near_overdue_count()
returns integer
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_today date;
  v_count integer;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;

  v_today := (now() at time zone 'Asia/Manila')::date;

  select count(*)
    into v_count
  from public.layaway_ledger l
  where lower(btrim(l.status)) = 'active'
    and coalesce(l.balance, 0) > 0
    and l.date_purchased is not null
    and (l.date_purchased::date + interval '3 months')::date
        between v_today + 1 and v_today + 30;

  return coalesce(v_count, 0);
end;
$function$;

revoke all on function public.layaway_near_overdue_count() from public;
revoke all on function public.layaway_near_overdue_count() from anon;
grant execute on function public.layaway_near_overdue_count() to authenticated, service_role;
