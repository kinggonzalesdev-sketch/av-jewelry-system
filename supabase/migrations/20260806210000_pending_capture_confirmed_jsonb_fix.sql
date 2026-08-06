-- Fix: capture_records.confirmed is JSONB (confirmation metadata / null when
-- pending), not a boolean. A pending floating capture has confirmed = null; a
-- confirmed one carries a jsonb marker. Correct create_pending_capture (no boolean
-- into jsonb) and link_capture_to_order (jsonb marker). Supersedes the versions in
-- 20260806190000_pending_capture_from_floating_screenshot.sql.
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

  insert into public.capture_records (
    device_installation_id, capture_id, idempotency_key, screenshot_path, ocr,
    captured_by, source, message_status, print_status
  ) values (
    trim(p_device), trim(p_capture_id), v_key, nullif(trim(p_screenshot_path), ''), p_ocr,
    app_private.current_staff_id(), 'floating', 'pending', 'pending'
  ) returning id into v_id;   -- confirmed stays null → "pending"

  return jsonb_build_object('capture_record_id', v_id, 'idempotent', false);
end;
$function$;

create or replace function public.link_capture_to_order(
  p_capture_record_id uuid,
  p_order_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not app_private.is_active_staff() then
    raise exception 'Not authorized: an active MineFlow staff session is required.';
  end if;
  update public.capture_records
     set official_order_id = p_order_id,
         confirmed = jsonb_build_object('confirmed_at', now(), 'via', 'pc_review')
   where id = p_capture_record_id;
end;
$function$;
