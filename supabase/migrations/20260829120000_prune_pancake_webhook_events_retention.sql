-- Webhook-events retention (Owner 2026-08-29): pancake_webhook_events grows ~8.8k rows / ~17MB per
-- day (~10k Live-comment webhooks/day) with NO retention, so it would balloon into GBs of Supabase
-- DB storage + compute pressure. This prunes events older than the retention window. SAFE: the
-- functional readers (media-eligibility window in media-window.ts, conversation resolution RPCs)
-- only ever consult RECENT events, and the (page_id, comment_id) dedup only matters for near-term FB
-- re-deliveries (minutes/hours) — never 30-day-old rows. Nothing is deleted until data actually ages
-- past the window (the table is currently only ~17 days old, so the first runs delete 0). Index-backed
-- by pancake_webhook_events_received_at_idx.
create or replace function public.prune_pancake_webhook_events(retention_days integer default 30)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_deleted integer;
  -- Safety floor: never keep fewer than 7 days, even if called with a smaller/garbage value.
  v_days integer := greatest(coalesce(retention_days, 30), 7);
begin
  delete from public.pancake_webhook_events
   where received_at < (now() - make_interval(days => v_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;

-- Service-role / cron only. Advisor-clean: no anon / authenticated EXECUTE.
revoke all on function public.prune_pancake_webhook_events(integer) from public, anon, authenticated;
grant execute on function public.prune_pancake_webhook_events(integer) to service_role;
