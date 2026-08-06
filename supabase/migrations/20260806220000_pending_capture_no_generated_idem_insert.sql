-- Fix: capture_records.idempotency_key is a GENERATED column (from
-- device_installation_id + capture_id) — it must not appear in the INSERT column
-- list. Look up existing by the same computed key, but let the generated column
-- populate itself on insert. Final correction on top of 20260806210000.
create or replace function public.create_pending_capture(
  p_device text,
  p_capture_id text,
  p_screenshot_path text,
  p_ocr jsonb
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key      text;
  v_id       uuid;
  v_existing uuid;
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;
  if coalesce(trim(p_device), '') = '' or coalesce(trim(p_capture_id), '') = '' then
    raise exception 'A device id and capture id are required.';
  end if;

  v_key := 'capture:' || trim(p_device) || ':' || trim(p_capture_id);
  select id into v_existing from public.capture_records where idempotency_key = v_key;
  if v_existing is not null then
    update public.capture_records
       set screenshot_path = coalesce(nullif(trim(p_screenshot_path), ''), screenshot_path),
           ocr = coalesce(p_ocr, ocr)
     where id = v_existing and official_order_id is null;
    return jsonb_build_object('capture_record_id', v_existing, 'idempotent', true);
  end if;

  -- idempotency_key is GENERATED ALWAYS; do NOT list it. confirmed stays null.
  insert into public.capture_records (
    device_installation_id, capture_id, screenshot_path, ocr,
    captured_by, source, message_status, print_status
  ) values (
    trim(p_device), trim(p_capture_id), nullif(trim(p_screenshot_path), ''), p_ocr,
    app_private.current_staff_id(), 'floating', 'pending', 'pending'
  ) returning id into v_id;

  return jsonb_build_object('capture_record_id', v_id, 'idempotent', false);
end;
$function$;
