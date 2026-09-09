-- ORDER STICKERS: NO SILENT LOSS, NO SURPRISE PRINTS (Owner 2026-09-09).
--
-- OWNER RULE that drives this file: "kung ano lang yung i-click ko sa A.V. Jewelry Capture lang
-- yung makukuha ng system — nothing more nothing less."
--   * NOTHING MORE — a sticker must NEVER print unless a person clicked Print for it, at the time
--     they clicked. An old job coming back to life when a printer reconnects is forbidden. This is
--     the same rule 20260909120000_capture_autoprint_safety applied to the CAPTURE queue.
--   * NOTHING LESS — a sticker a person DID click must never be lost in silence.
--
-- WHAT WENT WRONG. Every print failure was terminal: mark_print_job_failed set status='failed' and
-- nothing ever surfaced it. Between 2026-09-07 and 2026-09-09, 19 of 92 real customer order
-- stickers (~20%) were lost this way — every single one with failed_reason 'Turn on Bluetooth
-- first.'. There has never been a genuinely terminal failure in production: not one malformed
-- sticker, not one empty_sticker. Staff saw "Sticker sent to the printer" and nothing more.
--
-- WHY THIS DOES NOT AUTO-RETRY. Requeueing a failed job so it prints itself when Bluetooth returns
-- would fix "nothing less" by breaking "nothing more" — it is exactly the surprise-print behaviour
-- the capture-queue fix removed hours earlier. Terminal failure is CORRECT here. The defect was
-- that it was SILENT. So: fail fast, fail loud, and reprint ONLY on an explicit click.
--
-- Nothing here touches the CAPTURE sticker queue (capture_records / claim_next_capture_sticker),
-- the sticker layout, or any order/inventory/payment logic.

-- ---------------------------------------------------------------------------
-- 1. queued_at — when this job became eligible to print.
--
-- Separate from created_at so an explicit Retry can restart the eligibility window WITHOUT
-- rewriting the audit trail of when the job was first created.
--
-- Added nullable + backfilled from created_at BEFORE taking a default, because `add column ...
-- default now()` would stamp every historical row with now() and make old queued jobs look freshly
-- eligible — the precise resurrection this migration exists to prevent.
-- ---------------------------------------------------------------------------
alter table public.print_jobs add column if not exists queued_at timestamptz;

update public.print_jobs set queued_at = created_at where queued_at is null;

alter table public.print_jobs
  alter column queued_at set default now(),
  alter column queued_at set not null;

-- ---------------------------------------------------------------------------
-- 2. claim_next_print_job — add the eligibility WINDOW.
--
-- A job that was never claimed within ORDER_PRINT_WINDOW is dead. It is not served, so a phone that
-- was closed/offline when Print was clicked can never wake up later and print a stale sticker.
-- The operator sees it did not print and clicks Retry, which re-arms queued_at.
--
-- 60 seconds deliberately matches the capture queue's AUTO_PRINT_WINDOW: one rule, one number.
-- Normal path is unaffected — the poller claims within ~2.5s of the click.
--
-- Everything else is preserved VERBATIM from the live definition (read back 2026-09-09):
-- the has_permission gate, FOR UPDATE SKIP LOCKED, attempts increment, and the returned payload.
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
      -- NOTHING MORE: never serve a stale click.
      and queued_at >= now() - interval '60 seconds'
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
-- 3. requeue_print_job — the operator's explicit Retry.
--
-- Re-arms a job a PERSON chose to reprint. Sets queued_at = now() so the window restarts; without
-- that, retrying a job older than the window would flip it to 'queued' and it would never be
-- served — a silent loss of the retry itself.
--
-- Accepts 'failed' and 'voided' (an operator may un-void), and a STALE 'claimed' job — a phone that
-- claimed a job and then died (crash / force-stop / app killed) leaves it stuck in 'claimed'
-- forever, invisible and unclaimable. Recovering that requires an explicit click too.
--
-- The 2-minute staleness floor on 'claimed' is a double-print guard: it must be impossible to
-- re-arm a job a phone is actively printing right now.
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
       or (status = 'queued' and queued_at < now() - interval '60 seconds')
       or (status = 'claimed' and claimed_at < now() - interval '2 minutes')
     );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. void_print_job — "mark closed, no reprint".
--
-- Terminal, prints nothing. Lets staff clear a sticker that is no longer needed (the order already
-- went out, a handwritten label was used) so the outstanding list means something. Without this the
-- only ways to clear a failure are to reprint it or to ignore it forever — and an alert everyone
-- ignores is the same as no alert.
-- ---------------------------------------------------------------------------
create or replace function public.void_print_job(p_id uuid, p_reason text default null::text)
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
     set status = 'voided',
         failed_reason = nullif(trim(coalesce(p_reason, failed_reason, '')), ''),
         claimed_by_device = null,
         claimed_at = null
   where id = p_id
     and status in ('queued', 'claimed', 'printing', 'failed');
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Index for the outstanding-stickers panel.
--
-- The UI asks "which order stickers still need attention" on every New Order render, so keep it off
-- a seq scan. Partial: the terminal-and-fine rows ('printed', 'voided') are never queried here.
-- ---------------------------------------------------------------------------
create index if not exists print_jobs_unresolved_idx
  on public.print_jobs (queued_at desc)
  where status in ('queued', 'claimed', 'printing', 'failed');

-- ---------------------------------------------------------------------------
-- 6. ONE-TIME DATA FIX (Owner decision 2026-09-09: "mark them closed, no reprint").
--
-- The 15 order stickers stranded in 'failed' on 2026-09-07/08 — all 'Turn on Bluetooth first.' —
-- are marked 'voided' so they stop reading as outstanding. NOTHING PRINTS. The Owner explicitly
-- chose this over reprinting: those orders may already carry handwritten labels.
--
-- Bounded by date, so this is a no-op on a fresh database or on any later re-run.
-- ---------------------------------------------------------------------------
update public.print_jobs
   set status = 'voided',
       failed_reason = coalesce(failed_reason, '') ||
                       ' [voided 2026-09-09 by Owner decision: closed without reprint]'
 where status = 'failed'
   and created_at < timestamptz '2026-09-09 00:00:00+08';
