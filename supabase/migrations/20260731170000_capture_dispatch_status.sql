-- Record the outcome of sending (Pancake) / printing a capture, and attach the
-- uploaded screenshot path. Enables safe Retry Send / Retry Print for the Capture
-- app without ever recreating the order.
create or replace function public.update_capture_dispatch(
  p_device text,
  p_capture_id text,
  p_message_status text default null,
  p_print_status text default null,
  p_pancake_message_id text default null,
  p_screenshot_path text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_key text;
  v_row public.capture_records%rowtype;
begin
  if not app_private.has_permission('claim_capture') then
    raise exception 'Not authorized: the claim_capture permission is required.'
      using errcode = 'insufficient_privilege';
  end if;
  if coalesce(trim(p_device), '') = '' or coalesce(trim(p_capture_id), '') = '' then
    raise exception 'A device id and capture id are required.' using errcode = 'check_violation';
  end if;

  v_key := 'capture:' || trim(p_device) || ':' || trim(p_capture_id);

  update public.capture_records
    set message_status = coalesce(nullif(trim(p_message_status), ''), message_status),
        print_status = coalesce(nullif(trim(p_print_status), ''), print_status),
        pancake_message_id = coalesce(nullif(trim(p_pancake_message_id), ''), pancake_message_id),
        screenshot_path = coalesce(nullif(trim(p_screenshot_path), ''), screenshot_path)
    where idempotency_key = v_key
    returning * into v_row;

  if not found then
    raise exception 'No capture record for that device/capture.' using errcode = 'no_data_found';
  end if;

  return jsonb_build_object(
    'capture_record_id', v_row.id,
    'message_status', v_row.message_status,
    'print_status', v_row.print_status
  );
end;
$function$;

revoke all on function public.update_capture_dispatch(text, text, text, text, text, text) from public, anon;
grant execute on function public.update_capture_dispatch(text, text, text, text, text, text) to authenticated;
