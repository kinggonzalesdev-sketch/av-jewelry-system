-- ORDER STICKER eligibility window: 60 seconds → 15 MINUTES (Owner 2026-09-09).
--
-- WHY THIS CHANGED WITHIN THE HOUR. 20260909140000 gave order stickers the same 60s window as the
-- capture queue, on a "one rule, one number" argument. Production disproved that argument the same
-- afternoon: the Capture app went silent for 32 minutes (12:44 → 13:16) while staff kept working,
-- and 15 order stickers clicked between 13:02 and 13:15 expired unprinted with attempts = 0 — the
-- phone never even asked for them. A 60s window cannot survive the app dozing, and the app dozing
-- is routine, not exceptional.
--
-- WHY THE TWO QUEUES NOW DIFFER — the "one number" idea was wrong because the two queues are not
-- the same kind of thing:
--   * CAPTURE stickers auto-print during a Live with NO per-sticker click. Nobody is waiting for
--     any particular one, so anything not printed within seconds is unwanted paper. 60s is the
--     whole safety mechanism there and MUST NOT be touched (20260909120000).
--   * ORDER stickers are an EXPLICIT click by a person standing at the counter who is waiting for
--     that exact sticker. Printing it 8 minutes later is not a surprise — it is the thing they
--     asked for, arriving late. The "nothing more" risk a window guards against barely applies.
-- So the window here can be generous enough to ride out a sleeping phone without ever resurrecting
-- an hour-old sticker.
--
-- 15 minutes: long enough to cover the observed 30-minute-scale outages for most of a working
-- burst, short enough that nothing from an earlier session can come back. This does NOT touch the
-- capture queue, the sticker layout, or any order/inventory/payment logic.
--
-- NOTE ON IMMEDIATE EFFECT: the window is evaluated at CLAIM time against queued_at, so applying
-- this makes already-"expired" jobs younger than 15 minutes claimable again. That is intended —
-- those are stickers a person clicked minutes ago and is still waiting for.

-- ---------------------------------------------------------------------------
-- claim_next_print_job — widen the window only. Everything else is preserved VERBATIM from
-- 20260909140000: the has_permission gate, FOR UPDATE SKIP LOCKED, the attempts increment, and
-- the returned payload.
-- ---------------------------------------------------------------------------
create or replace function public.claim_next_print_job(p_device text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v public.print_jobs;
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  select * into v from public.print_jobs
    where status = 'queued'
      and claimed_at is null
      -- NOTHING MORE: never serve a stale click. 15 minutes — see the header for why this is
      -- deliberately LONGER than the capture queue's 60s.
      and queued_at >= now() - interval '15 minutes'
    order by created_at asc for update skip locked limit 1;
  if not found then return jsonb_build_object('claimed', false); end if;
  update public.print_jobs set status = 'claimed',
    claimed_by_device = nullif(trim(coalesce(p_device,'')),''),
    claimed_at = now(), attempts = attempts + 1
  where id = v.id;
  return jsonb_build_object(
    'claimed', true, 'print_job_id', v.id, 'job_type', v.job_type,
    'official_order_id', v.official_order_id, 'sticker', v.sticker,
    'label_size', v.label_size, 'is_test', v.is_test);
end;
$function$;

-- ---------------------------------------------------------------------------
-- requeue_print_job — its "re-arm an expired queued job" branch must use the SAME window, or a job
-- between 60s and 15min old would be rejected by Retry while still being perfectly claimable.
-- The 2-minute staleness floor on 'claimed' is a different thing (the double-print guard) and is
-- deliberately left alone.
-- ---------------------------------------------------------------------------
create or replace function public.requeue_print_job(p_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app_private.has_permission('confirm_claim_print_label') then
    raise exception 'Not authorized to print labels.' using errcode = 'insufficient_privilege';
  end if;
  update public.print_jobs
     set status = 'queued',
         queued_at = now(),
         claimed_by_device = null,
         claimed_at = null,
         failed_reason = null
   where id = p_id
     and (
       status in ('failed', 'voided')
       or (status = 'queued' and queued_at < now() - interval '15 minutes')
       or (status = 'claimed' and claimed_at < now() - interval '2 minutes')
     );
end;
$function$;
