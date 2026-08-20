-- ONE Capture = ONE physical sticker (2026-08-20). Fix the direct-local double-print.
--
-- ROOT CAUSE: the direct-local path prints immediately (~1s) then calls create_pending_capture
-- with printStatus='printed' (born-printed). That set print_status='printed' but left
-- sticker_printed_at NULL. The mobile poller's claim (claim_next_capture_sticker) and the pc-web
-- fallback (pending-actions) both gate on `sticker_printed_at is null` — they never check
-- print_status — so they RE-CLAIMED the already-printed capture and printed a SECOND sticker
-- when the "Sent to MineFlow" network step completed.
--
-- FIX (DB-only, additive, no app/web change):
--   1. create_pending_capture: when born-printed, ALSO stamp sticker_printed_at + sticker_claimed_by
--      ('direct-local') + sticker_claimed_at, so EVERY claim gate that checks sticker_printed_at
--      now skips it.
--   2. claim_next_capture_sticker + claim_capture_sticker_by_id: also require print_status <> 'printed'
--      (belt-and-suspenders — a born-printed row is never claimable even if sticker_printed_at were null).
-- Fallback for a genuinely un-printed ('pending') capture is UNCHANGED — it stays claimable.

create or replace function public.create_pending_capture(
  p_device text,
  p_capture_id text,
  p_screenshot_path text,
  p_ocr jsonb,
  p_print_status text default null,
  p_print_diag jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key      text;
  v_id       uuid;
  v_existing uuid;
  v_print    text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;
  if coalesce(trim(p_device), '') = '' or coalesce(trim(p_capture_id), '') = '' then
    raise exception 'A device id and capture id are required.';
  end if;
  v_print := case when p_print_status = 'printed' then 'printed' else null end;

  v_key := 'capture:' || trim(p_device) || ':' || trim(p_capture_id);
  select id into v_existing from public.capture_records where idempotency_key = v_key;
  if v_existing is not null then
    update public.capture_records
       set screenshot_path = coalesce(nullif(trim(p_screenshot_path), ''), screenshot_path),
           ocr = coalesce(p_ocr, ocr),
           print_status = case
             when v_print = 'printed' and coalesce(print_status, '') in ('pending', 'failed', '')
             then 'printed' else print_status end,
           -- Born-printed => mark PRINTED + CLAIMED (direct-local) so the poller / pc-web skip it.
           sticker_printed_at = case
             when v_print = 'printed' and sticker_printed_at is null then now()
             else sticker_printed_at end,
           sticker_claimed_by = case
             when v_print = 'printed' and sticker_claimed_by is null then 'direct-local'
             else sticker_claimed_by end,
           sticker_claimed_at = case
             when v_print = 'printed' and sticker_claimed_at is null then now()
             else sticker_claimed_at end,
           print_diag = coalesce(p_print_diag, print_diag)
     where id = v_existing and official_order_id is null;
    return jsonb_build_object('capture_record_id', v_existing, 'idempotent', true);
  end if;

  insert into public.capture_records (
    device_installation_id, capture_id, screenshot_path, ocr,
    captured_by, source, message_status, print_status, print_diag,
    sticker_printed_at, sticker_claimed_by, sticker_claimed_at
  ) values (
    trim(p_device), trim(p_capture_id), nullif(trim(p_screenshot_path), ''), p_ocr,
    app_private.current_staff_id(), 'floating', 'pending', coalesce(v_print, 'pending'), p_print_diag,
    case when v_print = 'printed' then now() else null end,
    case when v_print = 'printed' then 'direct-local' else null end,
    case when v_print = 'printed' then now() else null end
  ) returning id into v_id;

  return jsonb_build_object('capture_record_id', v_id, 'idempotent', false);
end;
$function$;

-- The shared queue claim: skip anything already printed (sticker_printed_at set) OR born-printed
-- locally (print_status='printed'). A 'pending' capture stays claimable — fallback intact.
create or replace function public.claim_next_capture_sticker(p_device text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rec public.capture_records;
  v_fb text;
  v_grams text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec
  from public.capture_records r
  where r.source = 'floating'
    and coalesce(r.is_test, false) = false
    and r.sticker_printed_at is null
    and coalesce(r.print_status, '') <> 'printed'
    and (r.sticker_claimed_at is null or r.sticker_claimed_at < now() - interval '45 seconds')
    and length(trim(coalesce(r.ocr->>'fbName', r.ocr->>'fb_name', r.ocr->>'name', ''))) >= 2
    and nullif(substring(
          coalesce(r.ocr->>'grams', r.ocr->>'weight', r.ocr->>'itemQuery', r.ocr->>'item', '')
          from '[0-9]+(?:\.[0-9]+)?'), '') is not null
  order by r.captured_at asc
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  update public.capture_records
     set sticker_claimed_by = nullif(trim(coalesce(p_device, '')), ''), sticker_claimed_at = now()
   where id = v_rec.id;
  v_fb := trim(coalesce(v_rec.ocr->>'fbName', v_rec.ocr->>'fb_name', v_rec.ocr->>'name', ''));
  v_grams := substring(
    coalesce(v_rec.ocr->>'grams', v_rec.ocr->>'weight', v_rec.ocr->>'itemQuery', v_rec.ocr->>'item', '')
    from '[0-9]+(?:\.[0-9]+)?');
  return jsonb_build_object('claimed', true, 'capture_record_id', v_rec.id, 'fb_name', v_fb, 'grams', v_grams);
end;
$function$;

-- Same guard on the by-id fast self-claim (defined for the capturing phone).
create or replace function public.claim_capture_sticker_by_id(p_capture_record_id uuid, p_device text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rec public.capture_records;
  v_fb text;
  v_grams text;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized.' using errcode = 'insufficient_privilege';
  end if;
  select * into v_rec
  from public.capture_records r
  where r.id = p_capture_record_id
    and r.source = 'floating'
    and coalesce(r.is_test, false) = false
    and r.sticker_printed_at is null
    and coalesce(r.print_status, '') <> 'printed'
    and (r.sticker_claimed_at is null or r.sticker_claimed_at < now() - interval '45 seconds')
    and length(trim(coalesce(r.ocr->>'fbName', r.ocr->>'fb_name', r.ocr->>'name', ''))) >= 2
    and nullif(substring(
          coalesce(r.ocr->>'grams', r.ocr->>'weight', r.ocr->>'itemQuery', r.ocr->>'item', '')
          from '[0-9]+(?:\.[0-9]+)?'), '') is not null
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false);
  end if;
  update public.capture_records
     set sticker_claimed_by = nullif(trim(coalesce(p_device, '')), ''), sticker_claimed_at = now()
   where id = v_rec.id;
  v_fb := trim(coalesce(v_rec.ocr->>'fbName', v_rec.ocr->>'fb_name', v_rec.ocr->>'name', ''));
  v_grams := substring(
    coalesce(v_rec.ocr->>'grams', v_rec.ocr->>'weight', v_rec.ocr->>'itemQuery', v_rec.ocr->>'item', '')
    from '[0-9]+(?:\.[0-9]+)?');
  return jsonb_build_object('claimed', true, 'capture_record_id', v_rec.id, 'fb_name', v_fb, 'grams', v_grams);
end;
$function$;