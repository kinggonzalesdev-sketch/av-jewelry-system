-- Floating-screenshot bridge: the phone uploads a screenshot + OCR guess as a
-- PENDING capture (no order/item yet). The PC's web app then picks it up, the
-- operator confirms/corrects the item + customer, creates the order (which prints
-- on the PC and reserves the item), and the capture is linked to that order so
-- Send Invoice attaches the screenshot. Idempotent per device+capture, so a
-- repeated tap never creates a second pending row. Active-staff only; is_test +
-- live_session_id are stamped by the existing capture_records trigger.
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
    -- Idempotent: same tap → same pending row. Refresh the screenshot/OCR if newly provided.
    update public.capture_records
       set screenshot_path = coalesce(nullif(trim(p_screenshot_path), ''), screenshot_path),
           ocr = coalesce(p_ocr, ocr)
     where id = v_existing and official_order_id is null;
    return jsonb_build_object('capture_record_id', v_existing, 'idempotent', true);
  end if;

  insert into public.capture_records (
    device_installation_id, capture_id, idempotency_key, screenshot_path, ocr,
    captured_by, confirmed, source, message_status, print_status
  ) values (
    trim(p_device), trim(p_capture_id), v_key, nullif(trim(p_screenshot_path), ''), p_ocr,
    app_private.current_staff_id(), false, 'floating', 'pending', 'pending'
  ) returning id into v_id;

  return jsonb_build_object('capture_record_id', v_id, 'idempotent', false);
end;
$function$;

-- Attach a pending capture to the order the operator created from it, so Send
-- Invoice can auto-attach the mined-item screenshot. Active-staff only.
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
     set official_order_id = p_order_id, confirmed = true
   where id = p_capture_record_id;
end;
$function$;

revoke all on function public.create_pending_capture(text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.link_capture_to_order(uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_pending_capture(text, text, text, jsonb) to authenticated;
grant execute on function public.link_capture_to_order(uuid, uuid) to authenticated;
