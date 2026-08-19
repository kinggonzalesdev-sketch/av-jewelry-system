-- Durable per-capture DIRECT-PRINT diagnostic (2026-08-19). Technical-only, NO PII: it records
-- what happened during the phone's local maybePrintDirect() attempt so ONE controlled capture is
-- diagnosable read-only from the server, without needing Logcat on a tethered phone.
--
-- maybePrintDirect() runs BEFORE create_pending_capture(), so the phone passes its result in and
-- the created row records it. Additive + non-destructive: a new nullable jsonb column + a defaulted
-- param; born-printed and the poller/PC fallback behaviour are UNCHANGED.
--
-- Stored keys (all technical): attempted, result (success|failed|skipped), socket_warm,
-- error_class (exception class / skip reason only), duration_ms, attempted_at. NEVER a customer
-- name, screenshot, message, Bluetooth address, or token.

alter table public.capture_records add column if not exists print_diag jsonb;

-- Drop the prior 5-arg signature first so a 6-arg-with-default doesn't create an ambiguous
-- named-argument overload; the lib now always passes p_print_diag.
drop function if exists public.create_pending_capture(text, text, text, jsonb, text);

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
  -- Only 'printed' is honoured (a device that already printed the sticker locally); any other
  -- value keeps the default 'pending' so the PC's auto-print still handles it.
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
           print_diag = coalesce(p_print_diag, print_diag)
     where id = v_existing and official_order_id is null;
    return jsonb_build_object('capture_record_id', v_existing, 'idempotent', true);
  end if;

  insert into public.capture_records (
    device_installation_id, capture_id, screenshot_path, ocr,
    captured_by, source, message_status, print_status, print_diag
  ) values (
    trim(p_device), trim(p_capture_id), nullif(trim(p_screenshot_path), ''), p_ocr,
    app_private.current_staff_id(), 'floating', 'pending', coalesce(v_print, 'pending'), p_print_diag
  ) returning id into v_id;

  return jsonb_build_object('capture_record_id', v_id, 'idempotent', false);
end;
$function$;

revoke all on function public.create_pending_capture(text, text, text, jsonb, text, jsonb)
  from public, anon;
grant execute on function public.create_pending_capture(text, text, text, jsonb, text, jsonb)
  to authenticated;
